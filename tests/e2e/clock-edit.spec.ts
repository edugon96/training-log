import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import {
  defaultTargets,
  makeItem,
  type SessionRecord,
  type WorkoutRecord,
} from "../../contracts/models"
import { workoutDraft } from "../../lib/workout-draft"
import { signInPage } from "./auth-helper"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: "America/Chicago",
})
const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `clock-edit-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Clock Edit Test" },
  })
  identity = { id: account.user.id, email, password }
})
test.afterAll(async () => {
  if (!identity) return
  for (const table of [
    "result_sets",
    "workout_sessions",
    "workouts",
    "weeks",
    "timer_settings",
    "exercises",
    "audit_events",
    "mutation_receipts",
  ])
    await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
      identity.id,
    ])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})
async function fixture(
  page: Page,
  context: BrowserContext,
  completed: boolean,
  legacy = false
) {
  await signInPage(page, identity.email, identity.password)
  await page.getByRole("heading", { name: /^Good / }).waitFor()
  await page.waitForLoadState("networkidle")
  const post = async (path: string, value: unknown) => {
    const response = await context.request.post(`/api/v1${path}`, {
      data: { value },
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const week = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "Clock week",
    targets: defaultTargets,
    notes: "",
  })
  const exercise = await post("/exercises", {
    id: randomUUID(),
    revision: 0,
    name: "Clock Row",
    equipmentId: null,
    equipment: "Machine",
    setup: "",
    primaryMuscle: "back",
    secondaryMuscles: [],
    pattern: "pull",
    defaultRole: "lifting",
    defaultLoad: { value: 20, unit: "lb", basis: "total" },
    trackingFields: ["load", "reps"],
    notes: "",
    archived: false,
  })
  const item = makeItem(exercise, 2)
  const plan: WorkoutRecord = await post("/workouts", {
    id: randomUUID(),
    revision: 0,
    kind: "planned",
    routineId: null,
    weekId: week.id,
    date: "2026-10-23",
    title: "Clock workout",
    focus: "",
    notes: "",
    source: null,
    blocks: [
      {
        id: randomUUID(),
        kind: "group",
        title: "Rows",
        notes: "",
        rounds: null,
        restSeconds: null,
        items: [item],
      },
    ],
  })
  const value = workoutDraft(plan)
  value.startedAt = "2026-10-23T20:50:32.123Z"
  if (completed) {
    value.status = "completed"
    value.finishedAt = "2026-10-24T16:12:15.012Z"
    value.pausedDurationMs = 19_742
  }
  value.results = item.sets.map((target, index) => ({
    id: randomUUID(),
    itemId: item.id,
    targetId: target.id,
    status: completed ? (index === 0 ? "completed" : "skipped") : "unlogged",
    reps: completed && index === 0 ? 10 : null,
    load:
      completed && index === 0
        ? { value: 20, unit: "lb", basis: "total" }
        : null,
    durationSeconds: null,
    distanceMeters: null,
    rir: null,
    notes: "",
    source: null,
  }))
  if (legacy) {
    value.loggingMode = "explicit"
    value.results = []
    value.startedAt = null
    value.finishedAt = null
    value.pausedDurationMs = 0
  }
  const session: SessionRecord = await post("/sessions", value)
  const read = async (): Promise<SessionRecord> =>
    (await context.request.get(`/api/v1/sessions/${session.id}`)).json()
  await page.goto(`/?tab=week&week=${week.id}&workout=${plan.id}`)
  await page
    .getByRole("button", { name: "Workout actions", exact: true })
    .waitFor()
  await page.waitForLoadState("networkidle")
  return { session, read }
}
// Chromium native datetime fields retain their internal focus after input.blur().
// Move focus to another control to exercise the actual focus-out save.
async function leaveTimeField(page: Page) {
  await page.getByRole("button", { name: "Close", exact: true }).focus()
}

async function openClock(page: Page) {
  await page
    .getByRole("button", { name: "Open workout clock", exact: true })
    .tap()
}

test("historical clock corrections preserve missing set results and completed status", async ({
  page,
  context,
}) => {
  const { session, read } = await fixture(page, context, true, true)
  await openClock(page)
  await expect(
    page.getByRole("timer", { name: "Workout elapsed time", exact: true })
  ).toHaveText("—")
  await page
    .getByLabel("Workout start time", { exact: true })
    .fill("2026-10-23T15:50")
  await leaveTimeField(page)
  await page
    .getByLabel("Workout end time", { exact: true })
    .fill("2026-10-23T17:16")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect
    .poll(async () => (await read()).finishedAt)
    .toBe("2026-10-23T22:16:00.000Z")
  expect((await read()).results).toEqual(session.results)
  expect((await read()).status).toBe("completed")
  await page.reload()
  await expect(page.locator(".workout-summary .elapsed-time")).toHaveText(
    "1:26:00"
  )
  await expect(page.locator(".workout-toolbar")).toContainText("Completed")
})

test("completed clocks are directly editable, preserve results and handle unknown or invalid times", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const { session, read } = await fixture(page, context, true)
  await openClock(page)
  await expect(
    page.getByRole("tab", { name: "Workout clock", exact: true })
  ).toHaveAttribute("aria-selected", "true")
  const start = page.getByLabel("Workout start time", { exact: true }),
    end = page.getByLabel("Workout end time", { exact: true })
  await expect(start).toBeEnabled()
  await expect(end).toBeEnabled()
  await expect(start).toHaveValue("2026-10-23T15:50")
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    // Wait for the drawer's opening/resize motion before assessing its layout.
    await expect
      .poll(async () => {
        const panel = (await page
          .getByRole("dialog", { name: "Clock", exact: true })
          .boundingBox())!
        return Math.abs(panel.y + panel.height - 844)
      })
      .toBeLessThan(1)
    for (const input of [start, end]) {
      const box = (await input.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(844)
    }
    await page.screenshot({
      path: test.info().outputPath(`completed-clock-${width}.png`),
    })
  }
  await end.fill("2026-10-23T17:16")
  // Closing must persist even when the final field has not explicitly blurred.
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect
    .poll(async () => (await read()).finishedAt)
    .toBe("2026-10-23T22:16:00.000Z")
  const corrected = await read()
  expect(corrected.startedAt).toBe(session.startedAt)
  expect(corrected.pausedDurationMs).toBe(0)
  expect(corrected.status).toBe("completed")
  expect(corrected.results).toEqual(session.results)
  await expect(page.locator(".workout-summary .elapsed-time")).toHaveText(
    "1:25:27"
  )
  await expect(page.locator(".workout-toolbar")).toContainText("Completed")
  await page.reload()
  await openClock(page)
  await expect(end).toHaveValue("2026-10-23T17:16")
  await end.fill("2026-10-23T15:40")
  await leaveTimeField(page)
  await expect(
    page.getByRole("alert").filter({ hasText: "End time must follow" })
  ).toBeVisible()
  expect((await read()).finishedAt).toBe(corrected.finishedAt)
  await end.fill("2026-10-23T17:16")
  await leaveTimeField(page)
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0)
  await start.fill("")
  await leaveTimeField(page)
  await end.fill("")
  await leaveTimeField(page)
  await expect(
    page.getByRole("timer", { name: "Workout elapsed time", exact: true })
  ).toHaveText("—")
  await expect.poll(async () => (await read()).finishedAt).toBeNull()
  expect((await read()).status).toBe("completed")
  await start.fill("2026-10-23T15:50")
  await leaveTimeField(page)
  await expect(
    page.getByRole("timer", { name: "Workout elapsed time", exact: true })
  ).toHaveText("—")
  await end.fill("2026-10-23T17:16")
  await leaveTimeField(page)
  await expect(
    page.getByRole("timer", { name: "Workout elapsed time", exact: true })
  ).toHaveText("1:26:00")
  await expect
    .poll(async () => (await read()).startedAt)
    .toBe("2026-10-23T20:50:00.000Z")
  expect((await read()).results).toEqual(session.results)
  expect(errors).toEqual([])
})

test("active end times save with unfinished sets, survive offline conflicts, resume and persist through Finish", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const { session, read } = await fixture(page, context, false)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await openClock(page)
  await page.getByRole("tab", { name: "Workout clock", exact: true }).tap()
  const end = page.getByLabel("Workout end time", { exact: true })
  await end.fill("2026-10-23T17:16")
  await leaveTimeField(page)
  await expect(
    page.getByRole("button", { name: "Resume workout timer", exact: true })
  ).toBeVisible()
  await expect
    .poll(async () => (await read()).finishedAt)
    .toBe("2026-10-23T22:16:00.000Z")
  expect((await read()).status).toBe("active")
  expect((await read()).results).toEqual(session.results)
  await context.setOffline(true)
  await end.fill("2026-10-23T17:20")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect(page.locator(".workout-summary .elapsed-time")).toHaveText(
    "1:29:27"
  )
  await expect(
    page.getByRole("status", { name: "Autosave: Offline" })
  ).toBeVisible()
  await page.reload()
  await expect(page.locator(".workout-summary .elapsed-time")).toHaveText(
    "1:29:27"
  )
  const current = await read()
  const remote = await context.request.put(`/api/v1/sessions/${session.id}`, {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      expectedRevision: current.revision,
      value: { ...current, userNotes: "Another device's note" },
    },
  })
  expect(remote.ok(), await remote.text()).toBe(true)
  await context.setOffline(false)
  await expect
    .poll(async () => (await read()).finishedAt)
    .toBe("2026-10-23T22:20:00.000Z")
  expect((await read()).userNotes).toBe("Another device's note")
  await openClock(page)
  await page.getByRole("tab", { name: "Workout clock", exact: true }).tap()
  await expect(end).toHaveValue("2026-10-23T17:20")
  await page
    .getByRole("button", { name: "Resume workout timer", exact: true })
    .tap()
  await expect.poll(async () => (await read()).finishedAt).toBeNull()
  expect((await read()).pausedDurationMs).toBeGreaterThan(0)
  await expect(
    page.getByRole("timer", { name: "Workout elapsed time", exact: true })
  ).toHaveText(/^1:29:/)
  await end.fill("2026-10-23T17:25")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect
    .poll(async () => (await read()).finishedAt)
    .toBe("2026-10-23T22:25:00.000Z")
  await page.getByRole("button", { name: "Finish workout", exact: true }).tap()
  await expect(
    page.getByRole("dialog", { name: "Review your workout", exact: true })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Skip remaining and finish", exact: true })
    .tap()
  await expect.poll(async () => (await read()).status).toBe("completed")
  const finished = await read()
  expect(finished.finishedAt).toBe("2026-10-23T22:25:00.000Z")
  expect(finished.results.every((result) => result.status === "skipped")).toBe(
    true
  )
  await page.reload()
  await expect(page.locator(".workout-summary .elapsed-time")).toHaveText(
    "1:34:27"
  )
  await expect(page.locator(".workout-toolbar")).toContainText("Completed")
  expect(errors).toEqual([])
})
