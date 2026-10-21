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

const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `navigation-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Navigation Test" },
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
test("mobile Back, Forward and reload restore screens, selected week and offline workout edits", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, identity.email, identity.password)
  async function post(path: string, value: unknown) {
    const response = await context.request.post(`/api/v1${path}`, {
      data: { value },
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const exercise: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "Navigation Push-up",
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
    title: "Navigation week",
    targets: defaultTargets,
    notes: "",
  })
  const older = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-12",
    title: "Older week",
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
    title: "Navigation workout",
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
  const nav = page.getByRole("navigation", { name: "Mobile navigation" })
  await nav.getByRole("button", { name: "Library", exact: true }).click()
  await expect(page).toHaveURL(/tab=library/)
  await nav.getByRole("button", { name: "Profile", exact: true }).click()
  await expect(page).toHaveURL(/tab=profile/)
  await page.goBack()
  await expect(page).toHaveURL(/tab=library/)
  await expect(page.locator(".breadcrumb")).toContainText("Library")
  await page.goBack()
  await expect(
    page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })
  ).toBeVisible()
  await page.getByLabel("Selected week").click()
  await page.getByRole("option", { name: /Older week/ }).click()
  await expect(page).toHaveURL(new RegExp(older.id))
  await page.goBack()
  await expect(page.getByLabel("Selected week")).toContainText(
    "Navigation week"
  )
  await page
    .getByRole("button", { name: "Open Navigation workout", exact: true })
    .click()
  await expect(page).toHaveURL(/workout=/)
  const workoutUrl = page.url()
  await context.setOffline(true)
  await page
    .getByLabel("Navigation Push-up set 1 actual reps", { exact: true })
    .fill("11")
  await page.goBack()
  await expect(
    page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })
  ).toBeVisible()
  await page.goForward()
  await expect(
    page.getByLabel("Navigation Push-up set 1 actual reps", { exact: true })
  ).toHaveValue("11")
  await page.reload()
  await expect(
    page.getByLabel("Navigation Push-up set 1 actual reps", { exact: true })
  ).toHaveValue("11")
  await context.setOffline(false)
  await expect
    .poll(
      async () =>
        (await (await context.request.get("/api/v1/sessions")).json())[0]
          ?.results[0]?.reps
    )
    .toBe(11)
  await nav.getByRole("button", { name: "Profile", exact: true }).click()
  await page.goBack()
  await expect(page).toHaveURL(workoutUrl)
  await expect(
    page.getByLabel("Navigation Push-up set 1 actual reps", { exact: true })
  ).toHaveValue("11")
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })
  ).toBeVisible()
  expect(errors).toEqual([])
})
