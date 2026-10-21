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

const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `home-${randomUUID()}@example.test`,
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

test("compact Home, direct opening, progress, planning menu and device-local wake control", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await context.addInitScript(() => {
    const state = { requests: 0, releases: 0 }
    Object.assign(window, { __wake: state })
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          state.requests++
          const lock = Object.assign(new EventTarget(), {
            released: false,
            release: async () => {
              lock.released = true
              state.releases++
              lock.dispatchEvent(new Event("release"))
            },
          })
          return lock
        },
      },
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, identity.email, identity.password)
  await expect(
    page.getByRole("heading", {
      name: /^Good (morning|afternoon|evening), Alex$/,
    })
  ).toBeVisible()
  const wake = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __wake: { requests: number; releases: number }
          }
        ).__wake
    )
  await expect.poll(async () => (await wake()).requests).toBe(1)
  async function post(path: string, data: unknown) {
    const response = await context.request.post(`/api/v1${path}`, {
      data,
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const date = (offset: number) => {
    const day = new Date(monday)
    day.setDate(day.getDate() + offset)
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
  }
  const week = await post("/weeks", {
    value: {
      id: randomUUID(),
      revision: 0,
      startDate: date(0),
      title: "Current week",
      targets: defaultTargets,
      notes: "",
    },
  })
  const future = await post("/weeks", {
    value: {
      id: randomUUID(),
      revision: 0,
      startDate: date(7),
      title: "Next week",
      targets: defaultTargets,
      notes: "",
    },
  })
  const movement: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "Pull-up",
    equipmentId: null,
    equipment: "Rig",
    setup: "",
    primaryMuscle: "back",
    secondaryMuscles: ["biceps"],
    pattern: "pull",
    defaultRole: "lifting",
    defaultLoad: null,
    trackingFields: ["reps"],
    notes: "",
    archived: false,
  }
  await post("/exercises", { value: movement })
  const ids: string[] = []
  const titles = [
    "Upper strength",
    "Lower strength",
    "Athletic conditioning",
    "Back and shoulders",
    "Chest and arms",
    "Lower body and conditioning",
  ]
  for (const [index, title] of titles.entries()) {
    const item = makeItem(movement, 3)
    const workout = await post("/workouts", {
      value: {
        id: randomUUID(),
        revision: 0,
        kind: "planned",
        routineId: null,
        weekId: week.id,
        date: date(index),
        title,
        focus:
          index % 2
            ? "Strength + accessories"
            : "Power + strength + conditioning",
        notes: "",
        source: null,
        blocks: [
          {
            id: randomUUID(),
            title: "Strength",
            kind: "straight",
            restSeconds: 120,
            rounds: null,
            items: [item],
            notes: "**Keep reps controlled.**\n\nRest between sets.",
          },
        ],
      },
    })
    ids.push(workout.id)
  }
  const session = (await post(`/workouts/${ids[0]}/start`, {
    performedOn: date(0),
  })) as SessionRecord
  const saved = await context.request.put(`/api/v1/sessions/${session.id}`, {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      expectedRevision: session.revision,
      value: {
        ...session,
        status: "completed",
        startedAt: `${date(0)}T12:00:00.000Z`,
        finishedAt: `${date(0)}T14:00:00.000Z`,
        pausedDurationMs: 1800000,
        timerPausedAt: null,
        results: session.results.map((result) => ({ ...result, reps: 8 })),
      },
    },
  })
  expect(saved.ok(), await saved.text()).toBe(true)
  await page.reload()
  await expect(page.getByLabel("Selected week")).toContainText("Current week")
  const progress = page.getByRole("region", { name: "Weekly progress" })
  await expect(progress).toContainText("1 / 6")
  await expect(progress).toContainText("1h 30m")
  await expect(progress).toContainText("logged")
  await expect(page.locator(".home-workout-card")).toHaveCount(6)
  for (const card of await page.locator(".home-workout-card").all()) {
    await expect(card).toHaveJSProperty("tagName", "BUTTON")
    await expect(card.locator("button")).toHaveCount(0)
    await expect(card.locator(".home-workout-copy > span")).toContainText(
      /sets/
    )
    const date = (await card.locator(".home-workout-date").boundingBox())!
    const bounds = (await card.boundingBox())!
    expect(
      Math.abs(date.y + date.height / 2 - (bounds.y + bounds.height / 2))
    ).toBeLessThan(2)
    await expect(card.locator(".home-workout-preview")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    )
    await expect(card.locator(".home-workout-bottom")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    )
  }
  await expect(
    page.getByRole("button", { name: "Training goals", exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole("table")).toHaveCount(0)
  await page.screenshot({
    path: "test-results/home-mobile.png",
    animations: "disabled",
  })
  const sessionCount = (
    await (await context.request.get("/api/v1/sessions")).json()
  ).length
  await page
    .getByRole("button", { name: "Open Lower strength", exact: true })
    .locator(".home-workout-bottom")
    .click()
  await expect(
    page.getByRole("heading", { name: "Pull-up", exact: true })
  ).toBeVisible()
  await expect(page.locator(".instructions strong")).toHaveText(
    "Keep reps controlled."
  )
  await page.screenshot({
    path: "test-results/home-preview-mobile.png",
    animations: "disabled",
  })
  expect(
    (await (await context.request.get("/api/v1/sessions")).json()).length
  ).toBe(sessionCount)
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page.getByRole("button", { name: "Week actions" }).click()
  for (const name of [
    "Muscle ledger",
    "Week details",
    "Repeat week",
    "New workout",
    "Add from routine",
    "New week",
  ])
    await expect(
      page.getByRole("menuitem", { name, exact: true })
    ).toBeVisible()
  await page.screenshot({
    path: "test-results/home-menu-mobile.png",
    animations: "disabled",
  })
  await page.getByRole("menuitem", { name: "Muscle ledger" }).click()
  await expect(
    page.getByRole("columnheader", { name: "Plan", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("columnheader", { name: "Done", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Edit week targets" }).click()
  await expect(page.getByRole("dialog").getByLabel("Chest target")).toHaveValue(
    String(defaultTargets.chest)
  )
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByLabel("Selected week").click()
  await page.getByRole("option", { name: /Next week/ }).click()
  await expect(page).toHaveURL(new RegExp(future.id))
  await expect(page.getByText("A clear week ahead")).toBeVisible()
  await page.goBack()
  await expect(page.locator(".home-workout-card")).toHaveCount(6)
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.screenshot({
      path: `test-results/home-${width}.png`,
      animations: "disabled",
    })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => scrollTo(0, 450))
  expect((await page.locator(".topbar").boundingBox())!.y).toBeLessThan(0)
  await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none")
  const nav = page.getByRole("navigation", { name: "Mobile navigation" })
  const middleTab = (await nav
    .getByRole("button", { name: "Library", exact: true })
    .boundingBox())!
  expect(Math.abs(middleTab.x + middleTab.width / 2 - 195)).toBeLessThanOrEqual(
    1
  )
  await nav.getByRole("button", { name: "Profile", exact: true }).click()
  await expect(
    page.getByLabel("Keep screen awake", { exact: true })
  ).toBeChecked()
  await expect(
    page.getByText("Active while the app is visible.", { exact: true })
  ).toBeVisible()
  expect((await wake()).requests).toBe(1)
  await page.getByLabel("Keep screen awake", { exact: true }).uncheck()
  await expect.poll(async () => (await wake()).releases).toBe(1)
  await page.reload()
  await expect(
    page.getByLabel("Keep screen awake", { exact: true })
  ).not.toBeChecked()
  expect((await wake()).requests).toBe(0)
  await page.getByLabel("Keep screen awake", { exact: true }).check()
  await expect.poll(async () => (await wake()).requests).toBe(1)
  await nav.getByRole("button", { name: "Week", exact: true }).click()
  await page
    .getByRole("button", { name: "Open Lower strength", exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(/workout=/)
  await page.getByLabel("Pull-up set 1 actual reps", { exact: true }).fill("8")
  await expect
    .poll(
      async () =>
        (await (await context.request.get("/api/v1/sessions")).json()).length
    )
    .toBe(sessionCount + 1)
  await nav.getByRole("button", { name: "Week", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Open Lower strength", exact: true })
  ).toHaveCount(1)
  expect(
    (await (await context.request.get("/api/v1/sessions")).json()).length
  ).toBe(sessionCount + 1)
  await page.route("**/api/v1/ledger?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unavailable",
          message: "Ledger temporarily unavailable",
        },
      }),
    })
  )
  await page.reload()
  await expect(page.locator(".home-stats")).toContainText("unavailable")
  await expect(page.locator(".home-stats")).not.toContainText("loading")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect.poll(async () => (await wake()).releases).toBe(1)
  expect(errors).toEqual([])
})
