"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  readDisplayPreference,
  watchScreenAwake,
  type WakeStatus,
} from "@/lib/screen-awake"

type DisplayContextValue = {
  enabled: boolean
  status: WakeStatus
  storageError: boolean
  setEnabled: (value: boolean) => void
}
const DisplayContext = createContext<DisplayContextValue | null>(null)

export function DisplayProvider({
  ownerId,
  children,
}: {
  ownerId: string
  children: ReactNode
}) {
  const key = `training-display:v1:${ownerId}`
  const [enabled, setEnabledState] = useState(() => {
    try {
      return readDisplayPreference(localStorage.getItem(key)).keepScreenAwake
    } catch {
      return true
    }
  })
  const [status, setStatus] = useState<WakeStatus>("requesting")
  const [storageError, setStorageError] = useState(false)
  useEffect(() => {
    if (!enabled) return
    return watchScreenAwake(
      {
        request: navigator.wakeLock
          ? () => navigator.wakeLock.request("screen")
          : undefined,
        isVisible: () => document.visibilityState === "visible",
        subscribe: (listener) => {
          document.addEventListener("visibilitychange", listener)
          window.addEventListener("focus", listener)
          window.addEventListener("pageshow", listener)
          document.addEventListener("pointerdown", listener, { passive: true })
          document.addEventListener("keydown", listener)
          return () => {
            document.removeEventListener("visibilitychange", listener)
            window.removeEventListener("focus", listener)
            window.removeEventListener("pageshow", listener)
            document.removeEventListener("pointerdown", listener)
            document.removeEventListener("keydown", listener)
          }
        },
      },
      setStatus
    )
  }, [enabled])
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key)
        setEnabledState(readDisplayPreference(event.newValue).keepScreenAwake)
    }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [key])
  function setEnabled(value: boolean) {
    setEnabledState(value)
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, keepScreenAwake: value })
      )
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }
  return (
    <DisplayContext.Provider
      value={{ enabled, status, storageError, setEnabled }}
    >
      {children}
    </DisplayContext.Provider>
  )
}

export function DisplaySettings() {
  const display = useContext(DisplayContext)
  if (!display) throw new Error("Display provider missing")
  const messages: Record<WakeStatus, string> = {
    requesting: "Requesting screen wake…",
    active: "Active while the app is visible.",
    released: "Your device released screen wake. Tap the app to try again.",
    unavailable:
      "Screen wake is unavailable. Your device may still dim or lock.",
    hidden: "Screen wake resumes when you return to the app.",
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Display</h2>
      </div>
      <label className="timer-toggle">
        <input
          type="checkbox"
          checked={display.enabled}
          onChange={(event) => display.setEnabled(event.target.checked)}
        />
        Keep screen awake
      </label>
      <p className="muted text-sm" role="status">
        {display.enabled
          ? messages[display.status]
          : "Off. Your device’s normal screen timeout applies."}
      </p>
      <p className="muted mt-2 text-sm">
        Applies across the app on this device. Manual locking and power-saving
        settings still take priority.
      </p>
      {display.storageError && (
        <p role="alert">This preference could not be saved on this device.</p>
      )}
    </section>
  )
}
