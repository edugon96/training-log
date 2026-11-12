import { test, expect, request, type APIRequestContext } from "@playwright/test"
import { randomUUID, createECDH, randomBytes } from "node:crypto"
import { betterAuth } from "better-auth"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signIn } from "./auth-helper"

const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
const owners: string[] = []
const contexts: APIRequestContext[] = []
async function account() {
  const email = `qa-notification-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const created = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Notification QA" },
  })
  owners.push(created.user.id)
  const context = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  })
  contexts.push(context)
  expect((await signIn(context, email, password)).ok()).toBe(true)
  return { context, ownerId: created.user.id, email, password }
}
function subscription() {
  const keys = createECDH("prime256v1")
  keys.generateKeys()
  return {
    endpoint: `https://web.push.apple.com/qa-never-sent-${randomUUID()}`,
    keys: {
      p256dh: keys.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  }
}
test.afterAll(async () => {
  for (const context of contexts) await context.dispose()
  for (const id of owners) {
    await getPool().query(
      "DELETE FROM notification_devices WHERE owner_id=$1",
      [id]
    )
    await getPool().query("DELETE FROM workout_sessions WHERE owner_id=$1", [
      id,
    ])
    await getPool().query('DELETE FROM "user" WHERE id=$1', [id])
  }
})
test("notification routes enforce browser origin, owner isolation, and monotonic timer updates", async () => {
  const { context: owner } = await account()
  const { context: other } = await account()
  const anonymous = await request.newContext({ baseURL: origin })
  contexts.push(anonymous)
  expect((await anonymous.get("/api/v1/notification-config")).status()).toBe(
    401
  )
  const config = await owner.get("/api/v1/notification-config")
  expect(config.ok(), await config.text()).toBe(true)
  expect(config.headers()["cache-control"]).toContain("no-store")
  expect((await config.json()).configured).toBe(true)
  const deviceId = randomUUID()
  const data = { deviceId, subscription: subscription() }
  expect(
    (
      await owner.put("/api/v1/notification-device", {
        data,
        headers: { Origin: "https://evil.example" },
      })
    ).status()
  ).toBe(403)
  expect(
    (
      await owner.put("/api/v1/notification-device", {
        data: {
          ...data,
          subscription: {
            ...data.subscription,
            endpoint: "http://127.0.0.1/private",
          },
        },
      })
    ).status()
  ).toBe(422)
  expect((await owner.put("/api/v1/notification-device", { data })).ok()).toBe(
    true
  )
  expect(
    (await other.put("/api/v1/notification-device", { data })).status()
  ).toBe(409)
  expect(
    await (
      await other.get(`/api/v1/notification-device?deviceId=${deviceId}`)
    ).json()
  ).toMatchObject({ enabled: false })
  const intent = {
    deviceId,
    sequence: 3,
    timerId: randomUUID(),
    sessionId: null,
    deadline: Date.now() - 1,
  }
  expect(
    (await other.put("/api/v1/timer-alerts", { data: intent })).status()
  ).toBe(409)
  const first = await owner.put("/api/v1/timer-alerts", { data: intent })
  expect(first.ok(), await first.text()).toBe(true)
  expect(await first.json()).toMatchObject({
    sequence: 3,
    state: "expired",
    superseded: false,
  })
  expect((await owner.put("/api/v1/timer-alerts", { data: intent })).ok()).toBe(
    true
  )
  expect(
    (
      await owner.put("/api/v1/timer-alerts", {
        data: { ...intent, deadline: intent.deadline - 1 },
      })
    ).status()
  ).toBe(409)
  expect(
    await (
      await owner.put("/api/v1/timer-alerts", {
        data: { ...intent, sequence: 2 },
      })
    ).json()
  ).toMatchObject({ sequence: 3, superseded: true })
  expect(
    (
      await owner.put("/api/v1/timer-alerts", {
        data: { ...intent, sequence: 4, sessionId: randomUUID() },
      })
    ).status()
  ).toBe(404)
  expect(
    (
      await owner.delete("/api/v1/notification-device", { data: { deviceId } })
    ).ok()
  ).toBe(true)
  expect(
    (
      await owner.put("/api/v1/timer-alerts", {
        data: { ...intent, sequence: 4 },
      })
    ).status()
  ).toBe(409)
})
test("real Workflow admission durably sleeps, then expires an obsolete alert without contacting a push provider", async () => {
  const { context: owner, ownerId } = await account()
  const deviceId = randomUUID()
  expect(
    (
      await owner.put("/api/v1/notification-device", {
        data: { deviceId, subscription: subscription() },
      })
    ).ok()
  ).toBe(true)
  const deadline = Date.now() + 8_000
  const response = await owner.put("/api/v1/timer-alerts", {
    data: {
      deviceId,
      sequence: 1,
      timerId: randomUUID(),
      sessionId: null,
      deadline,
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const scheduled = await getPool().query(
    "SELECT run_id,state FROM timer_alerts WHERE device_id=$1 AND owner_id=$2",
    [deviceId, ownerId]
  )
  expect(scheduled.rows[0].state).toBe("scheduled")
  expect(scheduled.rows[0].run_id).toBeTruthy()
  // The real workflow already holds its original wake time. Make only its
  // disposable DB row stale so the real delivery step never sends externally.
  await getPool().query(
    "UPDATE timer_alerts SET deadline=now()-interval '61 seconds' WHERE device_id=$1 AND owner_id=$2",
    [deviceId, ownerId]
  )
  await expect
    .poll(
      async () =>
        (
          await getPool().query(
            "SELECT state FROM timer_alerts WHERE device_id=$1 AND owner_id=$2",
            [deviceId, ownerId]
          )
        ).rows[0].state,
      { timeout: 30_000, intervals: [500, 1000] }
    )
    .toBe("expired")
})
test("the browser retries a failed admission and leaves natural completion notifications alive", async ({
  page,
}) => {
  const { context, ownerId } = await account()
  const deviceId = randomUUID()
  await page.context().addCookies((await context.storageState()).cookies)
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "granted" })
  })
  await page.goto("/")
  await page.evaluate(
    async ({ ownerId, deviceId }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("training-phone-notifications", 10)
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("devices")) {
            const devices = open.result.createObjectStore("devices", {
              keyPath: "ownerId",
            })
            devices.createIndex("deviceId", "deviceId")
          }
        }
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const transaction = open.result.transaction("devices", "readwrite")
          transaction
            .objectStore("devices")
            .put({
              ownerId,
              deviceId,
              enabled: true,
              sequence: 0,
              signature: "cancelled",
              pending: null,
              pendingDisable: false,
            })
          transaction.oncomplete = () => {
            open.result.close()
            resolve()
          }
        }
      })
      sessionStorage.setItem(
        `training-rest:${ownerId}`,
        JSON.stringify({
          id: "push-lifecycle",
          sessionId: null,
          durationMs: 60_000,
          remainingMs: 60_000,
          deadline: null,
          status: "paused",
        })
      )
    },
    { ownerId, deviceId }
  )
  const requests: { sequence: number; deadline: number | null }[] = []
  await page.route("**/api/v1/timer-alerts", async (route) => {
    const value = route.request().postDataJSON()
    requests.push(value)
    if (requests.length === 1)
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "notifications_unavailable", message: "Retry" },
        },
      })
    else
      await route.fulfill({
        json: {
          sequence: value.sequence,
          state: value.deadline ? "scheduled" : "cancelled",
          superseded: false,
        },
      })
  })
  await page.reload()
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  await page
    .getByRole("button", { name: "Resume rest timer", exact: true })
    .click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[0]).toEqual(requests[1])
  await page
    .getByRole("button", { name: "Pause rest timer", exact: true })
    .click()
  await expect.poll(() => requests.length).toBe(3)
  expect(requests[2].deadline).toBeNull()
  await page
    .getByRole("button", { name: "Reset rest timer", exact: true })
    .click()
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  const ruler = page.getByRole("slider", { name: "Custom duration" })
  await ruler.focus()
  await ruler.press("Home")
  await ruler.press("ArrowRight")
  await ruler.press("ArrowRight")
  await page
    .getByRole("button", { name: "Start rest timer", exact: true })
    .click()
  await expect.poll(() => requests.length).toBe(4)
  await expect(page.locator(".timer-face")).toHaveClass(/is-complete/, {
    timeout: 5000,
  })
  await expect
    .poll(
      () =>
        page.evaluate(
          (ownerId) => sessionStorage.getItem(`training-rest:${ownerId}`),
          ownerId
        ),
      { timeout: 6000 }
    )
    .toBeNull()
  expect(requests).toHaveLength(4)
  expect(requests[3].deadline).not.toBeNull()
})
