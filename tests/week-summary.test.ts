import { describe, expect, it } from "vitest"
import {
  preferredWeek,
  greetingForHour,
  summarizeWeek,
  trainingTimeLabel,
  workoutSession,
} from "../lib/week-summary"
import {
  defaultTargets,
  type WeekRecord,
  type WorkoutRecord,
  type SessionRecord,
} from "../contracts/models"

const weeks: WeekRecord[] = ["2026-10-26", "2026-10-19", "2026-10-12"].map(
  (startDate) => ({
    id: startDate,
    revision: 1,
    startDate,
    title: "Week",
    targets: defaultTargets,
    notes: "",
  })
)
const workout: WorkoutRecord = {
  id: "workout",
  revision: 1,
  kind: "planned",
  weekId: weeks[1].id,
  routineId: null,
  date: "2026-10-20",
  title: "Training",
  focus: "",
  blocks: [],
  notes: "",
  source: null,
}
const session: SessionRecord = {
  id: "session",
  revision: 1,
  workoutId: workout.id,
  routineId: null,
  weekId: workout.weekId,
  performedOn: "2026-10-20",
  title: "Training",
  status: "completed",
  blocks: [],
  results: [],
  notes: "",
  source: null,
  startedAt: "2026-10-20T12:00:00Z",
  finishedAt: "2026-10-20T13:30:00Z",
  pausedDurationMs: 30 * 60_000,
}

describe("weekly home summary", () => {
  it("uses morning, afternoon and evening at the local-hour boundaries", () => {
    for (const hour of [0, 4, 18, 23])
      expect(greetingForHour(hour)).toBe("Good evening")
    for (const hour of [5, 11])
      expect(greetingForHour(hour)).toBe("Good morning")
    for (const hour of [12, 17])
      expect(greetingForHour(hour)).toBe("Good afternoon")
  })
  it("prefers explicit selection, then the current week, then latest", () => {
    expect(preferredWeek(weeks, weeks[2].id, "2026-10-20")).toBe(weeks[2].id)
    expect(preferredWeek(weeks, "", "2026-10-20")).toBe(weeks[1].id)
    expect(preferredWeek(weeks, "missing", "2026-11-20")).toBe(weeks[0].id)
    expect(preferredWeek([], "", "2026-10-20")).toBe("")
  })
  it("counts distinct planned workouts, excludes active duration and subtracts pauses", () => {
    const active = {
      ...session,
      id: "active",
      status: "active" as const,
      finishedAt: null,
    }
    const result = summarizeWeek(
      weeks[1].id,
      [workout],
      [
        session,
        { ...session, id: "repeat" },
        active,
        { ...session, weekId: "elsewhere" },
      ]
    )
    expect(result).toMatchObject({
      planned: 1,
      completed: 1,
      durationMs: 120 * 60_000,
      missingTimes: 0,
    })
    expect(workoutSession(workout.id, [session, active])).toBe(active)
  })
  it("preserves unknown and partial historical time coverage", () => {
    const unknown = {
      ...session,
      id: "unknown",
      startedAt: null,
      finishedAt: null,
    }
    expect(summarizeWeek(weeks[1].id, [workout], [unknown])).toMatchObject({
      durationMs: null,
      missingTimes: 1,
      timedSessions: 0,
    })
    expect(
      summarizeWeek(weeks[1].id, [workout], [session, unknown])
    ).toMatchObject({
      durationMs: 3_600_000,
      missingTimes: 1,
      timedSessions: 1,
    })
    expect(summarizeWeek("empty", [], [])).toMatchObject({
      planned: 0,
      completed: 0,
      durationMs: 0,
    })
    expect(trainingTimeLabel(null)).toBe("—")
    expect(trainingTimeLabel(1000)).toBe("<1m")
    expect(trainingTimeLabel(5_400_000)).toBe("1h 30m")
  })
})
