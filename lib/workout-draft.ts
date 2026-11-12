import type { SessionRecord, WorkoutRecord } from "@/contracts/models"
import { trackingFields } from "@/contracts/training"

/** A view draft is not a performed session until the user records something. */
export function workoutDraft(
  workout: WorkoutRecord,
  id = crypto.randomUUID()
): SessionRecord {
  return {
    id,
    revision: 0,
    workoutId: workout.id,
    routineId: workout.routineId,
    weekId: workout.weekId,
    performedOn: workout.date ?? new Date().toLocaleDateString("en-CA"),
    title: workout.title,
    status: "active",
    loggingMode: "checked",
    blocks: structuredClone(workout.blocks).map((block) => ({
      ...block,
      items: block.items.map((item) => ({
        ...item,
        trackingFields: trackingFields(item),
      })),
    })),
    results: [],
    notes: "",
    source: null,
    startedAt: null,
    finishedAt: null,
    timerPausedAt: null,
    pausedDurationMs: 0,
  }
}
