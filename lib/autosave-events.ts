import type { SessionRecord, WorkoutRecord } from "@/contracts/models"

export type SavedEdit =
  | {
      ownerId: string
      kind: "workouts"
      before: WorkoutRecord
      after: WorkoutRecord
    }
  | {
      ownerId: string
      kind: "sessions"
      before: SessionRecord
      after: SessionRecord
    }
const listeners = new Set<(event: SavedEdit) => void>()
export function publishSaved(event: SavedEdit) {
  for (const listener of listeners) listener(event)
}
export function subscribeSaved(listener: (event: SavedEdit) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
