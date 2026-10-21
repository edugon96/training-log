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
  type SessionRecord,
} from "../../contracts/models"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `unified-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Alex Test" },
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
    "training_defaults",
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

test("one workout screen, manual timing, mobile units, protected completed edits and Profile", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await signInPage(page, identity.email, identity.password)
  async function post(path: string, value: unknown) {
    const response = await context.request.post(`/api/v1${path}`, {
      data: { value },
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const movement: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "Test Bench",
    equipmentId: null,
    equipment: "Barbell",
    setup: "",
    primaryMuscle: "chest",
    secondaryMuscles: [],
    pattern: "push",
    defaultRole: "lifting",
    defaultLoad: { value: 70, unit: "lb", basis: "total" },
    trackingFields: ["load", "reps"],
    notes: "",
    archived: false,
  }
  await post("/exercises", movement)
  const week = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "Screen test",
    targets: defaultTargets,
    notes: "",
  })
  const plan = await post("/workouts", {
    id: randomUUID(),
    revision: 0,
    kind: "planned",
    weekId: week.id,
    routineId: null,
    date: "2026-10-21",
    title: "Athletic conditioning",
    focus: "",
    notes: "",
    source: null,
    blocks: [
      {
        id: randomUUID(),
        title: "Strength",
        kind: "straight",
        rounds: null,
        restSeconds: 90,
        notes: "",
        items: [makeItem(movement, 2)],
      },
    ],
  })
  const sessions = async (): Promise<SessionRecord[]> =>
    (await context.request.get("/api/v1/sessions")).json()
  // Hold real responses to inspect each route's loader, then let the actual API finish.
  for (const route of [
    { page: "week", query: `tab=week&week=${week.id}` },
    { page: "library", query: "tab=library" },
    { page: "profile", query: "tab=profile" },
    { page: "workout", query: `tab=week&week=${week.id}&workout=${plan.id}` },
  ]) {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/v1/me", async (request) => {
      await gate
      await request.continue()
    })
    await page.goto(`/?${route.query}`)
    const skeleton = page.locator(`[data-loading-page="${route.page}"]`)
    await expect(skeleton).toBeVisible()
    await expect(skeleton.locator(":scope > div")).toHaveCSS(
      "animation-delay",
      "0.16s, 0.4s"
    )
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(skeleton.locator(":scope > div")).toHaveCSS(
      "animation-name",
      "none"
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    if (route.page === "workout")
      await page.screenshot({
        path: "test-results/workout-skeleton-mobile.png",
      })
    await page.emulateMedia({ reducedMotion: "no-preference" })
    release()
    await expect(skeleton).toHaveCount(0)
    await page.unroute("**/api/v1/me")
  }
  await page.goto(`/?tab=week&week=${week.id}`)
  await page.reload()
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(0)
  await expect(
    page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button")
  ).toHaveCount(3)
  await page
    .getByRole("button", { name: "Open Athletic conditioning", exact: true })
    .tap()
  await expect(page).toHaveURL(/workout=/)
  await expect(
    page.getByRole("heading", { name: "Athletic conditioning", exact: true })
  ).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Start workout", exact: true })
  ).toHaveCount(0)
  expect(await sessions()).toHaveLength(0)
  await page.reload()
  await expect(page.locator(".session-footer .elapsed-time")).toHaveText("0:00")
  expect(await sessions()).toHaveLength(0)
  await page.getByRole("button", { name: "Workout actions", exact: true }).tap()
  await page
    .getByRole("menuitem", { name: "Edit movements", exact: true })
    .tap()
  await page.getByLabel("Workout", { exact: true }).fill("Changed draft")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect(
    page.getByRole("heading", { name: "Discard changes?" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Discard changes", exact: true }).tap()
  expect(await sessions()).toHaveLength(0)
  await page
    .getByLabel("Test Bench set 1 actual weight", { exact: true })
    .fill("70")
  await page
    .getByLabel("Test Bench set 1 actual reps", { exact: true })
    .fill("9")
  await expect.poll(async () => (await sessions())[0]?.results[0]?.reps).toBe(9)
  expect((await sessions())[0].startedAt).toBeNull()
  await expect(page.getByLabel("Session notes", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Workout actions", exact: true }).tap()
  await page.getByRole("menuitem", { name: "Session notes", exact: true }).tap()
  await page
    .getByRole("textbox", { name: "Session notes", exact: true })
    .fill("Good session, notes saved automatically")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect
    .poll(async () => {
      const saved = (await sessions())[0]
      return saved?.userNotes ?? saved?.notes
    })
    .toBe("Good session, notes saved automatically")
  const clockCenter = await page
    .locator(".session-time-button .elapsed-time")
    .boundingBox()
  const restCenter = await page
    .getByRole("button", { name: "Open rest timer", exact: true })
    .boundingBox()
  expect(
    clockCenter &&
      restCenter &&
      Math.abs(
        clockCenter.y +
          clockCenter.height / 2 -
          restCenter.y -
          restCenter.height / 2
      )
  ).toBeLessThan(2)
  await page.screenshot({ path: "test-results/workout-toolbar-mobile.png" })
  await page
    .getByRole("button", { name: "Test Bench actions", exact: true })
    .tap()
  await page.getByRole("menuitem", { name: "Units", exact: true }).tap()
  await page
    .getByRole("combobox", { name: "Test Bench new entries unit", exact: true })
    .tap()
  await page.getByRole("option", { name: "kg", exact: true }).tap()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await page
    .getByLabel("Test Bench set 2 actual weight", { exact: true })
    .fill("30")
  await page
    .getByLabel("Test Bench set 2 actual reps", { exact: true })
    .fill("10")
  await expect.poll(async () => (await sessions())[0]?.results.length).toBe(2)
  await expect
    .poll(async () => (await sessions())[0]?.results[1]?.load?.unit)
    .toBe("kg")
  expect((await sessions())[0].results[0].load?.unit).toBe("lb")
  await page
    .getByRole("button", { name: "Test Bench set 1 actions", exact: true })
    .tap()
  for (const item of await page.getByRole("menuitem").all())
    await expect(item.locator("svg")).toHaveCount(1)
  await page.getByRole("menuitem", { name: "Set-specific units" }).tap()
  await expect(
    page.getByRole("combobox", { name: "Test Bench set 1 unit", exact: true })
  ).toContainText("lb")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await page
    .getByRole("button", { name: "Edit workout time", exact: true })
    .tap()
  await page
    .getByRole("button", { name: "Start workout timer", exact: true })
    .tap()
  await expect.poll(async () => (await sessions())[0]?.startedAt).not.toBeNull()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await page
    .getByRole("button", { name: "Pause workout timer", exact: true })
    .tap()
  await expect(
    page.getByRole("button", { name: "Resume workout timer", exact: true })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Edit workout time", exact: true })
    .tap()
  await page
    .getByRole("button", { name: "Reset workout timer", exact: true })
    .tap()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect(page.locator(".session-footer .elapsed-time")).toHaveText("0:00")
  await expect.poll(async () => (await sessions())[0]?.startedAt).toBeNull()
  await page.getByRole("button", { name: "Finish workout", exact: true }).tap()
  await expect.poll(async () => (await sessions())[0]?.status).toBe("completed")
  const completed = (await sessions())[0]
  expect(completed.finishedAt).toBeNull()
  await expect(
    page.getByLabel("Test Bench set 1 actual reps", { exact: true })
  ).toHaveAttribute("readonly")
  await expect(
    page.getByRole("button", { name: "Reopen workout" })
  ).toHaveCount(0)
  await page.reload()
  await page.getByRole("button", { name: "Workout actions", exact: true }).tap()
  await page.getByRole("menuitem", { name: "Edit results", exact: true }).tap()
  await page
    .getByLabel("Test Bench set 1 actual reps", { exact: true })
    .fill("")
  await page.getByRole("button", { name: "Done editing", exact: true }).tap()
  await expect(
    page.getByRole("heading", { name: "Review your workout" })
  ).toBeVisible()
  expect((await sessions())[0].results[0].reps).toBe(9)
  await page.getByRole("button", { name: "Review sets", exact: true }).tap()
  const current = (await sessions())[0]
  const changedElsewhere = await context.request.put(
    `/api/v1/sessions/${current.id}`,
    {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data: {
        expectedRevision: current.revision,
        value: { ...current, notes: "Changed on another device" },
      },
    }
  )
  expect(changedElsewhere.ok()).toBe(true)
  await page.reload()
  await expect(
    page.getByRole("heading", {
      name: "Results changed elsewhere",
      exact: true,
    })
  ).toBeVisible()
  expect((await sessions())[0].notes).toBe("Changed on another device")
  await page
    .getByRole("button", { name: "Review device draft", exact: true })
    .tap()
  await expect(
    page.getByLabel("Test Bench set 1 actual reps", { exact: true })
  ).toHaveValue("")
  await page
    .getByLabel("Test Bench set 1 actual reps", { exact: true })
    .fill("11")
  await expect.poll(async () => (await sessions())[0]?.results[0].reps).toBe(11)
  expect((await sessions())[0].status).toBe("completed")
  expect((await sessions())[0].startedAt).toBeNull()
  expect((await sessions())[0].finishedAt).toBeNull()
  await page.getByRole("button", { name: "Done editing", exact: true }).tap()
  await page.screenshot({ path: "test-results/unified-completed-mobile.png" })
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await expect(
    page.getByRole("button", {
      name: "Open Athletic conditioning",
      exact: true,
    })
  ).toBeVisible()
  await page.goForward()
  await expect(
    page.getByRole("heading", { name: "Athletic conditioning", exact: true })
  ).toBeVisible()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .tap()
  await page.getByLabel("Display name", { exact: true }).fill("Sam Test")
  await page.getByLabel("Email", { exact: true }).tap()
  await expect
    .poll(
      async () => (await (await context.request.get("/api/v1/me")).json()).name
    )
    .toBe("Sam Test")
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Week", exact: true })
    .tap()
  await expect(
    page.getByRole("heading", {
      name: /^Good (morning|afternoon|evening), Sam$/,
    })
  ).toBeVisible()
  await page.getByRole("button", { name: "Week actions", exact: true }).tap()
  const handle = page.locator(".mobile-panel-grip").last()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, 840, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
  await page.goto(`/?tab=settings&week=${week.id}`)
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true })
  ).toBeVisible()
  await page.goto(`/?tab=history&week=${week.id}`)
  await expect(
    page.getByRole("button", {
      name: "Open Athletic conditioning",
      exact: true,
    })
  ).toBeVisible()
  expect(
    (await sessions()).filter((session) => session.workoutId === plan.id)
  ).toHaveLength(1)
  expect(errors).toEqual([])
})
