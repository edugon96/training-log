"use client"

import { useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  muscleLabels,
  muscleNames,
  type ExerciseRecord,
  type TrackingField,
} from "@/contracts/models"
import { trackingOptions } from "@/contracts/training"
import { NativeSelect } from "./shared"

export function TrackingFieldsPicker({
  label,
  values,
  onChange,
}: {
  label: string
  values: TrackingField[]
  onChange: (values: TrackingField[]) => void
}) {
  return (
    <fieldset className="tracking-picker my-3">
      <legend className="mb-2 text-xs text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {trackingOptions.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs ${values.includes(option.value) ? "border-primary/30 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}
          >
            <input
              type="checkbox"
              aria-label={`${label}: ${option.label}`}
              checked={values.includes(option.value)}
              disabled={values.length === 1 && values[0] === option.value}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option.value]
                    : values.filter((value) => value !== option.value)
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function WorkoutExercisePicker({
  exercises,
  onSelect,
  label,
}: {
  exercises: ExerciseRecord[]
  onSelect: (exercise: ExerciseRecord) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [muscle, setMuscle] = useState("")
  const [equipment, setEquipment] = useState("")
  const active = exercises.filter((exercise) => !exercise.archived)
  const equipmentNames = [
    ...new Set(active.map((exercise) => exercise.equipment).filter(Boolean)),
  ].sort()
  const filtered = active.filter(
    (exercise) =>
      (!muscle ||
        exercise.primaryMuscle === muscle ||
        exercise.secondaryMuscles.includes(muscle)) &&
      (!equipment || exercise.equipment === equipment) &&
      `${exercise.name} ${exercise.equipment} ${exercise.setup}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  )
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} />
        {label}
      </Button>
    )
  return (
    <div className="workout-exercise-picker rounded-lg border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Choose a movement</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close movement picker"
          onClick={() => setOpen(false)}
        >
          <X size={15} />
        </Button>
      </div>
      <div className="relative">
        <Search
          size={15}
          className="absolute top-2.5 left-3 text-muted-foreground"
        />
        <Input
          autoFocus
          aria-label="Search movements"
          className="pl-9"
          placeholder="Search movement or machine…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="my-3 grid grid-cols-2 gap-2">
        <NativeSelect
          label="Filter movements by muscle"
          value={muscle}
          onChange={setMuscle}
        >
          <option value="">All muscles</option>
          {muscleNames.map((name) => (
            <option key={name} value={name}>
              {muscleLabels[name]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          label="Filter movements by equipment"
          value={equipment}
          onChange={setEquipment}
        >
          <option value="">All equipment</option>
          {equipmentNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="max-h-64 overflow-y-auto" aria-label="Matching movements">
        {filtered.map((exercise) => (
          <button
            type="button"
            key={exercise.id}
            className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              onSelect(exercise)
              setOpen(false)
              setQuery("")
            }}
          >
            <span>
              <strong className="block text-sm font-medium">
                {exercise.name}
              </strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                {[
                  exercise.primaryMuscle
                    ? muscleLabels[exercise.primaryMuscle]
                    : null,
                  exercise.equipment,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Plus size={15} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
        {!filtered.length && (
          <p className="px-3 py-5 text-center text-sm text-muted-foreground">
            No matching movements. Try another filter.
          </p>
        )}
      </div>
    </div>
  )
}
