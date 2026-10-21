import { z } from "zod"
import type { SessionRecord } from "@/contracts/models"

export const RestTimer = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  durationMs: z.number().int().positive(),
  status: z.enum(["idle", "running", "paused", "complete"]),
  deadline: z.number().finite().nullable(),
  remainingMs: z.number().nonnegative(),
  // Optional for timers stored before the dial was introduced.
  progressDurationMs: z.number().positive().optional(),
})
export type RestTimerState = z.infer<typeof RestTimer>
export function remainingMilliseconds(timer: RestTimerState, now: number) {
  return timer.status === "running" && timer.deadline !== null
    ? Math.max(0, Math.min(timer.remainingMs, timer.deadline - now))
    : timer.status === "complete"
      ? 0
      : timer.remainingMs
}
export function startRest(
  seconds: number,
  now: number,
  sessionId: string | null
): RestTimerState {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
    throw new Error("Choose 1 second to 60 minutes")
  return {
    id: crypto.randomUUID(),
    sessionId,
    durationMs: seconds * 1000,
    status: "running",
    deadline: now + seconds * 1000,
    remainingMs: seconds * 1000,
    progressDurationMs: seconds * 1000,
  }
}
export function pauseRest(timer: RestTimerState, now: number): RestTimerState {
  const remainingMs = remainingMilliseconds(timer, now)
  return {
    ...timer,
    status: remainingMs ? "paused" : "complete",
    deadline: null,
    remainingMs,
  }
}
export function resumeRest(timer: RestTimerState, now: number): RestTimerState {
  return {
    ...timer,
    status: timer.remainingMs ? "running" : "complete",
    deadline: timer.remainingMs ? now + timer.remainingMs : null,
  }
}
export function extendRest(timer: RestTimerState, now: number): RestTimerState {
  const remainingMs = remainingMilliseconds(timer, now) + 30_000
  const stopped = timer.status === "paused" || timer.status === "idle"
  return {
    ...timer,
    status: stopped ? "paused" : "running",
    deadline: stopped ? null : now + remainingMs,
    remainingMs,
    progressDurationMs: (timer.progressDurationMs ?? timer.durationMs) + 30_000,
  }
}
export function resetRest(timer: RestTimerState): RestTimerState {
  return {
    ...timer,
    id: crypto.randomUUID(),
    status: "idle",
    deadline: null,
    remainingMs: 0,
    progressDurationMs: timer.durationMs,
  }
}
type WorkoutTime = Pick<
  SessionRecord,
  "startedAt" | "finishedAt" | "status" | "timerPausedAt" | "pausedDurationMs"
>
export function elapsedMilliseconds(
  session: WorkoutTime,
  now: number
): number | null {
  if (
    !session.startedAt ||
    (session.status === "completed" && !session.finishedAt)
  )
    return null
  const start = Date.parse(session.startedAt)
  const end = session.finishedAt
    ? Date.parse(session.finishedAt)
    : session.timerPausedAt
      ? Date.parse(session.timerPausedAt)
      : now
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.max(0, end - start - (session.pausedDurationMs ?? 0))
    : null
}
export function settleWorkoutPause(session: WorkoutTime, now: number) {
  return {
    timerPausedAt: null,
    pausedDurationMs:
      (session.pausedDurationMs ?? 0) +
      (session.timerPausedAt
        ? Math.max(0, now - Date.parse(session.timerPausedAt))
        : 0),
  }
}
export function changeWorkoutTimer(
  session: WorkoutTime,
  action: "start" | "pause" | "resume" | "reset" | "clear",
  now: number
): WorkoutTime {
  if (session.status !== "active") return session
  if (action === "reset" || action === "clear")
    return {
      ...session,
      startedAt: null,
      finishedAt: null,
      timerPausedAt: null,
      pausedDurationMs: 0,
    }
  if (action === "start")
    return session.startedAt
      ? session
      : {
          ...session,
          startedAt: new Date(now).toISOString(),
          finishedAt: null,
          timerPausedAt: null,
          pausedDurationMs: 0,
        }
  if (!session.startedAt) return session
  if (action === "pause")
    return session.timerPausedAt
      ? session
      : { ...session, timerPausedAt: new Date(now).toISOString() }
  return { ...session, ...settleWorkoutPause(session, now) }
}
export function clockLabel(
  milliseconds: number,
  direction: "down" | "up" = "down"
) {
  const seconds = Math.max(
    0,
    (direction === "down" ? Math.ceil : Math.floor)(milliseconds / 1000)
  )
  const hours = Math.floor(seconds / 3600)
  return `${hours ? `${hours}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(hours ? 2 : 1, "0")}:${String(seconds % 60).padStart(2, "0")}`
}
