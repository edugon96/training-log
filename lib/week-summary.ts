import type {
  SessionRecord,
  WeekRecord,
  WorkoutRecord,
} from "@/contracts/models"
import { elapsedMilliseconds } from "./timers"

export function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning"
  if (hour >= 12 && hour < 18) return "Good afternoon"
  return "Good evening"
}

export function preferredWeek(
  weeks: WeekRecord[],
  requested: string,
  today: string
) {
  if (weeks.some((week) => week.id === requested)) return requested
  const sorted = [...weeks].sort((a, b) =>
    b.startDate.localeCompare(a.startDate)
  )
  const current = sorted.find((week) => {
    const end = new Date(`${week.startDate}T12:00:00`)
    end.setDate(end.getDate() + 6)
    const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
    return week.startDate <= today && today <= endDate
  })
  return current?.id ?? sorted[0]?.id ?? ""
}

export function summarizeWeek(
  weekId: string,
  workouts: WorkoutRecord[],
  sessions: SessionRecord[]
) {
  const plans = workouts.filter(
    (workout) => workout.kind === "planned" && workout.weekId === weekId
  )
  const planIds = new Set(plans.map((workout) => workout.id))
  const completed = sessions.filter(
    (session) => session.weekId === weekId && session.status === "completed"
  )
  const completedPlans = new Set(
    completed
      .filter((session) => session.workoutId && planIds.has(session.workoutId))
      .map((session) => session.workoutId)
  )
  const durations = completed
    .map((session) => elapsedMilliseconds(session, 0))
    .filter((value) => value !== null)
  return {
    planned: plans.length,
    completed: completedPlans.size,
    durationMs:
      completed.length && !durations.length
        ? null
        : durations.reduce((sum, value) => sum + value, 0),
    timedSessions: durations.length,
    completedSessions: completed.length,
    missingTimes: completed.length - durations.length,
  }
}

export function trainingTimeLabel(milliseconds: number | null) {
  if (milliseconds === null) return "—"
  if (milliseconds > 0 && milliseconds < 60_000) return "<1m"
  const minutes = Math.floor(milliseconds / 60_000)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`
}

export function workoutSession(workoutId: string, sessions: SessionRecord[]) {
  const matches = sessions.filter((session) => session.workoutId === workoutId)
  return matches.find((session) => session.status === "active") ?? matches[0]
}
