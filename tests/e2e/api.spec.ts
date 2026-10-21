import { test, expect, request, type APIRequestContext } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signIn } from "./auth-helper"
import {
  defaultTargets,
  makeItem,
  type ExerciseRecord,
  type WorkoutRecord,
  type WeekRecord,
  type SessionRecord,
} from "../../contracts/models"

const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let owner: APIRequestContext
let other: APIRequestContext
const owners: string[] = []
async function account() {
  const email = `qa-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const created = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Integration Test" },
  })
  owners.push(created.user.id)
  const context = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  })
  const login = await signIn(context, email, password)
  expect(login.ok(), await login.text()).toBe(true)
  return context
}
const mutate = (
  context: APIRequestContext,
  method: "post" | "put" | "delete",
  path: string,
  data?: unknown,
  key = randomUUID()
) =>
  context[method](`/api/v1${path}`, {
    data,
    headers: { "Idempotency-Key": key },
  })
async function json<T>(
  response: Awaited<ReturnType<APIRequestContext["get"]>>
): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()) as T
}
test.beforeAll(async () => {
  owner = await account()
  other = await account()
})
test.afterAll(async () => {
  await owner?.dispose()
  await other?.dispose()
  // Only ephemeral QA owners created above are removed. No real training rows.
  for (const id of owners) {
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
    ]) {
      await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [id])
    }
    await getPool().query('DELETE FROM "apikey" WHERE "referenceId" = $1', [id])
    await getPool().query('DELETE FROM "user" WHERE id = $1', [id])
  }
})
test("full API flow: isolation, idempotency, snapshots, ledger, scopes and restore", async () => {
  const unauth = await request.newContext({ baseURL: origin })
  expect((await unauth.get("/api/v1/weeks")).status()).toBe(401)
  expect(
    (await unauth.post("/api/auth/sign-up/email", { data: {} })).status()
  ).toBe(404)
  await unauth.dispose()
  const exercise: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "QA Press",
    equipmentId: null,
    equipment: "Barbell",
    setup: "Flat",
    primaryMuscle: "chest",
    secondaryMuscles: ["triceps"],
    pattern: "push",
    defaultRole: "lifting",
    defaultLoad: { value: 135, unit: "lb", basis: "total" },
    notes: "",
    archived: false,
  }
  await json(await mutate(owner, "post", "/exercises", { value: exercise }))
  const week: WeekRecord = {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "QA Week",
    targets: defaultTargets,
    notes: "",
  }
  const key = randomUUID()
  const first = await json<WeekRecord>(
    await mutate(owner, "post", "/weeks", { value: week }, key)
  )
  const repeat = await json<WeekRecord>(
    await mutate(owner, "post", "/weeks", { value: week }, key)
  )
  expect(repeat).toEqual(first)
  expect(
    (
      await mutate(
        owner,
        "post",
        "/weeks",
        { value: { ...week, title: "different" } },
        key
      )
    ).status()
  ).toBe(409)
  expect((await other.get(`/api/v1/weeks/${week.id}`)).status()).toBe(404)
  const item = makeItem(exercise, 3)
  item.sets.forEach((set) => {
    set.repsMin = 8
    set.repsMax = 10
  })
  const secondItem = makeItem(exercise, 2)
  secondItem.role = "power"
  const plan: WorkoutRecord = {
    id: randomUUID(),
    revision: 0,
    kind: "planned",
    routineId: null,
    weekId: week.id,
    date: "2026-10-19",
    title: "QA Upper",
    focus: "Upper",
    blocks: [
      {
        id: randomUUID(),
        title: "A",
        kind: "superset",
        restSeconds: 120,
        rounds: null,
        items: [item, secondItem],
        notes: "",
      },
    ],
    notes: "",
    source: null,
  }
  const saved = await json<WorkoutRecord>(
    await mutate(owner, "post", "/workouts", { value: plan })
  )
  expect(
    (
      await mutate(other, "post", "/workouts", {
        value: { ...plan, id: randomUUID() },
      })
    ).status()
  ).toBe(404)
  const wrongOrigin = await owner.post("/api/v1/weeks", {
    data: { value: { ...week, id: randomUUID() } },
    headers: {
      Origin: "https://evil.example",
      "Idempotency-Key": randomUUID(),
    },
  })
  expect(wrongOrigin.status()).toBe(403)
  const session = await json<SessionRecord>(
    await mutate(owner, "post", `/workouts/${saved.id}/start`, {
      performedOn: "2026-10-19",
    })
  )
  expect(session.results).toHaveLength(5)
  expect(
    session.results.every(
      (result) =>
        result.status === "unlogged" &&
        result.reps === null &&
        result.load === null
    )
  ).toBe(true)
  await json(
    await mutate(owner, "put", `/workouts/${saved.id}`, {
      expectedRevision: saved.revision,
      value: { ...saved, blocks: [] },
    })
  )
  const stable = await json<SessionRecord>(
    await owner.get(`/api/v1/sessions/${session.id}`)
  )
  expect(stable.blocks).toEqual(session.blocks)
  expect(stable.blocks[0].items[0].trackingFields).toEqual(["reps", "load"])
  const logged = {
    ...session,
    status: "completed" as const,
    results: session.results.map((result, index) => ({
      ...result,
      status: index < 2 ? ("unlogged" as const) : ("skipped" as const),
      reps: index < 2 ? 9 : null,
      load: index < 2 ? exercise.defaultLoad : null,
    })),
  }
  const committed = await json<SessionRecord>(
    await mutate(owner, "put", `/sessions/${session.id}`, {
      expectedRevision: session.revision,
      value: logged,
    })
  )
  expect(
    (
      await mutate(owner, "put", `/sessions/${session.id}`, {
        expectedRevision: session.revision,
        value: logged,
      })
    ).status()
  ).toBe(409)
  const ledger = await json<{ completedTotal: number; unloggedSets: number }>(
    await owner.get(`/api/v1/ledger?weekId=${week.id}`)
  )
  expect(ledger.completedTotal).toBe(2)
  expect(ledger.unloggedSets).toBe(0)
  const relational = await getPool().query(
    "SELECT count(*) FROM result_sets WHERE session_id = $1",
    [session.id]
  )
  expect(Number(relational.rows[0].count)).toBe(5)
  const history = await json<{ results: unknown[]; date: string }>(
    await owner.get(
      `/api/v1/history?exerciseId=${exercise.id}&before=2026-10-20`
    )
  )
  expect(history.date).toBe("2026-10-19")
  expect(history.results.length).toBeGreaterThanOrEqual(2)
  const duplicate = {
    ...committed,
    results: [
      ...committed.results,
      { ...committed.results[0], id: randomUUID() },
    ],
  }
  expect(
    (
      await mutate(owner, "put", `/sessions/${session.id}`, {
        expectedRevision: committed.revision,
        value: duplicate,
      })
    ).status()
  ).toBe(422)
  const copied = await json<WeekRecord>(
    await mutate(owner, "post", `/weeks/${week.id}/copy`, {
      startDate: "2026-10-26",
    })
  )
  expect(
    await json(await owner.get(`/api/v1/sessions?weekId=${copied.id}`))
  ).toEqual([])
  const keyResult = await json<{ key: string; info: { id: string } }>(
    await mutate(owner, "post", "/keys", {
      name: "QA read only",
      scopes: ["read"],
    })
  )
  const agent = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Authorization: `Bearer ${keyResult.key}` },
  })
  expect((await agent.get("/api/v1/weeks")).status()).toBe(200)
  expect(
    (
      await mutate(agent, "post", "/weeks", {
        value: { ...week, id: randomUUID() },
      })
    ).status()
  ).toBe(403)
  expect((await agent.get("/api/v1/keys")).status()).toBe(403)
  await json(await mutate(owner, "delete", `/keys/${keyResult.info.id}`))
  expect((await agent.get("/api/v1/weeks")).status()).toBe(401)
  await agent.dispose()
  const backup = await json(await owner.get("/api/v1/export"))
  const restored = await json<{ created: number; unchanged: number }>(
    await mutate(owner, "post", "/import", { manifest: backup })
  )
  expect(restored.created).toBe(0)
  expect(restored.unchanged).toBeGreaterThan(0)
  const csv = await owner.get("/api/v1/export?format=csv")
  expect(await csv.text()).toContain('"135","lb","total"')
})
