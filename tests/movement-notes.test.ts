import { expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import {
  Workout,
  Session,
  emptyTarget,
  type WorkoutRecord,
} from "../contracts/models"
import {
  changeCreationNotes,
  creationNotes,
  retainMovementNotes,
  projectCreationNotes,
  materializeCreationNotes,
} from "../lib/movement-notes"
import { cloneBlocks, startSession, validateSession } from "../server/domain"
import { setMark, setNumber } from "../components/tracker/set-type-menu"

function fixture(): WorkoutRecord {
  return {
    id: randomUUID(),
    revision: 1,
    kind: "planned",
    routineId: null,
    weekId: null,
    date: "2026-10-22",
    title: "Push",
    focus: "",
    notes: "",
    source: null,
    blocks: [
      {
        id: randomUUID(),
        title: "Bench",
        kind: "straight",
        restSeconds: 120,
        rounds: null,
        notes: "Keep shoulders stable.",
        items: [
          {
            id: randomUUID(),
            exerciseId: randomUUID(),
            name: "Bench",
            equipment: "Barbell",
            setup: "",
            primaryMuscle: "chest",
            secondaryMuscles: [],
            role: "lifting",
            unilateral: false,
            sets: [emptyTarget()],
            notes: "Pause at the bottom.",
          },
        ],
      },
    ],
  }
}
test("legacy notes become stable independent rows and deletions never resurrect them", () => {
  const workout = fixture(),
    block = workout.blocks[0],
    item = block.items[0]
  const notes = creationNotes(block, item)
  expect(notes).toEqual(creationNotes(block, item))
  expect(notes.map((note) => note.text)).toEqual([block.notes, item.notes])
  const blocks = changeCreationNotes(workout.blocks, item.id, [])
  const saved = Workout.parse(
    JSON.parse(JSON.stringify({ ...workout, blocks }))
  )
  expect(creationNotes(saved.blocks[0], saved.blocks[0].items[0])).toEqual([])
  expect(saved.blocks[0].notes).toBe("")
  expect(saved.blocks[0].items[0].notes).toBe("")
})
test("session note edits and deletions leave the original instructions untouched", () => {
  const workout = fixture(),
    original = structuredClone(workout),
    session = startSession(workout, "2026-10-22")
  const item = session.blocks[0].items[0]
  session.blocks = changeCreationNotes(session.blocks, item.id, [
    { id: randomUUID(), text: "Session modification" },
  ])
  session.movementNotes = {
    [item.id]: [{ id: randomUUID(), text: "Felt strong today" }],
  }
  const saved = Session.parse(JSON.parse(JSON.stringify(session)))
  validateSession(saved)
  expect(saved.movementNotes?.[item.id][0].text).toBe("Felt strong today")
  expect(workout).toEqual(original)
  expect(saved.blocks[0].items[0].notes).toBe("Session modification")
})
test("shared group notes stay at group scope and note projections support old readers", () => {
  const workout = fixture(),
    block = workout.blocks[0],
    item = block.items[0]
  block.kind = "superset"
  const blocks = changeCreationNotes(workout.blocks, item.id, [
    { id: randomUUID(), text: "First" },
    { id: randomUUID(), text: "Second" },
  ])
  expect(blocks[0].notes).toBe(block.notes)
  expect(blocks[0].items[0].notes).toBe("First\n\nSecond")
  expect(creationNotes(block, item)).toHaveLength(1)
  blocks[0].items[0].notes = "stale legacy projection"
  expect(projectCreationNotes(blocks)[0].items[0].notes).toBe("First\n\nSecond")
  const copy = cloneBlocks(blocks)
  expect(copy[0].items[0].noteEntries?.[0].id).not.toBe(
    blocks[0].items[0].noteEntries?.[0].id
  )
  expect(copy[0].items[0].noteEntries?.[0].text).toBe("First")
})
test("notes cannot reference missing movements or duplicate IDs and removals prune session notes", () => {
  const session = startSession(fixture(), "2026-10-22"),
    item = session.blocks[0].items[0],
    note = { id: randomUUID(), text: "Note" }
  session.movementNotes = { [randomUUID()]: [note] }
  expect(() => validateSession(session)).toThrow("Note movement")
  session.movementNotes = { [item.id]: [note, note] }
  expect(() => validateSession(session)).toThrow("Session note IDs")
  session.blocks = []
  expect(retainMovementNotes(session).movementNotes).toEqual({})
})
test("Hevy numbering counts normal and failure sets, excluding warm-up and drop sets", () => {
  const sets = (
    ["warmup", "warmup", "failure", "drop", "working"] as const
  ).map((kind) => ({ kind }))
  expect(
    sets.map((set, index) => setMark(set.kind, setNumber(sets, index)))
  ).toEqual(["W", "W", "F", "D", 2])
})

test("legacy provenance stays in exports while instructions move with grouped movements", () => {
  const workout = fixture(),
    block = workout.blocks[0],
    item = block.items[0]
  item.notes =
    "Pause at the bottom.\nSource: imported training log\nOriginal prescription row: 12"
  const entries = creationNotes(block, item)
  expect(entries.map((note) => note.text).join("\n")).not.toContain("Source:")
  const materialized = materializeCreationNotes(workout.blocks)
  materialized[0].kind = "superset"
  expect(
    creationNotes(materialized[0], materialized[0].items[0]).map(
      (note) => note.text
    )
  ).toEqual(entries.map((note) => note.text))
  const changed = changeCreationNotes(materialized, item.id, [
    { id: randomUUID(), text: "New instruction" },
  ])
  expect(changed[0].items[0].notes).toContain("Source: imported training log")
  expect(changed[0].items[0].notes).toContain("Original prescription row: 12")
  expect(
    creationNotes(changed[0], changed[0].items[0]).map((note) => note.text)
  ).toEqual(["New instruction"])
})

test("rep range preference survives empty values and session snapshots", () => {
  const workout = fixture()
  workout.blocks[0].items[0].repetitionMode = "range"
  const saved = Workout.parse(JSON.parse(JSON.stringify(workout)))
  const session = startSession(saved, "2026-10-22")
  expect(session.blocks[0].items[0].repetitionMode).toBe("range")
  expect(cloneBlocks(saved.blocks)[0].items[0].repetitionMode).toBe("range")
})
