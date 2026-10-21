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

/** One request in flight. OS releases never cause an aggressive retry loop. */
export function watchScreenAwake(
  environment: WakeEnvironment,
  onStatus: (status: WakeStatus) => void
) {
  let disposed = false
  let pending = false
  let lock: Lock | undefined
  const release = () => {
    const held = lock
    lock = undefined
    if (held && !held.released) void held.release().catch(() => undefined)
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
    if (pending || (lock && !lock.released)) return
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
        acquired.addEventListener("release", () => {
          if (disposed || lock !== acquired) return
          lock = undefined
          onStatus(environment.isVisible() ? "released" : "hidden")
        })
      }
    } catch {
      if (!disposed)
        onStatus(environment.isVisible() ? "unavailable" : "hidden")
    } finally {
      pending = false
    }
  }
  const unsubscribe = environment.subscribe(() => {
    void acquire()
  })
  void acquire()
  return () => {
    disposed = true
    unsubscribe()
    release()
  }
}
