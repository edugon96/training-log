import Dexie, { liveQuery, type Table } from "dexie"
import {
  Session,
  type PreviousRecord,
  type SessionRecord,
  type WorkoutRecord,
  type WeekRecord,
} from "@/contracts/models"
import { workoutDraft } from "./workout-draft"
import { ApiError, saveSession } from "./api-client"
import { mergeSession, mergeSessionForSave } from "./autosave-merge"
import { publishSaved } from "./autosave-events"
import { saveRebased, saveFailure, type SaveRequest } from "./autosave-request"

interface CachedSession {
  key: string
  ownerId: string
  session: SessionRecord
  serverRevision: number
  base?: SessionRecord
}
export interface PendingSession {
  key: string
  id: string
  ownerId: string
  session: SessionRecord
  version: string
  status: "pending" | "conflict" | "error"
  message?: string
  failure?: "auth" | "invalid" | "network"
  server?: SessionRecord
  base?: SessionRecord
  legacyBase?: SessionRecord
  readyAt?: number
  request?: SaveRequest<SessionRecord> & { session?: SessionRecord }
}
class TrainingCache extends Dexie {
  editorDrafts!: Table<
    {
      key: string
      ownerId: string
      value: WorkoutRecord
      base?: WorkoutRecord
    },
    string
  >
  planEdits!: Table<
    {
      key: string
      ownerId: string
      value: WorkoutRecord
      version: string
      base?: WorkoutRecord
      request?: SaveRequest<WorkoutRecord>
      legacyBase?: WorkoutRecord
      error?: string
      failure?: "auth" | "invalid" | "network"
    },
    string
  >
  recoveries!: Table<
    { key: string; ownerId: string; value: unknown; reason: string },
    string
  >
  deleted!: Table<{ key: string; ownerId: string }, string>
  sessions!: Table<CachedSession, string>
  pending!: Table<PendingSession, string>
  history!: Table<
    { key: string; ownerId: string; value: PreviousRecord },
    string
  >
  plans!: Table<
    {
      key: string
      ownerId: string
      weeks: WeekRecord[]
      workouts: WorkoutRecord[]
    },
    string
  >
  drafts!: Table<
    { key: string; ownerId: string; session: SessionRecord },
    string
  >
  corrections!: Table<
    {
      key: string
      ownerId: string
      session: SessionRecord
      base?: SessionRecord
    },
    string
  >
  constructor() {
    super("training-platform-v1")
    this.version(1).stores({
      sessions: "key, ownerId",
      pending: "key, ownerId, status",
    })
    this.version(2).stores({ history: "key, ownerId" })
    this.version(3).stores({
      plans: "key, ownerId",
      drafts: "key, ownerId",
      corrections: "key, ownerId",
    })
    this.version(4).stores({
      editorDrafts: "key, ownerId",
      planEdits: "key, ownerId",
      deleted: "key, ownerId",
    })
    this.version(5).stores({ recoveries: "key, ownerId" })
  }
}
export const offlineDb = new TrainingCache()
const keyFor = (ownerId: string, id: string) => `${ownerId}:${id}`
function reconcilePlans(
  current: WorkoutRecord[],
  incoming: WorkoutRecord[],
  baseline: WorkoutRecord[],
  weekId?: string
) {
  const values = new Map(current.map((value) => [value.id, value]))
  const before = new Map(baseline.map((value) => [value.id, value]))
  const present = new Set(incoming.map((value) => value.id))
  for (const value of current) {
    if (
      (weekId === undefined || value.weekId === weekId) &&
      !present.has(value.id) &&
      before.get(value.id)?.revision === value.revision
    )
      values.delete(value.id)
  }
  for (const value of incoming) {
    if ((values.get(value.id)?.revision ?? -1) <= value.revision)
      values.set(value.id, value)
  }
  return [...values.values()]
}
export async function cachePlans(
  ownerId: string,
  weeks: WeekRecord[],
  workouts: WorkoutRecord[],
  baseline?: WorkoutRecord[]
) {
  await offlineDb.transaction(
    "rw",
    [offlineDb.plans, offlineDb.deleted],
    async () => {
      const current = await offlineDb.plans.get(ownerId)
      const deleted = new Set(
        (
          await offlineDb.deleted.where("ownerId").equals(ownerId).toArray()
        ).map((row) => row.key)
      )
      await offlineDb.plans.put({
        key: ownerId,
        ownerId,
        weeks,
        workouts: reconcilePlans(
          current?.workouts ?? [],
          workouts,
          baseline ?? current?.workouts ?? []
        ).filter(
          (workout) => !deleted.has(`${ownerId}:workouts:${workout.id}`)
        ),
      })
    }
  )
}
export async function readCachedPlans(ownerId: string) {
  const cache = await offlineDb.plans.get(ownerId)
  if (!cache) return cache
  const pending = await offlineDb.planEdits
    .where("ownerId")
    .equals(ownerId)
    .toArray()
  const workouts = new Map(cache.workouts.map((value) => [value.id, value]))
  for (const entry of pending) workouts.set(entry.value.id, entry.value)
  return { ...cache, workouts: [...workouts.values()] }
}
/** Replace one server scope without dropping other weeks or pending local plans. */
export async function cacheWeekPlans(
  ownerId: string,
  weekId: string,
  weeks: WeekRecord[],
  workouts: WorkoutRecord[],
  isCurrent: () => boolean = () => true,
  baseline?: WorkoutRecord[]
) {
  await offlineDb.transaction(
    "rw",
    [offlineDb.plans, offlineDb.deleted],
    async () => {
      const current = await offlineDb.plans.get(ownerId)
      const deleted = new Set(
        (
          await offlineDb.deleted.where("ownerId").equals(ownerId).toArray()
        ).map((row) => row.key)
      )
      if (!isCurrent()) return
      await offlineDb.plans.put({
        key: ownerId,
        ownerId,
        weeks,
        workouts: reconcilePlans(
          current?.workouts ?? [],
          workouts,
          baseline ?? current?.workouts ?? [],
          weekId
        ).filter(
          (workout) => !deleted.has(`${ownerId}:workouts:${workout.id}`)
        ),
      })
    }
  )
}

export async function cacheWorkout(ownerId: string, workout: WorkoutRecord) {
  await offlineDb.transaction(
    "rw",
    [offlineDb.plans, offlineDb.deleted],
    async () => {
      if (await offlineDb.deleted.get(`${ownerId}:workouts:${workout.id}`))
        return
      const current = await offlineDb.plans.get(ownerId)
      if (
        !current ||
        current.workouts.some(
          (value) =>
            value.id === workout.id && value.revision > workout.revision
        )
      )
        return
      await offlineDb.plans.put({
        ...current,
        workouts: [
          ...current.workouts.filter((value) => value.id !== workout.id),
          workout,
        ],
      })
    }
  )
}

/** Pending results always overlay an acknowledged server list. */
export async function withPendingSessions(
  ownerId: string,
  sessions: SessionRecord[],
  weekId?: string
) {
  const values = new Map(sessions.map((session) => [session.id, session]))
  for (const entry of await offlineDb.pending
    .where("ownerId")
    .equals(ownerId)
    .toArray()) {
    if (weekId === undefined || entry.session.weekId === weekId)
      values.set(entry.id, entry.session)
  }
  return [...values.values()]
}
export async function getWorkoutDraft(ownerId: string, workout: WorkoutRecord) {
  if (await offlineDb.deleted.get(`${ownerId}:workouts:${workout.id}`))
    throw new Error("This workout was deleted")
  const key = keyFor(ownerId, workout.id)
  return offlineDb.transaction(
    "rw",
    offlineDb.drafts,
    offlineDb.sessions,
    offlineDb.planEdits,
    async () => {
      const existing = await offlineDb.drafts.get(key)
      if (existing) {
        const actual = await offlineDb.sessions.get(
          keyFor(ownerId, existing.session.id)
        )
        if (actual) return actual.session
      }
      const pending = await offlineDb.planEdits.get(key)
      const session = workoutDraft(
        pending?.value ?? workout,
        existing?.session.id
      )
      await offlineDb.drafts.put({ key, ownerId, session })
      return session
    }
  )
}
export async function archiveRecovery(
  ownerId: string,
  key: string,
  value: unknown,
  reason: string
) {
  const archiveKey = `${key}:${reason}`
  if (!(await offlineDb.recoveries.get(archiveKey)))
    await offlineDb.recoveries.put({ key: archiveKey, ownerId, value, reason })
}
export async function saveCorrection(
  ownerId: string,
  session: SessionRecord,
  base?: SessionRecord
) {
  const key = keyFor(ownerId, session.id)
  const existing = await offlineDb.corrections.get(key)
  await offlineDb.corrections.put({
    key,
    ownerId,
    session,
    base: existing?.base ?? base,
  })
}
export async function readCorrection(
  ownerId: string,
  id: string,
  current?: SessionRecord
) {
  const row = await offlineDb.corrections.get(keyFor(ownerId, id))
  if (!row || !current || row.session.revision === current.revision)
    return row?.session
  if (row.base) return mergeSession(row.base, row.session, current)
  await archiveRecovery(
    ownerId,
    row.key,
    row.session,
    "Legacy correction has no baseline"
  )
  await offlineDb.corrections.delete(row.key)
  return undefined
}
export async function clearCorrection(ownerId: string, id: string) {
  await offlineDb.corrections.delete(keyFor(ownerId, id))
}
export async function cachePrevious(
  ownerId: string,
  sessionId: string,
  itemId: string,
  value: PreviousRecord
) {
  if (
    value &&
    (await offlineDb.deleted.get(`${ownerId}:sessions:${value.sessionId}`))
  )
    return
  await offlineDb.history.put({
    key: `${ownerId}:${sessionId}:${itemId}`,
    ownerId,
    value,
  })
}
export async function readCachedPrevious(
  ownerId: string,
  sessionId: string,
  itemId: string
) {
  return (
    (await offlineDb.history.get(`${ownerId}:${sessionId}:${itemId}`))?.value ??
    null
  )
}
export async function cacheSession(ownerId: string, session: SessionRecord) {
  Session.parse(session)
  const key = keyFor(ownerId, session.id)
  await offlineDb.transaction(
    "rw",
    offlineDb.sessions,
    offlineDb.pending,
    offlineDb.deleted,
    async () => {
      if (await isDeleted(ownerId, session)) return
      if (await offlineDb.pending.get(key)) return
      const current = await offlineDb.sessions.get(key)
      if (current && current.serverRevision > session.revision) return
      await offlineDb.sessions.put({
        key,
        ownerId,
        session,
        serverRevision: session.revision,
        base: session,
      })
    }
  )
}
export async function readCachedSession(ownerId: string, id: string) {
  return (await offlineDb.sessions.get(keyFor(ownerId, id)))?.session
}
export async function listCachedSessions(ownerId: string) {
  return (
    await offlineDb.sessions.where("ownerId").equals(ownerId).toArray()
  ).map((row) => row.session)
}
export async function listPending(ownerId: string): Promise<PendingSession[]> {
  return offlineDb.pending.where("ownerId").equals(ownerId).toArray()
}
export function subscribePending(
  ownerId: string,
  onChange: (pending: PendingSession[]) => void,
  onError?: (error: unknown) => void
) {
  const subscription = liveQuery(() => listPending(ownerId)).subscribe({
    next: onChange,
    error: onError,
  })
  return () => subscription.unsubscribe()
}
export async function queueSession(
  ownerId: string,
  draft: SessionRecord,
  previous?: SessionRecord,
  delayMs = 0
) {
  Session.parse(draft)
  const key = keyFor(ownerId, draft.id)
  return offlineDb.transaction(
    "rw",
    [offlineDb.sessions, offlineDb.pending, offlineDb.deleted],
    async () => {
      if (await isDeleted(ownerId, draft))
        throw new Error("This workout was deleted")
      const cached = await offlineDb.sessions.get(key)
      const pending = await offlineDb.pending.get(key)
      const current = pending?.session ?? cached?.session
      const session =
        previous && current ? mergeSession(previous, draft, current) : draft
      const base = pending ? pending.base : (cached?.base ?? previous)
      const serverRevision =
        base?.revision ?? cached?.serverRevision ?? draft.revision
      const value = { ...session, revision: serverRevision }
      await offlineDb.sessions.put({
        key,
        ownerId,
        session: value,
        serverRevision,
        base,
      })
      await offlineDb.pending.put({
        ...pending,
        key,
        id: draft.id,
        ownerId,
        session: value,
        base,
        legacyBase:
          pending && !base
            ? (pending.legacyBase ?? previous ?? pending.session)
            : undefined,
        readyAt: Date.now() + delayMs,
        version: crypto.randomUUID(),
        status: "pending",
        message: undefined,
        failure: undefined,
      })
      return value
    }
  )
}
export interface FlushResult {
  synced: number
  conflicts: number
  authRequired: boolean
}
const running = new Map<string, Promise<FlushResult>>()
export async function flushQueue(ownerId: string): Promise<FlushResult> {
  const existing = running.get(ownerId)
  if (existing) return existing
  const run = () => flush(ownerId)
  const promise: Promise<FlushResult> = Promise.resolve(
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`training-sync:${ownerId}`, run)
      : run()
  )
  running.set(ownerId, promise)
  try {
    return await promise
  } finally {
    running.delete(ownerId)
  }
}
async function flush(ownerId: string): Promise<FlushResult> {
  const summary: FlushResult = { synced: 0, conflicts: 0, authRequired: false }
  for (const initial of await listPending(ownerId)) {
    for (let pass = 0; pass < 20; pass++) {
      const entry = await offlineDb.pending.get(initial.key)
      if (!entry) break
      if (!entry.request && (entry.readyAt ?? 0) > Date.now()) break
      try {
        const base = entry.base
        const legacy = entry.request?.session
        let request: SaveRequest<SessionRecord> = entry.request
          ? { ...entry.request, value: entry.request.value ?? legacy! }
          : {
              key: crypto.randomUUID(),
              version: entry.version,
              value: entry.session,
              local: entry.session,
              base,
            }
        const result = await saveRebased(
          request,
          saveSession,
          Session,
          mergeSessionForSave,
          async (next) => {
            request = next
            await offlineDb.pending.update(entry.key, { request: next })
          },
          async (local, current) => {
            await archiveRecovery(
              ownerId,
              entry.key,
              local,
              "Legacy result draft has no baseline"
            )
            return entry.legacyBase && request.version === entry.version
              ? mergeSession(entry.legacyBase, local, current)
              : current
          }
        )
        const saved = result.saved
        const before = result.request.local ?? result.request.value
        let present = false
        await offlineDb.transaction(
          "rw",
          [offlineDb.pending, offlineDb.sessions],
          async () => {
            const latest = await offlineDb.pending.get(entry.key)
            if (!latest) return
            present = true
            const value =
              latest.version === result.request.version
                ? saved
                : mergeSession(before, latest.session, saved)
            await offlineDb.sessions.put({
              key: entry.key,
              ownerId,
              session: value,
              base: saved,
              serverRevision: saved.revision,
            })
            if (latest.version === result.request.version)
              await offlineDb.pending.delete(entry.key)
            else
              await offlineDb.pending.put({
                ...latest,
                session: value,
                base: saved,
                legacyBase: undefined,
                request: undefined,
                status: "pending",
                message: undefined,
                failure: undefined,
                server: undefined,
              })
          }
        )
        if (present)
          publishSaved({ ownerId, kind: "sessions", before, after: saved })
        summary.synced++
      } catch (error) {
        if (error instanceof ApiError && error.code === "record_deleted") {
          await purgeWorkout(ownerId, {
            workoutId: entry.session.workoutId,
            sessionIds: [entry.id],
          })
          break
        }
        if (error instanceof ApiError && error.status === 401)
          summary.authRequired = true
        const failure = saveFailure(error)
        await offlineDb.pending.update(entry.key, {
          status: "error",
          message: failure.message,
          failure: failure.failure,
          ...(failure.rejected ? { request: undefined } : {}),
        })
        break
      }
    }
    if (summary.authRequired) break
  }
  return summary
}
export async function clearOwnerCache(ownerId: string) {
  await offlineDb.transaction(
    "rw",
    [
      offlineDb.pending,
      offlineDb.sessions,
      offlineDb.history,
      offlineDb.plans,
      offlineDb.drafts,
      offlineDb.corrections,
      offlineDb.editorDrafts,
      offlineDb.planEdits,
    ],
    async () => {
      if (
        (await offlineDb.planEdits.where("ownerId").equals(ownerId).count()) ||
        (await offlineDb.editorDrafts.where("ownerId").equals(ownerId).count())
      )
        throw new Error(
          "Resolve your unfinished workout edits before clearing local data."
        )
      if (await offlineDb.pending.where("ownerId").equals(ownerId).count())
        throw new Error(
          "Sync or explicitly resolve your unsaved sessions before clearing local data."
        )
      if (await offlineDb.corrections.where("ownerId").equals(ownerId).count())
        throw new Error(
          "Resolve your unfinished result corrections before clearing local data."
        )
      await offlineDb.sessions.where("ownerId").equals(ownerId).delete()
      await offlineDb.history.where("ownerId").equals(ownerId).delete()
      await offlineDb.plans.where("ownerId").equals(ownerId).delete()
      await offlineDb.drafts.where("ownerId").equals(ownerId).delete()
    }
  )
}

async function isDeleted(ownerId: string, session: SessionRecord) {
  return (
    !!(await offlineDb.deleted.get(`${ownerId}:sessions:${session.id}`)) ||
    !!(
      session.workoutId &&
      (await offlineDb.deleted.get(`${ownerId}:workouts:${session.workoutId}`))
    )
  )
}
export async function purgeWorkout(
  ownerId: string,
  deleted: { workoutId: string | null; sessionIds: string[] }
) {
  await offlineDb.transaction(
    "rw",
    [
      offlineDb.sessions,
      offlineDb.pending,
      offlineDb.history,
      offlineDb.plans,
      offlineDb.drafts,
      offlineDb.corrections,
      offlineDb.editorDrafts,
      offlineDb.planEdits,
      offlineDb.deleted,
      offlineDb.recoveries,
    ],
    async () => {
      const ids = new Set(deleted.sessionIds)
      for (const table of [
        offlineDb.sessions,
        offlineDb.pending,
        offlineDb.drafts,
        offlineDb.corrections,
      ]) {
        const rows = await table.where("ownerId").equals(ownerId).toArray()
        for (const row of rows)
          if (
            ids.has(row.session.id) ||
            (deleted.workoutId && row.session.workoutId === deleted.workoutId)
          ) {
            ids.add(row.session.id)
            await table.delete(row.key)
          }
      }
      for (const id of ids)
        await offlineDb.deleted.put({
          key: `${ownerId}:sessions:${id}`,
          ownerId,
        })
      if (deleted.workoutId) {
        await offlineDb.deleted.put({
          key: `${ownerId}:workouts:${deleted.workoutId}`,
          ownerId,
        })
        const plans = await offlineDb.plans.get(ownerId)
        if (plans)
          await offlineDb.plans.put({
            ...plans,
            workouts: plans.workouts.filter(
              (workout) => workout.id !== deleted.workoutId
            ),
          })
      }
      for (const table of [offlineDb.editorDrafts, offlineDb.planEdits]) {
        for (const row of await table
          .where("ownerId")
          .equals(ownerId)
          .toArray())
          if (
            row.value.id === deleted.workoutId ||
            ids.has(row.value.id) ||
            [...ids].some((id) => row.key === `${ownerId}:session:${id}`)
          )
            await table.delete(row.key)
      }
      const archivedIds = [
        ...ids,
        ...(deleted.workoutId ? [deleted.workoutId] : []),
      ]
      for (const row of await offlineDb.recoveries
        .where("ownerId")
        .equals(ownerId)
        .toArray())
        if (
          archivedIds.some(
            (id) =>
              row.key.startsWith(`${ownerId}:${id}:`) ||
              row.key.startsWith(`${ownerId}:session:${id}:`)
          )
        )
          await offlineDb.recoveries.delete(row.key)
      // Previous-performance caches can reference any deleted session.
      await offlineDb.history.where("ownerId").equals(ownerId).delete()
    }
  )
}
