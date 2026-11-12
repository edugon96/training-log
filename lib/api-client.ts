import createClient from "openapi-fetch"
import type { paths } from "@/contracts/api"
import * as m from "@/contracts/models"
import { z } from "zod"

export const client = createClient<paths>({ credentials: "same-origin" })
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}
async function parse<T>(
  promise: Promise<{ data?: unknown; error?: unknown; response: Response }>,
  schema: z.ZodType<T>
): Promise<T> {
  const { data, error, response } = await promise
  if (!response.ok) {
    const body = m.ErrorResponse.safeParse(error)
    throw new ApiError(
      response.status,
      body.success
        ? body.data.error.message
        : `Request failed (${response.status})`,
      body.success ? body.data.error.details : undefined,
      body.success ? body.data.error.code : undefined
    )
  }
  return schema.parse(data)
}
const headers = (key?: string) => ({
  "Idempotency-Key": key ?? crypto.randomUUID(),
})
export const me = () =>
  parse(
    client.GET("/api/v1/me"),
    z.object({ id: z.string(), name: z.string(), email: z.string() })
  )
export async function updateProfileName(name: string) {
  const value = z.string().trim().min(1).max(200).parse(name)
  await authRequest("update-user", { name: value })
  return me()
}
export const getTrainingDefaults = () =>
  parse(client.GET("/api/v1/training-defaults"), m.TrainingDefaults)
export const getTimerSettings = () =>
  parse(client.GET("/api/v1/timer-settings"), m.TimerSettings)
export const saveTimerSettings = (value: m.TimerSettingsRecord, key?: string) =>
  parse(
    client.PUT("/api/v1/timer-settings", {
      params: { header: headers(key) },
      body: { expectedRevision: value.revision, value },
    }),
    m.TimerSettings
  )
export const saveTrainingDefaults = (
  value: m.TrainingDefaultsRecord,
  key?: string
) =>
  parse(
    client.PUT("/api/v1/training-defaults", {
      params: { header: headers(key) },
      body: { expectedRevision: value.revision, value },
    }),
    m.TrainingDefaults
  )
export const catalog = () => parse(client.GET("/api/v1/catalog"), m.Catalog)
export const listEquipment = () =>
  parse(client.GET("/api/v1/equipment"), z.array(m.Equipment))
export const listExercises = () =>
  parse(client.GET("/api/v1/exercises"), z.array(m.Exercise))
export const listWeeks = () =>
  parse(client.GET("/api/v1/weeks"), z.array(m.Week))
export const listWorkouts = (query: { weekId?: string; kind?: string } = {}) =>
  parse(
    client.GET("/api/v1/workouts", { params: { query } }),
    z.array(m.Workout)
  )
export const listSessions = (
  query: { weekId?: string; workoutId?: string } = {}
) =>
  parse(
    client.GET("/api/v1/sessions", { params: { query } }),
    z.array(m.Session)
  )
export const getWorkout = (id: string) =>
  parse(
    client.GET("/api/v1/workouts/{id}", { params: { path: { id } } }),
    m.Workout
  )
export const getSession = (id: string) =>
  parse(
    client.GET("/api/v1/sessions/{id}", { params: { path: { id } } }),
    m.Session
  )
export function getDeletionPreview(
  resource: "workouts" | "sessions",
  id: string
) {
  return parse(
    client.GET(`/api/v1/${resource}/{id}/deletion`, {
      params: { path: { id } },
    }),
    m.DeletionSnapshot
  )
}
export function deleteWorkout(expected: m.DeletionPreview, key: string) {
  return parse(
    client.DELETE(`/api/v1/${expected.resource}/{id}`, {
      params: { path: { id: expected.id }, header: headers(key) },
      body: { expected },
    }),
    m.DeleteResult
  )
}
export function saveEquipment(value: m.EquipmentRecord, key?: string) {
  return parse(
    value.revision === 0
      ? client.POST("/api/v1/equipment", {
          body: { value },
          params: { header: headers(key) },
        })
      : client.PUT("/api/v1/equipment/{id}", {
          params: { path: { id: value.id }, header: headers(key) },
          body: { expectedRevision: value.revision, value },
        }),
    m.Equipment
  )
}
export function saveExercise(value: m.ExerciseRecord, key?: string) {
  return parse(
    value.revision === 0
      ? client.POST("/api/v1/exercises", {
          body: { value },
          params: { header: headers(key) },
        })
      : client.PUT("/api/v1/exercises/{id}", {
          params: { path: { id: value.id }, header: headers(key) },
          body: { expectedRevision: value.revision, value },
        }),
    m.Exercise
  )
}
export function saveWeek(value: m.WeekRecord, key?: string) {
  return parse(
    value.revision === 0
      ? client.POST("/api/v1/weeks", {
          body: { value },
          params: { header: headers(key) },
        })
      : client.PUT("/api/v1/weeks/{id}", {
          params: { path: { id: value.id }, header: headers(key) },
          body: { expectedRevision: value.revision, value },
        }),
    m.Week
  )
}
export function saveWorkout(value: m.WorkoutRecord, key?: string) {
  return parse(
    value.revision === 0
      ? client.POST("/api/v1/workouts", {
          body: { value },
          params: { header: headers(key) },
        })
      : client.PUT("/api/v1/workouts/{id}", {
          params: { path: { id: value.id }, header: headers(key) },
          body: { expectedRevision: value.revision, value },
        }),
    m.Workout
  )
}
export function saveSession(value: m.SessionRecord, key?: string) {
  return parse(
    value.revision === 0
      ? client.POST("/api/v1/sessions", {
          body: { value },
          params: { header: headers(key) },
        })
      : client.PUT("/api/v1/sessions/{id}", {
          params: { path: { id: value.id }, header: headers(key) },
          body: { expectedRevision: value.revision, value },
        }),
    m.Session
  )
}
export const copyWeek = (id: string, startDate: string) =>
  parse(
    client.POST("/api/v1/weeks/{id}/copy", {
      params: { path: { id }, header: headers() },
      body: { startDate },
    }),
    m.Week
  )
export const startWorkout = (id: string, performedOn: string) =>
  parse(
    client.POST("/api/v1/workouts/{id}/start", {
      params: { path: { id }, header: headers() },
      body: { performedOn },
    }),
    m.Session
  )
export const previous = (
  exerciseId: string,
  routineId: string | null,
  before: string
) =>
  parse(
    client.GET("/api/v1/history", {
      params: {
        query: { exerciseId, ...(routineId ? { routineId } : {}), before },
      },
    }),
    m.Previous
  )
const previousRequests = new Map<string, Promise<m.PreviousBatchRecord>>()
export function previousBatch(
  ownerId: string,
  exerciseIds: string[],
  routineId: string | null,
  before: string
): Promise<m.PreviousBatchRecord> {
  const ids = [...new Set(exerciseIds)].sort()
  const key = JSON.stringify([ownerId, ids, routineId, before])
  const pending = previousRequests.get(key)
  if (pending) return pending
  const run = async () => {
    const batches: m.PreviousBatchRecord[] = []
    for (let offset = 0; offset < ids.length; offset += 100) {
      batches.push(
        await parse(
          client.GET("/api/v1/history/batch", {
            params: {
              query: {
                exerciseId: ids.slice(offset, offset + 100),
                ...(routineId ? { routineId } : {}),
                before,
              },
            },
          }),
          m.PreviousBatch
        )
      )
    }
    return Object.assign({}, ...batches)
  }
  const request = run().finally(() => previousRequests.delete(key))
  previousRequests.set(key, request)
  return request
}
export const ledger = (weekId: string) =>
  parse(
    client.GET("/api/v1/ledger", { params: { query: { weekId } } }),
    m.Ledger
  )
export const changes = () =>
  parse(client.GET("/api/v1/changes"), z.array(m.Change))
export const listKeys = () =>
  parse(client.GET("/api/v1/keys"), z.array(m.ApiKeyInfo))
export const createKey = (name: string, scopes: z.infer<typeof m.Scope>[]) =>
  parse(
    client.POST("/api/v1/keys", {
      body: { name, scopes },
      params: { header: headers() },
    }),
    z.object({ key: z.string(), info: m.ApiKeyInfo })
  )
export const revokeKey = (id: string) =>
  parse(
    client.DELETE("/api/v1/keys/{id}", {
      params: { path: { id }, header: headers() },
    }),
    z.object({ ok: z.boolean() })
  )
export function exportData(format?: "json"): Promise<m.ImportData>
export function exportData(format: "csv"): Promise<string>
export async function exportData(
  format: "json" | "csv" = "json"
): Promise<m.ImportData | string> {
  if (format === "json")
    return parse(client.GET("/api/v1/export"), m.ImportManifest)
  const response = await fetch("/api/v1/export?format=csv", {
    credentials: "same-origin",
    cache: "no-store",
  })
  if (!response.ok)
    throw new ApiError(response.status, "Could not export results")
  return response.text()
}
export const importData = (manifest: m.ImportData) =>
  parse(
    client.POST("/api/v1/import", {
      body: { manifest },
      params: { header: headers() },
    }),
    z.unknown()
  )
async function authRequest(path: string, body: object) {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok)
    throw new ApiError(response.status, data.message ?? "Authentication failed")
  return data
}
export const signIn = (email: string, password: string) =>
  authRequest("sign-in/email", { email, password })
export const signOut = () => authRequest("sign-out", {})
export const api = {
  getDeletionPreview,
  deleteWorkout,
  getTimerSettings,
  saveTimerSettings,
  getTrainingDefaults,
  saveTrainingDefaults,
  catalog,
  me,
  listEquipment,
  saveEquipment,
  listExercises,
  saveExercise,
  listWeeks,
  saveWeek,
  copyWeek,
  listWorkouts,
  getWorkout,
  saveWorkout,
  startWorkout,
  listSessions,
  getSession,
  saveSession,
  previous,
  previousBatch,
  ledger,
  changes,
  listKeys,
  createKey,
  revokeKey,
  exportData,
  importData,
  signIn,
  signOut,
}
