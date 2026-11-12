import { test, expect } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signInPage } from "./auth-helper"
import {
  defaultTargets,
  type WorkoutRecord,
  type SessionRecord,
} from "../../contracts/models"

test.use({
  viewport: { width: 440, height: 956 },
  hasTouch: true,
  isMobile: true,
})
const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `movement-review-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const user = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Movement Review" },
  })
  identity = { id: user.user.id, email, password }
  await mkdir(".local/hevy-review", { recursive: true })
  if (process.env.KEEP_HEVY_REVIEW === "1")
    await writeFile(".local/hevy-review/login.json", JSON.stringify(identity), {
      mode: 0o600,
    })
})
test.afterAll(async () => {
  if (!identity || process.env.KEEP_HEVY_REVIEW === "1") return
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

test("movement cards preserve instruction scope, match controls, and persist note and set changes", async ({
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
  const week = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "Movement review",
    notes: "",
    targets: defaultTargets,
  })
  const exercise = await post("/exercises", {
    id: randomUUID(),
    revision: 0,
    name: "Bench Press (Barbell)",
    equipmentId: null,
    equipment: "Barbell",
    setup: "",
    primaryMuscle: "chest",
    secondaryMuscles: [],
    pattern: "push",
    defaultRole: "lifting",
    defaultLoad: { value: 45, unit: "lb", basis: "total" },
    trackingFields: ["load", "reps"],
    notes:
      "Control the movement and pause briefly at the bottom position before pressing.",
    archived: false,
  })
  const plans = async (): Promise<WorkoutRecord[]> =>
    (await context.request.get("/api/v1/workouts")).json()
  const sessions = async (): Promise<SessionRecord[]> =>
    (await context.request.get("/api/v1/sessions")).json()
  const card = () =>
    page.getByRole("article", { name: exercise.name, exact: true })
  await page.goto(`/?tab=week&week=${week.id}`)
  await page.getByRole("button", { name: "New workout", exact: true }).tap()
  await page.getByLabel("Workout", { exact: true }).fill("Push reference")
  await page.getByRole("button", { name: "Add movements", exact: true }).tap()
  await page.getByRole("button", { name: /Bench Press/ }).tap()
  await page.getByRole("button", { name: "Add 1 exercise", exact: true }).tap()
  await expect(card().locator(".movement-card-title")).toContainText(
    exercise.name
  )
  await expect(page.locator(".workout-group-heading")).toHaveCount(1)
  await page
    .getByRole("button", { name: `Add note to ${exercise.name}`, exact: true })
    .tap()
  let notes = page.getByRole("textbox", {
    name: `${exercise.name} workout note`,
    exact: true,
  })
  await expect(notes).toHaveCount(2)
  await expect(notes.nth(1)).toBeFocused()
  await notes.nth(1).fill("Second instruction")
  await page
    .getByRole("button", {
      name: `${exercise.name} repetition options`,
      exact: true,
    })
    .tap()
  await page
    .getByRole("menuitemradio", { name: "Rep Range", exact: true })
    .tap()
  await page
    .getByLabel(`${exercise.name} set 1 min reps`, { exact: true })
    .fill("10")
  await page
    .getByLabel(`${exercise.name} set 1 max reps`, { exact: true })
    .fill("15")
  for (let i = 0; i < 4; i++)
    await card().getByRole("button", { name: "Add set", exact: true }).tap()
  await expect(card().locator(".rep-range-fields")).toHaveCount(5)
  const kinds = [
    "W Warm Up Set",
    "W Warm Up Set",
    "F Failure Set",
    "D Drop Set",
  ]
  for (let index = 0; index < kinds.length; index++) {
    await page
      .getByRole("button", {
        name: `${exercise.name} set ${index + 1} type`,
        exact: true,
      })
      .tap()
    if (index === 0) {
      await expect(
        page.getByRole("heading", { name: "Select Set Type", exact: true })
      ).toBeVisible()
      await expect(page.getByRole("menuitemradio")).toHaveCount(4)
      await expect(
        page.getByRole("menuitem", { name: "Set details" })
      ).toHaveCount(0)
      await expect(
        page.getByRole("heading", { name: "Select Set Type", exact: true })
      ).toBeInViewport()
      await page.screenshot({
        animations: "disabled",
        path: ".local/hevy-review/set-type-sheet.png",
      })
      await page
        .getByRole("button", { name: "About Warm Up Set", exact: true })
        .tap()
      await expect(
        page.getByRole("heading", { name: "Warm Up Set", exact: true })
      ).toBeVisible()
      await page.getByRole("button", { name: "OK", exact: true }).tap()
      await expect(
        page.getByRole("heading", { name: "Select Set Type", exact: true })
      ).toBeVisible()
    }
    await page
      .getByRole("menuitemradio", { name: kinds[index], exact: true })
      .tap()
  }
  await expect(card().locator(".set-type-trigger")).toHaveText([
    "W",
    "W",
    "F",
    "D",
    "2",
  ])
  await page
    .getByRole("button", { name: `${exercise.name} rest timer`, exact: true })
    .tap()
  await page.getByRole("button", { name: "2m", exact: true }).tap()
  await expect(page.getByRole("textbox", { name: "Group name" })).toHaveCount(0)
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  await page
    .getByRole("button", { name: `${exercise.name} weight units`, exact: true })
    .tap()
  await expect(
    page.getByRole("heading", { name: "Weight Input", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await card().scrollIntoViewIfNeeded()
  await page.screenshot({
    animations: "disabled",
    path: ".local/hevy-review/routine-card.png",
  })
  expect(await plans()).toHaveLength(0)
  await page.getByRole("button", { name: "Save", exact: true }).tap()
  await expect.poll(async () => (await plans()).length).toBe(1)
  const original = (await plans())[0]
  expect(original.blocks[0].items[0].noteEntries).toHaveLength(2)
  expect(original.blocks[0].items[0].notes).toContain("Second instruction")
  await page
    .getByRole("button", { name: "Open Push reference", exact: true })
    .tap()
  // Before the first logged set, instruction editing must still create only a session copy.
  notes = page.getByRole("textbox", {
    name: `${exercise.name} workout note`,
    exact: true,
  })
  await notes.nth(1).fill("Only this session")
  await page
    .getByRole("button", { name: `Add note to ${exercise.name}`, exact: true })
    .tap()
  const sessionNote = page.getByRole("textbox", {
    name: `${exercise.name} session note`,
    exact: true,
  })
  await expect(sessionNote).toBeFocused()
  await expect(sessionNote).toHaveCSS("box-shadow", "none")
  await expect(sessionNote).toHaveCSS("border-bottom-width", "0px")
  await page.screenshot({
    animations: "disabled",
    path: ".local/hevy-review/focused-note.png",
  })
  await sessionNote.fill("Keep elbows tucked today")
  await expect
    .poll(
      async () =>
        (await sessions())[0]?.movementNotes?.[
          original.blocks[0].items[0].id
        ]?.[0]?.text
    )
    .toBe("Keep elbows tucked today")
  expect((await plans())[0]).toEqual(original)
  await page.reload()
  await expect(sessionNote).toHaveValue("Keep elbows tucked today")
  await expect(notes.nth(1)).toHaveValue("Only this session")
  // Reveal each row independently using a real pointer drag; no deletion until button tap.
  const noteRow = card().locator(".movement-note-swipe").nth(1)
  await noteRow.scrollIntoViewIfNeeded()
  let box = await noteRow.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width - 12, box!.y + 22)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width - 112, box!.y + 22, { steps: 8 })
  await page.mouse.up()
  await expect(noteRow).toHaveAttribute("data-revealed", "true")
  await expect(noteRow.locator(".swipe-delete-action")).toHaveCSS(
    "width",
    "75px"
  )
  const setRow = card()
    .locator(".session-set-row")
    .nth(4)
    .locator("..")
    .locator("..")
  await setRow.scrollIntoViewIfNeeded()
  box = await setRow.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 110, box!.y + 22)
  await page.mouse.down()
  await page.mouse.move(box!.x + 12, box!.y + 22, { steps: 8 })
  await page.mouse.up()
  await expect(setRow).toHaveAttribute("data-revealed", "true")
  await expect(setRow.locator(".swipe-delete-action")).toHaveCSS(
    "width",
    "75px"
  )
  await expect(noteRow).toHaveAttribute("data-revealed", "true")
  await page.screenshot({
    animations: "disabled",
    path: ".local/hevy-review/swipe-reveal.png",
  })
  await noteRow
    .getByRole("button", { name: `Delete ${exercise.name} note`, exact: true })
    .tap()
  await setRow
    .getByRole("button", { name: `Delete ${exercise.name} set 5`, exact: true })
    .tap()
  await expect(card().locator(".session-set-row")).toHaveCount(4)
  // Offline additions persist locally, then reach the API on reconnection.
  await context.setOffline(true)
  await sessionNote.fill("Offline session note")
  await expect(sessionNote).toHaveValue("Offline session note")
  await context.setOffline(false)
  await expect
    .poll(
      async () =>
        (await sessions())[0]?.movementNotes?.[
          original.blocks[0].items[0].id
        ]?.[0]?.text
    )
    .toBe("Offline session note")
  await page.reload()
  await expect(notes).toHaveCount(1)
  await expect(sessionNote).toHaveValue("Offline session note")
  await expect(card().locator(".session-set-row")).toHaveCount(4)
  expect((await plans())[0]).toEqual(original)
  await page
    .getByLabel(`${exercise.name} set 1 actual weight`, { exact: true })
    .fill("45")
  await page
    .getByLabel(`${exercise.name} set 1 actual reps`, { exact: true })
    .fill("12")
  await page
    .getByRole("button", {
      name: `${exercise.name} set 1 complete`,
      exact: true,
    })
    .tap()
  await expect(card().locator(".session-set-row").first()).toHaveAttribute(
    "data-completion",
    "completed"
  )
  await page.screenshot({
    animations: "disabled",
    path: ".local/hevy-review/active-card.png",
  })
  await page
    .getByRole("button", { name: `${exercise.name} actions`, exact: true })
    .tap()
  await page.getByRole("menuitem", { name: "Set details", exact: true }).tap()
  await expect(
    page.getByRole("heading", { name: "Set Details", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  // Review adjacent completed rows and the read-only state that exposed the visual regression.
  for (let index = 2; index <= 4; index++) {
    await page
      .getByLabel(`${exercise.name} set ${index} actual weight`, {
        exact: true,
      })
      .fill("45")
    await page
      .getByLabel(`${exercise.name} set ${index} actual reps`, { exact: true })
      .fill("12")
    await page
      .getByRole("button", {
        name: `${exercise.name} set ${index} complete`,
        exact: true,
      })
      .tap()
  }
  await page.getByRole("button", { name: "Finish workout", exact: true }).tap()
  await expect(page.locator(".workout-toolbar")).toContainText("Completed")
  const completedRows = card().locator(".session-set-row")
  await expect(completedRows).toHaveCount(4)
  for (const row of await completedRows.all()) {
    await expect(row).toHaveCSS("background-color", "rgb(22, 48, 8)")
    await expect(row).toHaveCSS("border-radius", "0px")
    await expect(row).toHaveCSS("padding-left", "16px")
    await expect(row.locator(".set-check")).toHaveCSS(
      "background-color",
      "rgb(86, 189, 35)"
    )
    await expect(row.locator(".set-check")).toHaveCSS(
      "color",
      "rgb(255, 255, 255)"
    )
    await expect(row.locator(".set-check")).toBeDisabled()
    await expect(row.locator(".set-type-trigger")).toHaveCSS("width", "36px")
    await expect(row.locator(".set-type-trigger")).toHaveCSS("display", "grid")
  }
  await card().scrollIntoViewIfNeeded()
  await page.screenshot({
    animations: "disabled",
    path: ".local/hevy-review/completed-card.png",
  })
  await page.setViewportSize({ width: 320, height: 740 })
  expect(
    await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)
  ).toBe(true)
  await page.screenshot({
    animations: "disabled",
    path: ".local/hevy-review/completed-card-narrow.png",
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    animations: "disabled",
    path: ".local/hevy-review/desktop-card.png",
  })
  expect(
    await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)
  ).toBe(true)
  expect(errors).toEqual([])
})
