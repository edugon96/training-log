"use client"
import { useState } from "react"
import { CircleHelp, X } from "lucide-react"
import type { SetTarget } from "@/contracts/models"
import { ResponsivePanel } from "./responsive-panel"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export const setTypes = [
  {
    value: "warmup",
    label: "Warm Up Set",
    mark: "W",
    help: "A lighter set to prepare for your working sets. Warm-up sets are excluded from your working-set count.",
  },
  {
    value: "working",
    label: "Normal Set",
    mark: "1",
    help: "A regular working set using the planned weight and repetitions.",
  },
  {
    value: "failure",
    label: "Failure Set",
    mark: "F",
    help: "A working set taken until you cannot complete another repetition with good form.",
  },
  {
    value: "drop",
    label: "Drop Set",
    mark: "D",
    help: "Reduce the weight and continue after the preceding set. Automatic rest waits until after the drop set.",
  },
] as const
export function setNumber(sets: Pick<SetTarget, "kind">[], index: number) {
  return sets
    .slice(0, index + 1)
    .filter((set) => set.kind === "working" || set.kind === "failure").length
}
export function setMark(kind: SetTarget["kind"], number: number) {
  return kind === "warmup"
    ? "W"
    : kind === "failure"
      ? "F"
      : kind === "drop"
        ? "D"
        : number
}
export function SetTypeMenu({
  label,
  kind,
  number,
  onChange,
  onRemove,
}: {
  label: string
  kind: SetTarget["kind"]
  number: number
  onChange?: (kind: SetTarget["kind"]) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [help, setHelp] = useState<(typeof setTypes)[number] | null>(null)
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`set-type-trigger set-mark set-${kind}`}
        onClick={() => setOpen(true)}
      >
        {setMark(kind, number)}
      </button>
      {open && (
        <ResponsivePanel title="Select Set Type" onClose={() => setOpen(false)}>
          <div
            className="set-type-options"
            role="menu"
            aria-label="Select Set Type"
          >
            {onChange &&
              setTypes.map((type) => (
                <div className="set-type-option" key={type.value}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={kind === type.value}
                    onClick={() => {
                      onChange(type.value)
                      setOpen(false)
                    }}
                  >
                    <span className={`set-mark set-${type.value}`}>
                      {type.mark}
                    </span>
                    <span>{type.label}</span>
                  </button>
                  <button
                    type="button"
                    className="set-type-help"
                    aria-label={`About ${type.label}`}
                    onClick={() => setHelp(type)}
                  >
                    <CircleHelp size={19} />
                  </button>
                </div>
              ))}
            <button
              type="button"
              role="menuitem"
              className="set-type-remove"
              onClick={() => {
                setOpen(false)
                onRemove()
              }}
            >
              <X size={21} />
              <span>Remove Set</span>
            </button>
          </div>
          {help && (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) setHelp(null)
              }}
            >
              <DialogContent
                className="set-help-dialog"
                overlayClassName="set-help-overlay"
                showCloseButton={false}
              >
                <DialogTitle>{help.label}</DialogTitle>
                <DialogDescription>{help.help}</DialogDescription>
                <Button className="w-full" onClick={() => setHelp(null)}>
                  OK
                </Button>
              </DialogContent>
            </Dialog>
          )}
        </ResponsivePanel>
      )}
    </>
  )
}
