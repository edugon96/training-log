"use client"
import { useRef, useState, type ReactNode } from "react"

const revealWidth = 75

/** Reveal only. Swiping never deletes until the Delete button is tapped. */
export function SwipeDeleteRow({
  children,
  label,
  onDelete,
  disabled = false,
  className = "",
}: {
  children: ReactNode
  label: string
  onDelete: () => void
  disabled?: boolean
  className?: string
}) {
  const [offset, setOffset] = useState(0)
  const gesture = useRef<{
    x: number
    y: number
    start: number
    axis: "x" | "y" | null
  } | null>(null)
  const dragged = useRef(false)
  const offsetRef = useRef(0)
  function position(value: number) {
    offsetRef.current = value
    setOffset(value)
  }
  return (
    <div className={`swipe-delete-row ${className}`} data-revealed={offset < 0}>
      {!disabled && (
        <button
          type="button"
          className="swipe-delete-action"
          style={{ width: revealWidth }}
          aria-label={`Delete ${label}`}
          tabIndex={offset < 0 ? 0 : -1}
          aria-hidden={offset === 0}
          onClick={onDelete}
        >
          Delete
        </button>
      )}
      <div
        className="swipe-delete-content"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return
          dragged.current = false
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            start: offsetRef.current,
            axis: null,
          }
        }}
        onPointerMove={(event) => {
          const current = gesture.current
          if (!current) return
          const dx = event.clientX - current.x,
            dy = event.clientY - current.y
          if (!current.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
            current.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y"
            if (current.axis === "x")
              event.currentTarget.setPointerCapture(event.pointerId)
          }
          if (current.axis !== "x") return
          dragged.current = true
          position(Math.max(-revealWidth, Math.min(0, current.start + dx)))
        }}
        onPointerUp={() => {
          if (gesture.current?.axis === "x")
            position(offsetRef.current < -revealWidth / 2 ? -revealWidth : 0)
          gesture.current = null
        }}
        onPointerCancel={() => {
          position(gesture.current?.start ?? 0)
          gesture.current = null
        }}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.preventDefault()
            event.stopPropagation()
            dragged.current = false
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") position(0)
        }}
      >
        {children}
      </div>
    </div>
  )
}
