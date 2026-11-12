"use client"

import { confirmAction } from "./responsive-panel"

import { useMemo, useState } from "react"
import { ChevronRight, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api-client"
import {
  muscleLabels,
  muscleNames,
  type CatalogRecord,
  type EquipmentRecord,
  type ExerciseRecord,
} from "@/contracts/models"
import {
  buildCatalog,
  equipmentDetails,
  normalizeMuscle,
  trackingFields,
  trackingOptions,
} from "@/contracts/training"
import {
  ComboSelect,
  Empty,
  Field,
  LoadEditor,
  Modal,
  MultiSelect,
  NativeSelect,
  errorMessage,
  loadLabel,
} from "./shared"

export function Library({
  exercises,
  equipment,
  catalog,
  onRefresh,
}: {
  exercises: ExerciseRecord[]
  equipment: EquipmentRecord[]
  catalog?: CatalogRecord
  onRefresh: () => Promise<void>
}) {
  const [query, setQuery] = useState("")
  const [muscle, setMuscle] = useState("")
  const [equipmentType, setEquipmentType] = useState("")
  const [mode, setMode] = useState<"movements" | "equipment">("movements")
  const [exercise, setExercise] = useState<ExerciseRecord | null>(null)
  const [machine, setMachine] = useState<EquipmentRecord | null>(null)
  const [baseline, setBaseline] = useState("")
  function openExercise(value: ExerciseRecord) {
    setBaseline(JSON.stringify(value))
    setExercise(value)
  }
  function openMachine(value: EquipmentRecord) {
    setBaseline(JSON.stringify(value))
    setMachine(value)
  }
  const dirty = JSON.stringify(exercise ?? machine) !== baseline
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const options = catalog ?? buildCatalog(equipment)
  const equipmentById = useMemo(
    () => new Map(equipment.map((e) => [e.id, equipmentDetails(e)])),
    [equipment]
  )
  const matches = (value: string) =>
    value.toLowerCase().includes(query.trim().toLowerCase())
  const movementType = (movement: ExerciseRecord) =>
    equipmentById.get(movement.equipmentId ?? "")?.type ??
    equipmentDetails({
      id: movement.id,
      revision: 0,
      name: movement.equipment,
      model: "",
      notes: "",
      archived: false,
      startingResistance: null,
    }).type
  const visibleExercises = exercises.filter(
    (e) =>
      matches(
        `${e.name} ${e.equipment} ${e.primaryMuscle ?? ""} ${e.secondaryMuscles.join(" ")}`
      ) &&
      (!muscle ||
        e.primaryMuscle === muscle ||
        e.secondaryMuscles.some((m) => normalizeMuscle(m) === muscle)) &&
      (!equipmentType || movementType(e) === equipmentType)
  )
  const visibleEquipment = equipment
    .map(equipmentDetails)
    .filter(
      (e) =>
        matches(`${e.name} ${e.brand ?? ""} ${e.model}`) &&
        (!equipmentType || e.type === equipmentType)
    )
  function close() {
    setExercise(null)
    setMachine(null)
  }
  async function save() {
    setBusy(true)
    setError("")
    try {
      if (exercise)
        await api.saveExercise({
          ...exercise,
          secondaryMuscles: [
            ...new Set(
              exercise.secondaryMuscles.map(normalizeMuscle).filter(Boolean)
            ),
          ],
          trackingFields: trackingFields(
            exercise,
            equipmentById.get(exercise.equipmentId ?? "")
          ),
        })
      if (machine) await api.saveEquipment(machine)
      await onRefresh()
      close()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const secondaryValues =
    exercise?.secondaryMuscles.map(normalizeMuscle).filter(Boolean) ?? []
  const secondaryOptions = [
    ...options.muscles,
    ...secondaryValues
      .filter((value) => !options.muscles.some((o) => o.value === value))
      .map((value) => ({ value, label: value.replaceAll("_", " ") })),
  ]
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Library</p>
          <h1>Movements & equipment</h1>
        </div>
        <Button
          onClick={() => {
            setError("")
            if (mode === "movements")
              openExercise({
                id: crypto.randomUUID(),
                revision: 0,
                name: "",
                equipmentId: null,
                equipment: "",
                setup: "",
                primaryMuscle: null,
                secondaryMuscles: [],
                pattern: "",
                defaultRole: "lifting",
                defaultLoad: null,
                trackingFields: ["reps", "load"],
                notes: "",
                archived: false,
              })
            else
              openMachine({
                id: crypto.randomUUID(),
                revision: 0,
                name: "",
                model: "",
                brand: "",
                type: "machine",
                notes: "",
                startingResistance: null,
                archived: false,
              })
          }}
        >
          <Plus size={16} /> Add{" "}
          {mode === "movements" ? "movement" : "equipment"}
        </Button>
      </div>
      <div className="toolbar">
        <div className="segmented">
          <button
            className={mode === "movements" ? "active" : ""}
            onClick={() => setMode("movements")}
          >
            Movements <span>{exercises.length}</span>
          </button>
          <button
            className={mode === "equipment" ? "active" : ""}
            onClick={() => setMode("equipment")}
          >
            Equipment <span>{equipment.length}</span>
          </button>
        </div>
        <div className="search-input">
          <Search size={16} />
          <Input
            aria-label="Search library"
            placeholder="Search movements or equipment"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="toolbar">
        {mode === "movements" && (
          <NativeSelect
            label="Filter by muscle"
            value={muscle}
            onChange={setMuscle}
          >
            <option value="">All muscles</option>
            {options.muscles.map((m) => (
              <option value={m.value} key={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        )}
        <NativeSelect
          label="Filter by equipment type"
          value={equipmentType}
          onChange={setEquipmentType}
        >
          <option value="">All equipment</option>
          {options.equipmentTypes.map((e) => (
            <option value={e.value} key={e.value}>
              {e.label}
            </option>
          ))}
        </NativeSelect>
        {(query || muscle || equipmentType) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("")
              setMuscle("")
              setEquipmentType("")
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      <div className="library-grid">
        {mode === "movements"
          ? visibleExercises.map((e) => (
              <button
                className={`library-card ${e.archived ? "archived" : ""}`}
                key={e.id}
                onClick={() => {
                  setError("")
                  openExercise(e)
                }}
              >
                <div>
                  <h3>{e.name}</h3>
                  <p>{e.equipment || "No equipment"}</p>
                  <div className="row">
                    <span className="small-tag">
                      {e.primaryMuscle
                        ? muscleLabels[e.primaryMuscle]
                        : e.defaultRole}
                    </span>
                    {e.archived && <span className="small-tag">Archived</span>}
                  </div>
                </div>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))
          : visibleEquipment.map((e) => (
              <button
                className={`library-card ${e.archived ? "archived" : ""}`}
                key={e.id}
                onClick={() => {
                  setError("")
                  openMachine(e)
                }}
              >
                <div>
                  <h3>{e.name}</h3>
                  <p>
                    {[e.brand, e.model].filter(Boolean).join(" · ") ||
                      options.equipmentTypes.find((o) => o.value === e.type)
                        ?.label}
                  </p>
                  {e.startingResistance && (
                    <span className="small-tag">
                      Starting resistance {loadLabel(e.startingResistance)}
                    </span>
                  )}
                  {e.archived && <span className="small-tag">Archived</span>}
                </div>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))}
      </div>
      {(mode === "movements"
        ? !visibleExercises.length
        : !visibleEquipment.length) && (
        <Empty
          title={
            query || muscle || equipmentType
              ? "No matches"
              : "Your library starts here"
          }
        >
          <p>
            {query || muscle || equipmentType
              ? "Try a different search or filter."
              : "Add a movement or equipment record."}
          </p>
        </Empty>
      )}
      {(exercise || machine) && (
        <Modal
          title={exercise ? "Movement details" : "Equipment details"}
          dirty={dirty}
          onClose={close}
        >
          {exercise && (
            <>
              <div className="form-grid">
                <Field label="Name">
                  <Input
                    value={exercise.name}
                    onChange={(e) =>
                      setExercise({ ...exercise, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Equipment">
                  <NativeSelect
                    label="Equipment record"
                    value={exercise.equipmentId ?? ""}
                    onChange={(id) => {
                      const selected = equipment.find((e) => e.id === id)
                      setExercise({
                        ...exercise,
                        equipmentId: id || null,
                        equipment:
                          id === exercise.equipmentId
                            ? exercise.equipment
                            : (selected?.name ?? ""),
                      })
                    }}
                  >
                    <option value="">No equipment</option>
                    {equipment.map((e) => (
                      <option key={e.id} value={e.id}>
                        {[e.name, e.brand, e.model].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Setup">
                  <Input
                    value={exercise.setup}
                    placeholder="Grip, seat position or variation"
                    onChange={(e) =>
                      setExercise({ ...exercise, setup: e.target.value })
                    }
                  />
                </Field>
                <Field label="Primary muscle">
                  <NativeSelect
                    label="Primary muscle"
                    value={exercise.primaryMuscle ?? ""}
                    onChange={(m) =>
                      setExercise({
                        ...exercise,
                        primaryMuscle: m
                          ? (m as ExerciseRecord["primaryMuscle"])
                          : null,
                      })
                    }
                  >
                    <option value="">Not counted</option>
                    {muscleNames.map((m) => (
                      <option key={m} value={m}>
                        {muscleLabels[m]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Movement pattern">
                  <NativeSelect
                    label="Movement pattern"
                    value={exercise.pattern.toLowerCase()}
                    onChange={(pattern) =>
                      setExercise({ ...exercise, pattern })
                    }
                  >
                    <option value="">Select pattern</option>
                    {options.patterns.map((p) => (
                      <option value={p.value} key={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Default role">
                  <NativeSelect
                    label="Default role"
                    value={exercise.defaultRole}
                    onChange={(role) =>
                      setExercise({
                        ...exercise,
                        defaultRole: role as ExerciseRecord["defaultRole"],
                      })
                    }
                  >
                    {[
                      "preparation",
                      "power",
                      "lifting",
                      "conditioning",
                      "cooldown",
                    ].map((r) => (
                      <option key={r} value={r}>
                        {r[0].toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <MultiSelect
                label="Secondary muscles"
                values={secondaryValues}
                options={secondaryOptions}
                onChange={(secondaryMuscles) =>
                  setExercise({ ...exercise, secondaryMuscles })
                }
              />
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Track</legend>
                <div className="row">
                  {trackingOptions.map((field) => {
                    const fields = trackingFields(
                      exercise,
                      equipmentById.get(exercise.equipmentId ?? "")
                    )
                    return (
                      <label className="check-label" key={field.value}>
                        <input
                          type="checkbox"
                          checked={fields.includes(field.value)}
                          disabled={
                            fields.length === 1 && fields.includes(field.value)
                          }
                          onChange={(e) =>
                            setExercise({
                              ...exercise,
                              trackingFields: e.target.checked
                                ? [...fields, field.value]
                                : fields.filter((f) => f !== field.value),
                            })
                          }
                        />
                        {field.label}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              {trackingFields(
                exercise,
                equipmentById.get(exercise.equipmentId ?? "")
              ).includes("load") && (
                <Field label="Default load">
                  <LoadEditor
                    value={exercise.defaultLoad}
                    onChange={(defaultLoad) =>
                      setExercise({ ...exercise, defaultLoad })
                    }
                  />
                </Field>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={exercise.archived}
                  onChange={(e) =>
                    setExercise({ ...exercise, archived: e.target.checked })
                  }
                />
                Archive movement
              </label>
              <p className="muted">
                Existing workouts keep their original setup.
              </p>
            </>
          )}
          {machine && (
            <>
              <div className="form-grid">
                <Field label="Name">
                  <Input
                    value={machine.name}
                    placeholder="e.g. Pec Deck"
                    onChange={(e) =>
                      setMachine({ ...machine, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Type">
                  <NativeSelect
                    label="Equipment type"
                    value={machine.type ?? "other"}
                    onChange={(type) => setMachine({ ...machine, type })}
                  >
                    {options.equipmentTypes.map((e) => (
                      <option value={e.value} key={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Brand">
                  <ComboSelect
                    label="Equipment brand"
                    value={machine.brand ?? ""}
                    options={options.brands.map((b) => b.name)}
                    placeholder="Select or add brand"
                    onChange={(brand) =>
                      setMachine({
                        ...machine,
                        brand,
                        model: brand === machine.brand ? machine.model : "",
                      })
                    }
                  />
                </Field>
                <Field label="Model">
                  <ComboSelect
                    label="Equipment model"
                    value={machine.model}
                    options={
                      options.brands.find(
                        (b) =>
                          b.name.toLowerCase() === machine.brand?.toLowerCase()
                      )?.models ?? []
                    }
                    placeholder="Select or add model"
                    onChange={(model) => setMachine({ ...machine, model })}
                  />
                </Field>
              </div>
              <Field label="Starting resistance">
                <LoadEditor
                  value={machine.startingResistance}
                  onChange={(startingResistance) =>
                    setMachine({ ...machine, startingResistance })
                  }
                />
              </Field>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={machine.archived}
                  onChange={(e) =>
                    setMachine({ ...machine, archived: e.target.checked })
                  }
                />
                Archive equipment
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <Button
              variant="outline"
              onClick={async () => {
                if (
                  !dirty ||
                  (await confirmAction("Discard your unsaved changes?"))
                )
                  close()
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !(exercise?.name || machine?.name)?.trim()}
              onClick={save}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
