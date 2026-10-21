"use client"

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { Pause, Play, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { clockLabel } from "@/lib/timers"

const ticks = Array.from({ length: 120 }, (_, index) => index)

export function TimerFace({
  milliseconds,
  mode,
  active = false,
  paused = false,
  complete = false,
  totalMs = 1,
  label,
  className = "",
}: {
  milliseconds: number | null
  mode: "rest" | "workout"
  active?: boolean
  paused?: boolean
  complete?: boolean
  totalMs?: number
  label: string
  className?: string
}) {
  const time = milliseconds ?? 0
  const statusId = useId()
  const progress = Math.min(1, Math.max(0, time / totalMs))
  const display =
    milliseconds === null
      ? "—"
      : clockLabel(time, mode === "rest" ? "down" : "up")
  return (
    <div
      className={`timer-face ${active ? "is-active" : ""} ${paused ? "is-paused" : ""} ${complete ? "is-complete" : ""}`}
    >
      <svg className="timer-dial" viewBox="0 0 320 320" aria-hidden="true">
        <circle className="timer-bezel" cx="160" cy="160" r="157" />
        {ticks.map((index) => (
          <line
            key={index}
            x1="160"
            y1="15"
            x2="160"
            y2={index % 10 === 0 ? "33" : "25"}
            transform={`rotate(${index * 3} 160 160)`}
            className={`timer-tick ${index % 10 === 0 ? "is-major" : ""} ${mode === "rest" && index / 120 < progress ? "is-lit" : ""}`}
          />
        ))}
      </svg>
      {mode === "workout" && milliseconds !== null && (
        <div
          className="timer-sweep"
          style={
            {
              "--sweep": `${((time % 60000) / 60000) * 360}deg`,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <span />
        </div>
      )}
      <div className="timer-face-center">
        <span
          role="timer"
          aria-live="off"
          aria-label={label}
          aria-describedby={statusId}
          className={`timer-digits ${display.length > 5 ? "timer-digits-long" : ""} ${className}`}
        >
          {display}
        </span>
        <span className="sr-only" id={statusId}>
          {complete
            ? "Complete"
            : paused
              ? "Paused"
              : active
                ? "Running"
                : "Stopped"}
        </span>
      </div>
    </div>
  )
}

export function ClockControls({
  playing,
  playLabel,
  resetLabel,
  onPlay,
  onReset,
  onExtend,
}: {
  playing: boolean
  playLabel: string
  resetLabel: string
  onPlay: () => void
  onReset: () => void
  onExtend?: () => void
}) {
  return (
    <div className={`clock-actions ${onExtend ? "" : "clock-actions-pair"}`}>
      <Button
        variant="outline"
        className="clock-action"
        aria-label={resetLabel}
        onClick={onReset}
      >
        <RotateCcw size={22} />
      </Button>
      <Button
        className="clock-action clock-action-primary"
        aria-label={playLabel}
        onClick={onPlay}
      >
        {playing ? <Pause size={28} /> : <Play size={28} />}
      </Button>
      {onExtend && (
        <Button
          variant="outline"
          className="clock-action"
          aria-label="Add 30 seconds"
          onClick={onExtend}
        >
          <span>+30</span>
        </Button>
      )}
    </div>
  )
}

const rulerStep = 8
const clampDuration = (seconds: number) =>
  Math.max(1, Math.min(3600, Math.round(seconds)))

export function DurationRuler({
  value,
  onChange,
}: {
  value: number
  onChange: (seconds: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const position = useRef(value)
  const [fraction, setFraction] = useState(0)
  const drag = useRef<{
    x: number
    time: number
    velocity: number
    pointer: number
  } | null>(null)
  const frame = useRef<number | null>(null)
  const wheelEnd = useRef<ReturnType<typeof setTimeout> | null>(null)
  const move = useCallback(
    (seconds: number) => {
      const bounded = Math.max(1, Math.min(3600, seconds))
      const snapped = Math.round(bounded)
      position.current = bounded
      setFraction(bounded - snapped)
      onChange(snapped)
    },
    [onChange]
  )
  const stopMotion = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (wheelEnd.current !== null) clearTimeout(wheelEnd.current)
    wheelEnd.current = null
  }, [])
  useEffect(() => stopMotion, [stopMotion])
  const release = () => {
    const gesture = drag.current
    drag.current = null
    if (!gesture) return
    let velocity = performance.now() - gesture.time < 100 ? gesture.velocity : 0
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      velocity = 0
    let last = performance.now()
    const coast = (now: number) => {
      const dt = Math.min(32, now - last)
      last = now
      const candidate = position.current + velocity * dt
      velocity *= Math.exp(-dt / 180)
      move(candidate)
      if (Math.abs(velocity) < 0.001 || candidate <= 1 || candidate >= 3600) {
        move(Math.round(position.current))
        frame.current = null
      } else frame.current = requestAnimationFrame(coast)
    }
    if (Math.abs(velocity) < 0.001) move(Math.round(position.current))
    else frame.current = requestAnimationFrame(coast)
  }
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      stopMotion()
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
      const pixels =
        delta *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientWidth
            : 1)
      // Trackpads supply their own inertia. Do not apply a second momentum curve.
      move(position.current + pixels / rulerStep)
      wheelEnd.current = setTimeout(
        () => move(Math.round(position.current)),
        120
      )
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [move, stopMotion])
  const nearby = Array.from(
    { length: 121 },
    (_, index) => value - 60 + index
  ).filter((second) => second >= 1 && second <= 3600)
  return (
    <div className="duration-ruler-wrap">
      <div
        ref={ref}
        className="duration-ruler"
        data-vaul-no-drag
        role="slider"
        tabIndex={0}
        aria-label="Custom duration"
        aria-valuemin={1}
        aria-valuemax={3600}
        aria-valuenow={value}
        aria-valuetext={clockLabel(value * 1000)}
        aria-orientation="horizontal"
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return
          stopMotion()
          position.current = value + fraction
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            x: event.clientX,
            time: performance.now(),
            velocity: 0,
            pointer: event.pointerId,
          }
        }}
        onPointerMove={(event) => {
          const gesture = drag.current
          if (!gesture || gesture.pointer !== event.pointerId) return
          const now = performance.now()
          const delta = (gesture.x - event.clientX) / rulerStep
          const dt = Math.max(1, now - gesture.time)
          gesture.velocity = Math.max(
            -0.18,
            Math.min(0.18, (0.7 * delta) / dt + 0.3 * gesture.velocity)
          )
          gesture.x = event.clientX
          gesture.time = now
          move(position.current + delta)
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer === event.pointerId) release()
        }}
        onPointerCancel={() => {
          drag.current = null
          stopMotion()
          move(Math.round(position.current))
        }}
        onLostPointerCapture={() => {
          if (drag.current) {
            drag.current = null
            stopMotion()
            move(Math.round(position.current))
          }
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1
          const next = {
            ArrowRight: value + step,
            ArrowUp: value + step,
            ArrowLeft: value - step,
            ArrowDown: value - step,
            PageUp: value + 60,
            PageDown: value - 60,
            Home: 1,
            End: 3600,
          }[event.key]
          if (next !== undefined) {
            event.preventDefault()
            stopMotion()
            move(clampDuration(next))
          }
        }}
      >
        <div className="duration-ruler-track" aria-hidden="true">
          {nearby.map((second) => (
            <span
              key={second}
              className={`duration-tick ${second % 10 === 0 ? "is-major" : ""}`}
              style={{
                left: `calc(50% + ${(second - value - fraction) * rulerStep}px)`,
              }}
            >
              {second % 10 === 0 && <span>{clockLabel(second * 1000)}</span>}
            </span>
          ))}
        </div>
        <span className="duration-ruler-marker" aria-hidden="true" />
      </div>
    </div>
  )
}
