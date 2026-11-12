import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { isAPIError } from "better-auth/api";
import { ApiKeyInfo, DateOnly, DeleteRequest, ImportManifest, Scope, TrainingDefaults, TimerSettings, type ImportData } from "../contracts/models";
import { buildCatalog } from "../contracts/training";
import { getDb, withTransaction, type Store } from "./db";
import { getAuth, transactionAuth } from "./auth";
import { authenticate, authorize, checkOrigin, fingerprint, seal, unseal, canonical, type Actor } from "./security";
import { demand, HttpError } from "./errors";
import { list, previousBatch, requireRecord, save, changes, recordAudit, resourceNames, deletionPreview, deleteWorkout, assertNotDeleted, type Resource, type ListFilter } from "./repository";
import { cloneBlocks, computeLedger, startSession } from "./domain";
import { receipts, importSources } from "./schema";
import { getTrainingDefaults, saveTrainingDefaults, storedTrainingDefaults, normalizeEquipment, normalizeExercise } from "./training";
import { getTimerSettings, saveTimerSettings, storedTimerSettings } from "./timers";

const Id = z.uuid();
const resource = (s: string): s is Resource => resourceNames.includes(s as Resource);
const isWrite = (method: string) => method !== "GET";
function requiredScope(path: string[], method: string): z.infer<typeof Scope> {
  if (!isWrite(method)) return "read";
  if (path[0] === "equipment" || path[0] === "exercises") return "library:write";
  if (path[0] === "sessions" || path[2] === "start") return "results:write";
  return "plans:write";
}
type Reply = { body: unknown; status: number; csv?: string };
const ok = (body: unknown, status = 200): Reply => ({ body, status });

export async function exportOwner(db: Store, owner: string): Promise<ImportData> {
  const equipment = await list(db, owner, "equipment");
  const exercises = await list(db, owner, "exercises");
  const weeks = await list(db, owner, "weeks");
  const workouts = await list(db, owner, "workouts");
  const sessions = await list(db, owner, "sessions");
  const trainingDefaults = await storedTrainingDefaults(db, owner);
  const timerSettings = await storedTimerSettings(db, owner);
  const sources = await db.select().from(importSources).where(eq(importSources.ownerId, owner));
  return { version: 1, equipment, exercises, weeks, workouts, sessions, ...(trainingDefaults ? { trainingDefaults } : {}), ...(timerSettings ? { timerSettings } : {}),
    sources: sources.map(source => ({ file: source.file, sha256: source.sha256, notes: source.notes })) };
}
function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(manifest: ImportData) {
  const rows: unknown[][] = [["Date", "Workout", "Movement", "Equipment", "Setup", "Set", "Status", "Reps", "Load", "Unit", "Basis", "Seconds", "Meters", "RIR", "Notes", "User Notes", "Workout Notes", "Workout User Notes"]];
  for (const session of manifest.sessions) {
    for (const result of session.results) {
      const item = session.blocks.flatMap(b => b.items).find(i => i.id === result.itemId);
      rows.push([session.performedOn, session.title, item?.name, item?.equipment, item?.setup,
        item ? item.sets.findIndex(s => s.id === result.targetId) + 1 : null,
        result.status, result.reps, result.load?.value, result.load?.unit, result.load?.basis,
        result.durationSeconds, result.distanceMeters, result.rir, result.notes, result.userNotes,
        session.notes, session.userNotes]);
    }
  }
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
const comparable = (value: { revision: number }) => canonical({ ...value, revision: 0 });
function comparableResource(resource: Resource, value: Parameters<typeof comparable>[0]) {
  if (resource === "equipment") return comparable(normalizeEquipment(value as ImportData["equipment"][number]));
  if (resource === "exercises") return comparable(normalizeExercise(value as ImportData["exercises"][number]));
  return comparable(value);
}
export async function importOwner(db: Store, actor: Actor, raw: unknown) {
  const manifest = ImportManifest.parse(raw);
  let created = 0;
  let unchanged = 0;
  if (manifest.timerSettings) {
    const existing = await storedTimerSettings(db, actor.ownerId);
    if (existing) {
      demand(comparable(existing) === comparable(manifest.timerSettings), 409, "import_conflict", "Import would overwrite existing timer settings");
      unchanged++;
    } else {
      await saveTimerSettings(db, actor, { ...manifest.timerSettings, revision: 0 }, 0);
      created++;
    }
  }
  if (manifest.trainingDefaults) {
    const existingDefaults = await storedTrainingDefaults(db, actor.ownerId);
    if (existingDefaults) {
      demand(comparable(existingDefaults) === comparable(manifest.trainingDefaults), 409, "import_conflict",
        "Import would overwrite existing training defaults", { resource: "training-defaults" });
      unchanged++;
    } else {
      await saveTrainingDefaults(db, actor, { ...manifest.trainingDefaults, revision: 0 }, 0);
      created++;
    }
  }
  // Parent resources first, then routines, then dated workouts, then sessions.
  for (const name of resourceNames) {
    const deferredAliases: ImportData["exercises"] = [];
    const records = name === "workouts"
      ? [...manifest.workouts].sort((a, b) => Number(a.kind !== "routine") - Number(b.kind !== "routine"))
      : manifest[name];
    const existing = new Map((await list(db, actor.ownerId, name)).map(r => [r.id, r]));
    const seen = new Set<string>();
    for (const record of records) {
      demand(!seen.has(record.id), 422, "duplicate_id", `Duplicate ${name} record in import`);
      seen.add(record.id);
      const current = existing.get(record.id);
      if (current) {
        demand(comparableResource(name, current) === comparableResource(name, record), 409, "import_conflict", "Import would overwrite an existing record", { resource: name, id: record.id });
        unchanged++;
      } else {
        // Import identities first so verified aliases can reference later records
        // (or each other). The surrounding import transaction remains atomic.
        if (name === "exercises" && (record as ImportData["exercises"][number]).historyAliases?.length) {
          const exercise = record as ImportData["exercises"][number];
          const identity = { ...exercise };
          delete identity.historyAliases;
          const inserted = await save(db, actor, "exercises", { ...identity, revision: 0 }, null);
          deferredAliases.push({ ...inserted, historyAliases: exercise.historyAliases });
        } else {
          await save(db, actor, name, { ...record, revision: 0 }, null);
        }
        created++;
      }
    }
    for (const exercise of deferredAliases) {
      await save(db, actor, "exercises", exercise, exercise.revision);
    }
  }
  for (const source of manifest.sources) {
    await db.insert(importSources).values({ ownerId: actor.ownerId, ...source }).onConflictDoNothing();
  }
  await recordAudit(db, actor, "imported", "backup", randomUUID());
  return { created, unchanged };
}
type KeyLike = { id: string; name?: string | null; prefix?: string | null; start?: string | null;
  permissions?: Record<string, string[]> | null; createdAt: Date; updatedAt?: Date; enabled?: boolean; metadata?: unknown };
function keyInfo(key: KeyLike) {
  const metadata = key.metadata as { revokedAt?: string } | null;
  return ApiKeyInfo.parse({ id: key.id, name: key.name || "Unnamed key", prefix: key.start || key.prefix || "",
    scopes: key.permissions?.workout ?? [], createdAt: key.createdAt.toISOString(),
    revokedAt: metadata?.revokedAt ?? (key.enabled === false ? key.updatedAt?.toISOString() ?? null : null) });
}
async function dispatch(db: Store, request: Request, actor: Actor, path: string[], body: unknown, keyAuth: ReturnType<typeof getAuth> | ReturnType<typeof transactionAuth> = getAuth()): Promise<Reply> {
  const method = request.method;
  const url = new URL(request.url);
  const [first, id, action] = path;
  if (first === "me" && path.length === 1 && method === "GET") return ok(actor.user);
  if (first === "timer-settings" && path.length === 1) {
    if (method === "GET") return ok(await getTimerSettings(db, actor.ownerId));
    if (method === "PUT") {
      const input = z.object({ expectedRevision: z.number().int().nonnegative(), value: TimerSettings }).strict().parse(body);
      return ok(await saveTimerSettings(db, actor, input.value, input.expectedRevision));
    }
  }
  if (first === "catalog" && path.length === 1 && method === "GET") return ok(buildCatalog(await list(db, actor.ownerId, "equipment")));
  if (first === "training-defaults" && path.length === 1) {
    if (method === "GET") return ok(await getTrainingDefaults(db, actor.ownerId));
    if (method === "PUT") {
      const input = z.object({ expectedRevision: z.number().int().nonnegative(), value: TrainingDefaults }).strict().parse(body);
      return ok(await saveTrainingDefaults(db, actor, input.value, input.expectedRevision));
    }
  }
  if (first === "changes" && path.length === 1 && method === "GET") return ok(await changes(db, actor.ownerId));
  if (first === "history" && (path.length === 1 || (path.length === 2 && id === "batch")) && method === "GET") {
    const batch = id === "batch";
    const ids = [...new Set(batch
      ? z.array(Id).min(1).max(100).parse(url.searchParams.getAll("exerciseId"))
      : [Id.parse(url.searchParams.get("exerciseId"))])];
    const exercises = await Promise.all(ids.map(exerciseId => requireRecord(db, actor.ownerId, "exercises", exerciseId)));
    const before = DateOnly.parse(url.searchParams.get("before"));
    const routineId = url.searchParams.get("routineId");
    if (routineId) await requireRecord(db, actor.ownerId, "workouts", Id.parse(routineId));
    const previous = await previousBatch(db, actor.ownerId, exercises, routineId, before);
    return ok(batch ? previous : previous[ids[0]]);
  }
  if (first === "ledger" && path.length === 1 && method === "GET") {
    const week = await requireRecord(db, actor.ownerId, "weeks", Id.parse(url.searchParams.get("weekId")));
    return ok(computeLedger(week, await list(db, actor.ownerId, "workouts", { weekId: week.id, kind: "planned" }), await list(db, actor.ownerId, "sessions", { weekId: week.id })));
  }
  if (first === "export" && path.length === 1 && method === "GET") {
    const data = await exportOwner(db, actor.ownerId);
    return url.searchParams.get("format") === "csv" ? { ...ok(null), csv: exportCsv(data) } : ok(data);
  }
  if (first === "import" && path.length === 1 && method === "POST") {
    const input = z.object({ manifest: ImportManifest }).strict().parse(body);
    return ok(await importOwner(db, actor, input.manifest));
  }
  if (first === "keys") {
    const auth = keyAuth;
    if (method === "GET" && path.length === 1) {
      const all: ReturnType<typeof keyInfo>[] = [];
      let offset = 0;
      while (true) {
        const keys = await auth.api.listApiKeys({ headers: request.headers, query: { limit: 100, offset } });
        all.push(...keys.apiKeys.map(keyInfo));
        offset += keys.apiKeys.length;
        if (offset >= keys.total || !keys.apiKeys.length) break;
      }
      return ok(all);
    }
    if (method === "POST" && path.length === 1) {
      const input = z.object({ name: z.string().trim().min(1).max(100), scopes: z.array(Scope).min(1) }).strict().parse(body);
      const key = await auth.api.createApiKey({ body: { name: input.name, userId: actor.ownerId, permissions: { workout: [...new Set(input.scopes)] } } });
      await recordAudit(db, actor, "created", "api_key", key.id);
      return ok({ key: key.key, info: keyInfo(key) }, 201);
    }
    if (method === "DELETE" && path.length === 2) {
      const key = await auth.api.getApiKey({ headers: request.headers, query: { id } });
      await auth.api.updateApiKey({ headers: request.headers, body: { keyId: key.id, enabled: false, metadata: { revokedAt: new Date().toISOString() } } });
      await recordAudit(db, actor, "revoked", "api_key", key.id);
      return ok({ ok: true });
    }
  }
  if (resource(first)) {
    if (first === "workouts" || first === "sessions") {
      if (path.length === 3 && action === "deletion" && method === "GET")
        return ok(await deletionPreview(db, actor.ownerId, first, Id.parse(id)));
      if (path.length === 2 && method === "DELETE") {
        const input = DeleteRequest.parse(body);
        demand(input.expected.id === Id.parse(id) && input.expected.resource === first, 422, "id_mismatch", "Confirmation must match the selected workout");
        return ok(await deleteWorkout(db, actor, input.expected));
      }
    }
    if (path.length === 1 && method === "GET") {
      const filter: ListFilter = {};
      const weekId = url.searchParams.get("weekId");
      const kind = url.searchParams.get("kind");
      if (weekId) {
        await requireRecord(db, actor.ownerId, "weeks", Id.parse(weekId));
        filter.weekId = weekId;
      }
      if (kind) {
        filter.kind = z.enum(["routine", "planned"]).parse(kind);
      }
      const workoutId = url.searchParams.get("workoutId");
      if (workoutId && first === "sessions") {
        await requireRecord(db, actor.ownerId, "workouts", Id.parse(workoutId));
        filter.workoutId = workoutId;
      }
      return ok(await list(db, actor.ownerId, first, filter));
    }
    if (path.length === 2 && method === "GET") return ok(await requireRecord(db, actor.ownerId, first, Id.parse(id)));
    if (path.length === 1 && method === "POST") {
      const input = z.object({ value: z.unknown() }).strict().parse(body);
      return ok(await save(db, actor, first, input.value, null), 201);
    }
    if (path.length === 2 && method === "PUT") {
      const input = z.object({ expectedRevision: z.number().int().min(1), value: z.object({ id: Id }).passthrough() }).strict().parse(body);
      demand(input.value.id === Id.parse(id), 422, "id_mismatch", "Body ID must match URL");
      return ok(await save(db, actor, first, input.value, input.expectedRevision));
    }
    if (first === "workouts" && path.length === 3 && action === "start" && method === "POST") {
      const input = z.object({ performedOn: DateOnly }).strict().parse(body);
      const workout = await requireRecord(db, actor.ownerId, "workouts", Id.parse(id));
      return ok(await save(db, actor, "sessions", startSession(workout, input.performedOn), null), 201);
    }
    if (first === "weeks" && path.length === 3 && action === "copy" && method === "POST") {
      const input = z.object({ startDate: DateOnly }).strict().parse(body);
      const week = await requireRecord(db, actor.ownerId, "weeks", Id.parse(id));
      const defaults = await getTrainingDefaults(db, actor.ownerId);
      const next = await save(db, actor, "weeks", { ...week, id: randomUUID(), revision: 0, startDate: input.startDate,
        title: `Week of ${input.startDate}`, targets: defaults.targets }, null);
      const delta = Date.parse(input.startDate) - Date.parse(week.startDate);
      for (const workout of await list(db, actor.ownerId, "workouts", { weekId: week.id, kind: "planned" })) {
        await save(db, actor, "workouts", { ...workout, id: randomUUID(), revision: 0, weekId: next.id,
          date: workout.date ? new Date(Date.parse(workout.date) + delta).toISOString().slice(0, 10) : null,
          blocks: cloneBlocks(workout.blocks), source: null }, null);
      }
      return ok(next, 201);
    }
  }
  throw new HttpError(404, "not_found", "Endpoint not found");
}
function response(reply: Reply) {
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization" };
  if (reply.csv !== undefined) return new Response(reply.csv, { status: reply.status,
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="workout-results.csv"' } });
  return Response.json(reply.body, { status: reply.status, headers });
}
export async function handleApi(request: Request, path: string[]) {
  try {
    const actor = await authenticate(request);
    authorize(actor, requiredScope(path, request.method), path[0] === "keys" || path[0] === "import");
    if (request.method === "DELETE" && path[0] === "workouts") authorize(actor, "results:write");
    if (!isWrite(request.method)) {
      if (["export", "ledger", "history"].includes(path[0]) || path[2] === "deletion") {
        return response(await withTransaction(async (tx, client) => {
          await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          return dispatch(tx, request, actor, path, null);
        }));
      }
      return response(await dispatch(getDb(), request, actor, path, null));
    }
    checkOrigin(request, actor);
    const key = z.string().min(8).max(200).parse(request.headers.get("idempotency-key"));
    const text = await request.text();
    demand(text.length < 12_000_000, 413, "too_large", "Request is too large");
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; }
    catch { throw new HttpError(400, "invalid_json", "Body must be valid JSON"); }
    const hash = fingerprint(request.method, new URL(request.url).pathname, body);
    const reply = await withTransaction(async (tx, client) => {
      // Serialize this owner's mutations, including checks, graph writes, audit and receipt.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.ownerId}, 0))`);
      const [receipt] = await tx.select().from(receipts).where(and(eq(receipts.ownerId, actor.ownerId), eq(receipts.key, key)));
      if (receipt) {
        demand(receipt.hash === hash, 409, "idempotency_conflict", "This idempotency key was used for another request");
        if (path[0] === "workouts" && path[2] === "start") await assertNotDeleted(tx, actor.ownerId, "workouts", Id.parse(path[1]));
        // Replaying an old save must not return deleted data as a current record.
        if (resource(path[0]) && (request.method === "POST" || request.method === "PUT") && path.length <= 2) {
          const value = (body as { value?: { id?: string; workoutId?: string } })?.value;
          if (value?.id && Id.safeParse(value.id).success) await assertNotDeleted(tx, actor.ownerId, path[0], value.id);
          if (path[0] === "sessions" && value?.workoutId && Id.safeParse(value.workoutId).success) await assertNotDeleted(tx, actor.ownerId, "workouts", value.workoutId);
        }
        return { body: unseal(receipt.response), status: receipt.status };
      }
      const result = await dispatch(tx, request, actor, path, body, path[0] === "keys" ? transactionAuth(client) : getAuth());
      await tx.insert(receipts).values({ ownerId: actor.ownerId, key, hash, response: seal(result.body), status: result.status });
      return result;
    });
    return response(reply);
  } catch (error) {
    if (error instanceof HttpError) return response({ status: error.status,
      body: { error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } } });
    if (error instanceof ZodError) return response({ status: 422,
      body: { error: { code: "validation", message: "Check the request fields", details: error.issues } } });
    if (isAPIError(error) && error.statusCode >= 400 && error.statusCode < 500) {
      return response({ status: error.statusCode, body: { error: {
        code: error.body?.code ?? "authentication", message: error.body?.message ?? "Authentication request rejected",
      } } });
    }
    console.error("API request failed", error instanceof Error ? error.message : "Unknown error");
    return response({ status: 500, body: { error: { code: "internal", message: "The request could not be completed" } } });
  }
}
