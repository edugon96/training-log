import { Workout, type WorkoutRecord } from "@/contracts/models"
import { withGroups } from "./workout-groups"
import { workoutDraft } from "./workout-draft"

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const normalized = (value: WorkoutRecord) =>
  Workout.parse({
    ...value,
    revision: 0,
    blocks: withGroups(workoutDraft(value, value.id)).blocks,
  })

/** Merge only a group-order edit. Never overwrite concurrent content or ordering. */
export function rebaseGroupOrder(
  base: WorkoutRecord,
  local: WorkoutRecord,
  server: WorkoutRecord
): WorkoutRecord | null {
  const before = normalized(base),
    after = normalized(local)
  const ids = after.blocks.map((b) => b.id)
  if (new Set(ids).size !== ids.length || ids.length !== before.blocks.length)
    return null
  const byId = new Map(before.blocks.map((b) => [b.id, b]))
  if (ids.some((id) => !byId.has(id))) return null
  if (!same({ ...before, blocks: ids.map((id) => byId.get(id)) }, after))
    return null
  const originalOrder = before.blocks.map((b) => b.id)
  if (same(originalOrder, ids)) return null
  const serverOrder = server.blocks.map((b) => b.id)
  if (!same(serverOrder, originalOrder) && !same(serverOrder, ids)) return null
  const current = new Map(server.blocks.map((b) => [b.id, b]))
  return Workout.parse({ ...server, blocks: ids.map((id) => current.get(id)) })
}
