import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { parse } from "dotenv"
import { changeWorkoutTimer, elapsedMilliseconds, settleWorkoutPause } from "../lib/timers"
import { workoutDraft } from "../lib/workout-draft"
import {
  defaultTargets,
  makeItem,
  type ExerciseRecord,
  type SessionRecord,
} from "../contracts/models"

// Explicitly opt into disposable test writes after inspecting the linked deployment.
if (!process.argv.includes("--allow-test-writes") || !process.env.VERIFY_ENV_FILE)
  throw new Error("VERIFY_ENV_FILE and --allow-test-writes are required")
const local = parse(await readFile(process.env.VERIFY_OWNER_ENV_FILE || ".env.local"))
const cloud = parse(await readFile(process.env.VERIFY_ENV_FILE))
const deployment = process.argv[2]
const project = process.env.VERIFY_PROJECT
const team = process.env.VERIFY_TEAM
if (
  !project || !team || !deployment ||
  new URL(deployment).origin !== deployment ||
  !deployment.startsWith(`https://${project}-`) ||
  !deployment.endsWith(".vercel.app") ||
  !cloud.DATABASE_URL || !cloud.BETTER_AUTH_URL ||
  new URL(cloud.DATABASE_URL).hostname !== process.env.VERIFY_DATABASE_HOST
)
  throw new Error("Explicit matching project, team, database host and production environment required")
const origin = new URL(cloud.BETTER_AUTH_URL).origin
Object.assign(process.env, {
  DATABASE_URL: cloud.DATABASE_URL,
  // Only provisions the disposable account locally. All login checks use the
  // deployed authentication service. Never pull or substitute its signing key.
  BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
  BETTER_AUTH_URL: origin,
})
const { getPool } = await import("../server/db")
const { authOptions } = await import("../server/auth")
const { betterAuth } = await import("better-auth")
let disposableOwner: string | undefined
let cookie = ""
function request(path: string, method = "GET", value?: unknown) {
  const lines = [
    "silent",
    "show-error",
    "include",
    `request = ${JSON.stringify(method)}`,
    `header = ${JSON.stringify(`Origin: ${origin}`)}`,
  ]
  if (cookie) lines.push(`header = ${JSON.stringify(`Cookie: ${cookie}`)}`)
  if (value !== undefined)
    lines.push(
      `header = "Content-Type: application/json"`,
      `header = "Idempotency-Key: ${randomUUID()}"`,
      `data = ${JSON.stringify(JSON.stringify(value))}`
    )
  const raw = execFileSync(
    "npx",
    [
      "--yes",
      "vercel@64.7.0",
      "curl",
      path,
      "--deployment",
      deployment,
      "--scope",
      team!,
      "--",
      "--config",
      "-",
    ],
    {
      input: lines.join("\n"),
      encoding: "utf8",
      maxBuffer: 10_000_000,
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  const status = Number(raw.match(/HTTP\/[\d.]+ (\d+)/)?.[1])
  const body = raw.slice(raw.indexOf("\r\n\r\n") + 4)
  const newCookie = [...raw.matchAll(/^set-cookie: ([^;\r\n]+)/gim)]
    .map((match) => match[1])
    .filter((value) => value.includes("better-auth"))
  if (newCookie.length) cookie = newCookie.join("; ")
  return { status, body }
}
function success(path: string, method = "GET", value?: unknown) {
  const response = request(path, method, value)
  if (response.status < 200 || response.status >= 300)
    throw new Error(`${method} ${path} failed (${response.status})`)
  return JSON.parse(response.body)
}
try {
  if (request("/api/v1/sessions").status !== 401)
    throw new Error("Anonymous sessions must be rejected")
  success("/api/auth/sign-in/email", "POST", {
    email: local.OWNER_EMAIL,
    password: local.OWNER_PASSWORD,
  })
  const counts: Record<string, number> = {}
  for (const resource of [
    "equipment",
    "exercises",
    "weeks",
    "workouts",
    "sessions",
  ])
    counts[resource] = success(`/api/v1/${resource}`).length
  console.log(JSON.stringify({ existingLogin: "passed", existingData: counts }))
  const ownerCookie = cookie
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
  const originalData = digest(success("/api/v1/export"))
  const email = `deployment-check-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const created = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Disposable Deployment Check" },
  })
  disposableOwner = created.user.id
  cookie = ""
  success("/api/auth/sign-in/email", "POST", { email, password })
  if (success("/api/v1/sessions").length !== 0)
    throw new Error("Owner isolation failed")
  if (process.argv.includes("--timers")) {
    const settings = success("/api/v1/timer-settings")
    const updated = success("/api/v1/timer-settings", "PUT", {
      expectedRevision: settings.revision,
      value: { ...settings, presets: [30, 90, 120], soundEnabled: false },
    })
    if (
      updated.revision !== 1 ||
      success("/api/v1/timer-settings").presets.length !== 3
    )
      throw new Error("Timer settings did not persist")
    if (
      request("/api/v1/timer-settings", "PUT", {
        expectedRevision: 0,
        value: settings,
      }).status !== 409
    )
      throw new Error("Stale timer settings were not rejected")
    if (!success("/api/v1/export").timerSettings)
      throw new Error("Timer settings missing from backup")
    console.log("Production timer settings, conflict checks and export passed.")
  }
  const exercise: ExerciseRecord = {
    id: randomUUID(),
    revision: 0,
    name: "Deployment Check Press",
    equipmentId: null,
    equipment: "Dumbbell",
    setup: "",
    primaryMuscle: "chest",
    secondaryMuscles: [],
    pattern: "push",
    defaultRole: "lifting",
    defaultLoad: { value: 20, unit: "kg", basis: "per_hand" },
    trackingFields: ["reps", "load"],
    notes: "",
    archived: false,
  }
  success("/api/v1/exercises", "POST", { value: exercise })
  const week = success("/api/v1/weeks", "POST", {
    value: {
      id: randomUUID(),
      revision: 0,
      startDate: "2026-10-19",
      title: "Disposable verification",
      targets: defaultTargets,
      notes: "",
    },
  })
  const item = makeItem(exercise, 1)
  const workout = success("/api/v1/workouts", "POST", {
    value: {
      id: randomUUID(),
      revision: 0,
      kind: "planned",
      routineId: null,
      weekId: week.id,
      date: "2026-10-20",
      title: "Disposable verification",
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
          items: [item],
          notes: "",
        },
      ],
    },
  })
  // Match the current web client. The legacy /start endpoint starts its clock.
  let session: SessionRecord = success("/api/v1/sessions", "POST", {
    value: workoutDraft(workout),
  })
  session.results = [
    {
      id: randomUUID(),
      itemId: item.id,
      targetId: item.sets[0].id,
      status: "completed",
      reps: 8,
      load: exercise.defaultLoad,
      rir: 2,
      durationSeconds: null,
      distanceMeters: null,
      notes: "",
      source: null,
    },
  ]
  if (process.argv.includes("--timers")) {
    function saveTimer(action: "start" | "pause" | "resume" | "reset") {
      session = success(`/api/v1/sessions/${session.id}`, "PUT", {
        expectedRevision: session.revision,
        value: { ...session, ...changeWorkoutTimer(session, action, Date.now()) },
      })
      return success(`/api/v1/sessions/${session.id}`) as SessionRecord
    }
    if (session.startedAt) throw new Error("New workout clock must be idle")
    if (!saveTimer("start").startedAt) throw new Error("Manual start did not persist")
    if (!saveTimer("pause").timerPausedAt) throw new Error("Workout pause did not persist")
    if (!(saveTimer("resume").pausedDurationMs! > 0)) throw new Error("Workout resume lost paused time")
    const reset = saveTimer("reset")
    if (reset.startedAt || reset.finishedAt || reset.timerPausedAt || reset.pausedDurationMs !== 0 || reset.results[0]?.reps !== 8)
      throw new Error("Workout reset changed results or retained paused time")
    saveTimer("start")
    saveTimer("pause")
  }
  session.status = "completed"
  const finish = Date.now()
  session.finishedAt = session.startedAt ? new Date(finish).toISOString() : null
  Object.assign(session, settleWorkoutPause(session, finish))
  success(`/api/v1/sessions/${session.id}`, "PUT", {
    expectedRevision: session.revision,
    value: session,
  })
  const saved = success(`/api/v1/sessions/${session.id}`)
  if (saved.status !== "completed" || saved.results[0]?.reps !== 8)
    throw new Error("Saved workout did not persist")
  const catalog = success(`/api/v1/exercises/${exercise.id}`)
  success(`/api/v1/exercises/${exercise.id}`, "PUT", {
    expectedRevision: catalog.revision,
    value: { ...catalog, setup: "Verified corrected setup", historyAliases: [
      { exerciseId: catalog.id, equipment: catalog.equipment, setup: catalog.setup },
    ] },
  })
  const previous = success(`/api/v1/history?exerciseId=${exercise.id}&before=2099-01-01`)
  if (previous?.results[0]?.reps !== 8 || JSON.stringify(success(`/api/v1/sessions/${session.id}`)) !== JSON.stringify(saved))
    throw new Error("Catalog correction lost history or changed its snapshot")
  console.log("Production catalog alias preserves previous performance and session snapshot.")
  const stored = await getPool().query(
    "SELECT data FROM workout_sessions WHERE id = $1 AND owner_id = $2",
    [session.id, disposableOwner]
  )
  if (stored.rows[0]?.data.results[0]?.reps !== 8)
    throw new Error("Database verification failed")
  if (process.argv.includes("--timers")) {
    if (stored.rows[0]?.data.pausedDurationMs !== session.pausedDurationMs || saved.timerPausedAt !== null)
      throw new Error("Workout pause duration failed database read-back")
    const exported = success("/api/v1/export").sessions.find((row: SessionRecord) => row.id === session.id)
    if (exported?.pausedDurationMs !== session.pausedDurationMs || elapsedMilliseconds(saved, finish) === null)
      throw new Error("Workout timing failed backup verification")
    console.log("Production workout pause, resume, reset, finish and backup verification passed.")
  }
  console.log(
    "Production API → database → read-back passed, including isolated start, log and finish."
  )
  cookie = ownerCookie
  if (digest(success("/api/v1/export")) !== originalData)
    throw new Error("Existing owner data changed during verification. Inspect before promotion.")
  console.log("Existing owner export is unchanged.")
} finally {
  if (disposableOwner) {
    for (const table of [
      "result_sets",
      "workout_sessions",
      "workouts",
      "weeks",
      "training_defaults",
      ...(process.argv.includes("--timers") ? ["timer_settings"] : []),
      "exercises",
      "equipment",
      "audit_events",
      "mutation_receipts",
      "import_sources",
    ])
      await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [
        disposableOwner,
      ])
    await getPool().query('DELETE FROM "user" WHERE id = $1', [disposableOwner])
    console.log(
      "Removed only the disposable verification account and its test records."
    )
  }
  await getPool().end()
}
