import "fake-indexeddb/auto"
import { beforeEach, afterAll, expect, test, vi } from "vitest"
import {
  defaultTargets,
  type SessionRecord,
  type WorkoutRecord,
} from "../contracts/models"
import { ApiError } from "../lib/api-client"
import {
  cacheSession,
  queueSession,
  flushQueue,
  listPending,
  readCachedSession,
  offlineDb,
  purgeWorkout,
  cachePlans,
  cacheWeekPlans,
  readCachedPlans,
  withPendingSessions,
} from "../lib/offline"

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
  saveSession: vi.fn(),
  getSession: vi.fn(),
}))
import { saveSession } from "../lib/api-client"
const owner = "owner-a"
const make = (): SessionRecord => ({
  id: crypto.randomUUID(),
  revision: 1,
  workoutId: null,
  routineId: null,
  weekId: null,
  performedOn: "2026-10-20",
  title: "Workout",
  status: "active",
  blocks: [],
  results: [],
  notes: "",
  source: null,
  startedAt: null,
  finishedAt: null,
})
beforeEach(async () => {
  vi.resetAllMocks()
  await offlineDb.pending.clear()
  await offlineDb.sessions.clear()
})
afterAll(() => offlineDb.close())
test("partitioned cache never exposes another owner's session", async () => {
  const session = make()
  await cacheSession(owner, session)
  expect(await readCachedSession("owner-b", session.id)).toBeUndefined()
})
test("an older remote read cannot replace a newer acknowledged session", async () => {
  const session = make()
  await cacheSession(owner, { ...session, revision: 3, title: "Latest" })
  await cacheSession(owner, { ...session, revision: 2, title: "Stale" })
  expect(await readCachedSession(owner, session.id)).toMatchObject({
    revision: 3,
    title: "Latest",
  })
})
test("week reconciliation removes deleted remote plans while retaining other weeks and pending edits", async () => {
  const ownerId = crypto.randomUUID(),
    weekId = crypto.randomUUID()
  const week = {
    id: weekId,
    revision: 1,
    startDate: "2026-10-19",
    title: "Test",
    notes: "",
    targets: defaultTargets,
  }
  const makePlan = (overrides: Partial<WorkoutRecord> = {}): WorkoutRecord => ({
    id: crypto.randomUUID(),
    revision: 1,
    kind: "planned",
    weekId,
    date: "2026-10-20",
    routineId: null,
    title: "Plan",
    notes: "",
    focus: "",
    blocks: [],
    source: null,
    ...overrides,
  })
  const edited = makePlan(),
    deleted = makePlan(),
    other = makePlan({ weekId: crypto.randomUUID() })
  await cachePlans(ownerId, [week], [edited, deleted, other])
  await offlineDb.planEdits.put({
    key: `${ownerId}:${edited.id}`,
    ownerId,
    version: "pending",
    base: edited,
    value: { ...edited, title: "Local edit" },
  })
  await cacheWeekPlans(
    ownerId,
    weekId,
    [week],
    [{ ...edited, revision: 2, title: "Remote edit" }]
  )
  const cached = await readCachedPlans(ownerId)
  expect(cached?.workouts).toEqual(
    expect.arrayContaining([
      other,
      expect.objectContaining({ id: edited.id, title: "Local edit" }),
    ])
  )
  expect(cached?.workouts.some((value) => value.id === deleted.id)).toBe(false)
  // A read that lost a race to an acknowledgement must not remove the newly saved plan.
  await cacheWeekPlans(ownerId, weekId, [], [], () => false)
  expect(await readCachedPlans(ownerId)).toEqual(cached)
  const before = (await offlineDb.plans.get(ownerId))!.workouts
  const added = makePlan({ revision: 2 })
  const moved = { ...other, revision: 2, weekId }
  await cachePlans(
    ownerId,
    [week],
    [...before, added].map((value) => (value.id === other.id ? moved : value))
  )
  await cacheWeekPlans(
    ownerId,
    weekId,
    [week],
    [{ ...edited, revision: 2 }],
    () => true,
    before
  )
  const reconciled = await readCachedPlans(ownerId)
  expect(reconciled?.workouts).toEqual(expect.arrayContaining([added, moved]))
  expect(new Set(reconciled?.workouts.map((value) => value.id)).size).toBe(
    reconciled?.workouts.length
  )
  await cachePlans(ownerId, [week], before, before)
  expect((await readCachedPlans(ownerId))?.workouts).toEqual(
    expect.arrayContaining([added, moved])
  )
})
test("scoped session lists retain pending local results without exposing another owner or week", async () => {
  const weekId = crypto.randomUUID(),
    session = { ...make(), weekId }
  await queueSession(owner, { ...session, notes: "Local" }, session)
  await queueSession(owner, { ...make(), weekId: crypto.randomUUID() })
  await queueSession("other", { ...make(), weekId })
  expect(await withPendingSessions(owner, [session], weekId)).toEqual([
    { ...session, notes: "Local" },
  ])
})
test("idempotency receipt survives uncertain network failures", async () => {
  const session = make()
  await queueSession(owner, session, session)
  vi.mocked(saveSession)
    .mockRejectedValueOnce(new TypeError("Network failed"))
    .mockResolvedValueOnce({ ...session, revision: 2 })
  await flushQueue(owner)
  expect((await listPending(owner))[0].status).toBe("error")
  await flushQueue(owner)
  expect(vi.mocked(saveSession).mock.calls[0][1]).toBe(
    vi.mocked(saveSession).mock.calls[1][1]
  )
  expect(await listPending(owner)).toHaveLength(0)
})
test("edits during a save drain automatically without losing newer values", async () => {
  const session = make()
  await queueSession(owner, session, session)
  vi.mocked(saveSession)
    .mockImplementationOnce(async () => {
      await queueSession(owner, { ...session, notes: "newer edit" }, session)
      return { ...session, revision: 2 }
    })
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  await flushQueue(owner)
  expect(await listPending(owner)).toHaveLength(0)
  expect((await readCachedSession(owner, session.id))?.notes).toBe("newer edit")
})
test("session conflicts merge automatically and preserve unrelated changes", async () => {
  const session = make()
  await queueSession(owner, { ...session, notes: "local" }, session)
  vi.mocked(saveSession)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", {
        current: {
          ...session,
          revision: 2,
          title: "Remote title",
          notes: "server",
        },
      })
    )
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  expect((await flushQueue(owner)).synced).toBe(1)
  expect(await listPending(owner)).toHaveLength(0)
  expect(await readCachedSession(owner, session.id)).toMatchObject({
    title: "Remote title",
    notes: "local",
    revision: 3,
  })
})
test("baseline-less legacy session cannot replace newer server fields", async () => {
  const session = make()
  await queueSession(owner, { ...session, notes: "Old value" })
  vi.mocked(saveSession)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", {
        current: { ...session, revision: 2, notes: "Newest" },
      })
    )
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  await flushQueue(owner)
  expect((await readCachedSession(owner, session.id))?.notes).toBe("Newest")
  expect(
    await offlineDb.recoveries.where("ownerId").equals(owner).count()
  ).toBeGreaterThan(0)
  expect(await listPending(owner)).toHaveLength(0)
})
test("authentication expiry preserves pending data", async () => {
  await queueSession(owner, make())
  vi.mocked(saveSession).mockRejectedValueOnce(new ApiError(401, "Sign in"))
  expect((await flushQueue(owner)).authRequired).toBe(true)
  expect(await listPending(owner)).toHaveLength(1)
})
test("deleting a workout clears pending results and ignores an in-flight response", async () => {
  const session = { ...make(), workoutId: crypto.randomUUID() }
  await queueSession(owner, session, session)
  vi.mocked(saveSession).mockImplementationOnce(async () => {
    await purgeWorkout(owner, {
      workoutId: session.workoutId,
      sessionIds: [session.id],
    })
    return { ...session, revision: 2 }
  })
  await flushQueue(owner)
  expect(await listPending(owner)).toHaveLength(0)
  expect(await readCachedSession(owner, session.id)).toBeUndefined()
  await cacheSession(owner, session)
  expect(await readCachedSession(owner, session.id)).toBeUndefined()
  await expect(queueSession(owner, session, session)).rejects.toThrow("deleted")
})
test("a server deletion is terminal, not a resolvable sync conflict", async () => {
  const session = make()
  await queueSession(owner, session, session)
  vi.mocked(saveSession).mockRejectedValueOnce(
    new ApiError(409, "Deleted", undefined, "record_deleted")
  )
  expect((await flushQueue(owner)).conflicts).toBe(0)
  expect(await listPending(owner)).toHaveLength(0)
  expect(await readCachedSession(owner, session.id)).toBeUndefined()
})

test("typing is durable immediately but waits for its debounce before sending", async () => {
  const base = make()
  await queueSession(owner, { ...base, notes: "Typing" }, base, 60000)
  expect((await readCachedSession(owner, base.id))?.notes).toBe("Typing")
  await flushQueue(owner)
  expect(saveSession).not.toHaveBeenCalled()
  await queueSession(
    owner,
    { ...base, notes: "Final" },
    { ...base, notes: "Typing" }
  )
  vi.mocked(saveSession).mockImplementationOnce(async (value) => ({
    ...value,
    revision: 2,
  }))
  await flushQueue(owner)
  expect((await readCachedSession(owner, base.id))?.notes).toBe("Final")
})
test("fresh edits remain saveable while a baseline-less session is recovered", async () => {
  const old = make()
  await queueSession(owner, { ...old, notes: "Old note" })
  await queueSession(
    owner,
    { ...old, title: "New title", notes: "Old note" },
    { ...old, notes: "Old note" }
  )
  vi.mocked(saveSession)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", {
        current: { ...old, revision: 2, notes: "New server note" },
      })
    )
    .mockImplementationOnce(async (value) => ({ ...value, revision: 3 }))
  await flushQueue(owner)
  expect(await readCachedSession(owner, old.id)).toMatchObject({
    title: "New title",
    notes: "New server note",
  })
})

test("a rejected request can be corrected instead of replaying the invalid body forever", async () => {
  const base = make()
  await queueSession(owner, { ...base, notes: "Rejected" }, base)
  vi.mocked(saveSession).mockRejectedValueOnce(
    new ApiError(422, "Check the request fields")
  )
  await flushQueue(owner)
  expect((await listPending(owner))[0].request).toBeUndefined()
  expect((await listPending(owner))[0].failure).toBe("invalid")
  await queueSession(
    owner,
    { ...base, notes: "Corrected" },
    { ...base, notes: "Rejected" }
  )
  vi.mocked(saveSession).mockImplementationOnce(async (value) => ({
    ...value,
    revision: 2,
  }))
  await flushQueue(owner)
  expect((await readCachedSession(owner, base.id))?.notes).toBe("Corrected")
  expect(await listPending(owner)).toHaveLength(0)
})
