import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import {
  defaultTargets,
  makeItem,
  type ExerciseRecord,
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
test.beforeEach(async () => {
  const email = `previous-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Previous Weights Test" },
  })
  identity = { id: account.user.id, email, password }
})
test.afterEach(async () => {
  if (!identity) return
  for (const table of [
    "result_sets",
    "workout_sessions",
    "workouts",
    "weeks",
    "timer_settings",
    "exercises",
    "equipment",
    "audit_events",
    "mutation_receipts",
  ])
    await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
      identity.id,
    ])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})
async function fixture(page: Page, context: BrowserContext) {
  await signInPage(page, identity.email, identity.password)
  await page.getByRole("heading", { name: /^Good / }).waitFor()
  const post = async (path: string, value: unknown) => {
    const response = await context.request.post("/api/v1" + path, {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data: { value },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const week = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "History week",
    targets: defaultTargets,
    notes: "",
  })
  const machine = await post("/equipment", {
    id: randomUUID(),
    revision: 0,
    name: "Pendulum Squat Pro",
    brand: "Atlantis",
    model: "PW212",
    type: "machine",
    notes: "",
    startingResistance: null,
    archived: false,
  })
  const exercise: ExerciseRecord = await post("/exercises", {
    id: randomUUID(),
    revision: 0,
    name: "Pendulum Squat (Machine)",
    equipmentId: machine.id,
    equipment: "Atlantis PW212",
    setup: "",
    primaryMuscle: "quads",
    secondaryMuscles: [],
    pattern: "legs",
    defaultRole: "lifting",
    defaultLoad: null,
    notes: "",
    archived: false,
  })
  const extension: ExerciseRecord = await post("/exercises", {
    ...exercise,
    id: randomUUID(),
    revision: 0,
    name: "Leg Extension",
    equipment: "C105",
  })
  const group = {
    id: randomUUID(),
    title: "Strength",
    kind: "group",
    rounds: null,
    restSeconds: null,
    notes: "",
    items: [],
  }
  const base = {
    id: randomUUID(),
    revision: 0,
    kind: "routine",
    routineId: null,
    weekId: null,
    date: null,
    title: "Lower routine",
    focus: "",
    notes: "",
    source: null,
    blocks: [group],
  }
  const routine = await post("/workouts", base)
  const other = await post("/workouts", {
    ...base,
    id: randomUUID(),
    title: "Other routine",
  })
  const prior: SessionRecord[] = []
  for (const [date, routineId, weight] of [
    ["2026-10-19", routine.id, 45],
    ["2026-10-22", other.id, 70],
  ] as const) {
    const item = makeItem({ ...exercise, trackingFields: ["reps", "load"] }, 3)
    item.sets[0].kind = "warmup"
    const plan: WorkoutRecord = await post("/workouts", {
      ...base,
      id: randomUUID(),
      kind: "planned",
      routineId,
      weekId: week.id,
      date,
      title: "Earlier lower",
      blocks: [{ ...group, id: randomUUID(), items: [item] }],
    })
    const session = workoutDraft(plan)
    session.status = "completed"
    session.results = item.sets
      .map((target, index) => ({
        id: randomUUID(),
        itemId: item.id,
        targetId: target.id,
        status: "completed",
        reps: index ? 10 : 5,
        load: { value: index ? weight : 20, unit: "lb", basis: "added" },
        durationSeconds: null,
        distanceMeters: null,
        rir: 2,
        notes: "",
        source: null,
      }))
      .reverse() as SessionRecord["results"]
    prior.push(await post("/sessions", session))
  }
  const plan: WorkoutRecord = await post("/workouts", {
    ...base,
    id: randomUUID(),
    kind: "planned",
    routineId: routine.id,
    weekId: week.id,
    date: "2026-10-24",
    title: "Repeat lower",
    blocks: [{ ...group, id: randomUUID() }],
  })
  const sessions = async (): Promise<SessionRecord[]> =>
    (await context.request.get("/api/v1/sessions")).json()
  const current = async () =>
    (await sessions()).find((s) => s.workoutId === plan.id)
  await page.goto(`/?tab=week&week=${week.id}&workout=${plan.id}`)
  await page.getByRole("region", { name: "Strength", exact: true }).waitFor()
  return { week, plan, exercise, extension, prior, current, sessions }
}
async function addMovement(page: Page, name: string) {
  await page
    .getByRole("region", { name: "Strength", exact: true })
    .getByRole("button", { name: "Add movements", exact: true })
    .tap()
  await page.getByLabel("Search movements", { exact: true }).fill(name)
  await page
    .getByRole("button", {
      name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .tap()
  await page.getByRole("button", { name: "Add 1 exercise", exact: true }).tap()
}

test("manual machine addition immediately shows the latest same-week history and accepts its weight", async ({
  page,
  context,
}) => {
  const { plan, prior, current } = await fixture(page, context)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await addMovement(page, "Pendulum Squat (Machine)")
  const weight = page.getByLabel(
    "Pendulum Squat (Machine) set 1 actual weight",
    { exact: true }
  )
  await expect(weight).toBeVisible()
  await expect(weight).toHaveValue("")
  await expect(weight).toHaveAttribute("placeholder", "70")
  const card = page.getByRole("article", {
    name: "Pendulum Squat (Machine)",
    exact: true,
  })
  await expect(card.locator(".session-set-reference").first()).toHaveText(
    "70 lb added × 10"
  )
  await expect(card).toContainText("Previous · Oct 22")
  expect(await current()).toBeUndefined()
  await page.screenshot({ path: test.info().outputPath("machine-history.png") })
  await page
    .getByRole("button", {
      name: "Pendulum Squat (Machine) set 1 complete",
      exact: true,
    })
    .tap()
  await expect
    .poll(async () => (await current())?.results[0]?.load)
    .toEqual({ value: 70, unit: "lb", basis: "added" })
  await expect.poll(async () => (await current())?.results[0]?.reps).toBe(10)
  await card.getByRole("button", { name: "Add set", exact: true }).tap()
  const second = page.getByLabel(
    "Pendulum Squat (Machine) set 2 actual weight",
    { exact: true }
  )
  await expect(second).toHaveAttribute("placeholder", "70")
  await second.fill("75")
  await page
    .getByRole("button", {
      name: "Pendulum Squat (Machine) set 2 complete",
      exact: true,
    })
    .tap()
  await expect
    .poll(async () =>
      (await current())?.results.some(
        (row) => row.load?.value === 75 && row.status === "completed"
      )
    )
    .toBe(true)
  await card.getByRole("button", { name: "Add set", exact: true }).tap()
  await expect(
    page.getByLabel("Pendulum Squat (Machine) set 3 actual weight", {
      exact: true,
    })
  ).toHaveAttribute("placeholder", "75")
  // A second machine added after recording starts also gets the weight field.
  await addMovement(page, "Leg Extension")
  const extension = page.getByLabel("Leg Extension set 1 actual weight", {
    exact: true,
  })
  await expect(extension).toBeVisible()
  await extension.fill("150")
  await page
    .getByLabel("Leg Extension set 1 actual reps", { exact: true })
    .fill("10")
  await page
    .getByRole("button", { name: "Leg Extension set 1 complete", exact: true })
    .tap()
  await expect
    .poll(async () =>
      (await current())?.results.some(
        (row) => row.load?.value === 150 && row.status === "completed"
      )
    )
    .toBe(true)
  for (const source of prior) {
    expect(
      await (await context.request.get("/api/v1/sessions/" + source.id)).json()
    ).toEqual(source)
  }
  await page.reload()
  await expect(weight).toHaveValue("70")
  await expect(second).toHaveValue("75")
  await expect(extension).toHaveValue("150")
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await page.getByRole("heading", { name: /^Good / }).waitFor()
  expect(errors).toEqual([])
  expect((await current())?.workoutId).toBe(plan.id)
})

test("history suggestions retain units, work offline and refresh on reconnect", async ({
  page,
  context,
}) => {
  const { exercise, prior, current } = await fixture(page, context)
  await addMovement(page, "Pendulum Squat (Machine)")
  const weight = page.getByLabel(
    "Pendulum Squat (Machine) set 1 actual weight",
    { exact: true }
  )
  await expect(weight).toHaveAttribute("placeholder", "70")
  await expect
    .poll(
      async () =>
        !!(await page.evaluate(() => navigator.serviceWorker.controller))
    )
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(weight).toHaveAttribute("placeholder", "70")
  await context.setOffline(false)
  // Update the actual source, then trigger a normal foreground refresh.
  const latest = prior[1]
  const changed = {
    ...latest,
    results: latest.results.map((row) => ({
      ...row,
      load: { value: row.reps === 5 ? 20 : 80, unit: "lb", basis: "added" },
    })),
  }
  const update = await context.request.put("/api/v1/sessions/" + latest.id, {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: { value: changed, expectedRevision: latest.revision },
  })
  expect(update.ok(), await update.text()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(weight).toHaveAttribute("placeholder", "80")
  await page
    .getByRole("button", {
      name: "Pendulum Squat (Machine) weight units",
      exact: true,
    })
    .tap()
  await page
    .getByLabel("Pendulum Squat (Machine) new entries unit", { exact: true })
    .tap()
  await page.getByRole("option", { name: "kg", exact: true }).tap()
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await expect(weight).toHaveAttribute("placeholder", "36.29")
  await page
    .getByRole("button", {
      name: "Pendulum Squat (Machine) set 1 complete",
      exact: true,
    })
    .tap()
  await expect
    .poll(async () => (await current())?.results[0]?.load)
    .toEqual({ value: 36.29, unit: "kg", basis: "added" })
  const history = await context.request.get(
    `/api/v1/history?exerciseId=${exercise.id}&before=2026-10-24`
  )
  expect((await history.json()).results[1].load.value).toBe(80)
})

test("new workout creation includes machine weight inputs and preserves an explicit prescription", async ({
  page,
  context,
}) => {
  const { week } = await fixture(page, context)
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await page.getByRole("button", { name: "New workout", exact: true }).tap()
  await page
    .getByLabel("Workout", { exact: true })
    .fill("Explicit machine prescription")
  await page.getByRole("button", { name: "Add movements", exact: true }).tap()
  await page
    .getByLabel("Search movements", { exact: true })
    .fill("Pendulum Squat (Machine)")
  await page.getByRole("button", { name: /Pendulum Squat/ }).tap()
  await page.getByRole("button", { name: "Add 1 exercise", exact: true }).tap()
  await page
    .getByLabel("Pendulum Squat (Machine) set 1 target weight", { exact: true })
    .fill("45")
  await page
    .getByLabel("Pendulum Squat (Machine) set 1 min reps", { exact: true })
    .fill("8")
  await page.getByLabel("Date", { exact: true }).fill("2026-10-24")
  await page.getByRole("button", { name: "Save", exact: true }).tap()
  await expect
    .poll(
      async () =>
        (
          (await (
            await context.request.get("/api/v1/workouts?weekId=" + week.id)
          ).json()) as WorkoutRecord[]
        ).find((w) => w.title === "Explicit machine prescription")?.blocks[0]
          .items[0].sets[0].load?.value
    )
    .toBe(45)
  const plans: WorkoutRecord[] = await (
    await context.request.get("/api/v1/workouts?weekId=" + week.id)
  ).json()
  const plan = plans.find((w) => w.title === "Explicit machine prescription")!
  expect(plan.blocks[0].items[0].trackingFields).toEqual(["reps", "load"])
  await page.goto(`/?tab=week&week=${week.id}&workout=${plan.id}`)
  await expect(
    page.getByLabel("Pendulum Squat (Machine) set 1 actual weight", {
      exact: true,
    })
  ).toHaveAttribute("placeholder", "45")
  await expect(
    page.getByLabel("Pendulum Squat (Machine) set 1 actual weight", {
      exact: true,
    })
  ).toHaveValue("")
  await expect(
    page
      .getByRole("article", { name: "Pendulum Squat (Machine)", exact: true })
      .locator(".session-set-reference")
      .first()
  ).toHaveText("70 lb added × 10")
})
