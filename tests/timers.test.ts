import { describe, expect, it } from "vitest"
import {
  changeWorkoutTimer,
  settleWorkoutPause,
  clockLabel,
  elapsedMilliseconds,
  extendRest,
  pauseRest,
  remainingMilliseconds,
  RestTimer,
  resumeRest,
  resetRest,
  startRest,
} from "../lib/timers"

describe("deadline-based rest timers", () => {
  it("survives delayed ticks, storage round trips and background elapsed time", () => {
    const timer = RestTimer.parse(
      JSON.parse(JSON.stringify(startRest(90, 1000, "session")))
    )
    expect(remainingMilliseconds(timer, 31_000)).toBe(60_000)
    expect(remainingMilliseconds(timer, 999_999)).toBe(0)
    expect(timer.sessionId).toBe("session")
  })
  it("pauses, resumes and extends without counting paused time", () => {
    const timer = pauseRest(startRest(90, 1000, null), 31_000)
    expect(remainingMilliseconds(timer, 500_000)).toBe(60_000)
    const resumed = resumeRest(timer, 500_000)
    expect(remainingMilliseconds(resumed, 510_000)).toBe(50_000)
    expect(remainingMilliseconds(extendRest(resumed, 510_000), 510_000)).toBe(
      80_000
    )
    expect(extendRest(timer, 500_000).status).toBe("paused")
  })
  it("validates custom timers and formats long durations", () => {
    for (const seconds of [0, -1, 3601, 1.5, NaN])
      expect(() => startRest(seconds, 0, null)).toThrow()
    expect(clockLabel(3_661_000)).toBe("1:01:01")
    expect(clockLabel(89_500)).toBe("1:30")
    expect(clockLabel(0)).toBe("0:00")
    expect(clockLabel(89_500, "up")).toBe("1:29")
    expect(clockLabel(900, "up")).toBe("0:00")
  })
  it("does not add a phantom second when a display snapshot precedes an action", () => {
    const timer = startRest(90, 1073, null)
    expect(clockLabel(remainingMilliseconds(timer, 1000))).toBe("1:30")
    const resumed = resumeRest(pauseRest(timer, 4073), 10073)
    expect(clockLabel(remainingMilliseconds(resumed, 10000))).toBe("1:27")
  })
  it("extends the dial reference without changing reset duration", () => {
    const timer = startRest(60, 1000, null)
    const paused = pauseRest(timer, 11000)
    expect(paused.progressDurationMs).toBe(60000)
    const extended = extendRest(paused, 11000)
    expect(extended.remainingMs).toBe(80000)
    expect(extended.progressDurationMs).toBe(90000)
    expect(extended.durationMs).toBe(60000)
    const legacy = RestTimer.parse({ ...timer, progressDurationMs: undefined })
    expect(extendRest(legacy, 11000).progressDurationMs).toBe(90000)
  })
  it("resets to zero and stays stopped after storage restoration", () => {
    const timer = startRest(90, 1000, "session")
    const reset = RestTimer.parse(JSON.parse(JSON.stringify(resetRest(timer))))
    expect(reset.id).not.toBe(timer.id)
    expect(reset.status).toBe("idle")
    expect(reset.deadline).toBeNull()
    expect(remainingMilliseconds(reset, 999999)).toBe(0)
    expect(reset.durationMs).toBe(90000)
    expect(extendRest(reset, 2000).remainingMs).toBe(30000)
    expect(extendRest(reset, 2000).status).toBe("paused")
  })
})
describe("workout duration", () => {
  const startedAt = "2026-10-20T12:00:00.000Z"
  it("includes rests and stops at the recorded finish", () => {
    expect(
      elapsedMilliseconds(
        { startedAt, finishedAt: null, status: "active" },
        Date.parse("2026-10-20T14:00:00Z")
      )
    ).toBe(7_200_000)
    expect(
      elapsedMilliseconds(
        { startedAt, finishedAt: "2026-10-20T13:00:00Z", status: "completed" },
        Date.parse("2026-10-22T12:00:00Z")
      )
    ).toBe(3_600_000)
  })
  it("does not invent unknown historical times or negative durations", () => {
    expect(
      elapsedMilliseconds(
        { startedAt: null, finishedAt: null, status: "completed" },
        Date.now()
      )
    ).toBeNull()
    expect(
      elapsedMilliseconds(
        { startedAt, finishedAt: null, status: "completed" },
        Date.now()
      )
    ).toBeNull()
    expect(
      elapsedMilliseconds(
        { startedAt, finishedAt: "2026-10-20T11:00:00Z", status: "completed" },
        Date.now()
      )
    ).toBeNull()
  })
  it("freezes during pauses, resumes without a jump and accumulates multiple pauses", () => {
    const base = Date.parse(startedAt)
    const active = { startedAt, finishedAt: null, status: "active" as const }
    const paused = changeWorkoutTimer(active, "pause", base + 60_000)
    expect(elapsedMilliseconds(paused, base + 3_600_000)).toBe(60_000)
    const resumed = changeWorkoutTimer(paused, "resume", base + 120_000)
    expect(elapsedMilliseconds(resumed, base + 120_000)).toBe(60_000)
    const pausedAgain = changeWorkoutTimer(resumed, "pause", base + 180_000)
    const done = {
      ...pausedAgain,
      ...settleWorkoutPause(pausedAgain, base + 240_000),
      status: "completed" as const,
      finishedAt: new Date(base + 240_000).toISOString(),
    }
    expect(done.pausedDurationMs).toBe(120_000)
    expect(elapsedMilliseconds(done, base + 999_999)).toBe(120_000)
  })
  it("resets to idle and only starts on explicit start", () => {
    const base = Date.parse(startedAt)
    const paused = {
      startedAt,
      finishedAt: null,
      status: "active" as const,
      timerPausedAt: new Date(base + 90_000).toISOString(),
      pausedDurationMs: 10_000,
    }
    const reset = changeWorkoutTimer(paused, "reset", base + 120_000)
    expect(elapsedMilliseconds(reset, base + 120_000)).toBeNull()
    expect(elapsedMilliseconds(reset, base + 130_000)).toBeNull()
    expect(changeWorkoutTimer(reset, "pause", base)).toBe(reset)
    expect(changeWorkoutTimer(reset, "resume", base)).toBe(reset)
    const manual = changeWorkoutTimer(reset, "start", base + 120_000)
    expect(elapsedMilliseconds(manual, base + 130_000)).toBe(10_000)
    expect(changeWorkoutTimer(manual, "start", base + 130_000)).toBe(manual)
    expect(reset.timerPausedAt).toBeNull()
    expect(reset.pausedDurationMs).toBe(0)
    expect(changeWorkoutTimer(paused, "clear", base).startedAt).toBeNull()
    expect(paused.startedAt).toBe(startedAt)
    const finished = {
      ...paused,
      status: "completed" as const,
      finishedAt: startedAt,
    }
    expect(changeWorkoutTimer(finished, "reset", base)).toBe(finished)
  })
})
