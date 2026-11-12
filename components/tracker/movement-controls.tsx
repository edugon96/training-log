"use client"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkoutItem } from "@/contracts/models"
import { ResponsivePanel } from "./responsive-panel"
import { Field, Numeric } from "./shared"

export function MovementRestPanel({
  name,
  rest,
  onChange,
  onClose,
}: {
  name: string
  rest: Pick<WorkoutItem, "restSeconds" | "automaticRest">
  onChange: (patch: Pick<WorkoutItem, "restSeconds" | "automaticRest">) => void
  onClose: () => void
}) {
  return (
    <ResponsivePanel title="Rest Timer" description={name} onClose={onClose}>
      <div className="rest-duration-options">
        {[0, 30, 60, 90, 120, 180].map((seconds) => (
          <button
            type="button"
            key={seconds}
            aria-pressed={(rest.restSeconds ?? 0) === seconds}
            onClick={() =>
              onChange({
                restSeconds: seconds || null,
                automaticRest: seconds > 0,
              })
            }
          >
            {seconds
              ? `${Math.floor(seconds / 60) ? `${Math.floor(seconds / 60)}m` : ""}${seconds % 60 ? ` ${seconds % 60}s` : ""}`.trim()
              : "Off"}
          </button>
        ))}
      </div>
      <Field label="Custom duration (seconds)">
        <Numeric
          label="Rest seconds"
          value={rest.restSeconds ?? null}
          onChange={(seconds) =>
            onChange({
              restSeconds: seconds,
              automaticRest: !!seconds && (rest.automaticRest ?? true),
            })
          }
        />
      </Field>
      <label className="check-label">
        <input
          type="checkbox"
          checked={rest.automaticRest ?? false}
          onChange={(event) =>
            onChange({
              restSeconds:
                rest.restSeconds || (event.target.checked ? 60 : null),
              automaticRest: event.target.checked,
            })
          }
        />
        Start rest automatically after a set
      </label>
      <Button className="mt-5 w-full" onClick={onClose}>
        Done
      </Button>
    </ResponsivePanel>
  )
}
export function RepetitionOptions({
  range,
  onChange,
  onClose,
}: {
  range: boolean
  onChange: (range: boolean) => void
  onClose: () => void
}) {
  return (
    <ResponsivePanel title="Repetition Options" onClose={onClose}>
      <div
        className="repetition-options"
        role="menu"
        aria-label="Repetition Options"
      >
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            role="menuitemradio"
            aria-checked={range === value}
            onClick={() => {
              onChange(value)
              onClose()
            }}
          >
            {value ? "Rep Range" : "Reps"}
            {range === value && <Check size={21} />}
          </button>
        ))}
      </div>
    </ResponsivePanel>
  )
}
