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
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `timer-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Timer Test" },
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
    "timer_settings",
    "exercises",
    "equipment",
    "audit_events",
    "mutation_receipts",
    "import_sources",
  ])
    await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
      identity.id,
    ])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})
test("mobile timers persist across navigation, reload and offline use, then cancel on finish", async ({
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
    name: "Timer Push-up",
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
    title: "Timer week",
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
    title: "Timer workout",
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
  await page
    .getByRole("button", { name: "Open Timer workout", exact: true })
    .click()
  await expect(
    page.getByLabel("Workout duration", { exact: true })
  ).toBeVisible()
  await page
    .getByLabel("Timer Push-up set 1 actual reps", { exact: true })
    .fill("8")
  await page
    .getByRole("button", { name: "Open rest timer", exact: true })
    .click()
  await page.getByRole("button", { name: "1:30", exact: true }).click()
  const responseTimes: number[] = []
  for (const preset of ["0:30", "2:00", "1:00", "1:30"]) {
    const measured = await page.evaluate(async (label) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".timer-presets button")
      ).find((node) => node.textContent === label)!
      const start = performance.now()
      button.click()
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      return {
        ms: performance.now() - start,
        text: document.querySelector(".rest-countdown")?.textContent,
      }
    }, preset)
    expect(measured.text).toBe(preset)
    expect(measured.ms).toBeLessThan(500)
    responseTimes.push(measured.ms)
  }
  await test.info().attach("preset-response-ms", {
    body: JSON.stringify(responseTimes),
    contentType: "application/json",
  })
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(0)
  await expect(page.locator(".timer-face")).toHaveCSS("box-shadow", "none")
  await expect(page.locator(".timer-face")).toHaveCSS(
    "background-image",
    "none"
  )
  const readTimer = () =>
    page.evaluate(
      (id) =>
        JSON.parse(sessionStorage.getItem(`training-rest:${id}`) || "null"),
      identity.id
    )
  const beforeDraft = await readTimer()
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  const custom = page.getByRole("slider", { name: "Custom duration" })
  await custom.focus()
  await custom.press("End")
  await expect(custom).toHaveAttribute("aria-valuenow", "3600")
  await custom.press("Home")
  await expect(custom).toHaveAttribute("aria-valuenow", "1")
  await custom.scrollIntoViewIfNeeded()
  const bounds = (await custom.boundingBox())!
  const touch = await context.newCDPSession(page)
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  })
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x - 80, y }],
  })
  const atRelease = Number(await custom.getAttribute("aria-valuenow"))
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
  await expect
    .poll(async () => Number(await custom.getAttribute("aria-valuenow")))
    .toBeGreaterThan(atRelease)
  // New input interrupts coasting. Reduced motion snaps without a momentum tail.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await custom.press("Home")
  await custom.press("PageUp")
  await custom.press("ArrowLeft")
  await expect(custom).toHaveAttribute("aria-valuenow", "60")
  await page.waitForTimeout(200)
  await expect(custom).toHaveAttribute("aria-valuenow", "60")
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(
    page.getByRole("dialog", { name: "Rest timer", exact: true })
  ).toBeVisible()
  expect((await readTimer()).id).toBe(beforeDraft.id)
  expect((await readTimer()).deadline).toBe(beforeDraft.deadline)
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("button", { name: "Open rest timer", exact: true })
    .click()
  await expect(custom).toHaveCount(0)
  await page.getByRole("button", { name: "1:30", exact: true }).click()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const face = page.locator(".timer-face")
    const digits = page.locator(".rest-countdown")
    const ringBox = (await face.boundingBox())!,
      numberBox = (await digits.boundingBox())!
    expect(
      Math.abs(
        ringBox.y + ringBox.height / 2 - (numberBox.y + numberBox.height / 2)
      )
    ).toBeLessThan(2)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await expect(digits).toHaveCSS("letter-spacing", "normal")
    await page.screenshot({ path: `test-results/rest-dial-${width}.png` })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: "test-results/timer-mobile-panel.png" })
  await page
    .getByRole("button", { name: "Pause rest timer", exact: true })
    .click()
  await page.getByRole("button", { name: "1:30", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Pause rest timer", exact: true })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Pause rest timer", exact: true })
    .click()
  const beforeExtension = await readTimer()
  await page
    .getByRole("button", { name: "Add 30 seconds", exact: true })
    .click()
  await expect
    .poll(async () => (await readTimer()).remainingMs)
    .toBe(beforeExtension.remainingMs + 30000)
  expect((await readTimer()).status).toBe("paused")
  expect((await readTimer()).durationMs).toBe(beforeExtension.durationMs)
  const paused = await page.locator(".rest-countdown").innerText()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Timers", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  await expect(page.locator(".rest-countdown")).toHaveText(paused)
  await page.waitForTimeout(2200)
  await page
    .getByRole("button", { name: "Resume rest timer", exact: true })
    .click()
  // Resuming must not temporarily add the time spent paused to the display.
  const displayed = await page.locator(".rest-countdown").innerText()
  const asSeconds = (text: string) =>
    text
      .trim()
      .split(":")
      .reduce((total, n) => total * 60 + Number(n), 0)
  expect(asSeconds(displayed)).toBeLessThanOrEqual(asSeconds(paused))
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.reload()
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  await expect(
    page.getByRole("button", { name: "Pause rest timer", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Reset rest timer" }).click()
  await expect(page.locator(".rest-countdown")).toHaveText("0:00")
  await expect(
    page.locator('.timer-presets [aria-pressed="true"]')
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Rest timer actions" })
  ).toHaveCount(0)
  await context.setOffline(true)
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  const ruler = page.getByRole("slider", { name: "Custom duration" })
  await ruler.focus()
  await ruler.press("Home")
  await expect(ruler).toHaveAttribute("aria-valuenow", "1")
  await page
    .getByRole("button", { name: "Start rest timer", exact: true })
    .click()
  await expect(page.locator(".timer-face")).toHaveClass(/is-complete/)
  await expect(page.locator(".timer-face")).not.toHaveClass(/is-complete/, {
    timeout: 6000,
  })
  await expect(page.locator(".rest-countdown")).toHaveText("0:01")
  await expect(
    page.getByRole("status").filter({ hasText: "Rest complete" })
  ).toHaveCount(0)
  await context.setOffline(false)
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  await page.getByLabel("New preset seconds").fill("240")
  await page.getByRole("button", { name: "Preset", exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await context.request.get("/api/v1/timer-settings")).json())
          .presets
    )
    .toEqual([30, 60, 90, 120, 150, 180, 240])
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Week", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Open Timer workout", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Open rest timer", exact: true })
    .click()
  await page.getByRole("button", { name: "1:00", exact: true }).click()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.setViewportSize({ width: 320, height: 740 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.locator(".session-footer").scrollIntoViewIfNeeded()
  await page.screenshot({ path: "test-results/timer-mobile-toolbar.png" })
  await page
    .getByRole("button", { name: "Finish workout", exact: true })
    .click()
  await expect(page.locator(".session-footer")).toContainText("Completed")
  await expect(
    page.getByRole("button", { name: "Open running rest timer" })
  ).toHaveCount(0)
  const duration = await page
    .getByLabel("Workout duration", { exact: true })
    .textContent()
  await expect
    .poll(
      async () =>
        (await (await context.request.get("/api/v1/sessions")).json())[0].status
    )
    .toBe("completed")
  await page
    .getByRole("button", { name: "Workout actions", exact: true })
    .click()
  await page
    .getByRole("menuitem", { name: "Edit results", exact: true })
    .click()
  await page.getByRole("button", { name: "Edit workout time" }).click()
  await page.getByRole("button", { name: "Workout clock actions" }).click()
  await page
    .getByRole("menuitem", { name: "Edit timestamps", exact: true })
    .click()
  await page.getByLabel("Workout started").fill("2026-10-20T12:00")
  await page.getByLabel("Workout started").blur()
  await page.getByLabel("Workout finished").fill("2026-10-20T13:30")
  await page.getByLabel("Workout finished").blur()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await expect(page.getByLabel("Workout duration", { exact: true })).toHaveText(
    "1:30:00"
  )
  expect(duration).toBeTruthy()
  expect(errors).toEqual([])
})
