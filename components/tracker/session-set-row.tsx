"use client"

import { useState } from "react"
import {
  Check,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  SkipForward,
  Trash2,
  Settings2,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ActionMenu } from "./responsive-panel"
import type {
  LoadValue,
  SetResult,
  SetTarget,
  TrackingField,
  WorkoutItem,
} from "@/contracts/models"
import { trackingFields } from "@/contracts/training"
import { isHistoricalCommentary, prescriptionLabel } from "@/lib/presentation"
import { Field, Modal, NativeSelect, Numeric, loadLabel } from "./shared"

const basisLabels: Record<LoadValue["basis"], string> = {
  total: "Total",
  per_hand: "Each hand",
  added: "Added",
  bodyweight: "Bodyweight",
  assistance: "Assistance",
  unknown: "Unspecified",
}
export function EntryUnits({
  prefix,
  value,
  onChange,
}: {
  prefix: string
  value: LoadValue
  onChange: (value: LoadValue) => void
}) {
  return (
    <div className="entry-unit-controls">
      <Field label="Weight unit">
        <NativeSelect
          label={`${prefix} unit`}
          value={value.unit}
          onChange={(unit) =>
            onChange({ ...value, unit: unit as LoadValue["unit"] })
          }
        >
          <option value="lb">lb</option>
          <option value="kg">kg</option>
          <option value="unknown">Unspecified</option>
        </NativeSelect>
      </Field>
      <Field label="Weight applies to">
        <NativeSelect
          label={`${prefix} load basis`}
          value={value.basis}
          onChange={(basis) =>
            onChange({ ...value, basis: basis as LoadValue["basis"] })
          }
        >
          {Object.entries(basisLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  )
}
export function defaultEntryLoad(item: WorkoutItem): LoadValue {
  const target = item.sets.find((set) => set.load)?.load
  return target
    ? { ...target, value: null }
    : { value: null, unit: "lb", basis: "total" }
}
export function hasEnteredResult(result: SetResult | undefined) {
  return (
    !!result &&
    (result.reps !== null ||
      (result.load?.value !== null && result.load?.value !== undefined) ||
      result.durationSeconds !== null ||
      result.distanceMeters !== null ||
      result.rir !== null ||
      !!result.notes ||
      !!result.userNotes)
  )
}
function fieldLabel(field: TrackingField, load: LoadValue) {
  if (field === "reps") return "Reps"
  if (field === "durationSeconds") return "Time (s)"
  if (field === "distanceMeters") return "Distance (m)"
  return `Weight${load.unit === "unknown" ? "" : ` (${load.unit})`}`
}
function fieldAria(field: TrackingField) {
  return {
    reps: "actual reps",
    load: "actual weight",
    durationSeconds: "actual seconds",
    distanceMeters: "actual meters",
  }[field]
}

function orderedFields(item: WorkoutItem) {
  const fields = trackingFields(item)
  return (
    ["load", "reps", "durationSeconds", "distanceMeters"] as const
  ).filter((field) => fields.includes(field))
}

function previousLabel(set: SetResult) {
  const parts = []
  if (set.load?.value != null) parts.push(loadLabel(set.load))
  if (set.reps != null) parts.push(`${set.reps}${parts.length ? "" : " reps"}`)
  const strength = parts.join(" × ")
  return (
    [
      strength,
      set.durationSeconds != null ? `${set.durationSeconds}s` : "",
      set.distanceMeters != null ? `${set.distanceMeters}m` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  )
}

export function SessionSetHeader({
  item,
  entryLoad,
}: {
  item: WorkoutItem
  entryLoad: LoadValue
}) {
  const fields = orderedFields(item)
  return (
    <div className="session-set-header session-set-main" aria-hidden="true">
      <span>Set</span>
      <span>Previous</span>
      <div
        className="session-set-columns"
        style={{
          gridTemplateColumns: `repeat(${Math.min(fields.length, 2)}, minmax(0, 1fr))`,
        }}
      >
        {fields.length <= 2 ? (
          fields.map((field) => (
            <span key={field}>{fieldLabel(field, entryLoad)}</span>
          ))
        ) : (
          <span>Result</span>
        )}
      </div>
      <span />
    </div>
  )
}

export function SessionSetRow({
  item,
  index,
  target,
  result,
  previous,
  entryLoad,
  showTarget = false,
  readOnly = false,
  onPatch,
  onRemove,
  onUndo,
  onSkip,
}: {
  item: WorkoutItem
  index: number
  target: SetTarget | null
  result?: SetResult
  previous?: SetResult
  entryLoad: LoadValue
  showTarget?: boolean
  readOnly?: boolean
  onPatch: (patch: Partial<SetResult>) => void
  onRemove: () => void
  onUndo: () => void
  onSkip: () => void
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [unitsOpen, setUnitsOpen] = useState(false)
  const fields = orderedFields(item)
  const load = result?.load ?? entryLoad
  const prefix = `${item.name} set ${index + 1}`
  const isSkipped = result?.status === "skipped"
  const isComplete = result?.status === "completed"
  const hasOverride =
    !!result?.load &&
    (load.unit !== entryLoad.unit || load.basis !== entryLoad.basis)
  const separateNotes =
    result?.userNotes !== undefined ||
    isHistoricalCommentary(result?.notes ?? "")
  const note = separateNotes ? (result?.userNotes ?? "") : (result?.notes ?? "")
  return (
    <div
      id={`set-${target?.id ?? result?.id}`}
      className={`session-set-row ${isComplete ? "set-is-complete" : isSkipped ? "set-is-skipped" : ""}`}
      data-completion={result?.status ?? "unlogged"}
    >
      <div className="session-set-main">
        <div className="session-set-identity">
          <span className="set-index text-sm font-medium">
            {target?.kind === "warmup" ? "W" : index + 1}
          </span>
          {isComplete && (
            <Check
              size={14}
              className="text-primary"
              aria-label="Set complete"
            />
          )}
          {isSkipped && <SkipForward size={12} aria-label="Set skipped" />}
        </div>
        <div className="session-set-reference">
          <span>{previous ? previousLabel(previous) : "—"}</span>
          {showTarget && target && (
            <small>Target: {prescriptionLabel(target)}</small>
          )}
        </div>
        <div
          className={`session-set-actual session-set-columns ${fields.length > 2 ? "multi-metric" : ""}`}
          style={{
            gridTemplateColumns: `repeat(${Math.min(fields.length, 2)}, minmax(0, 1fr))`,
          }}
        >
          {fields.map((field) => (
            <Field
              key={field}
              label={fieldLabel(field, load)}
              className="session-actual-field !mb-0"
            >
              <Numeric
                readOnly={readOnly}
                label={`${prefix} ${fieldAria(field)}`}
                value={
                  field === "load"
                    ? (result?.load?.value ?? null)
                    : (result?.[field] ?? null)
                }
                onChange={(value) =>
                  onPatch(
                    field === "load"
                      ? { load: { ...load, value } }
                      : { [field]: value }
                  )
                }
              />
            </Field>
          ))}
        </div>
        {!readOnly ? (
          <ActionMenu
            label={`${prefix} actions`}
            trigger={<MoreHorizontal size={17} />}
            actions={[
              {
                label: note ? "Edit note" : "Add note",
                icon: MessageSquare,
                onSelect: () => setNoteOpen(true),
              },
              ...(fields.includes("load")
                ? [
                    {
                      label: "Set-specific units",
                      icon: Settings2,
                      onSelect: () => setUnitsOpen(true),
                    },
                  ]
                : []),
              {
                label: isSkipped ? "Undo skip" : "Skip set",
                icon: isSkipped ? Undo2 : SkipForward,
                onSelect: onSkip,
              },
              ...(hasEnteredResult(result)
                ? [{ label: "Clear entry", icon: RotateCcw, onSelect: onUndo }]
                : []),
              {
                label: "Remove set",
                icon: Trash2,
                destructive: true,
                separator: true,
                onSelect: onRemove,
              },
            ]}
          />
        ) : (
          <span />
        )}
      </div>
      {hasOverride && !unitsOpen && (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2"
          disabled={readOnly}
          onClick={() => setUnitsOpen(true)}
        >
          Recorded in{" "}
          {load.unit === "unknown" ? "unspecified units" : load.unit} ·{" "}
          {basisLabels[load.basis]}
        </button>
      )}
      {unitsOpen && !readOnly && (
        <Modal title={`${prefix} units`} onClose={() => setUnitsOpen(false)}>
          <p className="mb-2 text-xs text-muted-foreground">
            Units for this set. Changing the label does not convert its weight.
          </p>
          <EntryUnits
            prefix={prefix}
            value={load}
            onChange={(value) => onPatch({ load: value })}
          />
        </Modal>
      )}
      {readOnly && note && <p className="set-note-text">{note}</p>}
      {!readOnly && note && !noteOpen && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          onClick={() => setNoteOpen(true)}
        >
          <MessageSquare size={13} />
          Set note
        </Button>
      )}
      {noteOpen && !readOnly && (
        <Modal title={`${prefix} note`} onClose={() => setNoteOpen(false)}>
          <Field label={`Set ${index + 1} note`}>
            <Textarea
              autoFocus
              placeholder="Optional note…"
              value={note}
              onChange={(event) =>
                onPatch(
                  separateNotes
                    ? { userNotes: event.target.value }
                    : { notes: event.target.value }
                )
              }
            />
          </Field>
          <Button variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
            Close note
          </Button>
        </Modal>
      )}
    </div>
  )
}
