import { Workout, type WorkoutRecord } from "@/contracts/models"
import { ApiError, saveWorkout } from "./api-client"
import { offlineDb, purgeWorkout, archiveRecovery } from "./offline"
import { mergeWorkout, recoverGroupOrder } from "./autosave-merge"
import { saveRebased, saveFailure, type SaveRequest } from "./autosave-request"
import { publishSaved } from "./autosave-events"

export async function queuePlanEdit(
  ownerId: string,
  value: WorkoutRecord,
  previous?: WorkoutRecord
) {
  Workout.parse(value)
  const key = `${ownerId}:${value.id}`
  return offlineDb.transaction(
    "rw",
    [offlineDb.planEdits, offlineDb.plans, offlineDb.deleted],
    async () => {
      if (await offlineDb.deleted.get(`${ownerId}:workouts:${value.id}`))
        throw new Error("This workout was deleted")
      const pending = await offlineDb.planEdits.get(key)
      const cached = (await offlineDb.plans.get(ownerId))?.workouts.find(
        (workout) => workout.id === value.id
      )
      const current = pending?.value ?? cached
      const next =
        previous && current ? mergeWorkout(previous, value, current) : value
      const base = pending
        ? pending.base
        : (previous ??
          (cached?.revision === value.revision ? cached : undefined))
      await offlineDb.planEdits.put({
        ...pending,
        key,
        ownerId,
        value: next,
        base,
        legacyBase:
          pending && !base
            ? (pending.legacyBase ?? previous ?? pending.value)
            : undefined,
        version: crypto.randomUUID(),
        error: undefined,
        failure: undefined,
      })
      return next
    }
  )
}
const running = new Map<string, Promise<Map<string, WorkoutRecord>>>()
export function flushPlanEdits(
  ownerId: string
): Promise<Map<string, WorkoutRecord>> {
  const existing = running.get(ownerId)
  if (existing) return existing
  const work = async () => {
    const acknowledged = new Map<string, WorkoutRecord>()
    for (const initial of await offlineDb.planEdits
      .where("ownerId")
      .equals(ownerId)
      .toArray()) {
      for (let pass = 0; pass < 20; pass++) {
        const entry = await offlineDb.planEdits.get(initial.key)
        if (!entry) break
        try {
          const request: SaveRequest<WorkoutRecord> = entry.request ?? {
            key: crypto.randomUUID(),
            version: entry.version,
            value: entry.value,
            local: entry.value,
            base: entry.base,
          }
          // Requests written by older clients may not carry their baseline.
          request.base ??= entry.base
          const result = await saveRebased(
            request,
            saveWorkout,
            Workout,
            mergeWorkout,
            async (request) => {
              await offlineDb.planEdits.update(entry.key, { request })
            },
            async (local, current) => {
              await archiveRecovery(
                ownerId,
                entry.key,
                local,
                "Legacy workout draft has no baseline"
              )
              const recovered = recoverGroupOrder(local, current)
              return entry.legacyBase && request.version === entry.version
                ? mergeWorkout(entry.legacyBase, local, recovered)
                : recovered
            }
          )
          const saved = result.saved,
            before = result.request.local ?? result.request.value
          let present = false
          await offlineDb.transaction(
            "rw",
            [offlineDb.planEdits, offlineDb.plans, offlineDb.editorDrafts],
            async () => {
              const latest = await offlineDb.planEdits.get(entry.key)
              if (!latest) return
              present = true
              const cache = await offlineDb.plans.get(ownerId)
              if (cache)
                await offlineDb.plans.put({
                  ...cache,
                  workouts: [
                    ...cache.workouts.filter((w) => w.id !== saved.id),
                    saved,
                  ],
                })
              if (latest.version === result.request.version)
                await offlineDb.planEdits.delete(entry.key)
              else
                await offlineDb.planEdits.put({
                  ...latest,
                  value: mergeWorkout(before, latest.value, saved),
                  base: saved,
                  legacyBase: undefined,
                  request: undefined,
                  error: undefined,
                  failure: undefined,
                })
              for (const draft of await offlineDb.editorDrafts
                .where("ownerId")
                .equals(ownerId)
                .toArray()) {
                if (draft.value.id === saved.id && draft.base)
                  await offlineDb.editorDrafts.put({
                    ...draft,
                    value: mergeWorkout(before, draft.value, saved),
                    base: saved,
                  })
              }
            }
          )
          if (present) {
            acknowledged.set(saved.id, saved)
            publishSaved({ ownerId, kind: "workouts", before, after: saved })
          }
        } catch (error) {
          if (error instanceof ApiError && error.code === "record_deleted") {
            await purgeWorkout(ownerId, {
              workoutId: entry.value.id,
              sessionIds: [],
            })
            break
          }
          const failure = saveFailure(error)
          await offlineDb.planEdits.update(entry.key, {
            error: failure.message,
            failure: failure.failure,
            ...(failure.rejected ? { request: undefined } : {}),
          })
          // Other workouts can continue syncing even if this one needs retrying.
          break
        }
      }
    }
    return acknowledged
  }
  const promise = Promise.resolve(
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`training-plan-sync:${ownerId}`, work)
      : work()
  ).finally(() => running.delete(ownerId))
  running.set(ownerId, promise)
  return promise
}
/** Success here means durable local acceptance. The shared coordinator syncs it. */
export async function savePlanEdit(
  ownerId: string,
  value: WorkoutRecord,
  previous?: WorkoutRecord
) {
  return queuePlanEdit(ownerId, value, previous)
}
