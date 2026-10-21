"use client"

import { confirmAction } from "./responsive-panel"

import { useState } from "react"
import { Plus, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  emptyTarget,
  makeItem,
  muscleLabels,
  muscleNames,
  type ExerciseRecord,
  type LoadValue,
  type SetTarget,
  type WorkoutBlock,
  type WorkoutItem,
  type WorkoutRecord,
} from "@/contracts/models"
import { trackingFields } from "@/contracts/training"
import { cleanBlockTitle, isHistoricalCommentary } from "@/lib/presentation"
import {
  Field,
  Modal,
  MoveButtons,
  NativeSelect,
  Numeric,
  OptionalNote,
  errorMessage,
  move,
} from "./shared"
import { defaultEntryLoad, EntryUnits } from "./session-set-row"
import {
  TrackingFieldsPicker,
  WorkoutExercisePicker,
} from "./workout-exercise-picker"

export function WorkoutEditor({
  workout,
  exercises,
  onSave,
  onClose,
}: {
  workout: WorkoutRecord
  exercises: ExerciseRecord[]
  onSave: (workout: WorkoutRecord) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(workout)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const patchBlock = (id: string, change: Partial<WorkoutBlock>) =>
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === id ? { ...block, ...change } : block
      ),
    }))
  const patchItem = (
    blockId: string,
    id: string,
    change: Partial<WorkoutItem>
  ) =>
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              items: block.items.map((item) =>
                item.id === id ? { ...item, ...change } : item
              ),
            }
          : block
      ),
    }))
  const patchSet = (
    blockId: string,
    itemId: string,
    id: string,
    change: Partial<SetTarget>
  ) =>
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              items: block.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      sets: item.sets.map((target) =>
                        target.id === id ? { ...target, ...change } : target
                      ),
                    }
                  : item
              ),
            }
          : block
      ),
    }))
  function changeUnits(
    block: WorkoutBlock,
    item: WorkoutItem,
    load: LoadValue
  ) {
    patchItem(block.id, item.id, {
      sets: item.sets.map((set) => ({
        ...set,
        load: { ...load, value: set.load?.value ?? null },
      })),
    })
  }
  async function save() {
    setBusy(true)
    setError("")
    try {
      await onSave(draft)
      onClose()
    } catch (exception) {
      setError(errorMessage(exception))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={workout.revision ? "Edit workout" : "Build a workout"}
      description="Arrange movements and set targets."
      dirty={JSON.stringify(draft) !== JSON.stringify(workout)}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Workout">
          <Input
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </Field>
        <Field label="Focus">
          <Input
            value={draft.focus}
            onChange={(event) =>
              setDraft({ ...draft, focus: event.target.value })
            }
          />
        </Field>
        {draft.kind === "planned" && (
          <Field label="Date">
            <Input
              type="date"
              value={draft.date ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, date: event.target.value || null })
              }
            />
          </Field>
        )}
      </div>
      <div className="stack">
        {draft.blocks.map((block, blockIndex) => (
          <section className="editor-block" key={block.id}>
            <div className="row spread">
              <span className="eyebrow">
                Block {String.fromCharCode(65 + blockIndex)}
              </span>
              <MoveButtons
                label={`block ${blockIndex + 1}`}
                index={blockIndex}
                length={draft.blocks.length}
                onMove={(direction) =>
                  setDraft((current) => ({
                    ...current,
                    blocks: move(current.blocks, blockIndex, direction),
                  }))
                }
                onRemove={() =>
                  setDraft((current) => ({
                    ...current,
                    blocks: current.blocks.filter(
                      (entry) => entry.id !== block.id
                    ),
                  }))
                }
              />
            </div>
            <div className="form-grid">
              <Field label="Block title">
                <Input
                  value={cleanBlockTitle(block.title)}
                  onChange={(event) =>
                    patchBlock(block.id, { title: event.target.value })
                  }
                />
              </Field>
              <Field label="Grouping">
                <NativeSelect
                  label="Block grouping"
                  value={block.kind}
                  onChange={(kind) =>
                    patchBlock(block.id, { kind: kind as WorkoutBlock["kind"] })
                  }
                >
                  <option value="straight">Straight sets</option>
                  <option value="superset">Superset</option>
                  <option value="circuit">Circuit</option>
                </NativeSelect>
              </Field>
              <Field label="Rest (seconds)">
                <Numeric
                  label="Rest seconds"
                  value={block.restSeconds}
                  onChange={(restSeconds) =>
                    patchBlock(block.id, { restSeconds })
                  }
                />
              </Field>
              {block.kind === "circuit" && (
                <Field label="Rounds">
                  <Numeric
                    label="Rounds"
                    value={block.rounds}
                    onChange={(rounds) => patchBlock(block.id, { rounds })}
                  />
                </Field>
              )}
            </div>
            {block.items.map((item, itemIndex) => {
              const fields = trackingFields(item)
              const load = defaultEntryLoad(item)
              return (
                <details className="editor-item" open key={item.id}>
                  <summary>
                    <span>
                      {String.fromCharCode(65 + blockIndex)}
                      {itemIndex + 1} · {item.name}
                    </span>
                  </summary>
                  <div className="row spread">
                    <span className="muted">
                      {item.equipment || "Bodyweight"}
                    </span>
                    <MoveButtons
                      label={item.name}
                      index={itemIndex}
                      length={block.items.length}
                      onMove={(direction) =>
                        patchBlock(block.id, {
                          items: move(block.items, itemIndex, direction),
                        })
                      }
                      onRemove={() =>
                        patchBlock(block.id, {
                          items: block.items.filter(
                            (entry) => entry.id !== item.id
                          ),
                        })
                      }
                    />
                  </div>
                  <TrackingFieldsPicker
                    label={`${item.name} tracking`}
                    values={fields}
                    onChange={(trackingFields) =>
                      patchItem(block.id, item.id, { trackingFields })
                    }
                  />
                  <details className="small-details">
                    <summary>Movement settings</summary>
                    <div className="form-grid">
                      <Field label="Role">
                        <NativeSelect
                          label={`${item.name} role`}
                          value={item.role}
                          onChange={(role) =>
                            patchItem(block.id, item.id, {
                              role: role as WorkoutItem["role"],
                            })
                          }
                        >
                          {[
                            "preparation",
                            "power",
                            "lifting",
                            "conditioning",
                            "cooldown",
                          ].map((role) => (
                            <option key={role}>{role}</option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Primary muscle">
                        <NativeSelect
                          label={`${item.name} primary muscle`}
                          value={item.primaryMuscle ?? ""}
                          onChange={(muscle) =>
                            patchItem(block.id, item.id, {
                              primaryMuscle: muscle
                                ? (muscle as WorkoutItem["primaryMuscle"])
                                : null,
                            })
                          }
                        >
                          <option value="">Not counted</option>
                          {muscleNames.map((muscle) => (
                            <option key={muscle} value={muscle}>
                              {muscleLabels[muscle]}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Setup">
                        <Input
                          value={item.setup}
                          onChange={(event) =>
                            patchItem(block.id, item.id, {
                              setup: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={item.unilateral}
                          onChange={(event) =>
                            patchItem(block.id, item.id, {
                              unilateral: event.target.checked,
                            })
                          }
                        />
                        Each side
                      </label>
                    </div>
                  </details>
                  {fields.includes("load") && (
                    <div className="my-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        Target units
                      </span>
                      <EntryUnits
                        prefix={`${item.name} target`}
                        value={load}
                        onChange={(value) => changeUnits(block, item, value)}
                      />
                    </div>
                  )}
                  {item.sets.map((target, index) => (
                    <div
                      className="editor-target-row mb-2 rounded-lg border border-border bg-background p-3"
                      key={target.id}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <strong className="text-xs">Set {index + 1}</strong>
                        <MoveButtons
                          label={`${item.name} set ${index + 1}`}
                          index={index}
                          length={item.sets.length}
                          onMove={(direction) =>
                            patchItem(block.id, item.id, {
                              sets: move(item.sets, index, direction),
                            })
                          }
                          onRemove={() =>
                            patchItem(block.id, item.id, {
                              sets: item.sets.filter(
                                (entry) => entry.id !== target.id
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {fields.includes("reps") && (
                          <>
                            <Field
                              label="Min reps"
                              className="min-w-[65px] flex-1"
                            >
                              <Numeric
                                label={`${item.name} set ${index + 1} min reps`}
                                value={target.repsMin}
                                onChange={(repsMin) =>
                                  patchSet(block.id, item.id, target.id, {
                                    repsMin,
                                  })
                                }
                              />
                            </Field>
                            <Field
                              label="Max reps"
                              className="min-w-[65px] flex-1"
                            >
                              <Numeric
                                label={`${item.name} set ${index + 1} max reps`}
                                value={target.repsMax}
                                onChange={(repsMax) =>
                                  patchSet(block.id, item.id, target.id, {
                                    repsMax,
                                  })
                                }
                              />
                            </Field>
                          </>
                        )}
                        {fields.includes("load") && (
                          <Field
                            label={`Weight${target.load?.unit && target.load.unit !== "unknown" ? ` (${target.load.unit})` : ""}`}
                            className="min-w-[75px] flex-1"
                          >
                            <Numeric
                              label={`${item.name} set ${index + 1} target weight`}
                              value={target.load?.value ?? null}
                              onChange={(value) =>
                                patchSet(block.id, item.id, target.id, {
                                  load: { ...(target.load ?? load), value },
                                })
                              }
                            />
                          </Field>
                        )}
                        {fields.includes("durationSeconds") && (
                          <Field
                            label="Time (s)"
                            className="min-w-[75px] flex-1"
                          >
                            <Numeric
                              label={`${item.name} set ${index + 1} target seconds`}
                              value={target.durationSeconds}
                              onChange={(durationSeconds) =>
                                patchSet(block.id, item.id, target.id, {
                                  durationSeconds,
                                })
                              }
                            />
                          </Field>
                        )}
                        {fields.includes("distanceMeters") && (
                          <Field
                            label="Distance (m)"
                            className="min-w-[75px] flex-1"
                          >
                            <Numeric
                              label={`${item.name} set ${index + 1} target meters`}
                              value={target.distanceMeters}
                              onChange={(distanceMeters) =>
                                patchSet(block.id, item.id, target.id, {
                                  distanceMeters,
                                })
                              }
                            />
                          </Field>
                        )}
                      </div>
                      <details className="small-details">
                        <summary>Set options</summary>
                        <div className="form-grid">
                          <Field label="Set type">
                            <NativeSelect
                              label={`${item.name} set ${index + 1} type`}
                              value={target.kind}
                              onChange={(kind) =>
                                patchSet(block.id, item.id, target.id, {
                                  kind: kind as SetTarget["kind"],
                                })
                              }
                            >
                              <option value="working">Working</option>
                              <option value="warmup">Warm-up</option>
                            </NativeSelect>
                          </Field>
                          <Field label="RIR">
                            <Numeric
                              label={`${item.name} set ${index + 1} target RIR`}
                              value={target.rir}
                              onChange={(rir) =>
                                patchSet(block.id, item.id, target.id, { rir })
                              }
                            />
                          </Field>
                          <Field label="Tempo">
                            <Input
                              value={target.tempo}
                              onChange={(event) =>
                                patchSet(block.id, item.id, target.id, {
                                  tempo: event.target.value,
                                })
                              }
                            />
                          </Field>
                        </div>
                        {fields.includes("load") && (
                          <Field label="Set-specific target units">
                            <EntryUnits
                              prefix={`${item.name} set ${index + 1} target`}
                              value={target.load ?? load}
                              onChange={(value) =>
                                patchSet(block.id, item.id, target.id, {
                                  load: value,
                                })
                              }
                            />
                          </Field>
                        )}
                      </details>
                      {!isHistoricalCommentary(target.notes) && (
                        <OptionalNote
                          label={`Set ${index + 1} notes`}
                          value={target.notes}
                          onChange={(notes) =>
                            patchSet(block.id, item.id, target.id, { notes })
                          }
                        />
                      )}
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patchItem(block.id, item.id, {
                        sets: [
                          ...item.sets,
                          {
                            ...structuredClone(
                              item.sets.at(-1) ?? emptyTarget()
                            ),
                            id: crypto.randomUUID(),
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> Add set
                  </Button>
                </details>
              )
            })}
            <WorkoutExercisePicker
              label="Add movement"
              exercises={exercises}
              onSelect={(exercise) => {
                const item = makeItem(exercise)
                item.trackingFields = trackingFields(exercise)
                patchBlock(block.id, { items: [...block.items, item] })
              }}
            />
            <details className="mt-4 text-xs text-muted-foreground">
              <summary>Block instructions</summary>
              <Field label="Instructions" className="mt-3">
                <Textarea
                  value={block.notes}
                  onChange={(event) =>
                    patchBlock(block.id, { notes: event.target.value })
                  }
                />
              </Field>
            </details>
          </section>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              blocks: [
                ...current.blocks,
                {
                  id: crypto.randomUUID(),
                  title: "New block",
                  kind: "straight",
                  restSeconds: null,
                  rounds: null,
                  items: [],
                  notes: "",
                },
              ],
            }))
          }
        >
          <Plus size={16} /> Add block
        </Button>
        {!isHistoricalCommentary(draft.notes) && (
          <OptionalNote
            label="Workout notes"
            value={draft.notes}
            onChange={(notes) => setDraft({ ...draft, notes })}
          />
        )}
      </div>
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
              JSON.stringify(draft) === JSON.stringify(workout) ||
              (await confirmAction("Discard your unsaved workout changes?"))
            )
              onClose()
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => void save()}
          disabled={busy || !draft.title.trim()}
        >
          <Save size={16} />
          {busy ? "Saving…" : "Save workout"}
        </Button>
      </div>
    </Modal>
  )
}
