import { test, expect } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signInPage } from "./auth-helper"
import {
  defaultTargets,
  type WorkoutRecord,
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
  const email = `editor-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const user = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Editor Test" },
  })
  identity = { id: user.user.id, email, password }
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
    "deleted_records",
  ])
    await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
      identity.id,
    ])
  await getPool().query('DELETE FROM "apikey" WHERE "referenceId" = $1', [
    identity.id,
  ])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})

test("draft save, ordered exercise selection, explicit checks, types and combined clocks", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await signInPage(page, identity.email, identity.password)
  const headers = () => ({ Origin: origin, "Idempotency-Key": randomUUID() })
  async function post(path: string, value: unknown) {
    const response = await context.request.post(`/api/v1${path}`, {
      data: { value },
      headers: headers(),
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const week = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "Design week",
    notes: "",
    targets: defaultTargets,
  })
  for (const name of ["Cable Curl", "Hammer Curl", "Bench Press"])
    await post("/exercises", {
      id: randomUUID(),
      revision: 0,
      name,
      equipmentId: null,
      equipment: "Dumbbell",
      setup: "",
      primaryMuscle: name === "Bench Press" ? "chest" : "biceps",
      secondaryMuscles: [],
      pattern: "pull",
      defaultRole: "lifting",
      defaultLoad: { value: 20, unit: "lb", basis: "per_hand" },
      trackingFields: ["load", "reps"],
      notes: "Keep your upper arms still.",
      archived: false,
    })
  const plans = async (): Promise<WorkoutRecord[]> =>
    (await context.request.get("/api/v1/workouts")).json()
  const sessions = async (): Promise<SessionRecord[]> =>
    (await context.request.get("/api/v1/sessions")).json()
  await page.goto(`/?tab=week&week=${week.id}`)
  await page.getByRole("button", { name: "New workout", exact: true }).tap()
  await page.getByLabel("Workout", { exact: true }).fill("Discard me")
  expect(await plans()).toHaveLength(0)
  await page.getByRole("button", { name: "Cancel", exact: true }).tap()
  await page.getByRole("button", { name: "Continue", exact: true }).tap()
  expect(await plans()).toHaveLength(0)
  await page.getByRole("button", { name: "New workout", exact: true }).tap()
  await expect(page.getByLabel("Workout", { exact: true })).toHaveValue("")
  await page.getByLabel("Workout", { exact: true }).fill("Strength builder")
  await expect(page.getByLabel("Workout notes", { exact: true })).toBeVisible()
  await page
    .getByLabel("Workout notes", { exact: true })
    .fill("Optional workout notes")
  await page.reload()
  await expect(page.getByLabel("Workout", { exact: true })).toHaveValue(
    "Strength builder"
  )
  await expect(page.getByLabel("Workout notes", { exact: true })).toHaveValue(
    "Optional workout notes"
  )
  expect(await plans()).toHaveLength(0)
  await page.getByRole("button", { name: "Add movements", exact: true }).tap()
  await page.getByRole("button", { name: /Hammer Curl/ }).tap()
  await page.getByLabel("Search movements", { exact: true }).fill("Cable")
  await page.getByRole("button", { name: /Cable Curl/ }).tap()
  await page.getByLabel("Search movements", { exact: true }).fill("Bench")
  await page.getByRole("button", { name: "Add 2 exercises", exact: true }).tap()
  await expect(page.locator(".compact-editor-item h2")).toHaveText([
    "Hammer Curl",
    "Cable Curl",
  ])
  await expect(
    page.getByRole("region", { name: "Group 1", exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Group 1", exact: true })
      .getByRole("article")
  ).toHaveCount(2)
  await page
    .getByLabel("Hammer Curl set 1 min reps", { exact: true })
    .fill("10")
  await page
    .locator(".compact-editor-item")
    .filter({ hasText: "Hammer Curl" })
    .getByRole("button", { name: "Add set", exact: true })
    .tap()
  await expect(
    page.getByLabel("Hammer Curl set 2 min reps", { exact: true })
  ).toHaveValue("10")
  await page.getByLabel("Cable Curl set 1 min reps", { exact: true }).fill("8")
  await page
    .getByRole("button", { name: "Hammer Curl set 2 type", exact: true })
    .tap()
  await page
    .getByRole("menuitemradio", { name: "D Drop Set", exact: true })
    .tap()
  await page
    .getByRole("button", { name: "Hammer Curl rest timer", exact: true })
    .tap()
  await page.getByLabel("Rest seconds", { exact: true }).fill("120")
  await page
    .getByRole("checkbox", {
      name: "Start rest automatically after a set",
      exact: true,
    })
    .check()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await page.screenshot({
    path: test.info().outputPath("design-builder-phone.png"),
  })
  expect(await plans()).toHaveLength(0)
  let loseResponse = true
  const createKeys: string[] = []
  await page.route("**/api/v1/workouts", async (route) => {
    if (route.request().method() === "POST")
      createKeys.push(route.request().headers()["idempotency-key"])
    if (loseResponse && route.request().method() === "POST") {
      loseResponse = false
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      await route.abort("failed")
    } else await route.continue()
  })
  const recovered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workouts" &&
      response.ok()
  )
  await page.getByRole("button", { name: "Save", exact: true }).tap()
  await recovered
  expect(loseResponse).toBe(false)
  expect(createKeys).toHaveLength(2)
  expect(createKeys[0]).toBeTruthy()
  expect(createKeys[1]).toBe(createKeys[0])
  expect(await plans()).toHaveLength(1)
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true })
  ).toHaveCount(0)

  await expect(
    page.getByRole("button", { name: "Open Strength builder", exact: true })
  ).toBeVisible()
  const saved = (await plans())[0]
  expect(await plans()).toHaveLength(1)
  expect(saved.revision).toBe(1)
  expect(saved.weekId).toBe(week.id)
  expect(saved.notes).toBe("Optional workout notes")
  expect(saved.blocks[0].items[0].automaticRest).toBe(true)
  expect(saved.blocks[0].items[1].automaticRest).toBe(false)
  expect(saved.blocks[0].items[0].sets[1].kind).toBe("drop")
  await page
    .getByRole("button", { name: "Open Strength builder", exact: true })
    .tap()
  await expect(page.locator(".mobile-nav")).toBeHidden()
  await expect(
    page.getByLabel("Hammer Curl set 1 actual reps", { exact: true })
  ).toHaveValue("")
  await expect(
    page.getByLabel("Hammer Curl set 1 actual reps", { exact: true })
  ).toHaveAttribute("placeholder", "10")
  await page
    .getByLabel("Hammer Curl set 1 actual reps", { exact: true })
    .fill("12")
  await page
    .getByLabel("Hammer Curl set 1 actual weight", { exact: true })
    .fill("25")
  await expect
    .poll(async () => (await sessions())[0]?.results[0]?.status)
    .toBe("unlogged")
  await page
    .getByRole("button", { name: "Hammer Curl set 1 complete", exact: true })
    .tap()
  await expect
    .poll(async () => (await sessions())[0]?.results[0]?.status)
    .toBe("completed")
  await page
    .getByRole("button", { name: "Hammer Curl set 1 uncheck", exact: true })
    .tap()
  await expect(
    page.getByLabel("Hammer Curl set 1 actual reps", { exact: true })
  ).toHaveValue("12")
  await page
    .getByRole("button", { name: "Hammer Curl set 1 complete", exact: true })
    .tap()
  await expect(
    page.getByRole("button", { name: "Open workout clock", exact: true })
  ).toHaveText("")
  await page
    .getByRole("button", { name: "Hammer Curl set 2 complete", exact: true })
    .tap()
  await expect(
    page.getByLabel("Rest remaining", { exact: true })
  ).toContainText(/1:|2:/)
  await expect(
    page.getByLabel("Hammer Curl set 2 actual reps", { exact: true })
  ).toHaveValue("10")
  await expect
    .poll(
      async () =>
        (await sessions())[0]?.results.filter(
          (row) => row.status === "completed"
        ).length
    )
    .toBe(2)
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Hammer Curl set 2 uncheck", exact: true })
  ).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath("design-logger-phone.png"),
  })
  await page
    .getByRole("button", { name: "Open workout clock", exact: true })
    .tap()
  await expect(
    page.getByRole("tab", { name: "Rest timer", exact: true })
  ).toHaveAttribute("aria-selected", "true")
  await page.getByRole("tab", { name: "Workout clock", exact: true }).tap()
  await page
    .getByRole("button", { name: "Start workout timer", exact: true })
    .tap()
  await page.getByRole("tab", { name: "Rest timer", exact: true }).tap()
  await page.getByRole("button", { name: "1:00", exact: true }).tap()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect(
    page.getByLabel("Rest remaining", { exact: true })
  ).toContainText(/0:|1:/)
  await page.getByRole("button", { name: "Finish workout", exact: true }).tap()
  await expect(
    page.getByRole("heading", { name: "Review your workout" })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Skip remaining and finish", exact: true })
    .tap()
  await expect.poll(async () => (await sessions())[0]?.status).toBe("completed")
  const completed = (await sessions())[0]
  expect(completed.loggingMode).toBe("checked")
  expect(
    completed.results.filter((row) => row.status === "completed")
  ).toHaveLength(2)
  expect(
    completed.results.filter((row) => row.status === "skipped")
  ).toHaveLength(1)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: test.info().outputPath("design-logger-desktop.png"),
  })
  expect(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth)
  ).toBe(true)
  expect(errors).toEqual([])
})

test("a slow explicit save preserves browser navigation", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Library", exact: true })
    .tap()
  await page.getByRole("button", { name: "Routine", exact: true }).tap()
  await page.getByLabel("Routine name", { exact: true }).fill("Navigation save")
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/workouts", async (route) => {
    if (route.request().method() === "POST") await gate
    await route.continue()
  })
  const request = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/v1/workouts")
  )
  await page.getByRole("button", { name: "Save", exact: true }).tap()
  await request
  await page.goBack()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .tap()
  release()
  await expect
    .poll(
      async () =>
        (
          (await (
            await context.request.get("/api/v1/workouts")
          ).json()) as WorkoutRecord[]
        ).filter((workout) => workout.title === "Navigation save").length
    )
    .toBe(1)
  await expect(page).toHaveURL(/tab=profile/)
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true })
  ).toBeVisible()
})
