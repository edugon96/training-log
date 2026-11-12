import type { WorkoutBlock, WorkoutItem } from "../contracts/models"
import { materializeCreationNotes } from "./movement-notes"

export function movementRest(block: WorkoutBlock, item: WorkoutItem) {
  return {
    restSeconds:
      item.restSeconds === undefined ? block.restSeconds : item.restSeconds,
    automaticRest:
      item.automaticRest === undefined
        ? (block.automaticRest ?? false)
        : item.automaticRest,
  }
}

/** Read-time adaptation only. IDs, prescriptions, and legacy metadata remain intact. */
export function normalizeGroups(blocks: WorkoutBlock[]): WorkoutBlock[] {
  return materializeCreationNotes(blocks).map((block) => ({
    ...block,
    kind: "group",
    items: block.items.map((item) => ({
      ...item,
      ...movementRest(block, item),
    })),
  }))
}
export function withGroups<T extends { blocks: WorkoutBlock[] }>(record: T): T {
  return { ...record, blocks: normalizeGroups(record.blocks) }
}
export function newGroup(blocks: WorkoutBlock[]): WorkoutBlock {
  let ordinal = 1
  while (blocks.some((block) => block.title === `Group ${ordinal}`)) ordinal++
  return {
    id: crypto.randomUUID(),
    title: `Group ${ordinal}`,
    kind: "group",
    notes: "",
    restSeconds: null,
    automaticRest: false,
    rounds: null,
    items: [],
  }
}
export function moveMovement(
  blocks: WorkoutBlock[],
  itemId: string,
  destinationId: string
): WorkoutBlock[] {
  const normalized = normalizeGroups(blocks)
  const item = normalized
    .flatMap((block) => block.items)
    .find((item) => item.id === itemId)
  if (
    !item ||
    !normalized.some((block) => block.id === destinationId) ||
    normalized.some(
      (block) =>
        block.id === destinationId &&
        block.items.some((item) => item.id === itemId)
    )
  )
    return blocks
  return normalized.map((block) => ({
    ...block,
    items:
      block.id === destinationId
        ? [...block.items, item]
        : block.items.filter((item) => item.id !== itemId),
  }))
}
