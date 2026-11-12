import { ApiError } from "./api-client"

export function saveFailure(error: unknown) {
  const status = error instanceof ApiError ? error.status : undefined
  return {
    message: error instanceof Error ? error.message : "Unable to save",
    failure:
      status === 401
        ? ("auth" as const)
        : status === 400 || status === 403 || status === 422
          ? ("invalid" as const)
          : ("network" as const),
    rejected: status === 400 || status === 403 || status === 422,
  }
}

export interface SaveRequest<T> {
  key: string
  version: string
  value: T
  /** The optimistic value at dispatch, used to preserve edits made during I/O. */
  local?: T
  base?: T
  /** Immutable intent, separate from the rebased wire request. */
  intent?: T
  rebased?: boolean
}

export async function saveRebased<T>(
  initial: SaveRequest<T>,
  save: (value: T, key: string) => Promise<T>,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false }
  },
  merge: (base: T, local: T, server: T) => T,
  persist: (request: SaveRequest<T>) => Promise<void>,
  recover?: (local: T, current: T) => Promise<T>
) {
  let request = initial
  for (let attempt = 0; attempt < 5; attempt++) {
    await persist(request)
    try {
      return { saved: await save(request.value, request.key), request }
    } catch (error) {
      const candidate = schema.safeParse(
        error instanceof ApiError &&
          error.status === 409 &&
          error.code !== "record_deleted"
          ? (error.details as { current?: unknown } | undefined)?.current
          : undefined
      )
      if (!candidate.success) throw error
      if (!request.base) {
        if (!recover) throw error
        const recovered = await recover(
          request.local ?? request.value,
          candidate.data
        )
        request = {
          ...request,
          key: crypto.randomUUID(),
          local: request.local ?? request.value,
          base: candidate.data,
          intent: recovered,
          value: recovered,
          rebased: true,
        }
        continue
      }
      request = {
        ...request,
        key: crypto.randomUUID(),
        intent: request.intent ?? request.value,
        local: request.local ?? request.value,
        value: merge(
          request.base,
          request.intent ?? request.value,
          candidate.data
        ),
        rebased: true,
      }
    }
  }
  await persist(request)
  throw new Error("Saving will continue automatically")
}
