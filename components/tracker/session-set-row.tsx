"use client"

import { useState, type ReactNode } from "react"
import { Check, MessageSquare, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SwipeDeleteRow } from "./swipe-delete-row"
import { Textarea } from "@/components/ui/textarea"
import { SetTypeMenu, setMark, setNumber } from "./set-type-menu"
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
export function defaultEntryLoad(
  item: WorkoutItem,
  previous?: LoadValue | null
): LoadValue {
  const target =
    item.sets.find((set) => set.load?.value != null)?.load ??
    previous ??
    item.sets.find((set) => set.load)?.load
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
  onUnits,
}: {
  onUnits?: () => void
  item: WorkoutItem
  entryLoad: LoadValue
}) {
  const fields = orderedFields(item)
  return (
    <div className="session-set-header session-set-main">
      <span>Set</span>
      <span>Previous</span>
      <div
        className="session-set-columns"
        style={{
          gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))`,
        }}
      >
        {fields.map((field) =>
          field === "load" && onUnits ? (
            <button
              key={field}
              onClick={onUnits}
              aria-label={`${item.name} weight units`}
            >
              {field === "load"
                ? entryLoad.unit === "lb"
                  ? "LBS"
                  : entryLoad.unit === "kg"
                    ? "KG"
                    : "Weight"
                : fieldLabel(field, entryLoad)}
            </button>
          ) : (
            <span key={field}>
              {field === "load"
                ? entryLoad.unit === "lb"
                  ? "LBS"
                  : entryLoad.unit === "kg"
                    ? "KG"
                    : "Weight"
                : fieldLabel(field, entryLoad)}
            </span>
          )
        )}
      </div>
      <span aria-label="Completed">
        <Check size={16} />
      </span>
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
  suggestion,
  onCheck,
  onType,
  detailsOpen = false,
  detailsSelector,
  onCloseDetails,
  onTargetPatch,
}: {
  detailsSelector?: ReactNode
  detailsOpen?: boolean
  onCloseDetails?: () => void
  onTargetPatch?: (patch: Partial<SetTarget>) => void
  suggestion?: Partial<SetResult>
  onCheck?: () => void
  onType?: (kind: SetTarget["kind"]) => void
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
  const [localDetailsOpen, setLocalDetailsOpen] = useState(false)
  const openDetails = detailsOpen || localDetailsOpen
  const closeDetails = () => {
    setLocalDetailsOpen(false)
    onCloseDetails?.()
  }
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
    <SwipeDeleteRow
      label={prefix}
      onDelete={onRemove}
      disabled={readOnly}
      className="session-set-swipe"
    >
      <div
        id={`set-${target?.id ?? result?.id}`}
        className={`session-set-row ${isComplete ? "set-is-complete" : isSkipped ? "set-is-skipped" : ""}`}
        data-completion={result?.status ?? "unlogged"}
      >
        <div className="session-set-main">
          {!readOnly ? (
            <SetTypeMenu
              label={`${prefix} type`}
              kind={target?.kind ?? "working"}
              number={
                target
                  ? setNumber(item.sets, index)
                  : setNumber(item.sets, item.sets.length - 1) +
                    index -
                    item.sets.length +
                    1
              }
              onChange={onType}
              onRemove={onRemove}
            />
          ) : (
            <span
              className={`set-type-trigger set-mark set-${target?.kind ?? "working"}`}
            >
              {setMark(
                target?.kind ?? "working",
                target ? setNumber(item.sets, index) : index + 1
              )}
            </span>
          )}
          <div className="session-set-reference">
            <span>{previous ? previousLabel(previous) : "—"}</span>
            {showTarget && target && (
              <small>Target: {prescriptionLabel(target)}</small>
            )}
          </div>
          <div
            className={`session-set-actual session-set-columns ${fields.length > 2 ? "multi-metric" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))`,
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
                  placeholder={String(
                    (field === "load"
                      ? suggestion?.load?.value
                      : suggestion?.[field]) ?? "—"
                  )}
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
          <button
            type="button"
            className="set-check"
            aria-label={`${prefix} ${isComplete ? "uncheck" : "complete"}`}
            aria-pressed={isComplete}
            disabled={readOnly}
            onClick={onCheck}
          >
            {isSkipped ? (
              <SkipForward size={17} />
            ) : (
              <Check size={20} strokeWidth={1.8} />
            )}
          </button>
        </div>
        {hasOverride && (
          <button
            type="button"
            className="set-note-text"
            disabled={readOnly}
            onClick={() => setLocalDetailsOpen(true)}
          >
            Recorded in {load.unit} · {basisLabels[load.basis]}
          </button>
        )}
        {note &&
          (readOnly ? (
            <p className="set-note-text">{note}</p>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocalDetailsOpen(true)}
            >
              <MessageSquare size={13} /> Set note
            </Button>
          ))}
        {openDetails && !readOnly && (
          <Modal title="Set Details" onClose={closeDetails}>
            <p className="muted mb-4 text-sm">{prefix}</p>
            {detailsSelector}
            <Field label="RIR">
              <Numeric
                label={`${prefix} RIR`}
                value={result?.rir ?? null}
                onChange={(rir) => onPatch({ rir })}
              />
            </Field>
            {target && onTargetPatch && (
              <Field label="Tempo">
                <Input
                  aria-label={`${prefix} tempo`}
                  value={target.tempo}
                  onChange={(event) =>
                    onTargetPatch({ tempo: event.target.value })
                  }
                />
              </Field>
            )}
            {fields.includes("load") && (
              <EntryUnits
                prefix={prefix}
                value={load}
                onChange={(value) => onPatch({ load: value })}
              />
            )}
            {target?.notes && <p className="set-note-text">{target.notes}</p>}
            <Field label="Set note">
              <Textarea
                aria-label={`${prefix} note`}
                placeholder="Optional"
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
            <div className="dialog-footer">
              <Button variant="outline" onClick={onSkip}>
                {isSkipped ? "Undo skip" : "Skip set"}
              </Button>
              {hasEnteredResult(result) && (
                <Button variant="outline" onClick={onUndo}>
                  Clear entry
                </Button>
              )}
              <Button onClick={closeDetails}>Done</Button>
            </div>
          </Modal>
        )}
      </div>
    </SwipeDeleteRow>
  )
}
