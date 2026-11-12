import { expect, test } from "vitest"
import {
  emptyTarget,
  type WorkoutRecord,
  type SessionRecord,
  type SetResult,
} from "../contracts/models"
import {
  mergeWorkout,
  mergeSession,
  recoverGroupOrder,
} from "../lib/autosave-merge"
import { workoutDraft } from "../lib/workout-draft"

export function autosavePlan(): WorkoutRecord {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "planned",
    routineId: null,
    weekId: null,
    date: "2026-10-22",
    title: "Pull",
    focus: "",
    notes: "Instructions",
    source: null,
    blocks: ["A", "B", "C"].map((title) => ({
      id: crypto.randomUUID(),
      title,
      kind: "group",
      notes: "",
      rounds: null,
      restSeconds: null,
      items: [
        {
          id: crypto.randomUUID(),
          exerciseId: crypto.randomUUID(),
          name: "Row",
          equipment: "Old machine",
          setup: "",
          role: "lifting",
          primaryMuscle: "back",
          secondaryMuscles: [],
          unilateral: false,
          notes: "",
          sets: [emptyTarget()],
        },
      ],
    })),
  }
}
test("ordering and field edits retain unrelated remote content and additions", () => {
  const base = autosavePlan(),
    local = structuredClone(base),
    remote = structuredClone(base)
  local.blocks.reverse()
  local.blocks[0].items[0].sets[0].repsMin = 10
  remote.blocks[0].items[0].equipment = "Megamass"
  remote.notes = "New instructions"
  remote.blocks.push({
    ...remote.blocks[0],
    id: crypto.randomUUID(),
    items: [],
  })
  remote.revision = 2
  const saved = mergeWorkout(base, local, remote)
  expect(saved.blocks.map((b) => b.id)).toEqual([
    ...local.blocks.map((b) => b.id),
    remote.blocks[3].id,
  ])
  expect(saved.blocks[2].items[0].equipment).toBe("Megamass")
  expect(saved.notes).toBe("New instructions")
  expect(saved.blocks[0].items[0].sets[0].repsMin).toBe(10)
})
test("same-field local write wins, load units are atomic, remote deletion wins", () => {
  const base = autosavePlan(),
    local = structuredClone(base),
    remote = structuredClone(base)
  local.title = "Local"
  remote.title = "Remote"
  local.blocks[0].items[0].sets[0].load = {
    value: 20,
    unit: "kg",
    basis: "total",
  }
  remote.blocks[0].items[0].sets[0].load = {
    value: 50,
    unit: "lb",
    basis: "per_hand",
  }
  local.blocks[1].title = "Renamed"
  remote.blocks.splice(1, 1)
  const saved = mergeWorkout(base, local, remote)
  expect(saved.title).toBe("Local")
  expect(saved.blocks).toHaveLength(2)
  expect(saved.blocks[0].items[0].sets[0].load).toEqual(
    local.blocks[0].items[0].sets[0].load
  )
})
test("moving a movement retains concurrent prescriptions without duplicating it", () => {
  const base = autosavePlan(),
    local = structuredClone(base),
    remote = structuredClone(base)
  const item = local.blocks[0].items.pop()!
  local.blocks[1].items.push(item)
  remote.blocks[0].items[0].sets[0].repsMin = 12
  const saved = mergeWorkout(base, local, remote)
  expect(saved.blocks[0].items).toHaveLength(0)
  expect(saved.blocks[1].items[1].id).toBe(item.id)
  expect(saved.blocks[1].items[1].sets[0].repsMin).toBe(12)
  expect(
    saved.blocks.flatMap((b) => b.items).filter((i) => i.id === item.id)
  ).toHaveLength(1)
})
test("session results merge by target and preserve other results and timer lifecycle", () => {
  const base: SessionRecord = { ...workoutDraft(autosavePlan()), revision: 1 }
  const result = (index: number): SetResult => ({
    id: crypto.randomUUID(),
    itemId: base.blocks[index].items[0].id,
    targetId: base.blocks[index].items[0].sets[0].id,
    status: "unlogged",
    reps: null,
    load: null,
    durationSeconds: null,
    distanceMeters: null,
    rir: null,
    notes: "",
    source: null,
  })
  const local = structuredClone(base),
    remote = structuredClone(base)
  local.results = [
    { ...result(0), load: { value: 25, unit: "lb", basis: "total" } },
  ]
  remote.results = [
    { ...result(0), reps: 10 },
    { ...result(1), reps: 12 },
  ]
  remote.startedAt = "2026-10-22T12:00:00Z"
  remote.timerPausedAt = "2026-10-22T12:10:00Z"
  const saved = mergeSession(base, local, remote)
  expect(saved.results).toHaveLength(2)
  expect(saved.results[0]).toMatchObject({
    id: remote.results[0].id,
    reps: 10,
    load: local.results[0].load,
  })
  expect(saved.startedAt).toBe(remote.startedAt)
  expect(saved.timerPausedAt).toBe(remote.timerPausedAt)
})
test("later changes over a merged acknowledgement do not restore old machine details", () => {
  const base = autosavePlan(),
    first = structuredClone(base),
    remote = structuredClone(base)
  first.blocks.reverse()
  remote.blocks[0].items[0].equipment = "Megamass"
  const acknowledged = mergeWorkout(base, first, remote)
  const latest = { ...first, title: "Later edit" }
  const next = mergeWorkout(first, latest, acknowledged)
  expect(next.title).toBe("Later edit")
  expect(next.blocks[2].items[0].equipment).toBe("Megamass")
})
test("legacy recovery applies only ordering and never guesses field changes", () => {
  const local = autosavePlan(),
    server = structuredClone(local)
  local.blocks.reverse()
  local.notes = "Old note"
  server.notes = "Newest note"
  server.blocks[0].items[0].equipment = "Megamass"
  const recovered = recoverGroupOrder(local, server)
  expect(recovered.notes).toBe(server.notes)
  expect(recovered.blocks[2]).toEqual(server.blocks[0])
})

test("finishing during a concurrent set addition preserves the set without inventing completion", async () => {
  const { mergeSessionForSave } = await import("../lib/autosave-merge")
  const { validateSession } = await import("../server/domain")
  const base = { ...workoutDraft(autosavePlan()), revision: 1 }
  base.blocks = []
  base.startedAt = "2026-10-22T12:00:00Z"
  const local: SessionRecord = {
    ...base,
    status: "completed",
    finishedAt: "2026-10-22T12:10:00Z",
  }
  const remote = { ...base, revision: 2, blocks: autosavePlan().blocks }
  const saved = mergeSessionForSave(base, local, remote)
  expect(saved.blocks).toHaveLength(3)
  expect(saved.results).toEqual([])
  expect(saved.status).toBe("active")
  expect(saved.finishedAt).toBe(local.finishedAt)
  expect(saved.timerPausedAt).toBeNull()
  expect(() => validateSession(saved)).not.toThrow()
})

test("an active stopped clock survives a merge with unrelated result edits", async () => {
  const { mergeSessionForSave } = await import("../lib/autosave-merge")
  const { validateSession } = await import("../server/domain")
  const base = {
    ...workoutDraft(autosavePlan()),
    revision: 1,
    startedAt: "2026-10-23T20:50:00.000Z",
  }
  const local = {
    ...base,
    finishedAt: "2026-10-23T22:16:00.000Z",
    pausedDurationMs: 0,
  }
  const server = { ...base, revision: 2, userNotes: "Another device's note" }
  const saved = mergeSessionForSave(base, local, server)
  expect(saved.status).toBe("active")
  expect(saved.finishedAt).toBe(local.finishedAt)
  expect(saved.userNotes).toBe(server.userNotes)
  expect(saved.blocks).toMatchObject(server.blocks)
  expect(() => validateSession(saved)).not.toThrow()
})
