import { config } from "dotenv"
import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import { drizzle } from "drizzle-orm/node-postgres"
import { getPool, type Store } from "./db"
import * as schema from "./schema"
import { list, previousBatch } from "./repository"
import { computeLedger, findPrevious, startSession } from "./domain"
import { buildHybridExample } from "../examples/hybrid-hypertrophy"
import type {
  ExerciseRecord,
  SessionRecord,
  WeekRecord,
  WorkoutRecord,
} from "../contracts/models"

config({ path: ".env.local", quiet: true })
const enabled = process.env.RUN_DATABASE_TESTS === "1"

// Six weeks and 32 sessions, matching the scale of the investigated account.
// Only synthetic public example prescriptions are used, never a private export.
function fixture() {
  const publicExample = buildHybridExample()
  const weeks: WeekRecord[] = []
  const workouts: WorkoutRecord[] = []
  const sessions: SessionRecord[] = []
  for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
    const start = Date.UTC(2026, 0, 5 + weekIndex * 7)
    const date = (offset: number) =>
      new Date(start + offset * 86_400_000).toISOString().slice(0, 10)
    const week = {
      ...publicExample.weeks[0],
      id: randomUUID(),
      revision: 1,
      startDate: date(0),
    }
    weeks.push(week)
    publicExample.workouts.forEach((original, day) => {
      const workout = {
        ...structuredClone(original),
        id: randomUUID(),
        revision: 1,
        weekId: week.id,
        date: date(day),
      }
      workouts.push(workout)
      if (sessions.length >= 32) return
      const session = startSession(workout, date(day))
      session.revision = 1
      session.startedAt = `${date(day)}T18:00:00.000Z`
      session.results = session.blocks.flatMap((block) =>
        block.items.flatMap((item) =>
          item.sets.map((target) => ({
            id: randomUUID(),
            itemId: item.id,
            targetId: target.id,
            status: "completed" as const,
            reps: target.repsMin,
            load: target.load ? { ...target.load, value: 40 } : null,
            durationSeconds: target.durationSeconds,
            distanceMeters: target.distanceMeters,
            rir: target.rir,
            notes: "",
            source: null,
          }))
        )
      )
      sessions.push(session)
    })
  }
  return { weeks, workouts, sessions, exercises: publicExample.exercises }
}

async function seed(
  db: Store,
  ownerId: string,
  data: ReturnType<typeof fixture>
) {
  const envelope = <T extends { id: string; revision: number }>(value: T) => ({
    id: value.id,
    ownerId,
    revision: value.revision,
    data: value,
  })
  await db.insert(schema.weeks).values(data.weeks.map(envelope))
  await db.insert(schema.workouts).values(data.workouts.map(envelope))
  await db.insert(schema.sessions).values(data.sessions.map(envelope))
}

describe.skipIf(!enabled)("targeted reads against real PostgreSQL", () => {
  afterAll(async () => {
    await getPool().end()
  })
  async function rollback(
    run: (db: Store, bytes: () => number) => Promise<void>
  ) {
    const client = await getPool().connect()
    try {
      await client.query("BEGIN")
      const socket = (
        client as unknown as { connection: { stream: { bytesRead: number } } }
      ).connection.stream
      await run(drizzle(client, { schema }), () => socket.bytesRead)
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  }

  it("filters week and workout inside the database without changing the ledger", async () => {
    await rollback(async (db) => {
      const data = fixture(),
        owner = randomUUID()
      await seed(db, owner, data)
      const week = data.weeks.at(-1)!
      const workouts = await list(db, owner, "workouts", {
        weekId: week.id,
        kind: "planned",
      })
      const sessions = await list(db, owner, "sessions", { weekId: week.id })
      expect(workouts).toHaveLength(6)
      expect(sessions).toHaveLength(2)
      expect(computeLedger(week, workouts, sessions)).toEqual(
        computeLedger(week, data.workouts, data.sessions)
      )
      expect(
        await list(db, owner, "sessions", { workoutId: workouts[0].id })
      ).toEqual([sessions[0]])
      expect(
        await list(db, owner, "sessions", {
          workoutId: workouts[0].id,
          weekId: data.weeks[0].id,
        })
      ).toEqual([])
      expect(
        await list(db, randomUUID(), "sessions", { weekId: week.id })
      ).toEqual([])
    })
  })

  it("preserves exact identity, aliases, recency, active results and target order", async () => {
    await rollback(async (db) => {
      const data = fixture(),
        owner = randomUUID()
      const exercise = data.exercises[0]
      const source = data.sessions[0]
      const matchingItem = source.blocks
        .flatMap((block) => block.items)
        .find((item) => item.exerciseId === exercise.id)!
      const alias: ExerciseRecord = {
        ...exercise,
        id: randomUUID(),
        equipment: "Replacement",
        setup: "New setup",
        historyAliases: [
          {
            exerciseId: exercise.id,
            equipment: exercise.equipment,
            setup: exercise.setup,
          },
        ],
      }
      const latest = {
        ...structuredClone(source),
        id: randomUUID(),
        performedOn: "2026-02-20",
        startedAt: "2026-02-20T18:00:00.000Z",
        routineId: randomUUID(),
      }
      latest.results.reverse()
      const noResults = {
        ...structuredClone(latest),
        id: randomUUID(),
        performedOn: "2026-02-21",
        results: [],
      }
      const wrongSetup = {
        ...structuredClone(latest),
        id: randomUUID(),
        performedOn: "2026-02-22",
      }
      wrongSetup.blocks
        .flatMap((block) => block.items)
        .forEach((item) => {
          item.setup = "A different setup"
        })
      const sameDateLater = {
        ...structuredClone(latest),
        id: randomUUID(),
        startedAt: "2026-02-20T20:00:00.000Z",
      }
      const today = {
        ...structuredClone(latest),
        id: randomUUID(),
        performedOn: "2026-02-23",
      }
      data.sessions.push(latest, noResults, wrongSetup, sameDateLater, today)
      await seed(db, owner, data)
      const requested = [
        exercise,
        alias,
        ...data.exercises.slice(1),
        { ...exercise, id: randomUUID() },
      ]
      const actual = await previousBatch(
        db,
        owner,
        requested,
        source.routineId,
        "2026-02-23"
      )
      const expected = Object.fromEntries(
        requested.map((value) => [
          value.id,
          findPrevious(value, source.routineId, "2026-02-23", data.sessions),
        ])
      )
      expect(actual).toEqual(expected)
      expect(actual[exercise.id]?.sessionId).toBe(sameDateLater.id)
      expect(actual[exercise.id]?.results[0].targetId).toBe(
        matchingItem.sets[0].id
      )
      expect(actual[alias.id]).toEqual(actual[exercise.id])
      expect(
        await previousBatch(db, randomUUID(), [exercise], null, "2026-02-23")
      ).toEqual({ [exercise.id]: null })
      expect(await previousBatch(db, owner, [], null, "2026-02-23")).toEqual({})
    })
  })

  it("reduces PostgreSQL response bytes by at least 90% for save refresh and nine-movement history", async () => {
    await rollback(async (db, bytes) => {
      const data = fixture(),
        owner = randomUUID()
      await seed(db, owner, data)
      const week = data.weeks.at(-1)!
      const requested = data.exercises.slice(0, 9)
      const before = "2026-02-20"
      const measure = async (run: () => Promise<void>) => {
        const start = bytes()
        await run()
        return bytes() - start
      }
      // Former acknowledgement: bootstrap plus its ledger effect and refreshSync's
      // ledger. Ancillary catalog/week reads are omitted, making the baseline conservative.
      const oldSave = await measure(async () => {
        for (let pass = 0; pass < 3; pass++) {
          await list(db, owner, "workouts")
          await list(db, owner, "sessions")
        }
      })
      const newSave = await measure(async () => {
        await list(db, owner, "workouts", { weekId: week.id, kind: "planned" })
        await list(db, owner, "sessions", { weekId: week.id })
      })
      const oldHistory = await measure(async () => {
        for (const exercise of requested)
          findPrevious(
            exercise,
            null,
            before,
            await list(db, owner, "sessions")
          )
      })
      const newHistory = await measure(async () => {
        const selected = await previousBatch(db, owner, requested, null, before)
        for (const exercise of requested)
          expect(selected[exercise.id]).toEqual(
            findPrevious(exercise, null, before, data.sessions)
          )
      })
      expect(newSave / oldSave).toBeLessThanOrEqual(0.1)
      expect(newHistory / oldHistory).toBeLessThanOrEqual(0.1)
      console.info(
        JSON.stringify({
          postgresResponseBytes: { oldSave, newSave, oldHistory, newHistory },
          saveReduction: 1 - newSave / oldSave,
          historyReduction: 1 - newHistory / oldHistory,
        })
      )
    })
  })
})
