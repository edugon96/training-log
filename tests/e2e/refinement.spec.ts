import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import {
  defaultTargets,
  makeItem,
  type EquipmentRecord,
  type ExerciseRecord,
  type SessionRecord,
  type WeekRecord,
  type WorkoutRecord,
} from "../../contracts/models"

const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }

test.beforeAll(async () => {
  const email = `refinement-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Refinement Test" },
  })
  identity = { id: account.user.id, email, password }
})
test.afterAll(async () => {
  if (!identity) return
  // Delete only the disposable account created by this file, never real owner records.
  for (const table of [
    "result_sets",
    "workout_sessions",
    "workouts",
    "weeks",
    "training_defaults",
    "exercises",
    "equipment",
    "audit_events",
    "mutation_receipts",
    "import_sources",
  ])
    await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
      identity.id,
    ])
  await getPool().query('DELETE FROM "apikey" WHERE "referenceId" = $1', [
    identity.id,
  ])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})

async function login(page: Page) {
  await page.goto("/")
  await page.getByLabel("Email", { exact: true }).fill(identity.email)
  await page.getByLabel("Password", { exact: true }).fill(identity.password)
  for (let attempt = 0; attempt < 4; attempt++) {
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-in/email")
    )
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    const response = await responsePromise
    if (response.status() !== 429) {
      expect(response.ok(), await response.text()).toBe(true)
      await expect(
        page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })
      ).toBeVisible()
      return
    }
    const retryAfter = response.headers()["retry-after"] || "10"
    const seconds = Number(retryAfter)
    const wait = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now())
    await page.waitForTimeout(Math.max(1000, wait) + 100)
  }
  throw new Error(
    "Authentication remained rate limited after respecting Retry-After."
  )
}
async function post<T>(
  request: APIRequestContext,
  path: string,
  value: unknown
): Promise<T> {
  const response = await request.post(`/api/v1${path}`, {
    data: { value },
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<T>
}

test("refined logger, completion review, safe instructions, equipment and saved goals", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click()
  await expect(page.locator(".sidebar")).toHaveCSS("width", "76px")
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click()
  await expect(page.locator(".sidebar")).toHaveCSS("width", "235px")
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator(".sidebar")).toBeHidden()
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation" })
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
  const bench: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "QA Bench",
    equipmentId: null,
    equipment: "Barbell",
    setup: "",
    primaryMuscle: "chest",
    secondaryMuscles: ["triceps"],
    pattern: "push",
    defaultRole: "lifting",
    defaultLoad: { value: 135, unit: "lb", basis: "total" },
    trackingFields: ["reps", "load"],
    notes: "",
    archived: false,
  }
  const pull: ExerciseRecord = {
    ...bench,
    id: randomUUID(),
    name: "QA Pull-up",
    equipment: "Bodyweight",
    primaryMuscle: "back",
    defaultLoad: null,
    trackingFields: ["reps"],
  }
  const hold: ExerciseRecord = {
    ...pull,
    id: randomUUID(),
    name: "QA Hold",
    primaryMuscle: "abs",
    defaultRole: "preparation",
    trackingFields: ["durationSeconds"],
  }
  const carry: ExerciseRecord = {
    ...bench,
    id: randomUUID(),
    name: "QA Carry",
    equipment: "Kettlebell",
    primaryMuscle: null,
    defaultRole: "conditioning",
    trackingFields: ["load", "distanceMeters"],
    defaultLoad: { value: 40, unit: "kg", basis: "per_hand" },
  }
  for (const exercise of [bench, pull, hold, carry])
    await post(context.request, "/exercises", exercise)
  const week = await post<WeekRecord>(context.request, "/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "Refinement week",
    targets: defaultTargets,
    notes: "",
  })
  const benchItem = makeItem(bench, 2)
  benchItem.sets.forEach((set) => {
    set.repsMin = 8
    set.repsMax = 10
  })
  const pullItem = makeItem(pull, 1)
  pullItem.sets[0].repsMin = 6
  pullItem.sets[0].repsMax = 8
  const holdItem = makeItem(hold, 1)
  holdItem.sets[0].durationSeconds = 30
  const carryItem = makeItem(carry, 1)
  carryItem.sets[0].distanceMeters = 20
  const workout = await post<WorkoutRecord>(context.request, "/workouts", {
    id: randomUUID(),
    revision: 0,
    kind: "planned",
    routineId: null,
    weekId: week.id,
    date: "2026-10-19",
    title: "Refinement session",
    focus: "Strength + carries",
    notes: "",
    source: null,
    blocks: [
      {
        id: randomUUID(),
        title: "**A · Strength**",
        kind: "superset",
        restSeconds: 90,
        rounds: null,
        items: [benchItem, pullItem, holdItem, carryItem],
        notes:
          '**A · Strength**\n\n**Purpose:** Controlled effort.\n\n- Keep reps crisp.\n\n[Training reference](https://example.com/training)\n\n[Unsafe link](javascript:alert(1))\n\n<img src=x onerror="window.__unsafe=true"><script>window.__unsafe=true</script>',
      },
      {
        id: randomUUID(),
        title: "Preparation",
        kind: "straight",
        restSeconds: null,
        rounds: null,
        items: [],
        notes: "Easy row or bike: 3–5 minutes.",
      },
    ],
  })
  await page.reload()
  await page
    .getByRole("button", { name: "Open Refinement session", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Refinement session", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Strength", exact: true })
  ).toHaveCount(1)
  const preparation = page.locator(".workout-block").filter({
    has: page.getByRole("heading", { name: "Preparation", exact: true }),
  })
  const instructionInsets = await preparation.evaluate((block) => {
    const instructions = block.querySelector(".instructions")!
    const heading = block.querySelector(".block-heading")!
    const outer = block.getBoundingClientRect()
    const inner = instructions.getBoundingClientRect()
    return {
      top: inner.top - heading.getBoundingClientRect().bottom,
      right: outer.right - inner.right,
      bottom: outer.bottom - inner.bottom,
      left: inner.left - outer.left,
    }
  })
  for (const inset of Object.values(instructionInsets))
    expect(inset).toBeGreaterThanOrEqual(16)
  await expect(page.locator(".instructions strong")).toHaveText("Purpose:")
  await expect(page.locator(".instructions li")).toHaveText("Keep reps crisp.")
  await expect(
    page.locator(".instructions img, .instructions script")
  ).toHaveCount(0)
  expect(
    await page
      .getByRole("link", { name: "Unsafe link", exact: true })
      .getAttribute("href")
  ).not.toMatch(/^javascript:/i)
  expect(await page.evaluate(() => "__unsafe" in window)).toBe(false)
  await expect(
    page.getByLabel("QA Pull-up set 1 actual reps", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByLabel("QA Pull-up set 1 actual weight", { exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByLabel("QA Hold set 1 actual seconds", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByLabel("QA Hold set 1 actual reps", { exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByLabel("QA Carry set 1 actual meters", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByLabel("QA Carry set 1 actual weight", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: /set \d+ status/i })
  ).toHaveCount(0)

  const firstBench = page.locator(`#set-${benchItem.sets[0].id}`)
  await page.getByLabel("QA Bench set 1 actual reps", { exact: true }).fill("8")
  await expect(firstBench).toHaveAttribute("data-completion", "unlogged")
  await page
    .getByLabel("QA Bench set 1 actual weight", { exact: true })
    .fill("135")
  await expect(firstBench).toHaveAttribute("data-completion", "completed")
  await page
    .getByRole("button", { name: "Collapse Strength", exact: true })
    .click()
  await expect(
    page.getByLabel("QA Bench set 1 actual reps", { exact: true })
  ).toBeHidden()
  await page
    .getByRole("button", { name: "Expand Strength", exact: true })
    .click()
  await expect(
    page.getByLabel("QA Bench set 1 actual reps", { exact: true })
  ).toHaveValue("8")
  await expect(
    page.getByRole("button", { name: "Save", exact: true })
  ).toHaveCount(0)
  await page
    .getByLabel("QA Pull-up set 1 actual reps", { exact: true })
    .fill("6")
  await expect(page.locator(`#set-${pullItem.sets[0].id}`)).toHaveAttribute(
    "data-completion",
    "completed"
  )
  await page
    .getByLabel("QA Hold set 1 actual seconds", { exact: true })
    .fill("30")
  await page
    .getByLabel("QA Carry set 1 actual meters", { exact: true })
    .fill("20")
  await expect(page.locator(`#set-${carryItem.sets[0].id}`)).toHaveAttribute(
    "data-completion",
    "unlogged"
  )

  const benchMovement = page.locator(".movement").filter({
    has: page.getByRole("heading", { name: "QA Bench", exact: true }),
  })
  await benchMovement
    .getByRole("button", { name: "Add set", exact: true })
    .click()
  await expect(
    page.getByLabel("QA Bench set 3 actual reps", { exact: true })
  ).toHaveValue("")
  await expect(
    page.getByLabel("QA Bench set 3 actual weight", { exact: true })
  ).toHaveValue("")
  await expect(benchMovement.locator(".movement-target")).toContainText(
    "8–10 reps"
  )
  const weightBox = await page
    .getByLabel("QA Bench set 1 actual weight", { exact: true })
    .boundingBox()
  const repsBox = await page
    .getByLabel("QA Bench set 1 actual reps", { exact: true })
    .boundingBox()
  expect(weightBox!.y).toBe(repsBox!.y)
  expect(weightBox!.width).toBeGreaterThanOrEqual(44)
  expect((await firstBench.boundingBox())!.height).toBeLessThanOrEqual(64)
  await page.setViewportSize({ width: 320, height: 740 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  const narrowWeight = await page
    .getByLabel("QA Bench set 1 actual weight", { exact: true })
    .boundingBox()
  const narrowReps = await page
    .getByLabel("QA Bench set 1 actual reps", { exact: true })
    .boundingBox()
  expect(narrowWeight!.y).toBe(narrowReps!.y)
  expect(narrowWeight!.width).toBeGreaterThanOrEqual(40)
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole("button", { name: "QA Bench actions", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Units", exact: true }).click()
  await expect(
    page.getByRole("combobox", {
      name: "QA Bench new entries unit",
      exact: true,
    })
  ).toBeVisible()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await expect(benchMovement.locator(".session-set-row")).toHaveCount(3)
  await expect(
    page
      .locator(".movement")
      .filter({
        has: page.getByRole("heading", { name: "QA Pull-up", exact: true }),
      })
      .locator(".session-set-row")
  ).toHaveCount(1)

  const secondBench = page.locator(`#set-${benchItem.sets[1].id}`)
  await page
    .getByRole("button", { name: "QA Bench set 2 actions", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Skip set", exact: true }).click()
  await expect(secondBench).toHaveAttribute("data-completion", "skipped")
  await page
    .getByRole("button", { name: "QA Bench set 2 actions", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Undo skip", exact: true }).click()
  await expect(secondBench).toHaveAttribute("data-completion", "unlogged")
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: "test-results/refinement-mobile-logger.png",
    fullPage: true,
    animations: "disabled",
  })
  await benchMovement.evaluate((element) =>
    element.scrollIntoView({ block: "start" })
  )
  await page.screenshot({
    path: "test-results/compact-mobile-sets.png",
    animations: "disabled",
  })

  await page
    .getByRole("button", { name: "Finish workout", exact: true })
    .click()
  const review = page.getByRole("dialog")
  await expect(
    review.getByRole("heading", { name: "Review your workout" })
  ).toBeVisible()
  await expect(review).toContainText("3 sets are still unlogged")
  await expect(review).toContainText("Partial entry")
  await expect
    .poll(async () => {
      const bounds = (await review.boundingBox())!
      return bounds.y + bounds.height
    })
    .toBeLessThanOrEqual(845)
  expect((await review.boundingBox())!.y).toBeGreaterThanOrEqual(0)
  await page.screenshot({ path: "test-results/mobile-finish-review.png" })
  await review.getByRole("button", { name: "Review sets", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(
    page.getByLabel("QA Carry set 1 actual meters", { exact: true })
  ).toHaveValue("20")
  await page
    .getByRole("button", { name: "Finish workout", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Skip remaining and finish", exact: true })
    .click()
  await expect(page.locator(".session-footer .completed-label")).toBeVisible()
  let saved: SessionRecord | undefined
  await expect
    .poll(async () => {
      const sessions = (await (
        await context.request.get("/api/v1/sessions")
      ).json()) as SessionRecord[]
      saved = sessions.find((session) => session.workoutId === workout.id)
      return saved?.status
    })
    .toBe("completed")
  expect(saved?.loggingMode).toBe("automatic")
  const savedCarry = saved?.results.find(
    (result) => result.targetId === carryItem.sets[0].id
  )
  expect(savedCarry).toMatchObject({
    status: "skipped",
    distanceMeters: 20,
    load: null,
  })
  expect(
    saved?.results.filter((result) => result.status === "completed")
  ).toHaveLength(3)
  expect(
    saved?.results.filter((result) => result.status === "skipped")
  ).toHaveLength(3)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Training goals", exact: true })
    .click()
  await page
    .getByRole("dialog")
    .getByLabel("Chest target", { exact: true })
    .fill("15")
  await page.getByRole("button", { name: "Save defaults", exact: true }).click()
  await expect(
    page.getByText("Defaults saved. Existing weeks are unchanged.", {
      exact: true,
    })
  ).toBeVisible()
  const unchangedWeek = (await (
    await context.request.get(`/api/v1/weeks/${week.id}`)
  ).json()) as WeekRecord
  expect(unchangedWeek.targets.chest).toBe(14)
  await page.screenshot({
    path: "test-results/refinement-training-goals.png",
    fullPage: true,
  })
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click()

  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Library", exact: true })
    .click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .locator(".library-card")
    .filter({
      has: page.getByRole("heading", { name: "QA Bench", exact: true }),
    })
    .click()
  await page
    .getByRole("combobox", { name: "Secondary muscles", exact: true })
    .click()
  await page
    .getByLabel("Search secondary muscles", { exact: true })
    .fill("rear")
  await page.getByRole("option", { name: "Rear delts", exact: true }).click()
  await page
    .getByLabel("Search secondary muscles", { exact: true })
    .fill("biceps")
  await page.getByRole("option", { name: "Biceps", exact: true }).click()
  await page.getByRole("button", { name: "Done", exact: true }).click()
  await expect(page.locator(".selection-chip")).toHaveCount(3)
  await page
    .getByRole("button", { name: "Remove Triceps", exact: true })
    .click()
  await expect(page.locator(".selection-chip")).toHaveCount(2)
  const modal = page.getByRole("dialog")
  await expect(modal).toBeVisible()
  await expect
    .poll(async () => Math.round((await modal.boundingBox())!.x))
    .toBe(0)
  await expect
    .poll(async () =>
      Math.round(
        (await modal.boundingBox())!.y + (await modal.boundingBox())!.height
      )
    )
    .toBe(844)
  await page.screenshot({ path: "test-results/mobile-muscle-picker.png" })
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(modal).toHaveCount(0)
  const editedBench = await (
    await context.request.get(`/api/v1/exercises/${bench.id}`)
  ).json()
  expect(editedBench.secondaryMuscles).toEqual(["rear_delts", "biceps"])
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("button", { name: /^Equipment \d+$/ }).click()
  await page.getByRole("button", { name: "Add equipment", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("QA Chest Fly")
  await page
    .getByRole("combobox", { name: "Equipment brand", exact: true })
    .click()
  await page
    .getByLabel("Search Equipment brand", { exact: true })
    .fill("QA Brand")
  await page
    .getByRole("option", { name: "Add “QA Brand”", exact: true })
    .click()
  await page
    .getByRole("combobox", { name: "Equipment model", exact: true })
    .click()
  await page
    .getByLabel("Search Equipment model", { exact: true })
    .fill("MODEL-123")
  await page
    .getByRole("option", { name: "Add “MODEL-123”", exact: true })
    .click()
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const machines = (await (
    await context.request.get("/api/v1/equipment")
  ).json()) as EquipmentRecord[]
  expect(
    machines.find((machine) => machine.name === "QA Chest Fly")
  ).toMatchObject({ brand: "QA Brand", model: "MODEL-123" })
  await page.screenshot({
    path: "test-results/refinement-equipment.png",
    fullPage: true,
  })
  expect(errors).toEqual([])
})
