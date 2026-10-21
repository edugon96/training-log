import {
  test,
  expect,
  request,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signIn } from "./auth-helper"
import {
  defaultTargets,
  makeItem,
  type ExerciseRecord,
  type SessionRecord,
  type TrainingDefaultsRecord,
  type WeekRecord,
} from "../../contracts/models"

const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000"
let owner: APIRequestContext, ownerId: string
async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<T>
}
const write = (
  method: "post" | "put",
  path: string,
  data: unknown,
  key = randomUUID()
) =>
  owner[method](`/api/v1${path}`, { data, headers: { "Idempotency-Key": key } })
test.beforeAll(async () => {
  const email = `qa-training-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID()
  const created = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Training test" },
  })
  ownerId = created.user.id
  owner = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  })
  await json(await signIn(owner, email, password))
})
test.afterAll(async () => {
  await owner?.dispose()
  if (ownerId) {
    for (const table of [
      "training_defaults",
      "timer_settings",
      "result_sets",
      "workout_sessions",
      "workouts",
      "weeks",
      "exercises",
      "equipment",
      "audit_events",
      "mutation_receipts",
      "import_sources",
    ]) {
      await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
        ownerId,
      ])
    }
    await getPool().query('DELETE FROM "apikey" WHERE "referenceId" = $1', [
      ownerId,
    ])
    await getPool().query('DELETE FROM "user" WHERE id = $1', [ownerId])
  }
})
test("defaults are owner scoped, revisioned, idempotent and copied separately from historic targets", async () => {
  expect(await json(await owner.get("/api/v1/training-defaults"))).toEqual({
    revision: 0,
    targets: defaultTargets,
  })
  const source = await json<WeekRecord>(
    await write("post", "/weeks", {
      value: {
        id: randomUUID(),
        revision: 0,
        startDate: "2026-10-12",
        title: "Source",
        targets: { ...defaultTargets, chest: 8 },
        notes: "",
      },
    })
  )
  await json(
    await write("post", "/weeks", {
      value: {
        id: randomUUID(),
        revision: 0,
        startDate: "2026-10-19",
        title: "Latest",
        targets: { ...defaultTargets, chest: 10 },
        notes: "",
      },
    })
  )
  expect(
    (
      await json<TrainingDefaultsRecord>(
        await owner.get("/api/v1/training-defaults")
      )
    ).targets.chest
  ).toBe(10)
  expect(
    (
      await getPool().query(
        "SELECT count(*) FROM training_defaults WHERE owner_id=$1",
        [ownerId]
      )
    ).rows[0].count
  ).toBe("0")
  const fallbackCopy = await json<WeekRecord>(
    await write("post", `/weeks/${source.id}/copy`, { startDate: "2026-10-26" })
  )
  expect(fallbackCopy.targets.chest).toBe(10)
  const data = {
    expectedRevision: 0,
    value: { revision: 0, targets: { ...defaultTargets, chest: 12 } },
  }
  const key = randomUUID()
  const saved = await json<TrainingDefaultsRecord>(
    await write("put", "/training-defaults", data, key)
  )
  expect(saved.revision).toBe(1)
  expect(
    await json(await write("put", "/training-defaults", data, key))
  ).toEqual(saved)
  expect((await write("put", "/training-defaults", data)).status()).toBe(409)
  expect(
    (
      await json<WeekRecord>(
        await write("post", `/weeks/${source.id}/copy`, {
          startDate: "2026-11-02",
        })
      )
    ).targets.chest
  ).toBe(12)
  expect(
    (await json<WeekRecord>(await owner.get(`/api/v1/weeks/${source.id}`)))
      .targets.chest
  ).toBe(8)
  const originDenied = await owner.put("/api/v1/training-defaults", {
    data: { expectedRevision: 1, value: saved },
    headers: {
      Origin: "https://wrong.example",
      "Idempotency-Key": randomUUID(),
    },
  })
  expect(originDenied.status()).toBe(403)
  const keyResponse = await json<{ key: string }>(
    await write("post", "/keys", { name: "Read defaults", scopes: ["read"] })
  )
  const agent = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Authorization: `Bearer ${keyResponse.key}` },
  })
  expect((await agent.get("/api/v1/training-defaults")).status()).toBe(200)
  expect(
    (
      await agent.put("/api/v1/training-defaults", {
        data: { expectedRevision: 1, value: saved },
        headers: { "Idempotency-Key": randomUUID() },
      })
    ).status()
  ).toBe(403)
  await agent.dispose()
})
test("catalog validation and automatic session completion persist the same inferred actuals", async () => {
  const equipment = await json<{ id: string; type: string; brand: string }>(
    await write("post", "/equipment", {
      value: {
        id: randomUUID(),
        revision: 0,
        name: "Atlantis Test Machine",
        model: "P999",
        notes: "",
        startingResistance: null,
        archived: false,
      },
    })
  )
  expect(equipment).toMatchObject({ brand: "Atlantis", type: "machine" })
  const catalog = await json<{ brands: { name: string; models: string[] }[] }>(
    await owner.get("/api/v1/catalog")
  )
  expect(catalog.brands).toContainEqual({ name: "Atlantis", models: ["P999"] })
  const exercise: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "Test press",
    equipmentId: equipment.id,
    equipment: "Atlantis Test Machine",
    setup: "",
    primaryMuscle: "chest",
    secondaryMuscles: ["Triceps"],
    pattern: "Push",
    defaultRole: "lifting",
    defaultLoad: { value: 90, unit: "lb", basis: "total" },
    notes: "",
    archived: false,
  }
  const savedExercise = await json<ExerciseRecord>(
    await write("post", "/exercises", { value: exercise })
  )
  expect(savedExercise.pattern).toBe("push")
  expect(savedExercise.secondaryMuscles).toEqual(["triceps"])
  expect(
    (
      await write("post", "/exercises", {
        value: {
          ...exercise,
          id: randomUUID(),
          secondaryMuscles: ["imaginary"],
        },
      })
    ).status()
  ).toBe(422)
  const workout = await json<{ id: string }>(
    await write("post", "/workouts", {
      value: {
        id: randomUUID(),
        revision: 0,
        kind: "routine",
        routineId: null,
        weekId: null,
        date: null,
        title: "Auto test",
        focus: "",
        blocks: [
          {
            id: randomUUID(),
            title: "Press",
            kind: "straight",
            restSeconds: null,
            rounds: null,
            items: [makeItem(savedExercise, 2)],
            notes: "",
          },
        ],
        notes: "",
        source: null,
      },
    })
  )
  const started = await json<SessionRecord>(
    await write("post", `/workouts/${workout.id}/start`, {
      performedOn: "2026-10-20",
    })
  )
  expect(started.loggingMode).toBe("automatic")
  expect(started.blocks[0].items[0].trackingFields).toEqual(["reps", "load"])
  const partial = structuredClone(started)
  partial.results[0].reps = 8
  partial.results[0].load = { value: 90, unit: "lb", basis: "total" }
  let saved = await json<SessionRecord>(
    await write("put", `/sessions/${started.id}`, {
      expectedRevision: started.revision,
      value: partial,
    })
  )
  expect(saved.results[0].status).toBe("completed")
  expect(saved.results[1].status).toBe("unlogged")
  expect(
    (
      await write("put", `/sessions/${started.id}`, {
        expectedRevision: saved.revision,
        value: { ...saved, status: "completed" },
      })
    ).status()
  ).toBe(422)
  saved.results[1].status = "skipped"
  saved = await json<SessionRecord>(
    await write("put", `/sessions/${started.id}`, {
      expectedRevision: saved.revision,
      value: { ...saved, status: "completed" },
    })
  )
  const rows = await getPool().query(
    "SELECT status FROM result_sets WHERE session_id=$1 ORDER BY status",
    [started.id]
  )
  expect(rows.rows.map((r) => r.status)).toEqual(["completed", "skipped"])
  expect(saved.status).toBe("completed")
})
test("timer preferences are idempotent and revisioned with validation and audit", async () => {
  const initial = await json<{
    revision: number
    presets: number[]
    soundEnabled: boolean
    keepScreenAwake: boolean
  }>(await owner.get("/api/v1/timer-settings"))
  expect(initial.presets).toEqual([30, 60, 90, 120, 150, 180])
  const body = {
    expectedRevision: 0,
    value: { ...initial, presets: [45, 90], soundEnabled: false },
  }
  const key = randomUUID()
  const saved = await json(await write("put", "/timer-settings", body, key))
  expect(await json(await write("put", "/timer-settings", body, key))).toEqual(
    saved
  )
  expect((await write("put", "/timer-settings", body)).status()).toBe(409)
  expect(
    (
      await write("put", "/timer-settings", {
        expectedRevision: 1,
        value: { ...body.value, revision: 1, presets: [0] },
      })
    ).status()
  ).toBe(422)
  const events = await getPool().query(
    "SELECT count(*) FROM audit_events WHERE owner_id=$1 AND entity_type='timer_settings'",
    [ownerId]
  )
  expect(events.rows[0].count).toBe("1")
})
