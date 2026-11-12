import "fake-indexeddb/auto"
import Dexie from "dexie"
import { afterAll, beforeEach, expect, test, vi } from "vitest"
import {
  disablePhoneNotifications,
  flushTimerAlerts,
  prepareNotificationWorker,
  queueTimerAlert,
} from "../lib/timer-alerts"
import { startRest } from "../lib/timers"
import { offlineDb } from "../lib/offline"

const db = new Dexie("training-phone-notifications")
db.version(1).stores({ devices: "ownerId,deviceId" })
const fetcher = vi.fn<typeof fetch>()
const network = { onLine: true }
beforeEach(async () => {
  vi.stubGlobal("window", new EventTarget())
  vi.stubGlobal("navigator", network)
  vi.stubGlobal("document", { visibilityState: "visible" })
  vi.stubGlobal("fetch", fetcher)
  network.onLine = true
  fetcher.mockReset()
  await db.table("devices").clear()
  await offlineDb.sessions.clear()
})
afterAll(() => {
  db.close()
  offlineDb.close()
  vi.unstubAllGlobals()
})
async function enrolled() {
  const ownerId = crypto.randomUUID()
  await db.table("devices").put({
    ownerId,
    deviceId: crypto.randomUUID(),
    enabled: true,
    sequence: 0,
    signature: null,
    pending: null,
    pendingDisable: false,
  })
  return ownerId
}
function acknowledge(body: string | null | undefined) {
  const value = JSON.parse(body ?? "{}")
  return Response.json({
    sequence: value.sequence,
    state: value.deadline ? "scheduled" : "cancelled",
    superseded: false,
  })
}
test("an acknowledgement cannot erase a newer pending timer edit", async () => {
  const owner = await enrolled()
  let finishFirst!: (response: Response) => void
  fetcher
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        })
    )
    .mockImplementation(async (_, init) => acknowledge(init?.body as string))
  const first = queueTimerAlert(owner, startRest(60, Date.now(), null))
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  const firstBody = fetcher.mock.calls[0][1]?.body as string
  const secondTimer = startRest(90, Date.now(), null)
  const second = queueTimerAlert(owner, secondTimer)
  await vi.waitFor(async () =>
    expect((await db.table("devices").get(owner)).pending.timerId).toBe(
      secondTimer.id
    )
  )
  finishFirst(acknowledge(firstBody))
  await Promise.all([first, second])
  expect(fetcher).toHaveBeenCalledTimes(2)
  const secondBody = JSON.parse(fetcher.mock.calls[1][1]?.body as string)
  expect(secondBody.timerId).toBe(secondTimer.id)
  expect(secondBody.sequence).toBeGreaterThan(JSON.parse(firstBody).sequence)
  expect((await db.table("devices").get(owner)).pending).toBeNull()
})
test("a delayed session lookup cannot resurrect a timer after cancellation", async () => {
  const owner = await enrolled()
  let finishLookup!: (value: undefined) => void
  const lookup = vi.spyOn(offlineDb.sessions, "get").mockImplementationOnce(
    () =>
      new Dexie.Promise<undefined>((resolve) => {
        finishLookup = resolve
      })
  )
  fetcher.mockImplementation(async (_, init) =>
    acknowledge(init?.body as string)
  )
  try {
    const staleStart = queueTimerAlert(
      owner,
      startRest(60, Date.now(), crypto.randomUUID())
    )
    expect(lookup).toHaveBeenCalledTimes(1)
    await queueTimerAlert(owner, null)
    finishLookup(undefined)
    await staleStart
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({
      timerId: null,
      deadline: null,
    })
    expect((await db.table("devices").get(owner)).signature).toBe("cancelled")
  } finally {
    lookup.mockRestore()
  }
})
test("sign-out still unsubscribes the browser when notification storage fails", async () => {
  const unsubscribe = vi.fn(async () => true)
  vi.stubGlobal("navigator", {
    onLine: true,
    serviceWorker: {
      getRegistration: vi.fn(async () => ({
        pushManager: { getSubscription: vi.fn(async () => ({ unsubscribe })) },
      })),
    },
  })
  const tablePrototype = Object.getPrototypeOf(
    db.Table.prototype
  ) as typeof db.Table.prototype
  const storage = vi
    .spyOn(tablePrototype, "get")
    .mockRejectedValueOnce(new Error("Storage unavailable"))
  try {
    await expect(
      disablePhoneNotifications(crypto.randomUUID())
    ).rejects.toThrow("Storage unavailable")
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  } finally {
    storage.mockRestore()
  }
})
test("offline edits coalesce to cancellation and only the latest intent is sent on reconnect", async () => {
  const owner = await enrolled()
  network.onLine = false
  await queueTimerAlert(owner, startRest(60, Date.now(), null))
  await queueTimerAlert(owner, null)
  expect(fetcher).not.toHaveBeenCalled()
  network.onLine = true
  fetcher.mockImplementation(async (_, init) =>
    acknowledge(init?.body as string)
  )
  await flushTimerAlerts(owner)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({
    timerId: null,
    deadline: null,
  })
})
test("a failed admission stays durable and retries with the same idempotent generation", async () => {
  const owner = await enrolled()
  fetcher
    .mockResolvedValueOnce(
      Response.json(
        {
          error: { code: "notifications_unavailable", message: "Unavailable" },
        },
        { status: 503 }
      )
    )
    .mockImplementation(async (_, init) => acknowledge(init?.body as string))
  await queueTimerAlert(owner, startRest(60, Date.now(), null))
  expect((await db.table("devices").get(owner)).pending).not.toBeNull()
  await flushTimerAlerts(owner)
  expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body)
  expect((await db.table("devices").get(owner)).pending).toBeNull()
})
test("disabled devices never admit timer notifications", async () => {
  const owner = await enrolled()
  await db.table("devices").update(owner, { enabled: false })
  await queueTimerAlert(owner, startRest(60, Date.now(), null))
  expect(fetcher).not.toHaveBeenCalled()
})
test("draft and first-autosave timers send immediately without an unowned session link", async () => {
  const owner = await enrolled()
  const sessionId = crypto.randomUUID()
  fetcher.mockImplementation(async (_, init) =>
    acknowledge(init?.body as string)
  )
  const manual = startRest(60, Date.now(), sessionId)
  await queueTimerAlert(owner, manual)
  expect(
    JSON.parse(fetcher.mock.calls[0][1]?.body as string).sessionId
  ).toBeNull()
  // An in-flight first autosave has not acknowledged this ID yet.
  await offlineDb.sessions.put({
    key: `${owner}:${sessionId}`,
    ownerId: owner,
    serverRevision: 0,
    session: {
      id: sessionId,
      revision: 0,
      workoutId: null,
      routineId: null,
      weekId: null,
      performedOn: "2026-10-31",
      title: "Draft",
      status: "active",
      blocks: [],
      results: [],
      notes: "",
      source: null,
      startedAt: null,
      finishedAt: null,
    },
  })
  await queueTimerAlert(owner, startRest(90, Date.now(), sessionId))
  expect(
    JSON.parse(fetcher.mock.calls[1][1]?.body as string).sessionId
  ).toBeNull()
  await offlineDb.sessions.update(`${owner}:${sessionId}`, {
    serverRevision: 1,
  })
  await queueTimerAlert(owner, startRest(120, Date.now(), sessionId))
  expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string).sessionId).toBe(
    sessionId
  )
})
test("enrollment waits for an old service worker to upgrade and confirm push capability", async () => {
  const oldWorker = { state: "activated", postMessage: vi.fn() }
  const newWorker = Object.assign(new EventTarget(), {
    state: "installing",
    postMessage: vi.fn((value, ports) => {
      if (value.type === "training-notification-capability")
        ports[0].postMessage({ restTimerPush: 1 })
    }),
  })
  const registration = {
    active: oldWorker,
    installing: newWorker,
    waiting: null,
    update: vi.fn(async () => undefined),
  }
  vi.stubGlobal("navigator", {
    onLine: true,
    serviceWorker: { register: vi.fn(async () => registration) },
  })
  let ready = false
  const work = prepareNotificationWorker().then((value) => {
    ready = true
    return value
  })
  await vi.waitFor(() => expect(registration.update).toHaveBeenCalled())
  expect(ready).toBe(false)
  newWorker.state = "activated"
  newWorker.dispatchEvent(new Event("statechange"))
  expect(await work).toBe(registration)
  expect(oldWorker.postMessage).not.toHaveBeenCalled()
  expect(newWorker.postMessage).toHaveBeenCalled()
})
