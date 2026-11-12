import { test, expect } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signInPage } from "./auth-helper"
import {
  defaultTargets,
  makeItem,
  type ExerciseRecord,
} from "../../contracts/models"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `workout-time-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Workout Time Test" },
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
    "exercises",
    "audit_events",
    "mutation_receipts",
  ])
    await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
      identity.id,
    ])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})
test("mobile taps pause, resume and reset workout time without changing sets or the rest timer", async ({
  page,
  context,
}) => {
  const openWorkoutClock = async () => {
    if (
      !(await page
        .getByRole("tab", { name: "Workout clock", exact: true })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "Open workout clock", exact: true })
        .tap()
    await page.getByRole("tab", { name: "Workout clock", exact: true }).tap()
  }
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await signInPage(page, identity.email, identity.password)
  async function post(path: string, value: unknown) {
    const r = await context.request.post(`/api/v1${path}`, {
      data: { value },
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    })
    expect(r.ok(), await r.text()).toBe(true)
    return r.json()
  }
  const exercise: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "Clock Push-up",
    equipmentId: null,
    equipment: "Bodyweight",
    setup: "",
    primaryMuscle: "chest",
    secondaryMuscles: [],
    pattern: "push",
    defaultRole: "lifting",
    defaultLoad: null,
    trackingFields: ["reps"],
    notes: "",
    archived: false,
  }
  await post("/exercises", exercise)
  const week = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "Clock week",
    targets: defaultTargets,
    notes: "",
  })
  await post("/workouts", {
    id: randomUUID(),
    revision: 0,
    kind: "planned",
    routineId: null,
    weekId: week.id,
    date: "2026-10-20",
    title: "Clock workout",
    focus: "",
    notes: "",
    source: null,
    blocks: [
      {
        id: randomUUID(),
        title: "Strength",
        kind: "straight",
        restSeconds: 90,
        rounds: null,
        items: [makeItem(exercise, 1)],
        notes: "",
      },
    ],
  })
  await page.reload()
  await page
    .getByRole("button", { name: "Open Clock workout", exact: true })
    .tap()
  await openWorkoutClock()
  await page
    .getByRole("button", { name: "Start workout timer", exact: true })
    .tap()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  const duration = page
    .locator(".workout-summary")
    .getByLabel("Workout duration", { exact: true })
  await page
    .getByLabel("Clock Push-up set 1 actual reps", { exact: true })
    .fill("8")
  await page
    .getByRole("button", { name: "Clock Push-up set 1 complete", exact: true })
    .tap()
  await page
    .getByRole("button", { name: "Open workout clock", exact: true })
    .tap()
  await page.getByRole("button", { name: "1:00", exact: true }).tap()
  await page.waitForTimeout(1200)
  const readRest = () =>
    page.evaluate(
      (id) =>
        JSON.parse(sessionStorage.getItem(`training-rest:${id}`) || "null"),
      identity.id
    )
  const beforeRestReset = await readRest()
  await page.getByRole("button", { name: "Reset rest timer" }).tap()
  await expect
    .poll(async () => (await readRest()).id)
    .not.toBe(beforeRestReset.id)
  expect((await readRest()).deadline).toBeNull()
  await expect(page.locator(".rest-countdown")).toHaveText("0:00")
  await page.getByRole("button", { name: "1:00", exact: true }).tap()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await context.setOffline(true)
  await openWorkoutClock()
  await page
    .getByRole("button", { name: "Pause workout timer", exact: true })
    .tap()
  await expect(
    page.getByRole("button", { name: "Resume workout timer", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect(
    page.getByRole("status", { name: "Autosave: Offline" }).first()
  ).toBeVisible()
  const paused = await duration.textContent()
  await page.reload()
  await openWorkoutClock()
  await expect(
    page.getByRole("button", { name: "Resume workout timer", exact: true })
  ).toBeVisible()
  await page.waitForTimeout(1200)
  await expect(duration).toHaveText(paused!)
  await page
    .getByRole("button", { name: "Resume workout timer", exact: true })
    .tap()
  await expect(duration).not.toHaveText(paused!)
  await context.setOffline(false)
  await expect
    .poll(
      async () =>
        (await (await context.request.get("/api/v1/sessions")).json())[0]
          ?.pausedDurationMs
    )
    .toBeGreaterThan(1000)
  const beforeReset = await readRest()
  await openWorkoutClock()
  await page.screenshot({ path: "test-results/workout-time-mobile.png" })
  await page.getByRole("button", { name: "Reset workout timer" }).tap()
  await expect(
    page.getByRole("timer", { name: "Workout elapsed time" })
  ).toHaveText("0:00")
  await page.waitForTimeout(1100)
  await expect(
    page.getByRole("timer", { name: "Workout elapsed time" })
  ).toHaveText("0:00")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect(duration).toHaveText("0:00")
  await expect(
    page.getByLabel("Clock Push-up set 1 actual reps", { exact: true })
  ).toHaveValue("8")
  expect((await readRest()).id).toBe(beforeReset.id)
  expect((await readRest()).deadline).toBe(beforeReset.deadline)
  await expect
    .poll(
      async () =>
        (await (await context.request.get("/api/v1/sessions")).json())[0]
          ?.pausedDurationMs
    )
    .toBe(0)
  await page.reload()
  await expect(page.locator(".workout-summary .elapsed-time")).toHaveText(
    "0:00"
  )
  await openWorkoutClock()
  await page
    .getByRole("button", { name: "Start workout timer", exact: true })
    .tap()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await page.setViewportSize({ width: 320, height: 740 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.locator(".workout-summary").scrollIntoViewIfNeeded()
  await page.screenshot({ path: "test-results/workout-clock-toolbar-320.png" })
  await openWorkoutClock()
  await page
    .getByRole("button", { name: "Pause workout timer", exact: true })
    .tap()
  const finishTime = await duration.textContent()
  await page.waitForTimeout(1200)
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await page.getByRole("button", { name: "Finish workout", exact: true }).tap()
  await expect(page.locator(".workout-toolbar")).toContainText("Completed")
  await expect(duration).toHaveText(finishTime!)
  await expect
    .poll(
      async () =>
        (await (await context.request.get("/api/v1/sessions")).json())[0]
          ?.status
    )
    .toBe("completed")
  const backup = await (await context.request.get("/api/v1/export")).json()
  expect(backup.sessions[0].pausedDurationMs).toBeGreaterThan(1000)
  expect(backup.sessions[0].timerPausedAt).toBeNull()
  expect(backup.sessions[0].results[0].reps).toBe(8)
  expect(errors).toEqual([])
})
