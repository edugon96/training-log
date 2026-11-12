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

test("explicit creation, existing autosave, dedicated mobile picker, offline recovery, destructive confirmation and deletion", async ({
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
    title: "Editor week",
    notes: "",
    targets: defaultTargets,
  })
  for (let i = 0; i < 15; i++)
    await post("/exercises", {
      id: randomUUID(),
      revision: 0,
      name: `Test curl ${String(i).padStart(2, "0")}`,
      equipmentId: null,
      equipment: "Dumbbell",
      setup: "",
      primaryMuscle: "biceps",
      secondaryMuscles: [],
      pattern: "pull",
      defaultRole: "lifting",
      defaultLoad: { value: 20, unit: "lb", basis: "per_hand" },
      trackingFields: ["load", "reps"],
      notes: "",
      archived: false,
    })
  const plans = async (): Promise<WorkoutRecord[]> =>
    (await context.request.get("/api/v1/workouts")).json()
  const sessions = async (): Promise<SessionRecord[]> =>
    (await context.request.get("/api/v1/sessions")).json()
  await page.goto(`/?tab=week&week=${week.id}`)
  const newWorkout = async () => {
    await page.getByRole("button", { name: "Week actions", exact: true }).tap()
    await page.getByRole("menuitem", { name: "New workout", exact: true }).tap()
    await expect(page.getByLabel("Workout", { exact: true })).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCSS("position", "fixed")
  }
  await newWorkout()
  await page.getByRole("button", { name: "Cancel", exact: true }).tap()
  expect(await plans()).toHaveLength(0)
  await newWorkout()
  await page.getByLabel("Workout", { exact: true }).fill("Arms and grip")
  await page.getByLabel("Workout notes", { exact: true }).fill("Arms")
  await page.getByRole("button", { name: "Add movements", exact: true }).tap()
  await page.getByLabel("Search movements", { exact: true }).fill("Test curl")
  await page.getByRole("button", { name: /Test curl 14/ }).tap()
  await expect(
    page.getByRole("button", { name: "Add 1 exercise", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Add 1 exercise", exact: true }).tap()
  await expect(page.locator(".compact-editor-item")).toHaveCount(1)
  await page
    .getByLabel("Test curl 14 set 1 min reps", { exact: true })
    .fill("8")
  await page
    .getByRole("button", {
      name: "Test curl 14 repetition options",
      exact: true,
    })
    .tap()
  await page
    .getByRole("menuitemradio", { name: "Rep Range", exact: true })
    .tap()
  await page
    .getByLabel("Test curl 14 set 1 max reps", { exact: true })
    .fill("12")
  expect(await plans()).toHaveLength(0)
  await page.screenshot({ path: "test-results/editor-mobile.png" })
  await page.getByRole("button", { name: "Save", exact: true }).tap()
  await expect.poll(async () => (await plans()).length).toBe(1)
  expect((await plans())[0].title).toBe("Arms and grip")
  expect(await sessions()).toHaveLength(0)
  await page
    .getByRole("button", { name: "Open Arms and grip", exact: true })
    .tap()
  const edit = async () => {
    await page
      .getByRole("button", { name: "Workout actions", exact: true })
      .tap()
    await page
      .getByRole("menuitem", { name: "Edit movements", exact: true })
      .tap()
    await expect(page.getByLabel("Workout", { exact: true })).toBeVisible()
  }
  await edit()
  await context.setOffline(true)
  await page
    .getByLabel("Test curl 14 set 1 min reps", { exact: true })
    .fill("9")
  await expect(
    page.getByRole("status", { name: "Autosave: Offline" }).first()
  ).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Back", exact: true })
    .tap()
  await context.setOffline(false)
  await expect
    .poll(async () => (await plans())[0].blocks[0].items[0].sets[0].repsMin)
    .toBe(9)
  await page.reload()
  await edit()
  await expect(
    page.getByLabel("Test curl 14 set 1 min reps", { exact: true })
  ).toHaveValue("9")
  // Invalid values stay local across close/reopen and never poison the saved plan.
  await page
    .getByLabel("Test curl 14 set 1 min reps", { exact: true })
    .fill("15")
  await expect(page.getByRole("alert")).toContainText("device")
  expect((await plans())[0].blocks[0].items[0].sets[0].repsMin).toBe(9)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Back", exact: true })
    .tap()
  await edit()
  await expect(
    page.getByLabel("Test curl 14 set 1 min reps", { exact: true })
  ).toHaveValue("15")
  await page
    .getByLabel("Test curl 14 set 1 max reps", { exact: true })
    .fill("16")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Back", exact: true })
    .tap()
  await edit()
  await expect
    .poll(async () => (await plans())[0].blocks[0].items[0].sets[0].repsMin)
    .toBe(15)
  const changedPlan = (await plans())[0]
  expect(changedPlan.blocks[0].items[0].sets[0].repsMin).toBe(15)
  expect(
    (
      await context.request.put(`/api/v1/workouts/${changedPlan.id}`, {
        headers: headers(),
        data: {
          expectedRevision: changedPlan.revision,
          value: { ...changedPlan, notes: "Remote edit" },
        },
      })
    ).ok()
  ).toBe(true)
  await page.getByLabel("Workout notes", { exact: true }).fill("Local edit")
  await expect.poll(async () => (await plans())[0].notes).toBe("Local edit")
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Use server version", exact: true })
  ).toHaveCount(0)
  await page.getByLabel("Workout notes", { exact: true }).fill("Resolved")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Back", exact: true })
    .tap()
  await expect.poll(async () => (await plans())[0].notes).toBe("Resolved")
  await page
    .getByLabel("Test curl 14 set 1 actual weight", { exact: true })
    .fill("25")
  await page
    .getByLabel("Test curl 14 set 1 actual reps", { exact: true })
    .fill("10")
  await expect
    .poll(async () => (await sessions())[0]?.results[0]?.reps)
    .toBe(10)
  await page
    .getByRole("button", { name: "Test curl 14 set 1 complete", exact: true })
    .tap()
  await edit()
  await page
    .getByRole("button", { name: "Test curl 14 set 1 type", exact: true })
    .tap()
  await page.getByRole("menuitem", { name: "Remove Set", exact: true }).tap()
  await expect(
    page.getByRole("heading", { name: "Confirm change" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Cancel", exact: true }).tap()
  await expect(
    page.getByLabel("Test curl 14 set 1 min reps", { exact: true })
  ).toHaveValue("15")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Back", exact: true })
    .tap()
  await page.getByRole("button", { name: "Finish workout", exact: true }).tap()
  await expect.poll(async () => (await sessions())[0]?.status).toBe("completed")
  const askDelete = async () => {
    await page
      .getByRole("button", { name: "Workout actions", exact: true })
      .tap()
    await page
      .getByRole("menuitem", { name: "Delete workout", exact: true })
      .tap()
    await expect(
      page.getByRole("heading", { name: "Delete workout?", exact: true })
    ).toBeVisible()
    await expect(page.getByText(/all 1 logged set/)).toBeVisible()
  }
  await askDelete()
  await page.getByRole("button", { name: "Cancel", exact: true }).tap()
  expect(await plans()).toHaveLength(1)
  expect(await sessions()).toHaveLength(1)
  await askDelete()
  await page
    .getByRole("button", { name: "Delete workout", exact: true })
    .click({ trial: true })
  await page.screenshot({ path: "test-results/delete-confirmation-mobile.png" })
  // Update a linked session while the confirmation is open. New consent is required.
  const session = (await sessions())[0]
  await context.request.put(`/api/v1/sessions/${session.id}`, {
    headers: headers(),
    data: {
      expectedRevision: session.revision,
      value: { ...session, notes: "New result note" },
    },
  })
  await page.getByRole("button", { name: "Delete workout", exact: true }).tap()
  await expect(page.getByRole("alert")).toContainText("changed")
  expect(await plans()).toHaveLength(1)
  await page.getByRole("button", { name: "Delete workout", exact: true }).tap()
  await expect(page.getByRole("heading", { name: /^Good / })).toBeVisible()
  expect(await plans()).toHaveLength(0)
  expect(await sessions()).toHaveLength(0)
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Open Arms and grip", exact: true })
  ).toHaveCount(0)
  const standalone = await post("/sessions", {
    id: randomUUID(),
    revision: 0,
    workoutId: null,
    routineId: null,
    weekId: week.id,
    performedOn: "2026-10-21",
    title: "Standalone log",
    status: "completed",
    blocks: [],
    results: [],
    notes: "",
    source: null,
    startedAt: null,
    finishedAt: null,
  })
  await page.goto(`/?tab=week&week=${week.id}&session=${standalone.id}`)
  await page.getByRole("button", { name: "Workout actions", exact: true }).tap()
  await page
    .getByRole("menuitem", { name: "Delete workout", exact: true })
    .tap()
  await page.getByRole("button", { name: "Delete workout", exact: true }).tap()
  await expect(page.getByRole("heading", { name: /^Good / })).toBeVisible()
  expect(await sessions()).toHaveLength(0)
  expect(errors).toEqual([])
})
