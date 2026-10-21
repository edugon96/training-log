import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import * as models from "../contracts/models";
import * as schema from "./schema";
import type { Store } from "./db";
import type { Actor } from "./security";
import { demand } from "./errors";
import { validateBlocks, validateSession } from "./domain";
import { equipmentDetails, normalizeSessionResults } from "../contracts/training";
import { normalizeEquipment, normalizeExercise } from "./training";

export const resourceNames = ["equipment", "exercises", "weeks", "workouts", "sessions"] as const;
export type Resource = typeof resourceNames[number];
export const resourceSchemas = { equipment: models.Equipment, exercises: models.Exercise, weeks: models.Week, workouts: models.Workout, sessions: models.Session };
export type RecordValue = models.EquipmentRecord | models.ExerciseRecord | models.WeekRecord | models.WorkoutRecord | models.SessionRecord;
export type RecordMap = {
  equipment: models.EquipmentRecord; exercises: models.ExerciseRecord; weeks: models.WeekRecord;
  workouts: models.WorkoutRecord; sessions: models.SessionRecord;
};
// All resource tables intentionally share the envelope. Their data is validated by resourceSchemas.
function table(resource: Resource) { return schema[resource] as typeof schema.equipment; }
export async function list<R extends Resource>(db: Store, owner: string, resource: R): Promise<RecordMap[R][]> {
  const t = table(resource);
  const rows = await db.select().from(t).where(eq(t.ownerId, owner));
  return rows.map(r => (resource === "equipment" ? equipmentDetails(r.data) : r.data) as RecordMap[R]);
}
export async function get<R extends Resource>(db: Store, owner: string, resource: R, id: string): Promise<RecordMap[R] | null> {
  const t = table(resource);
  const [row] = await db.select().from(t).where(and(eq(t.id, id), eq(t.ownerId, owner)));
  return row ? (resource === "equipment" ? equipmentDetails(row.data) : row.data) as RecordMap[R] : null;
}
export async function requireRecord<R extends Resource>(db: Store, owner: string, resource: R, id: string) {
  z.uuid().parse(id);
  const record = await get(db, owner, resource, id);
  demand(record, 404, "not_found", `${resource} record not found`);
  return record;
}
export async function recordAudit(db: Store, actor: Actor, action: string, entityType: string, entityId: string, revision = 0) {
  await db.insert(schema.audit).values({ id: randomUUID(), ownerId: actor.ownerId, actor: actor.label, action, entityType, entityId, revision });
}
export async function changes(db: Store, owner: string) {
  const rows = await db.select().from(schema.audit).where(eq(schema.audit.ownerId, owner)).orderBy(desc(schema.audit.at)).limit(500);
  return rows.map(row => ({ id: row.id, actor: row.actor, action: row.action, entityType: row.entityType,
    entityId: row.entityId, revision: row.revision, at: row.at.toISOString() }));
}
async function validateForeign(db: Store, owner: string, resource: Resource, value: RecordValue) {
  if (resource === "exercises") {
    const exercise = value as models.ExerciseRecord;
    if (exercise.equipmentId) await requireRecord(db, owner, "equipment", exercise.equipmentId);
    for (const id of new Set((exercise.historyAliases ?? []).map(alias => alias.exerciseId))) {
      if (id !== exercise.id) await requireRecord(db, owner, "exercises", id);
    }
  }
  if (resource === "workouts" || resource === "sessions") {
    const workout = value as models.WorkoutRecord | models.SessionRecord;
    validateBlocks(workout.blocks);
    if (workout.weekId) await requireRecord(db, owner, "weeks", workout.weekId);
    if (workout.routineId) {
      const routine = await requireRecord(db, owner, "workouts", workout.routineId);
      demand(routine.kind === "routine", 422, "invalid_routine", "Routine reference must point to a routine");
      demand(routine.id !== workout.id, 422, "invalid_routine", "A workout cannot reference itself");
    }
    for (const id of new Set(workout.blocks.flatMap(b => b.items.map(i => i.exerciseId)))) {
      await requireRecord(db, owner, "exercises", id);
    }
    if (resource === "sessions") {
      const session = value as models.SessionRecord;
      validateSession(session);
      if (session.workoutId) await requireRecord(db, owner, "workouts", session.workoutId);
    } else {
      const plan = value as models.WorkoutRecord;
      demand(plan.kind !== "routine" || (!plan.weekId && !plan.date && !plan.routineId), 422, "invalid_routine", "Reusable routines must be undated");
    }
  }
}
export async function save<R extends Resource>(db: Store, actor: Actor, resource: R, input: unknown, expectedRevision: number | null): Promise<RecordMap[R]> {
  let value = resourceSchemas[resource].parse(input) as RecordMap[R];
  if (resource === "equipment") value = normalizeEquipment(value as models.EquipmentRecord) as RecordMap[R];
  if (resource === "exercises") value = normalizeExercise(value as models.ExerciseRecord) as RecordMap[R];
  if (resource === "sessions") value = normalizeSessionResults(value as models.SessionRecord) as RecordMap[R];
  const current = await get(db, actor.ownerId, resource, value.id);
  if (resource === "sessions" && (current as models.SessionRecord | null)?.loggingMode === "automatic") {
    demand((value as models.SessionRecord).loggingMode === "automatic", 422, "logging_mode",
      "An automatic session must keep automatic logging");
  }
  if (expectedRevision === null) {
    demand(value.revision === 0, 422, "revision", "New records must have revision 0");
    demand(!current, 409, "already_exists", "Record already exists", { current });
    // Detect UUID collisions across owners without disclosing the other owner's data.
    const t = table(resource);
    const exists = await db.select({ id: t.id }).from(t).where(eq(t.id, value.id));
    demand(!exists.length, 409, "id_unavailable", "Record ID is unavailable");
  } else {
    demand(current, 404, "not_found", "Record not found");
    demand(current.revision === expectedRevision && value.revision === expectedRevision, 409, "revision_conflict", "This record changed elsewhere", { current });
  }
  await validateForeign(db, actor.ownerId, resource, value);
  const next = { ...value, revision: (current?.revision ?? 0) + 1 } as RecordMap[R];
  const t = table(resource);
  const envelope = { id: next.id, ownerId: actor.ownerId, revision: next.revision, data: next as models.EquipmentRecord };
  if (current) await db.update(t).set(envelope).where(and(eq(t.id, next.id), eq(t.ownerId, actor.ownerId)));
  else await db.insert(t).values(envelope);
  if (resource === "sessions") {
    const session = next as models.SessionRecord;
    await db.delete(schema.results).where(and(eq(schema.results.sessionId, next.id), eq(schema.results.ownerId, actor.ownerId)));
    if (session.results.length) await db.insert(schema.results).values(session.results.map(r => ({
      id: r.id, sessionId: session.id, ownerId: actor.ownerId, itemId: r.itemId, targetId: r.targetId, status: r.status, reps: r.reps, data: r,
    })));
  }
  if (resource === "exercises") {
    const exercise = next as models.ExerciseRecord;
    await db.delete(schema.exerciseMuscles).where(eq(schema.exerciseMuscles.exerciseId, next.id));
    const muscles = [...(exercise.primaryMuscle ? [{ muscle: exercise.primaryMuscle, role: "primary" }] : []),
      ...new Set(exercise.secondaryMuscles)].map(m => typeof m === "string" ? { muscle: m, role: "secondary" } : m);
    if (muscles.length) await db.insert(schema.exerciseMuscles).values(muscles.map(m => ({ ...m, exerciseId: next.id })));
  }
  await recordAudit(db, actor, current ? "updated" : "created", resource, next.id, next.revision);
  return next;
}
