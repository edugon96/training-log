import { expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import {
  newGroup,
  normalizeGroups,
  moveMovement,
  movementRest,
  withGroups,
} from "../lib/workout-groups"
import { creationNotes, changeCreationNotes } from "../lib/movement-notes"
import { automaticRestSeconds } from "../lib/set-logging"
import {
  Block,
  defaultTargets,
  emptyTarget,
  type WorkoutBlock,
  type WorkoutRecord,
} from "../contracts/models"
import { cloneBlocks, computeLedger, startSession } from "../server/domain"

function legacy(): WorkoutBlock {
  return {
    id: randomUUID(),
    title: "Press",
    kind: "straight",
    notes: "Stay stable.",
    restSeconds: 90,
    automaticRest: true,
    rounds: 3,
    items: [
      {
        id: randomUUID(),
        exerciseId: randomUUID(),
        name: "Press",
        equipment: "Barbell",
        setup: "",
        primaryMuscle: "chest",
        secondaryMuscles: [],
        role: "lifting",
        unilateral: false,
        notes: "Pause.",
        sets: [emptyTarget(), emptyTarget()],
      },
    ],
  }
}
test("legacy normalization is idempotent, preserves identity and moves projected notes once", () => {
  const block = legacy(),
    original = structuredClone(block)
  const [group] = normalizeGroups([block])
  expect(block).toEqual(original)
  expect(group.kind).toBe("group")
  expect(group.id).toBe(block.id)
  expect(group.items[0].sets).toEqual(block.items[0].sets)
  expect(group.rounds).toBe(3)
  expect(group.notes).toBe("")
  expect(creationNotes(group, group.items[0]).map((note) => note.text)).toEqual(
    ["Stay stable.", "Pause."]
  )
  expect(normalizeGroups([group])).toEqual([group])
  expect(Block.parse(JSON.parse(JSON.stringify(group)))).toEqual(group)
  expect(cloneBlocks([group])[0].items[0].restSeconds).toBe(90)
})
test("group instructions remain separate even with a single movement and after moving", () => {
  const [group] = normalizeGroups([legacy()])
  group.notes = "Group-only instructions"
  const destination = newGroup([group])
  const blocks = moveMovement(
    [group, destination],
    group.items[0].id,
    destination.id
  )
  expect(blocks[0].items).toHaveLength(0)
  expect(blocks[0].notes).toBe(group.notes)
  expect(blocks[1].items[0]).toEqual(group.items[0])
  const updated = changeCreationNotes([group], group.items[0].id, [])
  expect(updated[0].notes).toBe(group.notes)
  expect(normalizeGroups(updated)[0].items[0].noteEntries).toEqual([])
})
test("explicit movement rest overrides inheritance, including Off, and follows its own drop chain", () => {
  const block = legacy(),
    item = block.items[0]
  expect(movementRest(block, item)).toEqual({
    restSeconds: 90,
    automaticRest: true,
  })
  item.restSeconds = null
  item.automaticRest = false
  expect(normalizeGroups([block])[0].items[0].restSeconds).toBeNull()
  expect(automaticRestSeconds(block, item, item.sets[0], [])).toBeNull()
  item.restSeconds = 30
  item.automaticRest = true
  block.kind = "superset"
  block.items.push({
    ...item,
    id: randomUUID(),
    restSeconds: 120,
    sets: [emptyTarget()],
  })
  expect(automaticRestSeconds(block, item, item.sets[0], [])).toBe(30)
  item.sets[1].kind = "drop"
  expect(automaticRestSeconds(block, item, item.sets[0], [])).toBeNull()
  expect(automaticRestSeconds(block, item, item.sets[1], [])).toBe(30)
})
test("organizing groups does not change planned or logged ledger credit", () => {
  const week = {
    id: randomUUID(),
    revision: 1,
    startDate: "2026-10-19",
    title: "Week",
    notes: "",
    targets: defaultTargets,
  }
  const workout: WorkoutRecord = {
    id: randomUUID(),
    revision: 1,
    kind: "planned",
    routineId: null,
    weekId: week.id,
    date: week.startDate,
    title: "Training",
    focus: "",
    notes: "",
    source: null,
    blocks: [legacy()],
  }
  const session = startSession(workout, week.startDate)
  for (const result of session.results) {
    result.status = "completed"
    result.reps = 8
  }
  const before = computeLedger(week, [workout], [session])
  const normalized = withGroups(workout),
    group = newGroup(normalized.blocks)
  normalized.blocks = moveMovement(
    [...normalized.blocks, group],
    normalized.blocks[0].items[0].id,
    group.id
  )
  const logged = { ...session, blocks: normalized.blocks }
  expect(computeLedger(week, [normalized], [logged])).toEqual(before)
  expect(logged.results).toEqual(session.results)
})
