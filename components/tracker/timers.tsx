"use client"

import { TimerFace, ClockControls, DurationRuler } from "./timer-face"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { ArrowDown, ArrowUp, Plus, Timer, Volume2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api-client"
import { TimerAudio, type TimerAudioStatus } from "@/lib/timer-audio"
import { useTimerAlerts } from "@/lib/timer-alerts"
import { readStoredRestTimer, writeStoredRestTimer } from "@/lib/timer-storage"
import { NotificationSettings } from "./notification-settings"
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
  resumeRest,
  startRest,
  workoutTimerRunning,
  type RestTimerState,
} from "@/lib/timers"
import { Modal, errorMessage } from "./shared"

type TimerContextValue = {
  ownerId: string
  start: (duration: number, sessionId: string) => void
  controls: ReactNode
  bindSession: (id: string) => void
  timer: RestTimerState | null
  settings: TimerSettingsRecord
  editable: boolean
  saving: boolean
  message: string
  open: (sessionId?: string | null) => void
  cancelForSession: (id: string) => void
  saveSettings: (value: TimerSettingsRecord) => Promise<void>
  prepareSound: () => void
  testSound: () => void
  soundStatus: TimerAudioStatus
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
export function ElapsedTime({
  session,
  compact = false,
}: {
  session: SessionRecord
  compact?: boolean
}) {
  const now = useClock(workoutTimerRunning(session))
  const elapsed = elapsedMilliseconds(session, now)
  const untracked =
    elapsed === null && (session.status === "completed" || !!session.finishedAt)
  return (
    <span
      className="elapsed-time"
      aria-label={
        untracked ? "Workout duration not tracked" : "Workout duration"
      }
      title={untracked ? "Not tracked" : undefined}
    >
      {elapsed === null
        ? untracked
          ? compact
            ? "—"
            : "Not tracked"
          : "0:00"
        : clockLabel(elapsed, "up")}
    </span>
  )
}
export function RestTime({ timer }: { timer: RestTimerState }) {
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
  const settingsKey = `training-timer-settings:${ownerId}`
  const [timer, setTimerState] = useState<RestTimerState | null>(() =>
    readStoredRestTimer(ownerId)
  )
  const timerRef = useRef(timer)
  const audio = useRef<TimerAudio | null>(null)
  const soundEnabled = useRef(defaultTimerSettings.soundEnabled)
  const [soundStatus, setSoundStatus] = useState<TimerAudioStatus>("idle")
  const [message, setMessage] = useState("")
  const setTimer = useCallback(
    (
      value:
        | RestTimerState
        | null
        | ((current: RestTimerState | null) => RestTimerState | null)
    ) => {
      const next = typeof value === "function" ? value(timerRef.current) : value
      timerRef.current = next
      // Cancel old nodes within the control gesture, before React renders.
      audio.current?.update(next, soundEnabled.current)
      // Persist inside the gesture so an immediate iOS app termination cannot
      // leave the scheduled phone alert without its matching local timer.
      if (!writeStoredRestTimer(ownerId, next))
        setMessage("This browser cannot retain the rest timer after reload.")
      setTimerState(next)
    },
    [ownerId]
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
  const canSound = useCallback(
    (timerId: string, deadline: number) =>
      audio.current?.covers(timerId, deadline) ?? false,
    []
  )
  useTimerAlerts(ownerId, timer, {
    soundEnabled: settings.soundEnabled,
    soundReady: soundStatus === "ready",
    canSound,
  })
  const [editable, setEditable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [visible, setVisible] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const savingRef = useRef(false)
  useEffect(() => {
    const engine = new TimerAudio(setSoundStatus)
    audio.current = engine
    engine.preload()
    engine.update(timerRef.current, soundEnabled.current)
    const foreground = () => engine.foregroundChanged()
    const interaction = () => {
      if (soundEnabled.current && timerRef.current?.status === "running")
        void engine.prepare()
    }
    document.addEventListener("visibilitychange", foreground)
    window.addEventListener("focus", foreground)
    window.addEventListener("pageshow", foreground)
    // Touch activation is granted on pointer-up, not pointer-down, on iOS.
    document.addEventListener("pointerup", interaction, { passive: true })
    document.addEventListener("keydown", interaction)
    return () => {
      document.removeEventListener("visibilitychange", foreground)
      window.removeEventListener("focus", foreground)
      window.removeEventListener("pageshow", foreground)
      document.removeEventListener("pointerup", interaction)
      document.removeEventListener("keydown", interaction)
      engine.dispose()
      if (audio.current === engine) audio.current = null
    }
  }, [ownerId])
  useEffect(() => {
    soundEnabled.current = settings.soundEnabled
    audio.current?.update(timer, settings.soundEnabled)
  }, [timer, settings.soundEnabled])
  const prepareSound = useCallback(() => {
    if (soundEnabled.current) void audio.current?.prepare()
  }, [])
  const testSound = useCallback(() => {
    void audio.current?.preview()
  }, [])
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
    }
  }, [settingsKey])
  useEffect(() => {
    void Promise.resolve()
      .then(() => {
        if (!writeStoredRestTimer(ownerId, timer))
          setMessage("This browser cannot retain the rest timer after reload.")
      })
      .catch(() => {
        setMessage("This browser cannot retain the rest timer after reload.")
      })
  }, [timer, ownerId])
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
  }, [timer, setTimer])
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
      // Unlock before the network request loses the user's activation.
      if (value.soundEnabled) void audio.current?.prepare()
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
    (duration: number, id: string | null = sessionId) => {
      try {
        const next = startRest(duration, Date.now(), id)
        setSelected(duration)
        setCustomDraft(null)
        setMessage("")
        setTimer(next)
        if (soundEnabled.current) void audio.current?.playStart()
      } catch (error) {
        setMessage(errorMessage(error))
      }
    },
    [sessionId, setTimer]
  )
  const bindSession = useCallback(
    (id: string) => {
      setSessionId(id)
      setCustomDraft(null)
      setTimer((current) => (current?.status === "complete" ? null : current))
    },
    [setTimer]
  )
  const context: TimerContextValue = {
    ownerId,
    timer,
    settings,
    editable,
    saving,
    message,
    open,
    cancelForSession,
    saveSettings,
    prepareSound,
    testSound,
    soundStatus,
    start: handleStart,
    bindSession,
    controls: (
      <div className="clock-panel">
        <RestDial timer={timer} selected={selected} customDraft={customDraft} />
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
            prepareSound()
            if (customDraft !== null) handleStart(customDraft)
            else if (
              !timer ||
              timer.status === "complete" ||
              timer.status === "idle"
            )
              handleStart(selected)
            else {
              setTimer((current) =>
                current
                  ? current.status === "running"
                    ? pauseRest(current, Date.now())
                    : resumeRest(current, Date.now())
                  : current
              )
              if (timer.status === "paused" && soundEnabled.current)
                void audio.current?.playStart()
            }
          }}
          onExtend={() => {
            setCustomDraft(null)
            prepareSound()
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
            onClick={() => {
              prepareSound()
              setCustomDraft(customDraft === null ? selected : null)
            }}
          >
            Custom
          </Button>
        </div>
        {customDraft !== null && (
          <DurationRuler
            value={customDraft}
            onChange={(duration) => {
              setCustomDraft(duration)
              audio.current?.playTick()
            }}
          />
        )}
        {message && (
          <p className="muted text-sm" role="status">
            {message}
          </p>
        )}
      </div>
    ),
  }
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
          {context.controls}
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
  const running = workoutTimerRunning(session)
  const now = useClock(running)
  const elapsed = elapsedMilliseconds(
    session,
    Math.max(now, session.startedAt ? Date.parse(session.startedAt) : 0)
  )
  return (
    <TimerFace
      mode="workout"
      label="Workout elapsed time"
      milliseconds={
        elapsed ??
        (session.status === "active" && !session.finishedAt ? 0 : null)
      }
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
  const {
    ownerId,
    settings,
    editable,
    saving,
    saveSettings,
    message,
    testSound,
    soundStatus,
  } = useTimers()
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
        Timer sounds
      </label>
      <div className="row wrap">
        <p className="muted text-sm">Crisp ticks, start and countdown cues.</p>
        <Button variant="outline" onClick={testSound}>
          <Volume2 size={16} />
          Test sound
        </Button>
      </div>
      {soundStatus === "unavailable" && (
        <p className="muted text-sm" role="status">
          Sound is unavailable in this browser.
        </p>
      )}
      {soundStatus === "needs-gesture" && (
        <p className="muted text-sm" role="status">
          Tap Test sound to enable audio again.
        </p>
      )}
      <p className="muted text-sm">
        Sounds play while the app is open. Check your volume and Silent Mode if
        the test is quiet.
      </p>
      <NotificationSettings ownerId={ownerId} />
    </div>
  )
}
