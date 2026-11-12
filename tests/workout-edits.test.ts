import "fake-indexeddb/auto"
import { beforeEach, afterAll, expect, test, vi } from "vitest"
import { offlineDb } from "../lib/offline"
import {
  queuePlanEdit,
  flushPlanEdits,
  savePlanEdit,
} from "../lib/workout-edits"
import { saveWorkout, ApiError } from "../lib/api-client"
import type { WorkoutRecord } from "../contracts/models"
vi.mock("../lib/api-client", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public details?: unknown,
      public code?: string
    ) {
      super(message)
    }
  },
  saveWorkout: vi.fn(),
  getWorkout: vi.fn(),
  saveSession: vi.fn(),
  getSession: vi.fn(),
}))
const owner = "editor-owner"
const make = (): WorkoutRecord => ({
  id: crypto.randomUUID(),
  revision: 1,
  kind: "planned",
  routineId: null,
  weekId: null,
  date: "2026-10-21",
  title: "Upper",
  focus: "",
  notes: "Original",
  source: null,
  blocks: ["A", "B"].map((title) => ({
    id: crypto.randomUUID(),
    title,
    kind: "group",
    notes: "",
    items: [],
    rounds: null,
    restSeconds: null,
  })),
})
beforeEach(async () => {
  vi.resetAllMocks()
  for (const table of offlineDb.tables) await table.clear()
})
afterAll(() => offlineDb.close())
test("save accepts the edit locally without waiting for the network", async () => {
  const base = make(),
    local = { ...base, title: "Edited" }
  await expect(savePlanEdit(owner, local, base)).resolves.toMatchObject({
    title: "Edited",
  })
  expect(saveWorkout).not.toHaveBeenCalled()
  expect((await offlineDb.planEdits.get(`${owner}:${base.id}`))?.base).toEqual(
    base
  )
})
test("a conflict applies local fields and ordering while retaining remote fields", async () => {
  const base = make(),
    local = {
      ...base,
      title: "Local title",
      blocks: [...base.blocks].reverse(),
    },
    remote = {
      ...base,
      revision: 2,
      title: "Remote title",
      notes: "New instructions",
    }
  await queuePlanEdit(owner, local, base)
  vi.mocked(saveWorkout)
    .mockRejectedValueOnce(new ApiError(409, "Changed", { current: remote }))
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  const saved = (await flushPlanEdits(owner)).get(base.id)!
  expect(saved).toMatchObject({
    title: "Local title",
    notes: "New instructions",
    revision: 3,
  })
  expect(saved.blocks.map((b) => b.id)).toEqual(local.blocks.map((b) => b.id))
  expect(await offlineDb.planEdits.count()).toBe(0)
})
test("lost acknowledgement replays identical request then saves later edits", async () => {
  const base = make(),
    first = { ...base, title: "First" }
  await queuePlanEdit(owner, first, base)
  vi.mocked(saveWorkout).mockRejectedValueOnce(new TypeError("Offline"))
  await flushPlanEdits(owner)
  await queuePlanEdit(owner, { ...first, title: "Latest" }, first)
  vi.mocked(saveWorkout)
    .mockImplementationOnce(async (value) => ({ ...value, revision: 2 }))
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  const saved = (await flushPlanEdits(owner)).get(base.id)!
  expect(vi.mocked(saveWorkout).mock.calls[0]).toEqual(
    vi.mocked(saveWorkout).mock.calls[1]
  )
  expect(saved.title).toBe("Latest")
  expect(await offlineDb.planEdits.count()).toBe(0)
})
test("typing during a rebased request preserves new local and remote values", async () => {
  const base = make(),
    first = { ...base, blocks: [...base.blocks].reverse() },
    remote = { ...base, revision: 2, notes: "New server note" }
  await queuePlanEdit(owner, first, base)
  vi.mocked(saveWorkout)
    .mockRejectedValueOnce(new ApiError(409, "Changed", { current: remote }))
    .mockImplementationOnce(async (value) => {
      await queuePlanEdit(owner, { ...first, title: "Later title" }, first)
      return { ...value, revision: 3 }
    })
    .mockImplementationOnce(async (value) => ({ ...value, revision: 4 }))
  const saved = (await flushPlanEdits(owner)).get(base.id)!
  expect(saved).toMatchObject({
    title: "Later title",
    notes: "New server note",
  })
  expect(await offlineDb.planEdits.count()).toBe(0)
})
test("a second conflict does not replay fields from the first server merge", async () => {
  const base = make(),
    local = { ...base, title: "Local" }
  await queuePlanEdit(owner, local, base)
  vi.mocked(saveWorkout)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", {
        current: { ...base, revision: 2, notes: "Remote one" },
      })
    )
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", {
        current: { ...base, revision: 3, notes: "Remote two" },
      })
    )
    .mockImplementationOnce(async (value) => ({ ...value, revision: 4 }))
  expect((await flushPlanEdits(owner)).get(base.id)).toMatchObject({
    title: "Local",
    notes: "Remote two",
  })
})
test("legacy conflict recovers order automatically and archives ambiguous values", async () => {
  const base = make(),
    local = { ...base, notes: "Stale", blocks: [...base.blocks].reverse() },
    remote = { ...base, revision: 2, notes: "New instructions" }
  await offlineDb.planEdits.put({
    key: `${owner}:${base.id}`,
    ownerId: owner,
    value: local,
    version: crypto.randomUUID(),
    error: "Old conflict",
  })
  vi.mocked(saveWorkout)
    .mockRejectedValueOnce(new ApiError(409, "Changed", { current: remote }))
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  const saved = (await flushPlanEdits(owner)).get(base.id)!
  expect(saved.notes).toBe("New instructions")
  expect(saved.blocks.map((b) => b.id)).toEqual(local.blocks.map((b) => b.id))
  expect(await offlineDb.recoveries.count()).toBe(1)
  expect(await offlineDb.planEdits.count()).toBe(0)
})

test("fresh edits made before legacy recovery retain only known new intent", async () => {
  const old = make()
  old.blocks.reverse()
  await offlineDb.planEdits.put({
    key: `${owner}:${old.id}`,
    ownerId: owner,
    value: old,
    version: crypto.randomUUID(),
  })
  await queuePlanEdit(owner, { ...old, title: "New title" }, old)
  vi.mocked(saveWorkout)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", {
        current: { ...old, revision: 2, notes: "Newest instructions" },
      })
    )
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  const saved = (await flushPlanEdits(owner)).get(old.id)!
  expect(saved.title).toBe("New title")
  expect(saved.notes).toBe("Newest instructions")
  expect(await offlineDb.planEdits.count()).toBe(0)
})
