import "fake-indexeddb/auto"
import { afterAll, expect, test } from "vitest"
import {
  getWorkoutDraft,
  offlineDb,
  listCachedSessions,
  listPending,
  queueSession,
  saveCorrection,
  readCorrection,
  clearOwnerCache,
} from "../lib/offline"
import { workoutDraft } from "../lib/workout-draft"
import type { WorkoutRecord } from "../contracts/models"
const plan = (): WorkoutRecord => ({
  id: crypto.randomUUID(),
  revision: 1,
  kind: "planned",
  routineId: null,
  weekId: null,
  date: "2026-10-21",
  title: "Athletic conditioning",
  focus: "",
  notes: "Plan commentary",
  source: null,
  blocks: [],
})
afterAll(() => offlineDb.close())
test("opening a plan uses a stable draft ID without logging or starting a timer", async () => {
  const workout = plan()
  const [first, second] = await Promise.all([
    getWorkoutDraft("owner", workout),
    getWorkoutDraft("owner", workout),
  ])
  expect(first.id).toBe(second.id)
  expect(first.startedAt).toBeNull()
  expect(first.results).toEqual([])
  expect(first.notes).toBe("")
  expect(await listCachedSessions("owner")).toEqual([])
  expect(await listPending("owner")).toEqual([])
  const changed = await getWorkoutDraft("owner", {
    ...workout,
    title: "Updated plan",
  })
  expect(changed.id).toBe(first.id)
  expect(changed.title).toBe("Updated plan")
  expect((await getWorkoutDraft("other-owner", workout)).id).not.toBe(first.id)
  await queueSession("owner", { ...first, notes: "Actually logged" })
  expect((await getWorkoutDraft("owner", workout)).notes).toBe(
    "Actually logged"
  )
})
test("correction drafts stay separate from completed results and block cache clearing", async () => {
  const session = { ...workoutDraft(plan()), status: "completed" as const }
  await saveCorrection("correction-owner", session)
  expect(await readCorrection("another-owner", session.id)).toBeUndefined()
  expect(await readCorrection("correction-owner", session.id)).toEqual(session)
  expect(await listPending("correction-owner")).toEqual([])
  expect(await listCachedSessions("correction-owner")).toEqual([])
  await expect(clearOwnerCache("correction-owner")).rejects.toThrow(
    "unfinished result corrections"
  )
})
