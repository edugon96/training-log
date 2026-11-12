"use client"
import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  ClipboardList,
  FilePlus2,
  StickyNote,
  Timer,
  Trash2,
} from "lucide-react"
import type { MovementNoteRecord } from "@/contracts/models"
import {
  ActionMenu,
  ResponsivePanel,
  type MenuAction,
} from "./responsive-panel"
import { SwipeDeleteRow } from "./swipe-delete-row"

export type CardNote = MovementNoteRecord & { scope: "workout" | "session" }
function MovementNoteRow({
  note,
  name,
  autoFocus,
  readOnly,
  onChange,
  onDelete,
}: {
  note: CardNote
  name: string
  autoFocus: boolean
  readOnly: boolean
  onChange: (text: string) => void
  onDelete: () => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [options, setOptions] = useState(false)
  useLayoutEffect(() => {
    const field = input.current
    if (field) {
      field.style.height = "0px"
      field.style.height = `${Math.max(44, field.scrollHeight)}px`
    }
  }, [note.text])
  useLayoutEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])
  const Icon = note.scope === "workout" ? ClipboardList : StickyNote
  return (
    <SwipeDeleteRow
      label={`${name} note`}
      onDelete={onDelete}
      disabled={readOnly}
      className="movement-note-swipe"
    >
      <div className="movement-note" data-note-scope={note.scope}>
        <button
          type="button"
          className="movement-note-icon"
          aria-label={`${name} ${note.scope} note options`}
          disabled={readOnly}
          onClick={() => setOptions(true)}
        >
          <Icon size={19} />
        </button>
        {readOnly ? (
          <p>{note.text}</p>
        ) : (
          <textarea
            ref={input}
            rows={1}
            aria-label={`${name} ${note.scope} note`}
            placeholder={
              note.scope === "workout"
                ? "Add a note for this workout"
                : "Add a note for this session"
            }
            value={note.text}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </div>
      {options && (
        <ResponsivePanel
          title="Note options"
          description={
            note.scope === "workout"
              ? "Workout instructions. Changes made while training apply only to this session."
              : "This note belongs to this session."
          }
          onClose={() => setOptions(false)}
        >
          <button
            type="button"
            className="note-delete-option"
            onClick={() => {
              setOptions(false)
              onDelete()
            }}
          >
            <Trash2 size={19} /> Delete Note
          </button>
        </ResponsivePanel>
      )}
    </SwipeDeleteRow>
  )
}

export function MovementCard({
  name,
  detail,
  notes,
  actions,
  restSeconds,
  onRest,
  onAddNote,
  onChangeNote,
  onDeleteNote,
  readOnly = false,
  children,
  className = "",
}: {
  name: string
  detail?: string
  notes: CardNote[]
  actions: MenuAction[]
  restSeconds: number | null
  onRest: () => void
  onAddNote: (id: string) => void
  onChangeNote: (note: CardNote, text: string) => void
  onDeleteNote: (note: CardNote) => void
  readOnly?: boolean
  children: ReactNode
  className?: string
}) {
  const [focusId, setFocusId] = useState<string | null>(null)
  const rest = restSeconds
    ? `${Math.floor(restSeconds / 60) ? `${Math.floor(restSeconds / 60)}m ` : ""}${restSeconds % 60 ? `${restSeconds % 60}s` : ""}`.trim()
    : "Off"
  return (
    <article className={`movement-card ${className}`} aria-label={name}>
      <div className="movement-card-heading">
        <div className="movement-card-title">
          <h2>{name}</h2>
          {detail && <p>{detail}</p>}
        </div>
        {!readOnly && (
          <ActionMenu
            label={`${name} actions`}

            actions={actions}
          />
        )}
      </div>
      <div className="movement-card-controls">
        <button
          type="button"
          aria-label={`${name} rest timer`}
          disabled={readOnly}
          onClick={onRest}
        >
          <Timer size={17} /> Rest: {rest}
        </button>
        {!readOnly && (
          <button
            type="button"
            aria-label={`Add note to ${name}`}
            onClick={() => {
              const id = crypto.randomUUID()
              setFocusId(id)
              onAddNote(id)
            }}
          >
            <FilePlus2 size={17} /> Note
          </button>
        )}
      </div>
      {notes.length > 0 && (
        <div className="movement-notes">
          {notes.map((note) => (
            <MovementNoteRow
              key={`${note.scope}:${note.id}`}
              note={note}
              name={name}
              autoFocus={focusId === note.id}
              readOnly={readOnly}
              onChange={(text) => onChangeNote(note, text)}
              onDelete={() => onDeleteNote(note)}
            />
          ))}
        </div>
      )}
      {children}
    </article>
  )
}
