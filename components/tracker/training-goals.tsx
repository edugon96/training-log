"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  muscleLabels,
  muscleNames,
  type TrainingDefaultsRecord,
  type WeekRecord,
} from "@/contracts/models"
import { api } from "@/lib/api-client"
import { Field, Modal, errorMessage } from "./shared"

export function TrainingGoals({
  defaults,
  week,
  initialMode = "defaults",
  onClose,
  onRefresh,
}: {
  defaults: TrainingDefaultsRecord
  week?: WeekRecord
  initialMode?: "defaults" | "week"
  onClose: () => void
  onRefresh: () => Promise<void>
}) {
  const [mode, setMode] = useState<"defaults" | "week">(
    week ? initialMode : "defaults"
  )
  const [savedDefaults, setSavedDefaults] = useState(defaults)
  const [defaultDraft, setDefaultDraft] = useState({ ...defaults.targets })
  const [weekDraft, setWeekDraft] = useState({
    ...(week?.targets ?? defaults.targets),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const targets = mode === "defaults" ? defaultDraft : weekDraft
  const valid = Object.values(targets).every(
    (v) => Number.isInteger(v) && v >= 0 && v <= 1000
  )

  async function save(applyDefault = false) {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      if (mode === "defaults" && !applyDefault) {
        const saved = await api.saveTrainingDefaults({
          ...savedDefaults,
          targets: defaultDraft,
        })
        setSavedDefaults(saved)
        setDefaultDraft({ ...saved.targets })
        setMessage("Defaults saved. Existing weeks are unchanged.")
      } else if (week) {
        await api.saveWeek({
          ...week,
          targets: applyDefault ? savedDefaults.targets : weekDraft,
        })
        await onRefresh()
        onClose()
        return
      }
      await onRefresh()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Training goals"
      description="Weekly working-set targets by muscle."
      dirty={
        JSON.stringify(defaultDraft) !==
          JSON.stringify(savedDefaults.targets) ||
        (!!week && JSON.stringify(weekDraft) !== JSON.stringify(week.targets))
      }
      onClose={onClose}
    >
      <div className="segmented">
        <button
          className={mode === "defaults" ? "active" : ""}
          onClick={() => {
            setMode("defaults")
            setMessage("")
          }}
        >
          Saved defaults
        </button>
        {week && (
          <button
            className={mode === "week" ? "active" : ""}
            onClick={() => {
              setMode("week")
              setMessage("")
            }}
          >
            This week
          </button>
        )}
      </div>
      <p className="muted">
        {mode === "defaults"
          ? "Used for new and repeated weeks. Existing weeks keep their targets."
          : "Override this week's targets without changing your saved defaults."}
      </p>
      <div className="target-grid">
        {muscleNames.map((m) => (
          <Field label={muscleLabels[m]} key={m}>
            <Input
              type="number"
              min={0}
              max={1000}
              step={1}
              inputMode="numeric"
              aria-label={`${muscleLabels[m]} target`}
              value={targets[m]}
              onChange={(e) => {
                const value = e.target.value === "" ? 0 : Number(e.target.value)
                if (mode === "defaults")
                  setDefaultDraft({ ...defaultDraft, [m]: value })
                else setWeekDraft({ ...weekDraft, [m]: value })
              }}
            />
          </Field>
        ))}
      </div>
      <p className="muted">
        {Object.values(targets).reduce((a, b) => a + b, 0)} sets per week
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="dialog-footer">
        {mode === "week" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Apply saved defaults
          </Button>
        )}
        <Button disabled={busy || !valid} onClick={() => void save()}>
          {busy
            ? "Saving…"
            : mode === "defaults"
              ? "Save defaults"
              : "Save week override"}
        </Button>
      </div>
    </Modal>
  )
}
