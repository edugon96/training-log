import { expect, test } from "vitest"
import {
  emptyTarget,
  makeItem,
  defaultTargets,
  type ExerciseRecord,
  type WorkoutRecord,
} from "../contracts/models"
import {
  acceptedSuggestion,
  automaticRestSeconds,
  sessionVolume,
  setSuggestion,
  previousSet,
} from "../lib/set-logging"
import { normalizeSessionResults } from "../contracts/training"
import { computeLedger, startSession, validateSession } from "../server/domain"
const exercise: ExerciseRecord = {
  id: crypto.randomUUID(),
  revision: 1,
  name: "Curl",
  equipment: "Dumbbell",
  equipmentId: null,
  setup: "",
  primaryMuscle: "biceps",
  secondaryMuscles: [],
  defaultRole: "lifting",
  pattern: "pull",
  defaultLoad: { value: 20, unit: "lb", basis: "per_hand" },
  trackingFields: ["load", "reps"],
  notes: "",
  archived: false,
}
function fixture() {
  const item = makeItem(exercise, 3)
  item.sets = item.sets.map((set) => ({ ...set, repsMin: 8, repsMax: 12 }))
  const workout: WorkoutRecord = {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "planned",
    weekId: crypto.randomUUID(),
    routineId: null,
    date: "2026-10-21",
    title: "Arms",
    focus: "",
    notes: "",
    source: null,
    blocks: [
      {
        id: crypto.randomUUID(),
        title: "A",
        kind: "straight",
        restSeconds: 90,
        rounds: null,
        notes: "",
        items: [item],
      },
    ],
  }
  const session = startSession(workout, "2026-10-21")
  session.loggingMode = "checked"
  return { item: session.blocks[0].items[0], workout, session }
}
test("entered values remain unfinished until checked, and incomplete checked rows are rejected", () => {
  const { session } = fixture()
  session.results[0] = {
    ...session.results[0],
    reps: 8,
    load: exercise.defaultLoad,
  }
  expect(normalizeSessionResults(session).results[0].status).toBe("unlogged")
  expect(() => validateSession({ ...session, status: "completed" })).toThrow(
    "Log or skip"
  )
  session.results[0].status = "completed"
  expect(() => validateSession(session)).not.toThrow()
  session.results[0].reps = null
  expect(() => validateSession(session)).toThrow("Enter every tracked value")
})
test("suggestions repeat matching prescriptions without becoming recorded results", () => {
  const { item, session } = fixture()
  session.results[0] = {
    ...session.results[0],
    reps: 10,
    load: { value: 25, unit: "lb", basis: "per_hand" },
  }
  const suggested = setSuggestion(item, item.sets[1], session.results)
  expect(suggested.reps).toBe(10)
  expect(suggested.load?.value).toBe(25)
  expect(session.results[1].load).toBeNull()
  const accepted = acceptedSuggestion(session.results[1], suggested)
  expect(accepted.status).toBe("completed")
  expect(accepted.reps).toBe(10)
  item.sets[1].load!.value = 15
  expect(setSuggestion(item, item.sets[1], session.results).load?.value).toBe(
    15
  )
  item.sets[1].kind = "warmup"
  expect(setSuggestion(item, item.sets[1], session.results).reps).toBe(8)
})
test("typed overrides win over suggestions and unknown load units stay unknown", () => {
  const { session, item } = fixture()
  item.sets[0].load = { value: 20, unit: "unknown", basis: "unknown" }
  const accepted = acceptedSuggestion(
    { ...session.results[0], reps: 6 },
    setSuggestion(item, item.sets[0], [])
  )
  expect(accepted.reps).toBe(6)
  expect(accepted.load?.unit).toBe("unknown")
})
test("previous workout values fill an unprescribed set without becoming actuals", () => {
  const { item, session } = fixture()
  const target = item.sets[0]
  target.load = null
  target.repsMin = target.repsMax = null
  const previous = {
    ...session.results[0],
    status: "completed" as const,
    reps: 10,
    load: { value: 70, unit: "lb" as const, basis: "added" as const },
  }
  const suggestion = setSuggestion(item, target, [], previous)
  expect(suggestion).toMatchObject({ reps: 10, load: previous.load })
  expect(session.results[0].load).toBeNull()
  expect(acceptedSuggestion(session.results[0], suggestion)).toMatchObject({
    status: "completed",
    reps: 10,
    load: previous.load,
  })
  target.load = { value: 45, unit: "lb", basis: "added" }
  target.repsMin = 8
  expect(setSuggestion(item, target, [], previous)).toMatchObject({
    reps: 8,
    load: target.load,
  })
})
test("failure and drop each count once in ledger, warmups only in volume", () => {
  const { session, workout } = fixture()
  for (const blocks of [session.blocks, workout.blocks])
    blocks[0].items[0].sets.forEach((set, i) => {
      set.kind = (["warmup", "failure", "drop"] as const)[i]
    })
  session.results.forEach((row) => {
    row.status = "completed"
    row.reps = 10
    row.load = { value: 10, unit: "kg", basis: "per_hand" }
  })
  const ledger = computeLedger(
    {
      id: workout.weekId!,
      revision: 1,
      startDate: "2026-10-19",
      title: "Week",
      notes: "",
      targets: defaultTargets,
    },
    [workout],
    [session]
  )
  expect(ledger.plannedTotal).toBe(2)
  expect(ledger.completedTotal).toBe(2)
  expect(sessionVolume(session).pounds).toBeCloseTo(661.3868, 3)
  session.results[2].status = "unlogged"
  expect(sessionVolume(session).pounds).toBeCloseTo(440.9245, 3)
})
test("volume includes recorded machine weights with an unspecified basis", () => {
  const { session } = fixture()
  session.results.forEach((row) => {
    row.status = "completed"
    row.reps = 12
    row.load = { value: 105, unit: "lb", basis: "unknown" }
  })
  expect(sessionVolume(session)).toEqual({ pounds: 3780, excluded: 0 })
  session.results[0].load = { value: 10, unit: "kg", basis: "unknown" }
  expect(sessionVolume(session).pounds).toBeCloseTo(2784.5547, 3)
})
test("volume excludes unlogged, skipped, bodyweight, assisted and unquantified work", () => {
  const { session } = fixture()
  const original = session.results[0]
  session.results = [
    { ...original, status: "unlogged", reps: 12, load: exercise.defaultLoad },
    { ...original, status: "skipped", reps: 12, load: exercise.defaultLoad },
    {
      ...original,
      status: "completed",
      reps: 12,
      load: { value: 105, unit: "unknown", basis: "unknown" },
    },
    {
      ...original,
      status: "completed",
      reps: 12,
      load: { value: 20, unit: "lb", basis: "assistance" },
    },
    {
      ...original,
      status: "completed",
      reps: 12,
      load: { value: 150, unit: "lb", basis: "bodyweight" },
    },
    {
      ...original,
      status: "completed",
      reps: null,
      load: exercise.defaultLoad,
    },
    { ...original, status: "completed", reps: 12, load: null },
  ]
  expect(sessionVolume(session)).toEqual({ pounds: 0, excluded: 5 })
})
test("automatic rest is opt-in, independent of other movements, and respects drop chains", () => {
  const { session, item } = fixture()
  const block = session.blocks[0]
  expect(
    automaticRestSeconds(block, item, item.sets[0], session.results)
  ).toBeNull()
  block.automaticRest = true
  item.sets[1].kind = "drop"
  expect(
    automaticRestSeconds(block, item, item.sets[0], session.results)
  ).toBeNull()
  expect(automaticRestSeconds(block, item, item.sets[1], session.results)).toBe(
    90
  )
  block.kind = "superset"
  const second = { ...makeItem(exercise, 1), sets: [emptyTarget()] }
  block.items.push(second)
  item.sets[1].kind = "working"
  session.results[0].status = "completed"
  expect(automaticRestSeconds(block, item, item.sets[0], session.results)).toBe(
    90
  )
  const other = {
    ...session.results[0],
    id: crypto.randomUUID(),
    itemId: second.id,
    targetId: second.sets[0].id,
  }
  expect(
    automaticRestSeconds(block, second, second.sets[0], [
      ...session.results,
      other,
    ])
  ).toBe(90)
  session.results[2].status = "completed"
  expect(automaticRestSeconds(block, item, item.sets[2], session.results)).toBe(
    90
  )
})

test("history suggestions match set kinds and preserve explicit bodyweight", () => {
  const { item, session } = fixture()
  item.sets[0].kind = "warmup"
  const results = session.results.map((row, index) => ({
    ...row,
    status: "completed" as const,
    reps: 10 + index,
    load: {
      value: index === 0 ? 40 : 70,
      unit: "lb" as const,
      basis: "added" as const,
    },
  }))
  const history = {
    sessionId: session.id,
    date: "2026-10-22",
    title: "Earlier workout",
    match: "exercise" as const,
    results,
    targets: structuredClone(item.sets),
    notes: "",
  }
  expect(previousSet(item, item.sets[1], history)?.load?.value).toBe(70)
  const extra = { ...item.sets[2], id: crypto.randomUUID() }
  item.sets.push(extra)
  expect(previousSet(item, extra, history)).toBeUndefined()
  expect(previousSet(item, extra, history, true)?.reps).toBe(12)
  const partial = {
    ...history,
    results: history.results.filter((row) => row.targetId !== item.sets[1].id),
  }
  expect(previousSet(item, item.sets[1], partial)).toBeUndefined()
  expect(previousSet(item, item.sets[2], partial)?.reps).toBe(12)
  item.sets[1].load = { value: null, unit: "unknown", basis: "bodyweight" }
  expect(setSuggestion(item, item.sets[1], [], results[1]).load).toEqual(
    item.sets[1].load
  )
})

test("suggested weights convert known units and never reinterpret a different load basis", () => {
  const { item, session } = fixture()
  item.sets[0].load = null
  const previous = {
    ...session.results[0],
    status: "completed" as const,
    load: { value: 70, unit: "lb" as const, basis: "added" as const },
  }
  const kg = { value: null, unit: "kg" as const, basis: "added" as const }
  expect(setSuggestion(item, item.sets[0], [], previous, kg).load).toEqual({
    ...kg,
    value: 31.75,
  })
  expect(
    setSuggestion(item, item.sets[0], [], previous, {
      ...kg,
      basis: "per_hand",
    }).load
  ).toBeNull()
  expect(
    setSuggestion(
      item,
      item.sets[0],
      [],
      { ...previous, load: { ...previous.load, unit: "unknown" } },
      kg
    ).load
  ).toBeNull()
  const typed = {
    ...session.results[0],
    reps: 8,
    load: { value: 65, unit: "lb" as const, basis: "added" as const },
  }
  expect(
    acceptedSuggestion(typed, setSuggestion(item, item.sets[0], [], previous))
  ).toMatchObject({ reps: 8, load: typed.load })
})
