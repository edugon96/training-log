import type {
  MovementNoteRecord,
  SessionRecord,
  WorkoutBlock,
  WorkoutItem,
} from "../contracts/models"
import { cleanInstructions } from "./presentation"

function noteProjection(entries: MovementNoteRecord[], previous: string) {
  const provenance = previous
    .split("\n")
    .filter((line) =>
      /^\s*(Source:|Original (prescription row|record|dose):|\|)/i.test(line)
    )
    .join("\n")
  return [...entries.map((note) => note.text).filter(Boolean), provenance]
    .filter(Boolean)
    .join("\n\n")
}

export function isSingleMovement(block: WorkoutBlock) {
  return block.kind === "straight" && block.items.length === 1
}

/** Legacy IDs are deterministic so typing and offline retries never remount a note. */
export function creationNotes(
  block: WorkoutBlock,
  item: WorkoutItem
): MovementNoteRecord[] {
  const text = cleanInstructions(item.notes)
  const blockText = cleanInstructions(block.notes)
  const entries = item.noteEntries ?? (text ? [{ id: item.id, text }] : [])
  if (
    !isSingleMovement(block) ||
    !blockText ||
    entries.some((note) => note.text === blockText)
  )
    return entries
  return [{ id: block.id, text: blockText }, ...entries]
}

export function changeCreationNotes(
  blocks: WorkoutBlock[],
  itemId: string,
  entries: MovementNoteRecord[]
): WorkoutBlock[] {
  return blocks.map((block) =>
    !block.items.some((item) => item.id === itemId)
      ? block
      : {
          ...block,
          ...(isSingleMovement(block) ? { notes: noteProjection([], block.notes) } : {}),
          items: block.items.map((item) =>
            item.id !== itemId
              ? item
              : {
                  ...item,
                  noteEntries: entries,
                  notes: noteProjection(entries, item.notes),
                }
          ),
        }
  )
}

export function retainMovementNotes(session: SessionRecord): SessionRecord {
  if (!session.movementNotes) return session
  const ids = new Set(
    session.blocks.flatMap((block) => block.items.map((item) => item.id))
  )
  return {
    ...session,
    movementNotes: Object.fromEntries(
      Object.entries(session.movementNotes).filter(([id]) => ids.has(id))
    ),
  }
}

export function projectCreationNotes(blocks: WorkoutBlock[]): WorkoutBlock[] {
  return blocks.map((block) => ({
    ...block,
    items: block.items.map((item) =>
      item.noteEntries === undefined
        ? item
        : {
            ...item,
            notes: noteProjection(item.noteEntries, item.notes),
          }
    ),
  }))
}

/** Move single-movement instructions with their movement when it joins a group. */
export function materializeCreationNotes(blocks: WorkoutBlock[]) {
  return blocks.map((block) =>
    isSingleMovement(block)
      ? changeCreationNotes(
          [block],
          block.items[0].id,
          creationNotes(block, block.items[0])
        )[0]
      : block
  )
}
