import { beforeEach, describe, expect, it, vi } from "vitest"
import webpush from "web-push"
import { PushSubscriptionInput, sendPush, type TimerPush } from "./push"

vi.mock("web-push", () => ({
  default: { sendNotification: vi.fn(async () => undefined) },
}))
const subscription = {
  endpoint: "https://web.push.apple.com/test",
  keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
}
const payload: TimerPush = {
  type: "rest-timer",
  ownerId: "test",
  deviceId: "eabb5f28-b782-4247-b004-9228917d7997",
  timerId: "one",
  sequence: 42,
  deadline: 100_000,
  url: "/?tab=week",
}
beforeEach(() => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "test")
  vi.stubEnv("VAPID_PRIVATE_KEY", "test")
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.invalid")
  vi.mocked(webpush.sendNotification).mockClear()
})
describe("push delivery envelope", () => {
  it("accepts browser push providers and rejects arbitrary network destinations", () => {
    expect(PushSubscriptionInput.safeParse(subscription).success).toBe(true)
    for (const endpoint of [
      "http://web.push.apple.com/test",
      "https://127.0.0.1",
      "https://push.apple.com.evil.example",
      "https://user:pass@web.push.apple.com/test",
      "https://web.push.apple.com:8080/test",
    ]) {
      expect(
        PushSubscriptionInput.safeParse({ ...subscription, endpoint }).success
      ).toBe(false)
    }
  })
  it("caps late delivery at one minute and sends high urgency with a stable collapse topic", async () => {
    await sendPush(subscription, payload, payload.deadline + 45_000)
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      subscription,
      JSON.stringify(payload),
      expect.objectContaining({ TTL: 15, urgency: "high", timeout: 5000 })
    )
    expect(
      vi.mocked(webpush.sendNotification).mock.calls[0][2]?.topic?.length
    ).toBeLessThanOrEqual(32)
    vi.mocked(webpush.sendNotification).mockClear()
    await sendPush(subscription, payload, payload.deadline + 60_000)
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })
  it("fails closed without configured credentials", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "")
    await expect(
      sendPush(subscription, payload, payload.deadline)
    ).rejects.toMatchObject({ status: 503 })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })
})
