import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import {
  defaultTargets,
  makeItem,
  type WorkoutRecord,
  type SessionRecord,
} from "../../contracts/models"
import { workoutDraft } from "../../lib/workout-draft"
import { signInPage } from "./auth-helper"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  // WebKit service-worker traffic bypasses Playwright route interception.
  // The separate offline specs run with the production worker enabled.
  serviceWorkers: "block",
})
const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `autosave-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const user = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Autosave Test" },
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
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})
async function fixture(
  context: BrowserContext,
  basis: "total" | "unknown" = "total"
) {
  const post = async (path: string, value: unknown) => {
    const response = await context.request.post(`/api/v1${path}`, {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data: { value },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const week = await post("/weeks", {
    id: randomUUID(),
    revision: 0,
    title: "Autosave week",
    startDate: "2026-10-19",
    notes: "",
    targets: defaultTargets,
  })
  const exercise = await post("/exercises", {
    id: randomUUID(),
    revision: 0,
    name: "Autosave Row",
    equipmentId: null,
    equipment: "Machine",
    setup: "",
    primaryMuscle: "back",
    secondaryMuscles: [],
    pattern: "pull",
    defaultRole: "lifting",
    defaultLoad: { value: 20, unit: "lb", basis },
    trackingFields: ["load", "reps"],
    notes: "",
    archived: false,
  })
  const item = makeItem(exercise)
  const plan: WorkoutRecord = await post("/workouts", {
    id: randomUUID(),
    revision: 0,
    kind: "planned",
    routineId: null,
    weekId: week.id,
    date: "2026-10-22",
    title: "Autosave workout",
    focus: "",
    notes: "Original instructions",
    source: null,
    blocks: [
      {
        id: randomUUID(),
        kind: "group",
        title: "Rows",
        notes: "",
        rounds: null,
        restSeconds: null,
        items: [item],
      },
    ],
  })
  const readPlan = async (): Promise<WorkoutRecord> =>
    (await context.request.get(`/api/v1/workouts/${plan.id}`)).json()
  const createSession = async (): Promise<SessionRecord> =>
    post("/sessions", workoutDraft(plan))
  return { week, plan, readPlan, createSession }
}
async function edit(page: Page) {
  await page.getByRole("button", { name: "Workout actions", exact: true }).tap()
  await page
    .getByRole("menuitem", { name: "Edit movements", exact: true })
    .tap()
  await expect(page.getByLabel("Workout", { exact: true })).toBeVisible()
}

test("acknowledgements refresh one ledger without reloading account resources or movement history", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const { createSession, week } = await fixture(context)
  const session = await createSession()
  const reads: URL[] = []
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/api/v1/"))
      reads.push(new URL(request.url()))
  })
  await page.goto(`/?tab=week&week=${week.id}&session=${session.id}`)
  const reps = page.getByLabel("Autosave Row set 1 actual reps", {
    exact: true,
  })
  await expect(reps).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(
    reads
      .filter((url) => url.pathname.startsWith("/api/v1/history"))
      .map((url) => url.pathname)
  ).toEqual(["/api/v1/history/batch"])
  reads.length = 0
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith(`/sessions/${session.id}`)
  )
  await reps.fill("10")
  expect((await saved).ok()).toBe(true)
  await expect
    .poll(() => reads.filter((url) => url.pathname === "/api/v1/ledger").length)
    .toBe(1)
  await page.waitForLoadState("networkidle")
  expect(reads.map((url) => url.pathname)).toEqual(["/api/v1/ledger"])
  expect(reads[0].searchParams.get("weekId")).toBe(week.id)
})

test("returning to an open plan merges a remote title into the mounted workout", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const { plan, week, readPlan } = await fixture(context)
  await page.goto(`/?tab=week&week=${week.id}&workout=${plan.id}`)
  await expect(
    page.getByRole("heading", { name: plan.title, exact: true })
  ).toBeVisible()
  await page.waitForLoadState("networkidle")
  const current = await readPlan()
  const response = await context.request.put(`/api/v1/workouts/${plan.id}`, {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      expectedRevision: current.revision,
      value: { ...current, title: "Updated on another device" },
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(
    page.getByRole("heading", {
      name: "Updated on another device",
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByLabel("Autosave Row set 1 actual reps", { exact: true })
  ).toBeVisible()
  const preview = await (
    await context.request.get(`/api/v1/workouts/${plan.id}/deletion`)
  ).json()
  const removed = await context.request.delete(`/api/v1/workouts/${plan.id}`, {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: { expected: preview },
  })
  expect(removed.ok(), await removed.text()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(page.getByRole("heading", { name: /^Good / })).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "Updated on another device",
      exact: true,
    })
  ).toHaveCount(0)
})

test("foreground refresh keeps pending results while applying unrelated remote session edits", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const { createSession, week } = await fixture(context)
  const session = await createSession()
  await page.goto(`/?tab=week&week=${week.id}&session=${session.id}`)
  const reps = page.getByLabel("Autosave Row set 1 actual reps", {
    exact: true,
  })
  await expect(reps).toBeVisible()
  await page.waitForLoadState("networkidle")
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/api/v1/sessions/${session.id}`, async (route) => {
    if (route.request().method() === "PUT") await held
    await route.continue()
  })
  try {
    await reps.fill("13")
    const remote = await context.request.put(`/api/v1/sessions/${session.id}`, {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data: {
        expectedRevision: session.revision,
        value: { ...session, title: "Remote session title" },
      },
    })
    expect(remote.ok(), await remote.text()).toBe(true)
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(
      page.getByRole("heading", { name: "Remote session title", exact: true })
    ).toBeVisible()
    await expect(reps).toHaveValue("13")
    release()
    await expect
      .poll(async () => {
        const saved: SessionRecord = await (
          await context.request.get(`/api/v1/sessions/${session.id}`)
        ).json()
        return [saved.title, saved.results[0]?.reps]
      })
      .toEqual(["Remote session title", 13])
  } finally {
    release()
  }
})

test("a foreground read cannot replay a saved checkmark over a newer undo", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const { createSession, week } = await fixture(context)
  const session = await createSession()
  await page.goto(`/?tab=week&week=${week.id}&session=${session.id}`)
  const reps = page.getByLabel("Autosave Row set 1 actual reps", {
    exact: true,
  })
  await reps.fill("10")
  const read = async (): Promise<SessionRecord> =>
    (await context.request.get(`/api/v1/sessions/${session.id}`)).json()
  await expect.poll(async () => (await read()).results[0]?.reps).toBe(10)
  await page.waitForLoadState("networkidle")
  let releaseRead!: () => void, releaseUndo!: () => void, sawRead!: () => void
  const readHeld = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  const undoHeld = new Promise<void>((resolve) => {
    releaseUndo = resolve
  })
  const reading = new Promise<void>((resolve) => {
    sawRead = resolve
  })
  let checked: SessionRecord | undefined
  await page.route(`**/api/v1/sessions/${session.id}`, async (route) => {
    if (route.request().method() === "GET") {
      sawRead()
      await readHeld
      await route.fulfill({ json: checked })
    } else {
      const body = route.request().postDataJSON() as { value?: SessionRecord }
      if (checked && body.value?.results[0]?.status === "unlogged")
        await undoHeld
      await route.continue()
    }
  })
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await reading
    const checkmark = page.getByRole("button", {
      name: /^Autosave Row set 1 (complete|uncheck)$/,
    })
    await checkmark.tap()
    await expect
      .poll(async () => (await read()).results[0]?.status)
      .toBe("completed")
    checked = await read()
    await expect(checkmark).toHaveAttribute("aria-pressed", "true")
    await checkmark.tap()
    await expect(checkmark).toHaveAttribute("aria-pressed", "false")
    const finished = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith(`/sessions/${session.id}`)
    )
    const refreshed = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/v1/sessions" &&
        url.searchParams.get("weekId") === week.id
      )
    })
    releaseRead()
    await finished
    await refreshed
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    await expect(checkmark).toHaveAttribute("aria-pressed", "false")
    releaseUndo()
    await expect
      .poll(async () => (await read()).results[0]?.status)
      .toBe("unlogged")
    await expect(checkmark).toHaveAttribute("aria-pressed", "false")
  } finally {
    releaseRead()
    releaseUndo()
  }
})

test("machine volume updates from actual sets, saves quietly and the rest dial follows its seconds", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.clock.install({ time: new Date("2026-10-23T12:00:00Z") })
  await signInPage(page, identity.email, identity.password)
  const { plan } = await fixture(context, "unknown")
  await page.goto(`/?tab=week&workout=${plan.id}`)
  const volume = page
    .locator(".workout-summary")
    .locator("strong[aria-label$=' pounds']")
  await expect(volume).toHaveAttribute("aria-label", "0 pounds")
  await page
    .getByLabel("Autosave Row set 1 actual weight", { exact: true })
    .fill("105")
  await page
    .getByLabel("Autosave Row set 1 actual reps", { exact: true })
    .fill("12")
  await expect(volume).toHaveAttribute("aria-label", "0 pounds")
  await page
    .getByRole("button", { name: "Autosave Row set 1 complete", exact: true })
    .tap()
  await expect(volume).toHaveAttribute("aria-label", "1,260 pounds")
  const sessions = async (): Promise<SessionRecord[]> =>
    (await context.request.get("/api/v1/sessions")).json()
  await expect
    .poll(
      async () =>
        (await sessions()).find((s) => s.workoutId === plan.id)?.results[0]
          ?.status
    )
    .toBe("completed")
  await expect(page.getByRole("status", { name: /^Autosave:/ })).toHaveCount(0)
  await page.reload()
  await expect(volume).toHaveAttribute("aria-label", "1,260 pounds")
  await context.setOffline(true)
  await page
    .getByRole("button", {
      name: "Offline, changes kept on this device",
      exact: true,
    })
    .tap()
  await expect(
    page.getByRole("dialog", { name: "Offline", exact: true })
  ).toContainText("save automatically when connected")
  await page.getByRole("button", { name: "Close", exact: true }).tap()
  await context.setOffline(false)
  await expect(page.getByRole("status", { name: /^Autosave:/ })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("quiet-workout.png") })
  await page
    .getByRole("button", { name: "Open workout clock", exact: true })
    .tap()
  await page.getByRole("button", { name: "1:30", exact: true }).tap()
  // Freeze after the panel's normal mobile interaction, then exercise exact
  // sub-second boundaries through the real clock subscription and controls.
  await page.clock.pauseAt(new Date("2026-10-23T12:02:00Z"))
  await page
    .getByRole("button", { name: "1:30", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
  await page.clock.runFor(100)
  const face = page
    .locator(".timer-face")
    .filter({ has: page.getByLabel("Rest countdown", { exact: true }) })
  const assertDial = async (text: string, lit: number) => {
    await expect(page.getByLabel("Rest countdown", { exact: true })).toHaveText(
      text
    )
    await expect(face.locator(".timer-tick.is-lit")).toHaveCount(lit)
  }
  await assertDial("1:30", 90)
  await page.clock.runFor(800)
  await assertDial("1:30", 90)
  await page.clock.runFor(100)
  await assertDial("1:29", 89)
  await page
    .getByRole("button", { name: "Pause rest timer", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
  await page.clock.runFor(5000)
  await assertDial("1:29", 89)
  await page
    .getByRole("button", { name: "Add 30 seconds", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
  await page.clock.runFor(100)
  await assertDial("1:59", 119)
  await expect(face.locator(".timer-tick")).toHaveCount(120)
  await page
    .getByRole("button", { name: "Resume rest timer", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
  await page.clock.runFor(1100)
  await assertDial("1:58", 118)
  await page.clock.runFor(117000)
  await assertDial("0:01", 1)
  await page.clock.runFor(1000)
  await assertDial("0:00", 0)
  await page.clock.resume()
  expect(errors).toEqual([])
})

test("two devices autosave independent fields and the later same-field save wins", async ({
  page,
  context,
  browser,
}) => {
  await signInPage(page, identity.email, identity.password)
  const { plan, readPlan } = await fixture(context)
  const device = await browser.newContext({
    baseURL: origin,
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  try {
    const other = await device.newPage()
    await page.goto(`/?tab=week&workout=${plan.id}`)
    await other.goto(`/?tab=week&workout=${plan.id}`)
    await edit(page)
    await edit(other)
    await page.getByLabel("Workout", { exact: true }).fill("First device title")
    await expect
      .poll(async () => (await readPlan()).title)
      .toBe("First device title")
    await other
      .getByLabel("Workout notes", { exact: true })
      .fill("Second device instructions")
    await expect
      .poll(async () => (await readPlan()).notes)
      .toBe("Second device instructions")
    expect((await readPlan()).title).toBe("First device title")
    await expect(other.getByLabel("Workout", { exact: true })).toHaveValue(
      "First device title"
    )
    await other
      .getByLabel("Workout", { exact: true })
      .fill("Second device title")
    await expect
      .poll(async () => (await readPlan()).title)
      .toBe("Second device title")
    await page.getByLabel("Workout", { exact: true }).fill("Latest title")
    await expect.poll(async () => (await readPlan()).title).toBe("Latest title")
    expect((await readPlan()).notes).toBe("Second device instructions")
    await expect(page.getByLabel("Workout notes", { exact: true })).toHaveValue(
      "Second device instructions"
    )
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
      0
    )
    await expect(
      other.getByRole("alert").filter({ hasText: /\S/ })
    ).toHaveCount(0)
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Back", exact: true })
      .tap()
    await page.getByRole("button", { name: "Back", exact: true }).tap()
    await expect(page.getByRole("heading", { name: /^Good / })).toBeVisible()
  } finally {
    await device.close()
  }
})

test("concurrent result entries merge into one set and credit the ledger only when checked", async ({
  page,
  context,
  browser,
}) => {
  await signInPage(page, identity.email, identity.password)
  const { createSession, week } = await fixture(context)
  const session = await createSession()
  const saved = async (): Promise<SessionRecord> =>
    (await context.request.get(`/api/v1/sessions/${session.id}`)).json()
  const ledger = async () =>
    (await context.request.get(`/api/v1/ledger?weekId=${week.id}`)).json()
  const device = await browser.newContext({
    baseURL: origin,
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  try {
    const other = await device.newPage()
    await page.goto(`/?tab=week&week=${week.id}&session=${session.id}`)
    await other.goto(`/?tab=week&week=${week.id}&session=${session.id}`)
    await expect(
      other.getByLabel("Autosave Row set 1 actual reps", { exact: true })
    ).toBeVisible()
    await page
      .getByLabel("Autosave Row set 1 actual weight", { exact: true })
      .fill("25")
    await expect
      .poll(async () => (await saved()).results[0]?.load?.value)
      .toBe(25)
    await other
      .getByLabel("Autosave Row set 1 actual reps", { exact: true })
      .fill("10")
    await expect.poll(async () => (await saved()).results[0]?.reps).toBe(10)
    expect((await saved()).results).toHaveLength(1)
    expect((await saved()).results[0].load?.value).toBe(25)
    expect((await ledger()).completedTotal).toBe(0)
    await expect(
      other.getByLabel("Autosave Row set 1 actual weight", { exact: true })
    ).toHaveValue("25")
    await other
      .getByRole("button", { name: "Autosave Row set 1 complete", exact: true })
      .tap()
    await expect.poll(async () => (await ledger()).completedTotal).toBe(1)
    await expect(
      other.getByRole("alert").filter({ hasText: /\S/ })
    ).toHaveCount(0)
    await page.reload()
    await expect(
      page.getByLabel("Autosave Row set 1 actual reps", { exact: true })
    ).toHaveValue("10")
  } finally {
    await device.close()
  }
})

test("a lost save response retries safely while Back and later edits remain available", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const { createSession, week } = await fixture(context)
  const session = await createSession()
  const saved = async (): Promise<SessionRecord> =>
    (await context.request.get(`/api/v1/sessions/${session.id}`)).json()
  let committed!: () => void, release!: () => void
  const firstCommitted = new Promise<void>((resolve) => {
    committed = resolve
  })
  const releaseResponse = new Promise<void>((resolve) => {
    release = resolve
  })
  const keys: string[] = []
  await page.route(`**/api/v1/sessions/${session.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue()
    keys.push(route.request().headers()["idempotency-key"])
    if (keys.length > 1) return route.continue()
    const response = await route.fetch()
    expect(response.ok(), await response.text()).toBe(true)
    committed()
    await releaseResponse
    await route.abort("failed")
  })
  await page.goto(`/?tab=week&week=${week.id}&session=${session.id}`)
  try {
    await page
      .getByLabel("Autosave Row set 1 actual weight", { exact: true })
      .fill("30")
    await firstCommitted
    await page
      .getByLabel("Autosave Row set 1 actual reps", { exact: true })
      .fill("12")
    await page.getByRole("button", { name: "Back", exact: true }).tap()
    await expect(page.getByRole("heading", { name: /^Good / })).toBeVisible({
      timeout: 3000,
    })
  } finally {
    release()
  }
  await expect
    .poll(async () => (await saved()).results[0]?.reps, { timeout: 15000 })
    .toBe(12)
  expect(keys.length).toBeGreaterThanOrEqual(3)
  expect(keys[0]).toBe(keys[1])
  expect(keys[2]).not.toBe(keys[1])
  expect((await saved()).results).toHaveLength(1)
  expect((await saved()).results[0].load?.value).toBe(30)
  await expect(
    page.getByRole("status", { name: "Autosave: Saved" }).first()
  ).toHaveCount(0)
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0)
})
