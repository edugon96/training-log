import { test, expect, request, type APIRequestContext } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signIn } from "./auth-helper"
import {
  defaultTargets,
  defaultTimerSettings,
  type ImportData,
  type SessionRecord,
  type WeekRecord,
} from "../../contracts/models"

const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
const owners: string[] = []
const contexts: APIRequestContext[] = []
let owner: APIRequestContext, other: APIRequestContext
async function account() {
  const email = `qa-security-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const result = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Security test" },
  })
  owners.push(result.user.id)
  const ctx = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  })
  contexts.push(ctx)
  const response = await signIn(ctx, email, password)
  expect(response.ok(), await response.text()).toBe(true)
  return ctx
}
const write = (
  ctx: APIRequestContext,
  method: "post" | "put" | "delete",
  path: string,
  data?: unknown
) =>
  ctx[method](`/api/v1${path}`, {
    data,
    headers: { "Idempotency-Key": randomUUID() },
  })
async function key(scopes: string[]) {
  const response = await write(owner, "post", "/keys", {
    name: "Scope test",
    scopes,
  })
  expect(response.ok(), await response.text()).toBe(true)
  const result = (await response.json()) as {
    key: string
    info: { id: string }
  }
  const ctx = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Authorization: `Bearer ${result.key}` },
  })
  contexts.push(ctx)
  return { ctx, ...result }
}
test.beforeAll(async () => {
  owner = await account()
  other = await account()
})
test.afterAll(async () => {
  for (const ctx of contexts) await ctx.dispose()
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
      "timer_settings",
    ]) {
      await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [id])
    }
    await getPool().query('DELETE FROM "apikey" WHERE "referenceId" = $1', [id])
    await getPool().query('DELETE FROM "user" WHERE id = $1', [id])
  }
})
test("each write scope is independent, agent keys cannot manage credentials", async () => {
  const plan = await key(["plans:write"])
  const results = await key(["results:write"])
  const library = await key(["library:write"])
  const equipment = {
    id: randomUUID(),
    revision: 0,
    name: "Scope test",
    model: "",
    notes: "",
    startingResistance: null,
    archived: false,
  }
  const week: WeekRecord = {
    id: randomUUID(),
    revision: 0,
    startDate: "2026-10-19",
    title: "Scope test",
    targets: defaultTargets,
    notes: "",
  }
  const session: SessionRecord = {
    id: randomUUID(),
    revision: 0,
    workoutId: null,
    routineId: null,
    weekId: null,
    performedOn: "2026-10-19",
    title: "Scope test",
    status: "active",
    blocks: [],
    results: [],
    notes: "",
    source: null,
    startedAt: null,
    finishedAt: null,
  }
  expect(
    (
      await write(library.ctx, "post", "/equipment", { value: equipment })
    ).status()
  ).toBe(201)
  expect(
    (await write(plan.ctx, "post", "/weeks", { value: week })).status()
  ).toBe(201)
  expect(
    (await write(results.ctx, "post", "/sessions", { value: session })).status()
  ).toBe(201)
  const timerInput = { expectedRevision: 0, value: defaultTimerSettings }
  expect(
    (await write(results.ctx, "put", "/timer-settings", timerInput)).status()
  ).toBe(403)
  expect(
    (await write(library.ctx, "put", "/timer-settings", timerInput)).status()
  ).toBe(403)
  expect(
    (await write(plan.ctx, "put", "/timer-settings", timerInput)).status()
  ).toBe(200)
  expect((await plan.ctx.get("/api/v1/timer-settings")).status()).toBe(403)
  for (const [ctx, path, value] of [
    [plan.ctx, "/equipment", equipment],
    [results.ctx, "/equipment", equipment],
    [library.ctx, "/weeks", week],
    [results.ctx, "/weeks", week],
    [library.ctx, "/sessions", session],
    [plan.ctx, "/sessions", session],
  ] as const) {
    expect(
      (
        await write(ctx, "post", path, {
          value: { ...value, id: randomUUID() },
        })
      ).status()
    ).toBe(403)
  }
  for (const agent of [plan, results, library]) {
    expect((await agent.ctx.get("/api/v1/weeks")).status()).toBe(403)
    expect(
      (
        await write(agent.ctx, "post", "/keys", {
          name: "Escalate",
          scopes: ["read", "plans:write"],
        })
      ).status()
    ).toBe(403)
    expect(
      (await write(agent.ctx, "post", "/import", { manifest: {} })).status()
    ).toBe(403)
  }
})
test("a different owner cannot revoke a key, and denied request leaves it usable", async () => {
  const agent = await key(["read"])
  const denied = await write(other, "delete", `/keys/${agent.info.id}`)
  expect([400, 403, 404]).toContain(denied.status())
  expect((await agent.ctx.get("/api/v1/weeks")).status()).toBe(200)
  expect((await agent.ctx.get("/api/v1/timer-settings")).status()).toBe(200)
  expect(
    (
      await write(agent.ctx, "put", "/timer-settings", {
        expectedRevision: 1,
        value: { ...defaultTimerSettings, revision: 1 },
      })
    ).status()
  ).toBe(403)
  const changes = await other.get("/api/v1/changes")
  expect(await changes.json()).toEqual([])
})
test("profile changes require a browser session, trusted origin and name-only input", async () => {
  const anonymous = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  })
  try {
    expect(
      (
        await anonymous.post("/api/auth/update-user", {
          data: { name: "Anonymous" },
        })
      ).status()
    ).toBe(401)
  } finally {
    await anonymous.dispose()
  }
  const before = await (await owner.get("/api/v1/me")).json()
  const otherBefore = await (await other.get("/api/v1/me")).json()
  expect(
    (
      await owner.post("/api/auth/update-user", {
        headers: { Origin: "https://untrusted.example" },
        data: { name: "Blocked" },
      })
    ).status()
  ).toBe(403)
  for (const data of [
    { name: "" },
    { name: "   " },
    { name: "x".repeat(201) },
    { name: "Name", email: "changed@example.test" },
  ]) {
    expect((await owner.post("/api/auth/update-user", { data })).status()).toBe(
      400
    )
  }
  expect(
    (
      await owner.post("/api/auth/update-user", {
        data: { name: "  Updated name  " },
      })
    ).status()
  ).toBe(200)
  const after = await (await owner.get("/api/v1/me")).json()
  expect(after.name).toBe("Updated name")
  expect(after.email).toBe(before.email)
  expect((await (await other.get("/api/v1/me")).json()).name).toBe(
    otherBefore.name
  )
})
test("late import failure rolls back earlier records, audit events and receipt", async () => {
  const id = randomUUID(),
    receipt = randomUUID()
  const beforeAudit = await getPool().query(
    "SELECT count(*) FROM audit_events WHERE owner_id=$1",
    [owners[0]]
  )
  const manifest: ImportData = {
    version: 1,
    sources: [],
    equipment: [
      {
        id,
        revision: 0,
        name: "Must roll back",
        model: "",
        notes: "",
        startingResistance: null,
        archived: false,
      },
    ],
    exercises: [
      {
        id: randomUUID(),
        revision: 0,
        name: "Bad reference",
        equipmentId: randomUUID(),
        equipment: "",
        setup: "",
        primaryMuscle: "chest",
        secondaryMuscles: [],
        pattern: "",
        defaultRole: "lifting",
        defaultLoad: null,
        notes: "",
        archived: false,
      },
    ],
    weeks: [],
    workouts: [],
    sessions: [],
  }
  const failed = await owner.post("/api/v1/import", {
    data: { manifest },
    headers: { "Idempotency-Key": receipt },
  })
  expect(failed.status()).toBe(404)
  expect((await owner.get(`/api/v1/equipment/${id}`)).status()).toBe(404)
  const afterAudit = await getPool().query(
    "SELECT count(*) FROM audit_events WHERE owner_id=$1",
    [owners[0]]
  )
  expect(afterAudit.rows[0].count).toBe(beforeAudit.rows[0].count)
  const receipts = await getPool().query(
    "SELECT count(*) FROM mutation_receipts WHERE owner_id=$1 AND key=$2",
    [owners[0], receipt]
  )
  expect(receipts.rows[0].count).toBe("0")
})
