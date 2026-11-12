import type {
  SessionRecord,
  SetResult,
  WorkoutBlock,
  WorkoutRecord,
} from "@/contracts/models"
import { withGroups } from "./workout-groups"
import { inferredStatus, normalizeSessionResults } from "@/contracts/training"

export const sameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameValue(v, b[i]))
    )
  const x = a as Fields,
    y = b as Fields
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  return [...keys].every((key) => sameValue(x[key], y[key]))
}
type Fields = Record<string, unknown>
type Entity = Fields & { id: string }
const fields = <T extends object>(base: T, local: T, server: T): T => {
  const result = { ...server } as Fields
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (key === "id" || key === "revision") continue
    const b = (base as Fields)[key],
      l = (local as Fields)[key]
    if (!sameValue(b, l)) {
      if (l === undefined) delete result[key]
      else result[key] = structuredClone(l)
    }
  }
  return result as T
}

/** Apply only an actual local ordering change, preserving remote additions. */
function ordered<T extends Entity>(
  base: T[],
  local: T[],
  server: T[],
  values: Map<string, T>
): T[] {
  const localOrder = local.map((v) => v.id)
  const order = sameValue(
    base.map((v) => v.id),
    localOrder
  )
    ? server.map((v) => v.id)
    : localOrder
  return [
    ...new Set([...order, ...server.map((v) => v.id), ...localOrder]),
  ].flatMap((id) => (values.has(id) ? [values.get(id)!] : []))
}
function entities<T extends Entity>(
  base: T[],
  local: T[],
  server: T[],
  merge = fields<T>
): T[] {
  const b = new Map(base.map((v) => [v.id, v])),
    l = new Map(local.map((v) => [v.id, v])),
    r = new Map(server.map((v) => [v.id, v]))
  const values = new Map<string, T>()
  for (const id of new Set([...r.keys(), ...l.keys()])) {
    const before = b.get(id),
      next = l.get(id),
      current = r.get(id)
    if (before) {
      // A deletion on either side wins over an edit to that existing entity.
      if (next && current) values.set(id, merge(before, next, current))
    } else if (next || current)
      values.set(id, structuredClone(next ?? current!))
  }
  return ordered(base, local, server, values)
}

function mergeBlocks(
  base: WorkoutBlock[],
  local: WorkoutBlock[],
  server: WorkoutBlock[]
): WorkoutBlock[] {
  const flatten = (blocks: WorkoutBlock[]) =>
    blocks.flatMap((block) =>
      block.items.map((item) => ({ ...item, parentId: block.id }))
    )
  const b = flatten(base),
    l = flatten(local),
    r = flatten(server)
  const items = entities(b, l, r, (before, next, current) => ({
    ...fields(before, next, current),
    sets: entities(before.sets, next.sets, current.sets),
    noteEntries: entities(
      before.noteEntries ?? [],
      next.noteEntries ?? [],
      current.noteEntries ?? []
    ),
  }))
  return entities(base, local, server).map((block) => {
    const inBlock = items.filter((item) => item.parentId === block.id)
    const values = new Map(inBlock.map((item) => [item.id, item]))
    const membership = (list: typeof items) =>
      list.filter((item) => item.parentId === block.id)
    return {
      ...block,
      items: ordered(membership(b), membership(l), membership(r), values).map(
        (value) => {
          const { parentId, ...item } = value
          void parentId
          return item
        }
      ),
    }
  })
}

/** Baselines are required. A stale whole snapshot is never inferred to be an edit. */
export function mergeWorkout(
  base: WorkoutRecord,
  local: WorkoutRecord,
  server: WorkoutRecord
): WorkoutRecord {
  const b = withGroups(base),
    l = withGroups(local),
    r = withGroups(server)
  return {
    ...fields(b, l, r),
    blocks: mergeBlocks(b.blocks, l.blocks, r.blocks),
    revision: server.revision,
  }
}

const resultKey = (result: SetResult) =>
  result.targetId ? `target:${result.targetId}` : result.id
function mergeResults(
  base: SetResult[],
  local: SetResult[],
  server: SetResult[]
): SetResult[] {
  const project = (values: SetResult[]) =>
    values.map((value) => ({
      ...value,
      resultId: value.id,
      id: resultKey(value),
    }))
  const b = project(base),
    l = project(local),
    r = project(server)
  // Two devices can independently create a result for the same target. Merge
  // against the empty result so an untouched null does not erase entered reps.
  for (const value of l)
    if (!b.some((v) => v.id === value.id) && r.some((v) => v.id === value.id))
      b.push({
        ...value,
        status: "unlogged",
        reps: null,
        load: null,
        durationSeconds: null,
        distanceMeters: null,
        rir: null,
        notes: "",
        userNotes: undefined,
        source: null,
      })
  return entities(b, l, r, (before, next, current) => ({
    ...fields(before, next, current),
    resultId: current.resultId,
  })).map((value) => {
    const { resultId, ...result } = value
    return { ...result, id: resultId }
  })
}
const clockFields = [
  "status",
  "startedAt",
  "finishedAt",
  "timerPausedAt",
  "pausedDurationMs",
] as const
export function mergeSession(
  base: SessionRecord,
  local: SessionRecord,
  server: SessionRecord
): SessionRecord {
  const b = withGroups(base),
    l = withGroups(local),
    r = withGroups(server)
  const merged = fields(b, l, r)
  // Timer lifecycle fields must all come from the same editing action.
  if (clockFields.some((key) => !sameValue(b[key], l[key])))
    Object.assign(
      merged,
      Object.fromEntries(clockFields.map((key) => [key, l[key]]))
    )
  const blocks = mergeBlocks(b.blocks, l.blocks, r.blocks)
  const items = new Map(
    blocks.flatMap((block) => block.items).map((item) => [item.id, item])
  )
  const movementNotes: NonNullable<SessionRecord["movementNotes"]> = {}
  for (const id of items.keys()) {
    const notes = entities(
      b.movementNotes?.[id] ?? [],
      l.movementNotes?.[id] ?? [],
      r.movementNotes?.[id] ?? []
    )
    if (notes.length) movementNotes[id] = notes
  }
  const results = mergeResults(b.results, l.results, r.results).filter(
    (result) => {
      const item = items.get(result.itemId)
      return (
        item &&
        (!result.targetId ||
          item.sets.some((set) => set.id === result.targetId))
      )
    }
  )
  return {
    ...merged,
    blocks,
    results,
    movementNotes,
    revision: server.revision,
  }
}

/** A concurrent new set or changed tracking field must never invent completion. */
export function mergeSessionForSave(
  base: SessionRecord,
  local: SessionRecord,
  server: SessionRecord
): SessionRecord {
  const value = normalizeSessionResults(mergeSession(base, local, server))
  if (value.loggingMode !== "automatic" && value.loggingMode !== "checked")
    return value
  const items = new Map(
    value.blocks.flatMap((block) => block.items).map((item) => [item.id, item])
  )
  value.results = value.results.map((result) =>
    result.status === "completed" &&
    inferredStatus(items.get(result.itemId)!, result) !== "completed"
      ? { ...result, status: "unlogged" }
      : result
  )
  const logged = new Set(
    value.results
      .filter((result) => result.status !== "unlogged")
      .map((result) => result.targetId)
  )
  const incomplete = [...items.values()].some((item) =>
    item.sets.some((set) => !logged.has(set.id))
  )
  if (incomplete && value.status === "completed") {
    // A concurrent new set reopens logging, while the recorded clock end stays.
    value.status = "active"
  }
  return value
}

/** Legacy recovery is deliberately restricted to group order, never its contents. */
export function recoverGroupOrder(
  local: WorkoutRecord,
  server: WorkoutRecord
): WorkoutRecord {
  const current = new Map(server.blocks.map((block) => [block.id, block]))
  return {
    ...server,
    blocks: [
      ...new Set([
        ...local.blocks.map((block) => block.id),
        ...server.blocks.map((block) => block.id),
      ]),
    ].flatMap((id) => (current.has(id) ? [current.get(id)!] : [])),
  }
}
