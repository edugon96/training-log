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
  const email = `browser-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const result = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Browser Test" },
  })
  identity = { id: result.user.id, email, password }
})
test.afterAll(async () => {
  if (identity) {
    for (const table of [
      "result_sets",
      "workout_sessions",
      "workouts",
      "weeks",
      "exercises",
      "equipment",
      "audit_events",
      "mutation_receipts",
      "import_sources",
      "training_defaults",
    ])
      await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
        identity.id,
      ])
    await getPool().query('DELETE FROM "apikey" WHERE "referenceId" = $1', [
      identity.id,
    ])
    await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
  }
})
test("mobile workout: plan edit, actuals, offline save, conflict and reload", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, identity.email, identity.password)
  await expect(
    page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })
  ).toBeVisible()
  async function post(path: string, data: unknown) {
    const response = await context.request.post(`/api/v1${path}`, {
      data,
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const press: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "Barbell Bench Press",
    equipmentId: null,
    equipment: "Barbell",
    setup: "Flat bench",
    primaryMuscle: "chest",
    secondaryMuscles: ["triceps"],
    pattern: "push",
    defaultRole: "lifting",
    defaultLoad: { value: 135, unit: "lb", basis: "total" },
    notes: "",
    archived: false,
  }
  const pull: ExerciseRecord = {
    ...press,
    id: randomUUID(),
    name: "Strict Pull-up",
    primaryMuscle: "back",
    equipment: "Rig",
    setup: "",
    defaultLoad: { value: null, unit: "unknown", basis: "bodyweight" },
  }
  await post("/exercises", { value: press })
  await post("/exercises", { value: pull })
  const week = await post("/weeks", {
    value: {
      id: randomUUID(),
      revision: 0,
      startDate: "2026-10-19",
      title: "Strength & engine",
      targets: defaultTargets,
      notes: "",
    },
  })
  const pressItem = makeItem(press, 3)
  pressItem.sets.forEach((set) => {
    set.repsMin = 8
    set.repsMax = 10
  })
  const pullItem = makeItem(pull, 2)
  pullItem.sets.forEach((set) => {
    set.repsMin = 5
    set.repsMax = 8
  })
  await post("/workouts", {
    value: {
      id: randomUUID(),
      revision: 0,
      kind: "planned",
      routineId: null,
      weekId: week.id,
      date: "2026-10-19",
      title: "Upper strength",
      focus: "Chest + back",
      notes: "",
      source: null,
      blocks: [
        {
          id: randomUUID(),
          title: "Press + pull",
          kind: "superset",
          restSeconds: 120,
          rounds: null,
          items: [pressItem, pullItem],
          notes: "",
        },
      ],
    },
  })
  await page.reload()
  await expect(page.getByText("Upper strength", { exact: true })).toBeVisible()
  await page
    .getByRole("button", { name: "Open Upper strength", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Workout actions", exact: true })
    .click()
  await page
    .getByRole("menuitem", { name: "Edit movements", exact: true })
    .click()
  await page
    .getByLabel("Barbell Bench Press set 1 min reps", { exact: true })
    .fill("9")
  await page.getByRole("button", { name: "Save workout", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: "Upper strength", exact: true })
  ).toBeVisible()
  const reps = page.getByLabel("Barbell Bench Press set 1 actual reps", {
    exact: true,
  })
  await reps.fill("9")
  await page
    .getByLabel("Barbell Bench Press set 1 actual weight", { exact: true })
    .fill("140")
  await expect(
    page.getByLabel("Barbell Bench Press set 1 status", { exact: true })
  ).toHaveCount(0)
  await expect(
    reps.locator("xpath=ancestor::*[@data-completion]")
  ).toHaveAttribute("data-completion", "completed")
  await expect
    .poll(async () => {
      const sessions = (await (
        await context.request.get("/api/v1/sessions")
      ).json()) as SessionRecord[]
      return sessions[0]?.results.find(
        (result) => result.targetId === pressItem.sets[0].id
      )?.reps
    })
    .toBe(9)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: "test-results/mobile-session.png",
    fullPage: true,
  })
  const sessions = (await (
    await context.request.get("/api/v1/sessions")
  ).json()) as SessionRecord[]
  const session = sessions[0]
  await context.setOffline(true)
  await reps.fill("10")
  await page
    .getByRole("button", { name: "Workout actions", exact: true })
    .click()
  await page
    .getByRole("menuitem", { name: "Session notes", exact: true })
    .click()
  await page
    .getByRole("textbox", { name: "Session notes", exact: true })
    .fill("Offline work preserved")
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await expect(page.getByText(/Offline.*sync pending/).first()).toBeVisible()
  if (process.env.TEST_OFFLINE_RELOAD === "1") {
    await page.reload()
    await expect(
      page.getByLabel("Barbell Bench Press set 1 actual reps", { exact: true })
    ).toHaveValue("10")
  }
  // APIRequestContext uses the test runner network, independent of browser offline.
  const external = await context.request.put(`/api/v1/sessions/${session.id}`, {
    data: {
      expectedRevision: session.revision,
      value: { ...session, notes: "Changed elsewhere" },
    },
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
  })
  expect(external.ok(), await external.text()).toBe(true)
  await context.setOffline(false)
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Keep device version" })
  ).toBeVisible({ timeout: 15000 })
  await page.getByRole("button", { name: "Keep device version" }).click()
  await expect(
    page.getByText("Everything on this device is synced.")
  ).toBeVisible()
  const saved = (await (
    await context.request.get(`/api/v1/sessions/${session.id}`)
  ).json()) as SessionRecord
  expect(saved.notes).toBe("Offline work preserved")
  expect(
    saved.results.find((result) => result.targetId === pressItem.sets[0].id)
      ?.reps
  ).toBe(10)
  await page.reload()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Week", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Open Upper strength", exact: true })
    .click()
  await expect(
    page.getByLabel("Barbell Bench Press set 1 actual reps", { exact: true })
  ).toHaveValue("10")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Week", exact: true })
    .click()
  await page.screenshot({
    path: "test-results/desktop-week.png",
    fullPage: true,
  })
  expect(errors).toEqual([])
})
