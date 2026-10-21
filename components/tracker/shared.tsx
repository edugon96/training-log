"use client"

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  MessageSquare,
  X,
} from "lucide-react"
import { Popover } from "radix-ui"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cleanInstructions } from "@/lib/presentation"
import { ResponsivePanel, useMobilePanel } from "./responsive-panel"
import type { LoadValue, SetResult, SetTarget } from "@/contracts/models"

export function dateLabel(
  value: string | null,
  options?: Intl.DateTimeFormatOptions
) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString(
        "en-US",
        options ?? { month: "short", day: "numeric" }
      )
    : "Unscheduled"
}
export function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function numberValue(value: string) {
  return value === "" ? null : Number(value)
}
export function loadLabel(load: LoadValue | null) {
  if (!load) return ""
  const value = load.value === null ? "?" : String(load.value)
  if (load.basis === "bodyweight" && load.value === null) return "BW"
  const suffix = {
    total: "",
    per_hand: " / hand",
    added: " added",
    bodyweight: " + BW",
    assistance: " assisted",
    unknown: "",
  }[load.basis]
  return `${value}${load.unit === "unknown" ? "" : ` ${load.unit}`}${suffix}`
}
export function setLabel(set: SetTarget | SetResult) {
  const parts: string[] = []
  if ("repsMin" in set && set.repsMin !== null)
    parts.push(
      `${set.repsMin}${set.repsMax !== null && set.repsMax !== set.repsMin ? `–${set.repsMax}` : ""} reps`
    )
  if ("reps" in set && set.reps !== null) parts.push(`${set.reps} reps`)
  if (set.load) parts.push(loadLabel(set.load))
  if (set.durationSeconds !== null) parts.push(`${set.durationSeconds}s`)
  if (set.distanceMeters !== null) parts.push(`${set.distanceMeters}m`)
  return parts.join(" · ") || "Not specified"
}
export function Field({
  label,
  children,
  className = "",
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}
export function Numeric({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string
  value: number | null
  readOnly?: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <Input
      aria-label={label}
      readOnly={readOnly}
      type="number"
      min={0}
      step="any"
      inputMode="decimal"
      placeholder="—"
      value={value ?? ""}
      onChange={(event) => onChange(numberValue(event.target.value))}
    />
  )
}
export function NativeSelect({
  label,
  value,
  onChange,
  children,
  className = "",
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  const mobile = useMobilePanel()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const options = Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string
        children?: ReactNode
        disabled?: boolean
      }>(child)
    )
      return []
    const text = Children.toArray(child.props.children).join("")
    return [
      {
        value: child.props.value ?? text,
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ]
  })
  if (mobile)
    return (
      <>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-controls={listId}
          aria-expanded={open}
          disabled={disabled}
          className={`native-select ${className}`}
          onClick={() => setOpen(true)}
        >
          <span data-slot="select-value">
            {options.find((option) => option.value === value)?.label ??
              "Select"}
          </span>
          <ChevronDown size={16} />
        </Button>
        {open && (
          <Modal title={label} onClose={() => setOpen(false)}>
            <div
              id={listId}
              onKeyDown={optionKeys}
              role="listbox"
              aria-label={label}
              className="panel-options"
            >
              {options.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  key={option.value}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value && <Check size={16} />}
                </button>
              ))}
            </div>
          </Modal>
        )}
      </>
    )
  return (
    <Select
      disabled={disabled}
      value={value || "__empty"}
      onValueChange={(v) => onChange(v === "__empty" ? "" : v)}
    >
      <SelectTrigger
        className={`native-select ${className}`}
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((option) => (
          <SelectItem
            key={option.value || "__empty"}
            value={option.value || "__empty"}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function optionKeys(event: import("react").KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)"
    ),
  ]
  if (!buttons.length) return
  event.preventDefault()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) %
          buttons.length
  buttons[next]?.focus()
}
function PickerPopover({
  label,
  open,
  onOpenChange,
  trigger,
  children,
}: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactElement<{ onClick?: () => void }>
  children: ReactNode
}) {
  const mobile = useMobilePanel()
  if (mobile)
    return (
      <>
        {cloneElement(trigger, { onClick: () => onOpenChange(true) })}
        {open && (
          <Modal title={label} onClose={() => onOpenChange(false)}>
            {children}
          </Modal>
        )}
      </>
    )
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="combo-popover" sideOffset={6} align="start">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ComboSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Select or add…",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const listId = useId()
  const matches = [...new Set(options)].filter((v) =>
    v.toLowerCase().includes(query.trim().toLowerCase())
  )
  const existing = options.find(
    (v) => v.toLowerCase() === query.trim().toLowerCase()
  )
  const choose = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery("")
  }
  return (
    <PickerPopover
      label={label}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
      trigger={
        <Button
          variant="outline"
          className="combo-trigger"
          role="combobox"
          aria-label={label}
          aria-controls={listId}
          aria-expanded={open}
        >
          <span>{value || placeholder}</span>
          <ChevronDown size={16} />
        </Button>
      }
    >
      <Input
        aria-label={`Search ${label}`}
        placeholder="Search or type a new value…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault()
            document
              .getElementById(listId)
              ?.querySelector<HTMLButtonElement>("button")
              ?.focus()
          }
          if (event.key === "Enter" && query.trim()) {
            event.preventDefault()
            choose(existing ?? query.trim())
          }
        }}
      />
      <div
        id={listId}
        onKeyDown={optionKeys}
        role="listbox"
        aria-label={`${label} options`}
        className="panel-options"
      >
        <button
          type="button"
          role="option"
          aria-selected={!value}
          onClick={() => choose("")}
        >
          Not specified
        </button>
        {matches.map((v) => (
          <button
            type="button"
            key={v}
            role="option"
            aria-selected={value === v}
            onClick={() => choose(v)}
          >
            {v}
          </button>
        ))}
        {query.trim() && !existing && (
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => choose(query.trim())}
          >
            Add “{query.trim()}”
          </button>
        )}
      </div>
    </PickerPopover>
  )
}
export function MultiSelect({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: { value: string; label: string }[]
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const listId = useId()
  const matches = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase())
  )
  const toggle = (value: string) =>
    onChange(
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value]
    )
  return (
    <div className="multi-select">
      <span className="multi-select-label">{label}</span>
      <div className="multi-select-control">
        {values.map((value) => (
          <span className="selection-chip" key={value}>
            {options.find((option) => option.value === value)?.label ?? value}
            <button
              type="button"
              aria-label={`Remove ${options.find((option) => option.value === value)?.label ?? value}`}
              onClick={() => toggle(value)}
            >
              <X size={13} />
            </button>
          </span>
        ))}
        <PickerPopover
          label={label}
          open={open}
          onOpenChange={(value) => {
            setOpen(value)
            if (!value) setQuery("")
          }}
          trigger={
            <button
              type="button"
              className="multi-select-trigger"
              role="combobox"
              aria-label={label}
              aria-controls={listId}
              aria-expanded={open}
            >
              <span>{values.length ? "Add muscle" : "Select muscles"}</span>
              <ChevronDown size={16} />
            </button>
          }
        >
          <Input
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Search muscles…"
            value={query}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                document
                  .getElementById(listId)
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus()
              }
            }}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div
            id={listId}
            onKeyDown={optionKeys}
            role="listbox"
            aria-label={`${label} options`}
            aria-multiselectable="true"
            className="panel-options"
          >
            {matches.map((option) => (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={values.includes(option.value)}
                onClick={() => toggle(option.value)}
              >
                <span>{option.label}</span>
                {values.includes(option.value) && <Check size={16} />}
              </button>
            ))}
            {!matches.length && (
              <p className="muted p-3 text-sm">No matching muscles</p>
            )}
          </div>
          <div className="multi-select-footer">
            <Button
              variant="ghost"
              size="sm"
              disabled={!values.length}
              onClick={() => onChange([])}
            >
              Clear all
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PickerPopover>
      </div>
    </div>
  )
}
export function Instructions({ text }: { text: string }) {
  const content = cleanInstructions(text)
  if (!content) return null
  return (
    <aside className="instructions">
      <span className="instructions-label">Instructions</span>
      <div className="markdown-note">
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          allowedElements={[
            "p",
            "strong",
            "em",
            "ul",
            "ol",
            "li",
            "a",
            "br",
            "code",
            "blockquote",
            "del",
          ]}
        >
          {content}
        </Markdown>
      </div>
    </aside>
  )
}
export function OptionalNote({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <details className="optional-note">
      <summary>
        <MessageSquare size={14} />
        {value ? label : `Add ${label.toLowerCase()}`}
        {value && <span className="note-dot" />}
      </summary>
      <Textarea
        aria-label={label}
        placeholder="Add a note…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </details>
  )
}
export function LoadEditor({
  value,
  onChange,
  prefix = "Load",
}: {
  value: LoadValue | null
  onChange: (value: LoadValue | null) => void
  prefix?: string
}) {
  const current: LoadValue = value ?? {
    value: null,
    unit: "lb",
    basis: "total",
  }
  return (
    <div className="load-editor">
      <Numeric
        label={`${prefix} weight`}
        value={value?.value ?? null}
        onChange={(v) => onChange({ ...current, value: v })}
      />
      <NativeSelect
        label={`${prefix} unit`}
        value={current.unit}
        onChange={(unit) =>
          onChange({ ...current, unit: unit as LoadValue["unit"] })
        }
      >
        <option value="lb">lb</option>
        <option value="kg">kg</option>
        <option value="unknown">?</option>
      </NativeSelect>
      <NativeSelect
        label={`${prefix} basis`}
        value={current.basis}
        onChange={(basis) =>
          onChange({ ...current, basis: basis as LoadValue["basis"] })
        }
      >
        <option value="total">Total</option>
        <option value="per_hand">Each hand</option>
        <option value="added">Added</option>
        <option value="bodyweight">Bodyweight</option>
        <option value="assistance">Assistance</option>
        <option value="unknown">Unknown</option>
      </NativeSelect>
    </div>
  )
}
export function MoveButtons({
  label,
  index,
  length,
  onMove,
  onRemove,
}: {
  label: string
  index: number
  length: number
  onMove: (direction: number) => void
  onRemove: () => void
}) {
  return (
    <div className="icon-actions">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={15} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} down`}
        disabled={index === length - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={15} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <X size={15} />
      </Button>
    </div>
  )
}
export function move<T>(values: T[], index: number, direction: number) {
  const copy = [...values]
  const target = index + direction
  if (target < 0 || target >= copy.length) return copy
  ;[copy[index], copy[target]] = [copy[target], copy[index]]
  return copy
}
export function Modal(props: {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  dirty?: boolean
}) {
  return <ResponsivePanel {...props} />
}
export function Empty({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children}
    </div>
  )
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again."
}
