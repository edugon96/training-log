import { test, expect } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signInPage } from "./auth-helper"
import {
  defaultTargets,
  makeItem,
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

test("reordering an open plan preserves newer server details and Back remains usable", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const headers = () => ({ Origin: origin, "Idempotency-Key": randomUUID() })
  const response = await context.request.post("/api/v1/workouts", {
    headers: headers(),
    data: {
      value: {
        id: randomUUID(),
        revision: 0,
        kind: "planned",
        routineId: null,
        weekId: null,
        date: "2026-10-22",
        title: "Reorder recovery",
        focus: "",
        notes: "Preserve workout instructions",
        source: null,
        blocks: ["First", "Second"].map((title) => ({
          id: randomUUID(),
          kind: "group",
          title,
          notes: "",
          rounds: null,
          restSeconds: null,
          automaticRest: false,
          items: [],
        })),
      },
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const plan: WorkoutRecord = await response.json()
  const saved = async (): Promise<WorkoutRecord> =>
    (await context.request.get(`/api/v1/workouts/${plan.id}`)).json()
  await page.goto(`/?tab=week&workout=${plan.id}`)
  await expect(
    page.getByRole("region", { name: "Second", exact: true })
  ).toBeVisible()
  const changed = {
    ...plan,
    blocks: plan.blocks.map((b, i) =>
      i ? b : { ...b, notes: "New machine details" }
    ),
  }
  const update = await context.request.put(`/api/v1/workouts/${plan.id}`, {
    headers: headers(),
    data: { expectedRevision: plan.revision, value: changed },
  })
  expect(update.ok(), await update.text()).toBe(true)
  await page
    .getByRole("button", { name: "Second group actions", exact: true })
    .tap()
  await page
    .getByRole("menuitem", { name: "Reorder groups", exact: true })
    .tap()
  await page.getByRole("button", { name: "Move Second up", exact: true }).tap()
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  await expect
    .poll(async () => (await saved()).blocks.map((b) => b.title))
    .toEqual(["Second", "First"])
  expect((await saved()).notes).toBe("Preserve workout instructions")
  expect((await saved()).blocks[1].notes).toBe("New machine details")
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await expect(
    page.getByRole("heading", { name: "Reorder recovery", exact: true })
  ).toHaveCount(0)
  const sessions: SessionRecord[] = await (
    await context.request.get("/api/v1/sessions")
  ).json()
  expect(sessions.filter((s) => s.workoutId === plan.id)).toEqual([])
})

test("an existing conflicted group order recovers automatically without prompts", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const response = await context.request.post("/api/v1/workouts", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      value: {
        id: randomUUID(),
        revision: 0,
        kind: "planned",
        routineId: null,
        weekId: null,
        date: "2026-10-22",
        title: "Conflicted order",
        focus: "",
        notes: "Server instructions",
        source: null,
        blocks: ["Original first", "Original second"].map((title) => ({
          id: randomUUID(),
          kind: "group",
          title,
          notes: "Latest machine details",
          rounds: null,
          restSeconds: null,
          automaticRest: false,
          items: [],
        })),
      },
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const plan: WorkoutRecord = await response.json()
  await page.goto(`/?tab=week&workout=${plan.id}`)
  await expect(
    page.getByRole("region", { name: "Original second", exact: true })
  ).toBeVisible()
  // Reproduce the durable queue left by the old client, without a merge baseline.
  await page.evaluate(
    async ({ ownerId, plan }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("training-platform-v1")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("planEdits", "readwrite")
        tx.objectStore("planEdits").put({
          key: `${ownerId}:${plan.id}`,
          ownerId,
          value: {
            ...plan,
            revision: 0,
            blocks: [...plan.blocks]
              .reverse()
              .map((b) => ({ ...b, notes: "Stale machine details" })),
          },
          version: crypto.randomUUID(),
          error: "This record changed elsewhere",
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { ownerId: identity.id, plan }
  )
  await page.reload()
  await expect
    .poll(async () =>
      (
        await (await context.request.get(`/api/v1/workouts/${plan.id}`)).json()
      ).blocks.map((b: { title: string }) => b.title)
    )
    .toEqual(["Original second", "Original first"])
  await expect(
    page.getByRole("button", { name: "Resolve workout changes", exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0)
  const saved: WorkoutRecord = await (
    await context.request.get(`/api/v1/workouts/${plan.id}`)
  ).json()
  expect(saved.blocks.map((b) => b.title)).toEqual([
    "Original second",
    "Original first",
  ])
  expect(saved.blocks.every((b) => b.notes === "Latest machine details")).toBe(
    true
  )
  expect(saved.notes).toBe("Server instructions")
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await expect(page).not.toHaveURL(new RegExp(`workout=${plan.id}`))
})

test("offline group reorder is durable and does not block Back", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const response = await context.request.post("/api/v1/workouts", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      value: {
        id: randomUUID(),
        revision: 0,
        kind: "planned",
        routineId: null,
        weekId: null,
        date: "2026-10-22",
        title: "Offline order",
        focus: "",
        notes: "",
        source: null,
        blocks: ["Offline first", "Offline second"].map((title) => ({
          id: randomUUID(),
          kind: "group",
          title,
          notes: "",
          rounds: null,
          restSeconds: null,
          automaticRest: false,
          items: [],
        })),
      },
    },
  })
  const plan: WorkoutRecord = await response.json()
  await page.goto(`/?tab=week&workout=${plan.id}`)
  await expect(
    page.getByRole("region", { name: "Offline second", exact: true })
  ).toBeVisible()
  await context.setOffline(true)
  await page
    .getByRole("button", { name: "Offline second group actions", exact: true })
    .tap()
  await page
    .getByRole("menuitem", { name: "Reorder groups", exact: true })
    .tap()
  await page
    .getByRole("button", { name: "Move Offline second up", exact: true })
    .tap()
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await expect(page).not.toHaveURL(new RegExp(`workout=${plan.id}`))
  await context.setOffline(false)
  await expect
    .poll(async () =>
      (
        (await (
          await context.request.get(`/api/v1/workouts/${plan.id}`)
        ).json()) as WorkoutRecord
      ).blocks.map((b) => b.title)
    )
    .toEqual(["Offline second", "Offline first"])
})
test.beforeAll(async () => {
  const email = `groups-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const user = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Groups Test" },
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

test("groups own additions, instructions and organization while movements retain results and independent rest", async ({
  page,
  context,
}) => {
  await signInPage(page, identity.email, identity.password)
  const post = async (path: string, value: unknown) => {
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
    title: "Group flow",
    notes: "",
    targets: defaultTargets,
  })
  for (const name of ["Alpha Press", "Beta Curl"])
    await post("/exercises", {
      id: randomUUID(),
      revision: 0,
      name,
      equipmentId: null,
      equipment: "Bodyweight",
      setup: "",
      primaryMuscle: "chest",
      secondaryMuscles: [],
      pattern: "push",
      defaultRole: "lifting",
      defaultLoad: null,
      trackingFields: ["reps"],
      notes: "Movement instruction",
      archived: false,
    })
  const plans = async (): Promise<WorkoutRecord[]> =>
    (await context.request.get(`/api/v1/workouts?weekId=${week.id}`)).json()
  const sessions = async (): Promise<SessionRecord[]> =>
    (await context.request.get("/api/v1/sessions")).json()
  const group = (name: string) =>
    page.getByRole("region", { name, exact: true })
  const movement = (name: string) =>
    page.getByRole("article", { name, exact: true })
  const groupMenu = async (name: string, action: string) => {
    await page
      .getByRole("button", { name: `${name} group actions`, exact: true })
      .tap()
    await page.getByRole("menuitem", { name: action, exact: true }).tap()
  }
  const moveTo = async (name: string, destination: string) => {
    await page
      .getByRole("button", { name: `${name} actions`, exact: true })
      .tap()
    await page
      .getByRole("menuitem", { name: "Move to group", exact: true })
      .tap()
    await page
      .getByRole("dialog", { name: "Move to group", exact: true })
      .getByRole("button", { name: destination, exact: true })
      .tap()
  }
  await page.goto(`/?tab=week&week=${week.id}`)
  await page.getByRole("button", { name: "New workout", exact: true }).tap()
  await expect(group("Group 1")).toBeVisible()
  await page.getByLabel("Workout", { exact: true }).fill("Group flow")
  await group("Group 1")
    .getByRole("button", { name: "Add movements", exact: true })
    .tap()
  await expect(
    page.getByRole("heading", { name: "Add to Group 1", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await expect(group("Group 1").getByRole("article")).toHaveCount(0)
  await group("Group 1")
    .getByRole("button", { name: "Add movements", exact: true })
    .tap()
  await page.getByRole("button", { name: /Beta Curl/ }).tap()
  await page.getByRole("button", { name: /Alpha Press/ }).tap()
  await page.getByRole("button", { name: "Add 2 exercises", exact: true }).tap()
  await expect(group("Group 1").locator(".movement-card-title h2")).toHaveText([
    "Beta Curl",
    "Alpha Press",
  ])
  await groupMenu("Group 1", "Rename group")
  await page.getByLabel("Group name", { exact: true }).fill("Strength")
  await page
    .getByRole("dialog", { name: "Rename group", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .tap()
  await groupMenu("Strength", "Edit instructions")
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Group-only instruction")
  await page
    .getByRole("dialog", { name: "Group instructions", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .tap()
  await page
    .getByRole("button", { name: "Beta Curl rest timer", exact: true })
    .tap()
  await page.getByRole("button", { name: "30s", exact: true }).tap()
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  await expect(
    movement("Alpha Press").getByRole("button", {
      name: "Alpha Press rest timer",
      exact: true,
    })
  ).toContainText("Off")
  await page
    .getByRole("button", { name: "Alpha Press rest timer", exact: true })
    .tap()
  await page.getByRole("button", { name: "2m", exact: true }).tap()
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  await page.getByRole("button", { name: "Add group", exact: true }).tap()
  await expect(group("Group 1")).toBeVisible()
  const editor = page.locator(".focused-editor-body:visible")
  await expect
    .poll(() => editor.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(200)
  await group("Group 1")
    .getByRole("button", { name: "Add movements", exact: true })
    .scrollIntoViewIfNeeded()
  const groupScroll = await editor.evaluate((element) => element.scrollTop)
  await group("Group 1")
    .getByRole("button", { name: "Add movements", exact: true })
    .tap()
  await page.getByRole("button", { name: "Back", exact: true }).tap()
  await expect
    .poll(() => editor.evaluate((element) => element.scrollTop))
    .toBeCloseTo(groupScroll, 0)
  await moveTo("Alpha Press", "Group 1")
  await expect(group("Strength").getByRole("article")).toHaveCount(1)
  await expect(group("Strength").locator(".group-instructions")).toHaveText(
    "Group-only instruction"
  )
  await expect(
    movement("Beta Curl").getByLabel("Beta Curl workout note", { exact: true })
  ).not.toHaveValue("Group-only instruction")
  await groupMenu("Group 1", "Reorder groups")
  await page.getByRole("button", { name: "Move Group 1 up", exact: true }).tap()
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  expect(await plans()).toHaveLength(0)
  await page.getByRole("button", { name: "Save", exact: true }).tap()
  await expect.poll(async () => (await plans()).length).toBe(1)
  const original = (await plans())[0]
  expect(original.blocks.map((block) => block.kind)).toEqual(["group", "group"])
  expect(original.blocks.map((block) => block.items[0].restSeconds)).toEqual([
    120, 30,
  ])
  await page.getByRole("button", { name: "Open Group flow", exact: true }).tap()
  await page
    .getByLabel("Alpha Press set 1 actual reps", { exact: true })
    .fill("8")
  await page
    .getByRole("button", { name: "Alpha Press set 1 complete", exact: true })
    .tap()
  await expect
    .poll(async () =>
      (await sessions())[0]?.results.some(
        (result) => result.status === "completed"
      )
    )
    .toBe(true)
  const before = (await sessions())[0]
  await moveTo("Alpha Press", "Strength")
  await expect(group("Group 1").getByRole("article")).toHaveCount(0)
  await expect(
    movement("Alpha Press").getByLabel("Alpha Press set 1 actual reps", {
      exact: true,
    })
  ).toHaveValue("8")
  await expect
    .poll(
      async () =>
        (await sessions())[0]?.blocks.find(
          (block) => block.title === "Strength"
        )?.items.length
    )
    .toBe(2)
  expect((await sessions())[0].results).toEqual(before.results)
  expect((await plans())[0]).toEqual(original)
  await context.setOffline(true)
  await moveTo("Beta Curl", "New group")
  await expect(group("Group 2")).toBeVisible()
  await page.reload()
  await expect(
    group("Group 2").getByRole("article", { name: "Beta Curl", exact: true })
  ).toBeVisible()
  await context.setOffline(false)
  await expect
    .poll(async () =>
      (await sessions())[0]?.blocks.some((block) => block.title === "Group 2")
    )
    .toBe(true)
  await page
    .getByRole("button", { name: "Collapse Strength", exact: true })
    .tap()
  await expect(movement("Alpha Press")).toBeHidden()
  await page.getByRole("button", { name: "Expand Strength", exact: true }).tap()
  await expect(movement("Alpha Press")).toBeVisible()
  await page.screenshot({
    path: ".local/groups/active-mobile.png",
    fullPage: true,
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: ".local/groups/active-desktop.png",
    fullPage: true,
  })
  await groupMenu("Group 1", "Remove group")
  await expect(group("Group 1")).toHaveCount(0)
  await groupMenu("Strength", "Remove group")
  await expect(
    page.getByRole("dialog", { name: "Confirm change" })
  ).toContainText("entered results")
  await page.getByRole("button", { name: "Cancel", exact: true }).tap()
  await expect(movement("Alpha Press")).toBeVisible()
  expect((await sessions())[0].results).toEqual(before.results)
  await groupMenu("Strength", "Remove group")
  await page.getByRole("button", { name: "Continue", exact: true }).tap()
  await expect(group("Strength")).toHaveCount(0)
  await expect.poll(async () => (await sessions())[0].results.length).toBe(0)
  expect((await plans())[0]).toEqual(original)
})

test("long workouts retain scroll and collapsed groups when adding groups and movements", async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await signInPage(page, identity.email, identity.password)
  const post = async (path: string, value: unknown) => {
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
    startDate: "2026-10-26",
    title: "Scroll check",
    notes: "",
    targets: defaultTargets,
  })
  const exercise = await post("/exercises", {
    id: randomUUID(),
    revision: 0,
    name: "Scroll movement",
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
  })
  const original: WorkoutRecord = await post("/workouts", {
    id: randomUUID(),
    revision: 0,
    kind: "planned",
    routineId: null,
    weekId: week.id,
    date: "2026-10-26",
    title: "Long workout",
    focus: "",
    notes: "",
    source: null,
    blocks: Array.from({ length: 5 }, (_, index) => ({
      id: randomUUID(),
      title: `Group ${index + 1}`,
      kind: index === 0 ? "straight" : "superset",
      rounds: 3,
      restSeconds: 90,
      automaticRest: true,
      notes: `Instructions ${index + 1}`,
      items: [makeItem(exercise, 3)],
    })),
  })
  const saved = async (): Promise<WorkoutRecord> =>
    (await context.request.get(`/api/v1/workouts/${original.id}`)).json()
  const group = (name: string) =>
    page.getByRole("region", { name, exact: true })
  await page.goto(`/?tab=week&week=${week.id}&editor=${original.id}`)
  await expect(group("Group 5")).toBeVisible()
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  expect(await saved()).toEqual(original) // Viewing/adapting a legacy record must not save it.
  await page.goto(`/?tab=week&week=${week.id}&editor=${original.id}`)
  await page
    .getByRole("button", { name: "Collapse Group 2", exact: true })
    .tap()
  await page.getByRole("button", { name: "Add group", exact: true }).tap()
  await expect(
    page.getByRole("button", { name: "Collapse Group 6", exact: true })
  ).toBeInViewport()
  const editor = page.locator(".focused-editor-body:visible")
  await expect
    .poll(() => editor.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1000)
  const add = group("Group 6").getByRole("button", {
    name: "Add movements",
    exact: true,
  })
  await add.scrollIntoViewIfNeeded()
  const beforePicker = await editor.evaluate((element) => element.scrollTop)
  await add.tap()
  await page.getByRole("button", { name: /Scroll movement/ }).tap()
  await page.getByRole("button", { name: "Add 1 exercise", exact: true }).tap()
  await expect
    .poll(() => editor.evaluate((element) => element.scrollTop))
    .toBeCloseTo(beforePicker, 0)
  await expect(
    page.getByRole("button", { name: "Expand Group 2", exact: true })
  ).toBeVisible()
  await expect(group("Group 6").getByRole("article")).toHaveCount(1)
  await page.getByRole("button", { name: "Done", exact: true }).tap()
  await expect.poll(async () => (await saved()).blocks[5]?.items.length).toBe(1)
  await page.goto(`/?tab=week&week=${week.id}&workout=${original.id}`)
  await page.getByRole("button", { name: "Add group", exact: true }).tap()
  await expect(
    page.getByRole("button", { name: "Collapse Group 7", exact: true })
  ).toBeInViewport()
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(1000)
  const sessionAdd = group("Group 7").getByRole("button", {
    name: "Add movements",
    exact: true,
  })
  await sessionAdd.scrollIntoViewIfNeeded()
  const sessionScroll = await page.evaluate(() => window.scrollY)
  await sessionAdd.tap()
  await page.getByRole("button", { name: /Scroll movement/ }).tap()
  await page.getByRole("button", { name: "Add 1 exercise", exact: true }).tap()
  await expect(group("Group 7").getByRole("article")).toHaveCount(1)
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(sessionScroll - 40)
  await expect.poll(async () => (await saved()).blocks[6]?.items.length).toBe(1)
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(sessionScroll - 40)
  await page.screenshot({ path: ".local/groups/scroll-after-add.png" })
  expect(errors).toEqual([])
})
