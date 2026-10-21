"use client"

import { TimerFace, ClockControls, DurationRuler } from "./timer-face"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { ArrowDown, ArrowUp, Plus, Timer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api-client"
import {
  defaultTimerSettings,
  TimerSettings,
  type TimerSettingsRecord,
  type SessionRecord,
} from "@/contracts/models"
import {
  clockLabel,
  elapsedMilliseconds,
  extendRest,
  pauseRest,
  resetRest,
  remainingMilliseconds,
  RestTimer,
  resumeRest,
  startRest,
  type RestTimerState,
} from "@/lib/timers"
import { Modal, errorMessage } from "./shared"

type TimerContextValue = {
  timer: RestTimerState | null
  settings: TimerSettingsRecord
  editable: boolean
  saving: boolean
  message: string
  open: (sessionId?: string | null) => void
  cancelForSession: (id: string) => void
  saveSettings: (value: TimerSettingsRecord) => Promise<void>
}
const TimerContext = createContext<TimerContextValue | null>(null)
export function useTimers() {
  const value = useContext(TimerContext)
  if (!value) throw new Error("Timer provider missing")
  return value
}
const clockSnapshot = () => Math.floor(Date.now() / 100) * 100
const serverClock = () => 0
const idleClock = () => () => undefined
function subscribeClock(tick: () => void) {
  const interval = window.setInterval(tick, 100)
  document.addEventListener("visibilitychange", tick)
  return () => {
    clearInterval(interval)
    document.removeEventListener("visibilitychange", tick)
  }
}
function useClock(enabled: boolean) {
  // Read the current clock on every mount and resume, never a stale paused tick.
  return useSyncExternalStore(
    enabled ? subscribeClock : idleClock,
    clockSnapshot,
    serverClock
  )
}
export function ElapsedTime({ session }: { session: SessionRecord }) {
  const now = useClock(
    session.status === "active" && !!session.startedAt && !session.timerPausedAt
  )
  const elapsed = elapsedMilliseconds(session, now)
  return (
    <span className="elapsed-time" aria-label="Workout duration">
      {elapsed === null
        ? session.status === "completed"
          ? "Not tracked"
          : "0:00"
        : clockLabel(elapsed, "up")}
    </span>
  )
}
function RestTime({ timer }: { timer: RestTimerState }) {
  const now = useClock(timer.status === "running")
  return (
    <span className="tabular-nums">
      {clockLabel(remainingMilliseconds(timer, now))}
    </span>
  )
}
export function TimerLaunch({ sessionId }: { sessionId?: string }) {
  const { timer, open } = useTimers()
  return (
    <Button
      variant="outline"
      size="icon"
      className="timer-launch"
      aria-label="Open rest timer"
      title="Rest timer"
      data-active={timer?.status === "running" || timer?.status === "paused"}
      onClick={() => open(sessionId)}
    >
      <Timer size={18} />
    </Button>
  )
}

export function TimerProvider({
  ownerId,
  children,
}: {
  ownerId: string
  children: ReactNode
}) {
  const storageKey = `training-rest:${ownerId}`
  const settingsKey = `training-timer-settings:${ownerId}`
  const [timer, setTimerState] = useState<RestTimerState | null>(() => {
    try {
      const saved = RestTimer.safeParse(
        JSON.parse(sessionStorage.getItem(storageKey) ?? "null")
      )
      return saved.success && saved.data.status !== "complete"
        ? saved.data
        : null
    } catch {
      return null
    }
  })
  const timerRef = useRef(timer)
  const setTimer = useCallback(
    (
      value:
        | RestTimerState
        | null
        | ((current: RestTimerState | null) => RestTimerState | null)
    ) => {
      const next = typeof value === "function" ? value(timerRef.current) : value
      timerRef.current = next
      setTimerState(next)
    },
    []
  )
  const selectionKey = `training-rest-duration:${ownerId}`
  const [selected, setSelected] = useState(() => {
    if (timer) return timer.durationMs / 1000
    try {
      const value = Number(localStorage.getItem(selectionKey))
      return Number.isInteger(value) && value >= 1 && value <= 3600 ? value : 90
    } catch {
      return 90
    }
  })
  const [customDraft, setCustomDraft] = useState<number | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(selectionKey, String(selected))
    } catch {
      /* Optional preference. */
    }
  }, [selectionKey, selected])
  const [settings, setSettings] = useState<TimerSettingsRecord>(() => {
    try {
      const saved = TimerSettings.safeParse(
        JSON.parse(localStorage.getItem(settingsKey) ?? "null")
      )
      return saved.success ? saved.data : defaultTimerSettings
    } catch {
      return defaultTimerSettings
    }
  })
  const [editable, setEditable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [visible, setVisible] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const savingRef = useRef(false)
  const lastAlert = useRef<string | null>(null)
  useEffect(() => {
    let live = true
    const refresh = () => {
      if (!navigator.onLine) {
        setEditable(false)
        return
      }
      void api
        .getTimerSettings()
        .then((value) => {
          if (!live || savingRef.current) return
          setSettings(value)
          setEditable(true)
          try {
            localStorage.setItem(settingsKey, JSON.stringify(value))
          } catch {
            /* Optional cache. */
          }
        })
        .catch(() => {
          if (live) setEditable(false)
        })
    }
    void Promise.resolve().then(refresh)
    window.addEventListener("online", refresh)
    window.addEventListener("offline", refresh)
    return () => {
      live = false
      window.removeEventListener("online", refresh)
      window.removeEventListener("offline", refresh)
      void audio.current?.close()
    }
  }, [storageKey, settingsKey])
  useEffect(() => {
    void Promise.resolve()
      .then(() => {
        if (timer) sessionStorage.setItem(storageKey, JSON.stringify(timer))
        else sessionStorage.removeItem(storageKey)
      })
      .catch(() => {
        setMessage("This browser cannot retain the rest timer after reload.")
      })
  }, [timer, storageKey])
  useEffect(() => {
    if (!timer || timer.status !== "running") return
    const complete = () => {
      const live = timerRef.current
      if (
        !live ||
        live.id !== timer.id ||
        live.status !== "running" ||
        remainingMilliseconds(live, Date.now()) > 0
      )
        return
      setTimer((current) =>
        current?.id === timer.id &&
        current.status === "running" &&
        remainingMilliseconds(current, Date.now()) === 0
          ? { ...current, status: "complete", remainingMs: 0, deadline: null }
          : current
      )
      if (lastAlert.current === timer.id) return
      lastAlert.current = timer.id
      if (settings.soundEnabled && audio.current?.state === "running") {
        const oscillator = audio.current.createOscillator()
        const gain = audio.current.createGain()
        oscillator.connect(gain)
        gain.connect(audio.current.destination)
        oscillator.frequency.value = 880
        gain.gain.setValueAtTime(0.12, audio.current.currentTime)
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          audio.current.currentTime + 0.35
        )
        oscillator.start()
        oscillator.stop(audio.current.currentTime + 0.35)
      }
    }
    const timeout = window.setTimeout(
      complete,
      remainingMilliseconds(timer, Date.now())
    )
    document.addEventListener("visibilitychange", complete)
    return () => {
      clearTimeout(timeout)
      document.removeEventListener("visibilitychange", complete)
    }
  }, [timer, settings.soundEnabled, setTimer])
  useEffect(() => {
    if (timer?.status !== "complete") return
    const id = timer.id
    const timeout = window.setTimeout(() => {
      setTimer((current) =>
        current?.id === id && current.status === "complete" ? null : current
      )
    }, 4000)
    return () => clearTimeout(timeout)
  }, [timer, setTimer])
  const open = useCallback(
    (id?: string | null) => {
      setSessionId(id ?? timer?.sessionId ?? null)
      setTimer((current) => (current?.status === "complete" ? null : current))
      setCustomDraft(null)
      setVisible(true)
    },
    [timer?.sessionId, setTimer]
  )
  const cancelForSession = useCallback(
    (id: string) =>
      setTimer((current) => (current?.sessionId === id ? null : current)),
    [setTimer]
  )
  const saveSettings = useCallback(
    async (value: TimerSettingsRecord) => {
      if (!editable || savingRef.current) return
      savingRef.current = true
      setSaving(true)
      setMessage("")
      try {
        const saved = await api.saveTimerSettings(value)
        setSettings(saved)
        try {
          localStorage.setItem(settingsKey, JSON.stringify(saved))
        } catch {
          /* Optional cache. */
        }
        setMessage("")
      } catch (error) {
        setMessage(errorMessage(error))
        try {
          setSettings(await api.getTimerSettings())
        } catch {
          setEditable(false)
        }
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [editable, settingsKey]
  )
  const handleStart = useCallback(
    (duration: number) => {
      try {
        const next = startRest(duration, Date.now(), sessionId)
        lastAlert.current = null
        setSelected(duration)
        setCustomDraft(null)
        setMessage("")
        setTimer(next)
        // Unlock audio in the gesture, without awaiting it or delaying state updates.
        if (settings.soundEnabled) {
          try {
            audio.current ??= new AudioContext()
            void audio.current.resume().catch(() => undefined)
          } catch {
            setMessage("Sound is unavailable in this browser.")
          }
        }
      } catch (error) {
        setMessage(errorMessage(error))
      }
    },
    [sessionId, settings.soundEnabled, setTimer]
  )
  const context = useMemo(
    () => ({
      timer,
      settings,
      editable,
      saving,
      message,
      open,
      cancelForSession,
      saveSettings,
    }),
    [
      timer,
      settings,
      editable,
      saving,
      message,
      open,
      cancelForSession,
      saveSettings,
    ]
  )
  return (
    <TimerContext.Provider value={context}>
      {children}
      {timer && timer.status !== "idle" && !visible && (
        <button
          className={`floating-rest ${timer.status === "complete" ? "rest-complete" : ""}`}
          onClick={() => open()}
          aria-label="Open running rest timer"
        >
          <Timer size={18} />
          {timer.status === "complete" ? (
            "Rest complete"
          ) : (
            <RestTime timer={timer} />
          )}
          {timer.status === "paused" && " · Paused"}
        </button>
      )}
      <span className="sr-only" role="status">
        {timer?.status === "complete" ? "Rest complete" : ""}
      </span>
      {visible && (
        <Modal
          title="Rest timer"
          onClose={() => {
            setVisible(false)
            setCustomDraft(null)
            setTimer((current) =>
              current?.status === "complete" ? null : current
            )
          }}
        >
          <div className="clock-panel">
            <RestDial
              timer={timer}
              selected={selected}
              customDraft={customDraft}
            />
            <ClockControls
              playing={customDraft === null && timer?.status === "running"}
              playLabel={
                customDraft !== null ||
                !timer ||
                timer.status === "complete" ||
                timer.status === "idle"
                  ? "Start rest timer"
                  : timer.status === "running"
                    ? "Pause rest timer"
                    : "Resume rest timer"
              }
              resetLabel="Reset rest timer"
              onReset={() => {
                setCustomDraft(null)
                setTimer(
                  resetRest(timer ?? startRest(selected, Date.now(), sessionId))
                )
              }}
              onPlay={() => {
                if (customDraft !== null) handleStart(customDraft)
                else if (
                  !timer ||
                  timer.status === "complete" ||
                  timer.status === "idle"
                )
                  handleStart(selected)
                else
                  setTimer((current) =>
                    current
                      ? current.status === "running"
                        ? pauseRest(current, Date.now())
                        : resumeRest(current, Date.now())
                      : current
                  )
              }}
              onExtend={() => {
                setCustomDraft(null)
                lastAlert.current = null
                setTimer((current) =>
                  extendRest(
                    current ?? {
                      ...startRest(selected, Date.now(), sessionId),
                      status: "paused",
                      deadline: null,
                    },
                    Date.now()
                  )
                )
              }}
            />
            <div className="timer-presets">
              {settings.presets.map((duration) => (
                <Button
                  key={duration}
                  variant="outline"
                  aria-pressed={
                    customDraft === null &&
                    timer?.status !== "idle" &&
                    (!timer ||
                      (timer.progressDurationMs ?? timer.durationMs) ===
                        timer.durationMs) &&
                    selected === duration
                  }
                  onClick={() => handleStart(duration)}
                >
                  {clockLabel(duration * 1000)}
                </Button>
              ))}
              <Button
                variant="outline"
                aria-pressed={customDraft !== null}
                onClick={() =>
                  setCustomDraft(customDraft === null ? selected : null)
                }
              >
                Custom
              </Button>
            </div>
            {customDraft !== null && (
              <DurationRuler value={customDraft} onChange={setCustomDraft} />
            )}
            {message && (
              <p className="muted text-sm" role="status">
                {message}
              </p>
            )}
          </div>
        </Modal>
      )}
    </TimerContext.Provider>
  )
}

function RestDial({
  timer,
  selected,
  customDraft,
}: {
  timer: RestTimerState | null
  selected: number
  customDraft: number | null
}) {
  const now = useClock(timer?.status === "running")
  const editing = customDraft !== null
  const remaining = editing
    ? customDraft * 1000
    : timer
      ? remainingMilliseconds(timer, now)
      : selected * 1000
  return (
    <TimerFace
      mode="rest"
      label={editing ? "Custom duration preview" : "Rest countdown"}
      className="rest-countdown"
      milliseconds={remaining}
      totalMs={
        editing
          ? remaining
          : (timer?.progressDurationMs ?? timer?.durationMs ?? selected * 1000)
      }
      active={!editing && timer?.status === "running"}
      paused={!editing && timer?.status === "paused"}
      complete={!editing && timer?.status === "complete"}
    />
  )
}

export function WorkoutDial({ session }: { session: SessionRecord }) {
  const running =
    session.status === "active" && !!session.startedAt && !session.timerPausedAt
  const now = useClock(running)
  const elapsed = elapsedMilliseconds(
    session,
    Math.max(now, session.startedAt ? Date.parse(session.startedAt) : 0)
  )
  return (
    <TimerFace
      mode="workout"
      label="Workout elapsed time"
      milliseconds={elapsed ?? (session.status === "active" ? 0 : null)}
      active={running}
      paused={!!session.timerPausedAt}
      complete={session.status === "completed"}
    />
  )
}

function PresetInput({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  return (
    <Input
      aria-label={`Preset ${clockLabel(value * 1000)} seconds`}
      type="number"
      min="1"
      max="3600"
      inputMode="numeric"
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = Number(text)
        if (Number.isInteger(next) && next >= 1 && next <= 3600) onChange(next)
        else setText(String(value))
      }}
    />
  )
}
export function TimerSettingsEditor() {
  const { settings, editable, saving, saveSettings, message } = useTimers()
  const [newDuration, setNewDuration] = useState("240")
  const disabled = !editable || saving
  function move(index: number, direction: number) {
    const presets = [...settings.presets]
    ;[presets[index], presets[index + direction]] = [
      presets[index + direction],
      presets[index],
    ]
    void saveSettings({ ...settings, presets })
  }
  return (
    <div className="timer-settings-editor">
      {message && (
        <p className="muted text-sm" role="status">
          {message}
        </p>
      )}
      {!editable && (
        <p className="muted text-sm">
          Connect to edit presets. Cached presets and custom timers still work
          offline.
        </p>
      )}
      <p className="muted text-xs">
        Preset durations in seconds. Changes save automatically.
      </p>
      {settings.presets.map((duration, index) => (
        <div
          className="timer-preset-edit"
          key={`${settings.revision}:${index}`}
        >
          <PresetInput
            value={duration}
            disabled={disabled}
            onChange={(next) => {
              if (next !== duration)
                void saveSettings({
                  ...settings,
                  presets: settings.presets.map((value, i) =>
                    i === index ? next : value
                  ),
                })
            }}
          />
          <span className="muted">{clockLabel(duration * 1000)}</span>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || index === 0}
            aria-label={`Move ${duration} second preset up`}
            onClick={() => move(index, -1)}
          >
            <ArrowUp size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || index === settings.presets.length - 1}
            aria-label={`Move ${duration} second preset down`}
            onClick={() => move(index, 1)}
          >
            <ArrowDown size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || settings.presets.length === 1}
            aria-label={`Remove ${duration} second preset`}
            onClick={() =>
              void saveSettings({
                ...settings,
                presets: settings.presets.filter((_, i) => i !== index),
              })
            }
          >
            <X size={16} />
          </Button>
        </div>
      ))}
      <div className="row">
        <Input
          aria-label="New preset seconds"
          type="number"
          min="1"
          max="3600"
          inputMode="numeric"
          value={newDuration}
          disabled={disabled}
          onChange={(event) => setNewDuration(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={
            disabled ||
            settings.presets.length >= 12 ||
            !Number.isInteger(Number(newDuration)) ||
            Number(newDuration) < 1 ||
            Number(newDuration) > 3600 ||
            settings.presets.includes(Number(newDuration))
          }
          onClick={() =>
            void saveSettings({
              ...settings,
              presets: [...settings.presets, Number(newDuration)],
            })
          }
        >
          <Plus size={16} />
          Preset
        </Button>
      </div>
      <label className="timer-toggle">
        <input
          type="checkbox"
          checked={settings.soundEnabled}
          disabled={disabled}
          onChange={(event) =>
            void saveSettings({
              ...settings,
              soundEnabled: event.target.checked,
            })
          }
        />
        Sound on completion
      </label>
    </div>
  )
}
