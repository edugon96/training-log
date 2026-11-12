"use client"

import { useState } from "react"
import { Check, Plus, Search } from "lucide-react"
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
  single = false,
}: {
  exercises: ExerciseRecord[]
  onSelect: (exercises: ExerciseRecord[]) => void
  single?: boolean
}) {
  const [selected, setSelected] = useState<ExerciseRecord[]>([])
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
  return (
    <div className="workout-exercise-picker">
      <div className="movement-search">
        <Search size={18} aria-hidden="true" />
        <Input
          aria-label="Search movements"
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
      <div className="movement-picker-results" aria-label="Matching movements">
        {filtered.map((exercise) => (
          <button
            type="button"
            key={exercise.id}
            aria-pressed={selected.some((value) => value.id === exercise.id)}
            className="movement-choice"
            onClick={() => {
              setSelected((current) =>
                current.some((value) => value.id === exercise.id)
                  ? current.filter((value) => value.id !== exercise.id)
                  : single
                    ? [exercise]
                    : [...current, exercise]
              )
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
            {selected.some((value) => value.id === exercise.id) ? (
              <Check size={18} className="text-primary" />
            ) : (
              <Plus size={18} className="text-muted-foreground" />
            )}
          </button>
        ))}
        {!filtered.length && (
          <p className="px-3 py-5 text-center text-sm text-muted-foreground">
            No matching movements. Try another filter.
          </p>
        )}
      </div>
      <div className="picker-footer">
        <Button disabled={!selected.length} onClick={() => onSelect(selected)}>
          {single
            ? "Replace exercise"
            : `Add ${selected.length || ""} ${selected.length === 1 ? "exercise" : "exercises"}`}
        </Button>
      </div>
    </div>
  )
}
