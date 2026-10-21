import Dexie, { liveQuery, type Table } from "dexie"
import {
  Session,
  type PreviousRecord,
  type SessionRecord,
  type WorkoutRecord,
  type WeekRecord,
} from "@/contracts/models"
import { workoutDraft } from "./workout-draft"
import { ApiError, getSession, saveSession } from "./api-client"

interface CachedSession {
  key: string
  ownerId: string
  session: SessionRecord
  serverRevision: number
}
export interface PendingSession {
  key: string
  id: string
  ownerId: string
  session: SessionRecord
  version: string
  status: "pending" | "conflict" | "error"
  message?: string
  server?: SessionRecord
  request?: { key: string; version: string; session: SessionRecord }
}
class TrainingCache extends Dexie {
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
    { key: string; ownerId: string; session: SessionRecord },
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
  }
}
export const offlineDb = new TrainingCache()
const keyFor = (ownerId: string, id: string) => `${ownerId}:${id}`
export async function cachePlans(
  ownerId: string,
  weeks: WeekRecord[],
  workouts: WorkoutRecord[]
) {
  await offlineDb.plans.put({ key: ownerId, ownerId, weeks, workouts })
}
export async function readCachedPlans(ownerId: string) {
  return offlineDb.plans.get(ownerId)
}
export async function getWorkoutDraft(ownerId: string, workout: WorkoutRecord) {
  const key = keyFor(ownerId, workout.id)
  return offlineDb.transaction(
    "rw",
    offlineDb.drafts,
    offlineDb.sessions,
    async () => {
      const existing = await offlineDb.drafts.get(key)
      if (existing) {
        const actual = await offlineDb.sessions.get(
          keyFor(ownerId, existing.session.id)
        )
        if (actual) return actual.session
      }
      const session = workoutDraft(workout, existing?.session.id)
      await offlineDb.drafts.put({ key, ownerId, session })
      return session
    }
  )
}
export async function saveCorrection(ownerId: string, session: SessionRecord) {
  await offlineDb.corrections.put({
    key: keyFor(ownerId, session.id),
    ownerId,
    session,
  })
}
export async function readCorrection(ownerId: string, id: string) {
  return (await offlineDb.corrections.get(keyFor(ownerId, id)))?.session
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
    async () => {
      if (await offlineDb.pending.get(key)) return
      await offlineDb.sessions.put({
        key,
        ownerId,
        session,
        serverRevision: session.revision,
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
export async function queueSession(ownerId: string, draft: SessionRecord) {
  Session.parse(draft)
  const key = keyFor(ownerId, draft.id)
  await offlineDb.transaction(
    "rw",
    offlineDb.sessions,
    offlineDb.pending,
    async () => {
      const cached = await offlineDb.sessions.get(key)
      const pending = await offlineDb.pending.get(key)
      const serverRevision = cached?.serverRevision ?? draft.revision
      const session = { ...draft, revision: serverRevision }
      await offlineDb.sessions.put({ key, ownerId, session, serverRevision })
      await offlineDb.pending.put({
        ...pending,
        key,
        id: draft.id,
        ownerId,
        session,
        version: crypto.randomUUID(),
        status: pending?.status === "conflict" ? "conflict" : "pending",
      })
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
  // One pass per snapshot. New edits remain queued for the next explicit/online flush.
  for (const entry of await listPending(ownerId)) {
    if (entry.status === "conflict") {
      summary.conflicts++
      continue
    }
    const outgoing = await offlineDb.transaction(
      "rw",
      offlineDb.pending,
      async () => {
        const current = await offlineDb.pending.get(entry.key)
        if (!current || current.status === "conflict") return null
        current.request ??= {
          key: crypto.randomUUID(),
          version: current.version,
          session: current.session,
        }
        await offlineDb.pending.put(current)
        return current.request
      }
    )
    if (!outgoing) continue
    try {
      const saved = await saveSession(outgoing.session, outgoing.key)
      await offlineDb.transaction(
        "rw",
        offlineDb.pending,
        offlineDb.sessions,
        async () => {
          const latest = await offlineDb.pending.get(entry.key)
          if (!latest) return
          if (latest.version === outgoing.version) {
            await offlineDb.sessions.put({
              key: entry.key,
              ownerId,
              session: saved,
              serverRevision: saved.revision,
            })
            await offlineDb.pending.delete(entry.key)
          } else {
            const session = { ...latest.session, revision: saved.revision }
            await offlineDb.sessions.put({
              key: entry.key,
              ownerId,
              session,
              serverRevision: saved.revision,
            })
            await offlineDb.pending.put({
              ...latest,
              session,
              request: undefined,
              status: "pending",
              message: undefined,
            })
          }
        }
      )
      summary.synced++
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        summary.authRequired = true
        break
      }
      const conflict = error instanceof ApiError && error.status === 409
      const candidate =
        error instanceof ApiError &&
        typeof error.details === "object" &&
        error.details !== null &&
        "current" in error.details
          ? Session.safeParse(error.details.current)
          : null
      await offlineDb.transaction("rw", offlineDb.pending, async () => {
        const latest = await offlineDb.pending.get(entry.key)
        if (!latest) return
        await offlineDb.pending.put({
          ...latest,
          status: conflict ? "conflict" : "error",
          message: error instanceof Error ? error.message : "Unable to sync",
          server: candidate?.success ? candidate.data : undefined,
        })
      })
      if (conflict) summary.conflicts++
      else break
    }
  }
  return summary
}
export async function resolveConflict(
  ownerId: string,
  id: string,
  choice: "local" | "server"
) {
  const key = keyFor(ownerId, id)
  const current = await getSession(id)
  await offlineDb.transaction(
    "rw",
    offlineDb.pending,
    offlineDb.sessions,
    async () => {
      const row = await offlineDb.pending.get(key)
      if (!row) return
      if (choice === "server") {
        await offlineDb.pending.delete(key)
        await offlineDb.sessions.put({
          key,
          ownerId,
          session: current,
          serverRevision: current.revision,
        })
      } else {
        const session = { ...row.session, revision: current.revision }
        await offlineDb.pending.put({
          ...row,
          session,
          version: crypto.randomUUID(),
          request: undefined,
          status: "pending",
          server: undefined,
          message: undefined,
        })
        await offlineDb.sessions.put({
          key,
          ownerId,
          session,
          serverRevision: current.revision,
        })
      }
    }
  )
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
    ],
    async () => {
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
