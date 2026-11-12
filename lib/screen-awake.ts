export type WakeStatus =
  "requesting" | "active" | "released" | "unavailable" | "hidden"
export type DisplayPreference = { version: 1; keepScreenAwake: boolean }
export function readDisplayPreference(raw: string | null): DisplayPreference {
  try {
    const value = JSON.parse(raw ?? "null")
    if (value?.version === 1 && typeof value.keepScreenAwake === "boolean")
      return { version: 1, keepScreenAwake: value.keepScreenAwake }
  } catch {
    /* Fall back to the visible-app default. */
  }
  return { version: 1, keepScreenAwake: true }
}

type Lock = Pick<WakeLockSentinel, "released" | "release" | "addEventListener">
type WakeEnvironment = {
  request: (() => Promise<Lock>) | undefined
  isVisible: () => boolean
  subscribe: (listener: () => void) => () => void
}

/** One request in flight, with one recovery attempt per foreground/interaction. */
export function watchScreenAwake(
  environment: WakeEnvironment,
  onStatus: (status: WakeStatus) => void
) {
  let disposed = false
  let pending = false
  let pendingAgain = false
  let lock: Lock | undefined
  let recovery: ReturnType<typeof setTimeout> | undefined
  let recoveryAllowed = true
  const clearRecovery = () => {
    clearTimeout(recovery)
    recovery = undefined
  }
  const release = () => {
    clearRecovery()
    const held = lock
    lock = undefined
    if (held && !held.released) void held.release().catch(() => undefined)
  }
  const recover = () => {
    if (disposed || !environment.isVisible() || !recoveryAllowed) return
    recoveryAllowed = false
    clearRecovery()
    recovery = setTimeout(() => {
      recovery = undefined
      void acquire()
    }, 1000)
  }
  const acquire = async () => {
    if (disposed) return
    if (!environment.isVisible()) {
      release()
      onStatus("hidden")
      return
    }
    if (!environment.request) {
      onStatus("unavailable")
      return
    }
    if (pending) {
      pendingAgain = true
      return
    }
    if (lock && !lock.released) return
    pending = true
    onStatus("requesting")
    try {
      const acquired = await environment.request()
      if (disposed || !environment.isVisible()) {
        await acquired.release()
        if (!disposed) onStatus("hidden")
      } else {
        lock = acquired
        onStatus(acquired.released ? "released" : "active")
        if (acquired.released) recover()
        acquired.addEventListener("release", () => {
          if (disposed || lock !== acquired) return
          lock = undefined
          onStatus(environment.isVisible() ? "released" : "hidden")
          recover()
        })
      }
    } catch {
      if (!disposed)
        onStatus(environment.isVisible() ? "unavailable" : "hidden")
    } finally {
      pending = false
      if (pendingAgain) {
        pendingAgain = false
        if (!disposed) void acquire()
      }
    }
  }
  const unsubscribe = environment.subscribe(() => {
    recoveryAllowed = true
    clearRecovery()
    void acquire()
  })
  void acquire()
  return () => {
    disposed = true
    unsubscribe()
    release()
  }
}
