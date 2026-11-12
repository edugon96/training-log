import { expect, test } from "vitest"
import { rebaseGroupOrder } from "../lib/plan-reorder"
import { emptyTarget, type WorkoutRecord } from "../contracts/models"

function plan(): WorkoutRecord {
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
          equipment: "Unknown row",
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
test("an order-only edit retains every newer server field and set identity", () => {
  const base = plan()
  const local = { ...base, blocks: [...base.blocks].reverse() }
  const server = structuredClone(base)
  server.revision = 2
  server.notes = "Updated instructions"
  server.blocks[0].items[0].equipment = "Megamass T-Bar Linear Row"
  server.blocks[0].items[0].sets[0].repsMin = 10
  const result = rebaseGroupOrder(base, local, server)
  expect(result).toEqual({ ...server, blocks: [...server.blocks].reverse() })
})
test("concurrent ordering, added groups and mixed content edits require explicit resolution", () => {
  const base = plan()
  const local = { ...base, blocks: [...base.blocks].reverse() }
  expect(
    rebaseGroupOrder(base, local, {
      ...base,
      blocks: [base.blocks[1], base.blocks[0], base.blocks[2]],
    })
  ).toBeNull()
  expect(
    rebaseGroupOrder(base, local, { ...base, blocks: base.blocks.slice(1) })
  ).toBeNull()
  expect(
    rebaseGroupOrder(base, { ...local, notes: "Also edited notes" }, base)
  ).toBeNull()
  const mixed = structuredClone(local)
  mixed.blocks[0].items[0].sets[0].repsMin = 8
  expect(rebaseGroupOrder(base, mixed, base)).toBeNull()
  expect(rebaseGroupOrder(base, base, base)).toBeNull()
})
