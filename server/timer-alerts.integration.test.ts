import { config } from "dotenv"
import { randomUUID, createECDH, randomBytes } from "node:crypto"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getPool } from "./db"
import { enrollDevice, scheduleTimerAlert, disableDevice } from "./timer-alerts"
import { deliverTimerGeneration } from "./timer-alert-delivery"
import { sendPush } from "./push"

vi.mock("workflow/api", () => ({
  start: vi.fn(async () => ({ runId: "test-run" })),
  getRun: vi.fn(() => ({ cancel: vi.fn(async () => undefined) })),
}))
vi.mock("./push", async (original) => ({
  ...(await original<typeof import("./push")>()),
  sendPush: vi.fn(async () => undefined),
}))
config({ path: ".env.local", quiet: true })
const enabled = process.env.RUN_DATABASE_TESTS === "1"
const owners: string[] = []
async function enrolled() {
  const ownerId = randomUUID(),
    deviceId = randomUUID()
  owners.push(ownerId)
  const keys = createECDH("prime256v1")
  keys.generateKeys()
  await enrollDevice(ownerId, {
    deviceId,
    subscription: {
      endpoint: `https://web.push.apple.com/test-${randomUUID()}`,
      keys: {
        p256dh: keys.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    },
  })
  return { ownerId, deviceId }
}
afterAll(async () => {
  for (const owner of owners)
    await getPool().query(
      "DELETE FROM notification_devices WHERE owner_id=$1",
      [owner]
    )
})
beforeEach(() => {
  // Delivery is mocked in this suite. Keep configuration independent of a
  // developer's optional local push credentials.
  vi.stubEnv("VAPID_PUBLIC_KEY", "test")
  vi.stubEnv("VAPID_PRIVATE_KEY", "test")
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.invalid")
  vi.mocked(sendPush).mockClear()
})
describe.skipIf(!enabled)("rest alerts on PostgreSQL", () => {
  it("serializes competing duplicate deliveries and rejects a previous timer generation", async () => {
    const { ownerId, deviceId } = await enrolled()
    const first = {
      deviceId,
      sequence: 1,
      timerId: randomUUID(),
      sessionId: null,
      deadline: Date.now() + 60_000,
    }
    await scheduleTimerAlert(ownerId, first)
    const next = { ...first, sequence: 2, deadline: first.deadline + 30_000 }
    await scheduleTimerAlert(ownerId, next)
    expect(
      await deliverTimerGeneration(ownerId, deviceId, 1, next.deadline)
    ).toBe("superseded")
    const values = await Promise.all([
      deliverTimerGeneration(ownerId, deviceId, 2, next.deadline),
      deliverTimerGeneration(ownerId, deviceId, 2, next.deadline),
    ])
    expect(values.sort()).toEqual(["delivered", "superseded"])
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendPush).mock.calls[0][1]).toMatchObject({
      deviceId,
      ownerId,
      sequence: 2,
      deadline: next.deadline,
    })
  })
  it("cancellation, disabled devices, and expiry prevent delivery", async () => {
    const { ownerId, deviceId } = await enrolled()
    const initial = {
      deviceId,
      sequence: 1,
      timerId: randomUUID(),
      sessionId: null,
      deadline: Date.now() + 60_000,
    }
    await scheduleTimerAlert(ownerId, initial)
    await scheduleTimerAlert(ownerId, {
      ...initial,
      sequence: 2,
      timerId: null,
      deadline: null,
    })
    expect(
      await deliverTimerGeneration(ownerId, deviceId, 1, initial.deadline)
    ).toBe("superseded")
    await scheduleTimerAlert(ownerId, { ...initial, sequence: 3 })
    expect(
      await deliverTimerGeneration(
        ownerId,
        deviceId,
        3,
        initial.deadline + 60_000
      )
    ).toBe("expired")
    await scheduleTimerAlert(ownerId, { ...initial, sequence: 4 })
    await disableDevice(ownerId, deviceId)
    expect(
      await deliverTimerGeneration(ownerId, deviceId, 4, initial.deadline)
    ).toBe("superseded")
    expect(sendPush).not.toHaveBeenCalled()
  })
  it("retries a failed send without losing the pending generation and disables expired subscriptions", async () => {
    const { ownerId, deviceId } = await enrolled()
    const initial = {
      deviceId,
      sequence: 1,
      timerId: randomUUID(),
      sessionId: null,
      deadline: Date.now() + 60_000,
    }
    await scheduleTimerAlert(ownerId, initial)
    vi.mocked(sendPush).mockRejectedValueOnce({ statusCode: 503 })
    await expect(
      deliverTimerGeneration(ownerId, deviceId, 1, initial.deadline)
    ).rejects.toMatchObject({ statusCode: 503 })
    expect(
      (
        await getPool().query(
          "SELECT state FROM timer_alerts WHERE device_id=$1",
          [deviceId]
        )
      ).rows[0].state
    ).toBe("scheduled")
    expect(
      await deliverTimerGeneration(ownerId, deviceId, 1, initial.deadline)
    ).toBe("delivered")
    await scheduleTimerAlert(ownerId, { ...initial, sequence: 2 })
    vi.mocked(sendPush).mockRejectedValueOnce({ statusCode: 410 })
    expect(
      await deliverTimerGeneration(ownerId, deviceId, 2, initial.deadline)
    ).toBe("subscription-expired")
    expect(
      (
        await getPool().query(
          "SELECT enabled FROM notification_devices WHERE id=$1",
          [deviceId]
        )
      ).rows[0].enabled
    ).toBe(false)
  })
})
