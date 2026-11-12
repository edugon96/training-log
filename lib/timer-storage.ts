import { RestTimer, type RestTimerState } from "./timers"

type TimerStore = Pick<Storage, "getItem" | "setItem" | "removeItem">
type TimerStorageEnvironment = {
  session?: TimerStore
  standalone?: TimerStore
  now: () => number
}

function browserStorage(): TimerStorageEnvironment {
  const environment: TimerStorageEnvironment = { now: () => Date.now() }
  try {
    environment.session = sessionStorage
  } catch {
    /* Storage is optional. */
  }
  try {
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone
    )
      environment.standalone = localStorage
  } catch {
    /* Browser tabs retain their existing session-only behavior. */
  }
  return environment
}

function read(store: TimerStore | undefined, key: string) {
  try {
    return RestTimer.safeParse(JSON.parse(store?.getItem(key) ?? "null"))
  } catch {
    return RestTimer.safeParse(null)
  }
}

export function readStoredRestTimer(
  ownerId: string,
  environment = browserStorage()
): RestTimerState | null {
  const current = read(environment.session, `training-rest:${ownerId}`)
  if (current.success) {
    if (current.data.status === "complete") return null
    if (current.data.status !== "running" || current.data.deadline !== null)
      return current.data
  }
  // iOS can discard sessionStorage when it closes a Home Screen app. Recover
  // only that app's timer, never share a browser tab's timer with another tab.
  const saved = read(
    environment.standalone,
    `training-rest-standalone:${ownerId}`
  )
  if (!saved.success) return null
  if (saved.data.status === "paused") return saved.data
  if (
    saved.data.status === "running" &&
    saved.data.deadline !== null &&
    saved.data.deadline > environment.now()
  )
    return saved.data
  return null
}

export function writeStoredRestTimer(
  ownerId: string,
  timer: RestTimerState | null,
  environment = browserStorage()
): boolean {
  const write = (
    store: TimerStore | undefined,
    key: string,
    value: RestTimerState | null
  ) => {
    if (!store) return false
    try {
      if (value) store.setItem(key, JSON.stringify(value))
      else store.removeItem(key)
      return true
    } catch {
      return false
    }
  }
  const session = write(environment.session, `training-rest:${ownerId}`, timer)
  const standalone = write(
    environment.standalone,
    `training-rest-standalone:${ownerId}`,
    timer?.status === "running" || timer?.status === "paused" ? timer : null
  )
  return session || standalone
}
