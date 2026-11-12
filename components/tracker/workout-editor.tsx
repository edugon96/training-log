"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowUp,
  Plus,
  Settings2,
  Trash2,
  RefreshCw,
  FolderInput,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  emptyTarget,
  makeItem,
  muscleLabels,
  muscleNames,
  type ExerciseRecord,
  type EquipmentRecord,
  type SetTarget,
  type WorkoutBlock,
  type WorkoutItem,
  type WorkoutRecord,
} from "@/contracts/models"
import { trackingFields } from "@/contracts/training"
import { newGroup, moveMovement, movementRest } from "@/lib/workout-groups"
import { WorkoutGroup, MoveToGroup } from "./workout-group"
import { useWorkoutAutosave } from "./use-workout-autosave"
import { AutosaveStatus } from "./autosave"
import { confirmAction } from "./responsive-panel"
import { Field, Modal, NativeSelect, Numeric } from "./shared"
import { defaultEntryLoad, EntryUnits } from "./session-set-row"
import {
  TrackingFieldsPicker,
  WorkoutExercisePicker,
} from "./workout-exercise-picker"
import { SetTypeMenu, setNumber } from "./set-type-menu"
import { MovementCard } from "./movement-card"
import { MovementRestPanel, RepetitionOptions } from "./movement-controls"
import { MovementReorderPanel } from "./movement-reorder-panel"
import { SwipeDeleteRow } from "./swipe-delete-row"
import { creationNotes, changeCreationNotes } from "@/lib/movement-notes"

type Selection = { blockId: string; itemId?: string; replace?: boolean }
export function WorkoutEditor({
  workout,
  exercises,
  equipment,
  onSave,
  onClose,
  ownerId,
  draftKey,
  onBeforeChange,
  sessionId,
  creation = workout.revision === 0,
}: {
  workout: WorkoutRecord
  exercises: ExerciseRecord[]
  equipment: EquipmentRecord[]
  onSave: (
    workout: WorkoutRecord,
    base: WorkoutRecord
  ) => Promise<WorkoutRecord>
  onClose: () => void
  ownerId: string
  draftKey: string
  onBeforeChange?: (workout: WorkoutRecord) => Promise<boolean>
  sessionId?: string
  creation?: boolean
}) {
  const { draft, setDraft, ready, submitted, error, flush, discard } =
    useWorkoutAutosave({
      ownerId,
      draftKey,
      workout,
      onSave,
      onBeforeChange,
      sessionId,
      manual: creation,
    })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [viewport, setViewport] = useState<{
    height: number
    top: number
  } | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const resize = () =>
      setViewport({ height: viewport.height, top: viewport.offsetTop })
    resize()
    viewport.addEventListener("resize", resize)
    viewport.addEventListener("scroll", resize)
    return () => {
      viewport.removeEventListener("resize", resize)
      viewport.removeEventListener("scroll", resize)
    }
  }, [])
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<Selection | null>(null)
  const editorBody = useRef<HTMLDivElement>(null)
  const pickerReturn = useRef<{
    top: number
    focus: HTMLElement | null
  } | null>(null)
  function openPicker(selection: Selection) {
    pickerReturn.current = {
      top: editorBody.current?.scrollTop ?? 0,
      focus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    }
    setNewGroupId(null)
    setPicker(selection)
  }
  useLayoutEffect(() => {
    if (!picker && pickerReturn.current && editorBody.current) {
      const position = pickerReturn.current
      editorBody.current.scrollTop = position.top
      position.focus?.focus({ preventScroll: true })
      pickerReturn.current = null
    }
  }, [picker])
  const [settings, setSettings] = useState<Selection | null>(null)
  const [setOptions, setSetOptions] = useState<
    (Selection & { targetId: string }) | null
  >(null)
  const [restSelection, setRestSelection] = useState<Selection | null>(null)
  const [unitsSelection, setUnitsSelection] = useState<Selection | null>(null)
  const [repsSelection, setRepsSelection] = useState<Selection | null>(null)
  const [reordering, setReordering] = useState(false)
  const [movingItem, setMovingItem] = useState<string | null>(null)
  const [newGroupId, setNewGroupId] = useState<string | null>(null)
  function addGroup() {
    const group = newGroup(draft.blocks)
    setDraft((current) => ({ ...current, blocks: [...current.blocks, group] }))
    setNewGroupId(group.id)
  }
  async function removeGroup(block: WorkoutBlock) {
    if (
      block.items.length &&
      !(await confirmAction(`Remove ${block.title} and all its movements?`))
    )
      return
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.filter((value) => value.id !== block.id),
    }))
  }
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
    item: WorkoutItem,
    id: string,
    change: Partial<SetTarget>
  ) =>
    patchItem(blockId, item.id, {
      sets: item.sets.map((set) =>
        set.id === id ? { ...set, ...change } : set
      ),
    })
  async function close() {
    if (busy) return
    if (picker) {
      setPicker(null)
      return
    }
    if (creation && !submitted) {
      if (
        (draft.title ||
          draft.notes ||
          draft.date !== workout.date ||
          draft.blocks.length > 1 ||
          draft.blocks.some(
            (block) =>
              block.items.length || block.notes || block.title !== "Group 1"
          )) &&
        !(await confirmAction("Discard this unsaved workout?"))
      )
        return
      await discard()
    } else if (!creation) await flush()
    if (mounted.current) onClose()
  }
  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if ((await flush()) && mounted.current) onClose()
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  function addExercises(selected: ExerciseRecord[]) {
    const items = selected.map((exercise) => ({
      ...makeItem(exercise, 1),
      restSeconds: null,
      automaticRest: false,
      notes: exercise.notes,
      trackingFields: trackingFields(
        exercise,
        equipment.find((value) => value.id === exercise.equipmentId)
      ),
    }))
    if (picker) {
      const block = draft.blocks.find((value) => value.id === picker.blockId)
      if (block)
        patchBlock(block.id, {
          items: picker.replace
            ? block.items.flatMap((item) =>
                item.id === picker.itemId ? items.slice(0, 1) : [item]
              )
            : [...block.items, ...items],
        })
    }
    setPicker(null)
  }
  const settingsBlock = draft.blocks.find(
    (block) => block.id === settings?.blockId
  )
  const settingsItem = settingsBlock?.items.find(
    (item) => item.id === settings?.itemId
  )
  const optionBlock = draft.blocks.find(
    (block) => block.id === setOptions?.blockId
  )
  const optionItem = optionBlock?.items.find(
    (item) => item.id === setOptions?.itemId
  )
  const optionTarget = optionItem?.sets.find(
    (set) => set.id === setOptions?.targetId
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close()
      }}
    >
      <DialogContent
        className="focused-editor"
        style={
          viewport ? { height: viewport.height, top: viewport.top } : undefined
        }
        showCloseButton={false}
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <header className="workout-toolbar">
          <Button variant="ghost" disabled={busy} onClick={() => void close()}>
            <ArrowLeft size={17} />
            {picker
              ? "Back"
              : creation
                ? submitted
                  ? "Close"
                  : "Cancel"
                : "Back"}
          </Button>
          <DialogTitle>
            {picker
              ? picker.replace
                ? "Replace movement"
                : `Add to ${draft.blocks.find((block) => block.id === picker.blockId)?.title ?? "group"}`
              : creation
                ? `New ${draft.kind === "routine" ? "routine" : "workout"}`
                : "Edit workout"}
          </DialogTitle>
          {!picker && (
            <div className="workout-toolbar-actions">
              {!creation && (
                <AutosaveStatus
                  ownerId={ownerId}
                  id={sessionId ?? workout.id}
                />
              )}
              <Button disabled={!ready || busy} onClick={() => void save()}>
                {busy ? "Saving…" : creation ? "Save" : "Done"}
              </Button>
            </div>
          )}
        </header>
        {ready && picker && (
          <div className="focused-editor-body">
            <WorkoutExercisePicker
              exercises={exercises}
              single={picker.replace}
              onSelect={addExercises}
            />
          </div>
        )}
        <div
          ref={editorBody}
          className="focused-editor-body"
          style={picker ? { display: "none" } : undefined}
        >
          {!ready ? (
            <p role="status">Loading editor…</p>
          ) : (
            <>
              {error && (
                <div role="alert" className="editor-save-error">
                  <p>{error}</p>
                </div>
              )}
              <Field
                label={draft.kind === "routine" ? "Routine name" : "Workout"}
              >
                <Input
                  className="workout-name-input"
                  placeholder="Workout name"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                />
              </Field>
              {draft.kind === "planned" && (
                <div className="workout-details">
                  <Field label="Date">
                    <Input
                      type="date"
                      value={draft.date ?? ""}
                      onChange={(event) =>
                        setDraft({ ...draft, date: event.target.value || null })
                      }
                    />
                  </Field>
                </div>
              )}
              <Field label="Notes">
                <Textarea
                  aria-label="Workout notes"
                  className="workout-notes-input"
                  placeholder="Optional"
                  rows={3}
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft({ ...draft, notes: event.target.value })
                  }
                />
              </Field>
              {draft.blocks.map((block) => (
                <WorkoutGroup
                  key={block.id}
                  block={block}
                  focusOnMount={newGroupId === block.id}
                  onChange={(patch) => patchBlock(block.id, patch)}
                  onAdd={() => openPicker({ blockId: block.id })}
                  onRemove={() => {
                    void removeGroup(block)
                  }}
                  onReorder={() => setReordering(true)}
                >
                  {block.items.map((item) => {
                    const fields = trackingFields(item)
                    const load = defaultEntryLoad(item)
                    const range =
                      item.repetitionMode === "range" ||
                      item.sets.some(
                        (set) =>
                          set.repsMax != null && set.repsMax !== set.repsMin
                      )
                    const notes = creationNotes(block, item)
                    const setNotes = (entries: typeof notes) =>
                      setDraft((current) => ({
                        ...current,
                        blocks: changeCreationNotes(
                          current.blocks,
                          item.id,
                          entries
                        ),
                      }))
                    const columns = `40px repeat(${fields.length}, minmax(0, 1fr))`
                    return (
                      <MovementCard
                        key={item.id}
                        className="compact-editor-item"
                        name={item.name}
                        detail={[item.equipment, item.setup]
                          .filter(Boolean)
                          .join(" · ")}
                        notes={notes.map((note) => ({
                          ...note,
                          scope: "workout" as const,
                        }))}
                        restSeconds={movementRest(block, item).restSeconds}
                        onRest={() =>
                          setRestSelection({
                            blockId: block.id,
                            itemId: item.id,
                          })
                        }
                        onAddNote={(id) =>
                          setNotes([...notes, { id, text: "" }])
                        }
                        onChangeNote={(note, text) =>
                          setNotes(
                            notes.map((value) =>
                              value.id === note.id
                                ? { id: value.id, text }
                                : value
                            )
                          )
                        }
                        onDeleteNote={(note) =>
                          setNotes(
                            notes.filter((value) => value.id !== note.id)
                          )
                        }
                        actions={[
                          {
                            label: "Reorder exercises",
                            icon: ArrowUp,
                            onSelect: () => setReordering(true),
                          },
                          {
                            label: "Replace exercise",
                            icon: RefreshCw,
                            onSelect: () =>
                              openPicker({
                                blockId: block.id,
                                itemId: item.id,
                                replace: true,
                              }),
                          },
                          {
                            label: "Move to group",
                            icon: FolderInput,
                            onSelect: () => setMovingItem(item.id),
                          },
                          {
                            label: "Exercise settings",
                            icon: Settings2,
                            separator: true,
                            onSelect: () =>
                              setSettings({
                                blockId: block.id,
                                itemId: item.id,
                              }),
                          },
                          {
                            label: "Set details",
                            icon: Settings2,
                            disabled: !item.sets.length,
                            onSelect: () =>
                              setSetOptions({
                                blockId: block.id,
                                itemId: item.id,
                                targetId: item.sets[0].id,
                              }),
                          },
                          {
                            label: "Remove exercise",
                            icon: Trash2,
                            destructive: true,
                            separator: true,
                            onSelect: () =>
                              setDraft((current) => ({
                                ...current,
                                blocks: current.blocks.map((value) =>
                                  value.id !== block.id
                                    ? value
                                    : {
                                        ...value,
                                        items: value.items.filter(
                                          (row) => row.id !== item.id
                                        ),
                                      }
                                ),
                              })),
                          },
                        ]}
                      >
                        <div className="movement-target-table">
                          <div
                            className="movement-target-head"
                            style={{ gridTemplateColumns: columns }}
                          >
                            <span>Set</span>
                            {fields.includes("load") && (
                              <button
                                type="button"
                                aria-label={`${item.name} weight units`}
                                onClick={() =>
                                  setUnitsSelection({
                                    blockId: block.id,
                                    itemId: item.id,
                                  })
                                }
                              >
                                {load.unit === "unknown"
                                  ? "Weight"
                                  : load.unit === "lb"
                                    ? "LBS"
                                    : "KG"}
                              </button>
                            )}
                            {fields.includes("reps") && (
                              <button
                                type="button"
                                aria-label={`${item.name} repetition options`}
                                onClick={() =>
                                  setRepsSelection({
                                    blockId: block.id,
                                    itemId: item.id,
                                  })
                                }
                              >
                                {range ? "Rep Range" : "Reps"} ▾
                              </button>
                            )}
                            {fields.includes("durationSeconds") && (
                              <span>Time (s)</span>
                            )}
                            {fields.includes("distanceMeters") && (
                              <span>Distance (m)</span>
                            )}
                          </div>
                          {item.sets.map((target, index) => {
                            const remove = () =>
                              patchItem(block.id, item.id, {
                                sets: item.sets.filter(
                                  (set) => set.id !== target.id
                                ),
                              })
                            return (
                              <SwipeDeleteRow
                                key={target.id}
                                label={`${item.name} set ${index + 1}`}
                                onDelete={remove}
                              >
                                <div
                                  className="movement-target-row"
                                  style={{ gridTemplateColumns: columns }}
                                >
                                  <SetTypeMenu
                                    label={`${item.name} set ${index + 1} type`}
                                    kind={target.kind}
                                    number={setNumber(item.sets, index)}
                                    onChange={(kind) =>
                                      patchSet(block.id, item, target.id, {
                                        kind,
                                      })
                                    }
                                    onRemove={remove}
                                  />
                                  {fields.includes("load") && (
                                    <Numeric
                                      label={`${item.name} set ${index + 1} target weight`}
                                      value={target.load?.value ?? null}
                                      onChange={(value) =>
                                        patchSet(block.id, item, target.id, {
                                          load: {
                                            ...(target.load ?? load),
                                            value,
                                          },
                                        })
                                      }
                                    />
                                  )}
                                  {fields.includes("reps") && (
                                    <div
                                      className={
                                        range
                                          ? "rep-range-fields"
                                          : "rep-exact-field"
                                      }
                                    >
                                      <Numeric
                                        label={`${item.name} set ${index + 1} min reps`}
                                        value={target.repsMin}
                                        onChange={(repsMin) =>
                                          patchSet(block.id, item, target.id, {
                                            repsMin,
                                            ...(!range
                                              ? { repsMax: repsMin }
                                              : {}),
                                          })
                                        }
                                      />
                                      {range && (
                                        <>
                                          <span>to</span>
                                          <Numeric
                                            label={`${item.name} set ${index + 1} max reps`}
                                            value={target.repsMax}
                                            onChange={(repsMax) =>
                                              patchSet(
                                                block.id,
                                                item,
                                                target.id,
                                                { repsMax }
                                              )
                                            }
                                          />
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {fields.includes("durationSeconds") && (
                                    <Numeric
                                      label={`${item.name} set ${index + 1} target seconds`}
                                      value={target.durationSeconds}
                                      onChange={(durationSeconds) =>
                                        patchSet(block.id, item, target.id, {
                                          durationSeconds,
                                        })
                                      }
                                    />
                                  )}
                                  {fields.includes("distanceMeters") && (
                                    <Numeric
                                      label={`${item.name} set ${index + 1} target meters`}
                                      value={target.distanceMeters}
                                      onChange={(distanceMeters) =>
                                        patchSet(block.id, item, target.id, {
                                          distanceMeters,
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              </SwipeDeleteRow>
                            )
                          })}
                        </div>
                        <Button
                          className="add-session-set"
                          variant="secondary"
                          onClick={() =>
                            patchItem(block.id, item.id, {
                              sets: [
                                ...item.sets,
                                {
                                  ...structuredClone(
                                    item.sets.at(-1) ?? emptyTarget()
                                  ),
                                  id: crypto.randomUUID(),
                                  kind: "working",
                                },
                              ],
                            })
                          }
                        >
                          <Plus size={14} /> Add set
                        </Button>
                      </MovementCard>
                    )
                  })}
                </WorkoutGroup>
              ))}
              <Button
                className="add-exercises-button"
                variant="outline"
                onClick={addGroup}
              >
                <Plus size={17} /> Add group
              </Button>
            </>
          )}
        </div>
        {movingItem && (
          <MoveToGroup
            blocks={draft.blocks}
            itemId={movingItem}
            onClose={() => setMovingItem(null)}
            onMove={(destination) => {
              const group = destination ? null : newGroup(draft.blocks)
              setDraft((current) => ({
                ...current,
                blocks: moveMovement(
                  group ? [...current.blocks, group] : current.blocks,
                  movingItem,
                  destination ?? group!.id
                ),
              }))
              if (group) setNewGroupId(group.id)
              setMovingItem(null)
            }}
          />
        )}
        {reordering && (
          <MovementReorderPanel
            blocks={draft.blocks}
            onChange={(blocks) =>
              setDraft((current) => ({ ...current, blocks }))
            }
            onClose={() => setReordering(false)}
          />
        )}
        {restSelection &&
          (() => {
            const block = draft.blocks.find(
              (block) => block.id === restSelection.blockId
            )
            const item = block?.items.find(
              (value) => value.id === restSelection.itemId
            )
            if (!block || !item) return null
            return (
              <MovementRestPanel
                name={
                  block.items.find((item) => item.id === restSelection.itemId)
                    ?.name ?? block.title
                }
                rest={movementRest(block, item)}
                onChange={(patch) => patchItem(block.id, item.id, patch)}
                onClose={() => setRestSelection(null)}
              />
            )
          })()}
        {unitsSelection &&
          (() => {
            const block = draft.blocks.find(
              (block) => block.id === unitsSelection.blockId
            )
            const item = block?.items.find(
              (item) => item.id === unitsSelection.itemId
            )
            if (!block || !item) return null
            return (
              <Modal
                title="Weight Input"
                onClose={() => setUnitsSelection(null)}
              >
                <p className="muted mb-4 text-sm">{item.name}</p>
                <EntryUnits
                  prefix={`${item.name} target`}
                  value={defaultEntryLoad(item)}
                  onChange={(load) =>
                    patchItem(block.id, item.id, {
                      sets: item.sets.map((set) => ({
                        ...set,
                        load: { ...load, value: set.load?.value ?? null },
                      })),
                    })
                  }
                />
              </Modal>
            )
          })()}
        {repsSelection &&
          (() => {
            const block = draft.blocks.find(
              (block) => block.id === repsSelection.blockId
            )
            const item = block?.items.find(
              (item) => item.id === repsSelection.itemId
            )
            if (!block || !item) return null
            const range =
              item.repetitionMode === "range" ||
              item.sets.some(
                (set) => set.repsMax != null && set.repsMax !== set.repsMin
              )
            return (
              <RepetitionOptions
                range={range}
                onClose={() => setRepsSelection(null)}
                onChange={(next) => {
                  patchItem(block.id, item.id, {
                    repetitionMode: next ? "range" : "exact",
                    ...(!next
                      ? {
                          sets: item.sets.map((set) => ({
                            ...set,
                            repsMax: set.repsMin,
                          })),
                        }
                      : {}),
                  })
                }}
              />
            )
          })()}
        {settingsBlock && (
          <Modal
            title={
              settingsItem ? `${settingsItem.name} settings` : "Group settings"
            }
            onClose={() => setSettings(null)}
          >
            {settingsItem ? (
              <>
                <TrackingFieldsPicker
                  label={`${settingsItem.name} tracking`}
                  values={trackingFields(settingsItem)}
                  onChange={(trackingFields) =>
                    patchItem(settingsBlock.id, settingsItem.id, {
                      trackingFields,
                    })
                  }
                />
                {trackingFields(settingsItem).includes("load") && (
                  <EntryUnits
                    prefix={`${settingsItem.name} target`}
                    value={defaultEntryLoad(settingsItem)}
                    onChange={(load) =>
                      patchItem(settingsBlock.id, settingsItem.id, {
                        sets: settingsItem.sets.map((set) => ({
                          ...set,
                          load: { ...load, value: set.load?.value ?? null },
                        })),
                      })
                    }
                  />
                )}
                <Field label="Setup">
                  <Input
                    value={settingsItem.setup}
                    onChange={(event) =>
                      patchItem(settingsBlock.id, settingsItem.id, {
                        setup: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Role">
                  <NativeSelect
                    label="Exercise role"
                    value={settingsItem.role}
                    onChange={(role) =>
                      patchItem(settingsBlock.id, settingsItem.id, {
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
                    label="Primary muscle"
                    value={settingsItem.primaryMuscle ?? ""}
                    onChange={(muscle) =>
                      patchItem(settingsBlock.id, settingsItem.id, {
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
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={settingsItem.unilateral}
                    onChange={(event) =>
                      patchItem(settingsBlock.id, settingsItem.id, {
                        unilateral: event.target.checked,
                      })
                    }
                  />{" "}
                  Each side
                </label>
              </>
            ) : null}
          </Modal>
        )}
        {optionBlock && optionItem && optionTarget && (
          <Modal title="Set Details" onClose={() => setSetOptions(null)}>
            <Field label="Set">
              <NativeSelect
                label={`${optionItem.name} set details`}
                value={optionTarget.id}
                onChange={(targetId) =>
                  setSetOptions({
                    blockId: optionBlock.id,
                    itemId: optionItem.id,
                    targetId,
                  })
                }
              >
                {optionItem.sets.map((set, index) => (
                  <option key={set.id} value={set.id}>
                    Set {index + 1}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="RIR">
              <Numeric
                label="Target RIR"
                value={optionTarget.rir}
                onChange={(rir) =>
                  patchSet(optionBlock.id, optionItem, optionTarget.id, { rir })
                }
              />
            </Field>
            <Field label="Tempo">
              <Input
                value={optionTarget.tempo}
                onChange={(event) =>
                  patchSet(optionBlock.id, optionItem, optionTarget.id, {
                    tempo: event.target.value,
                  })
                }
              />
            </Field>
            {trackingFields(optionItem).includes("load") && (
              <EntryUnits
                prefix="Set target"
                value={optionTarget.load ?? defaultEntryLoad(optionItem)}
                onChange={(load) =>
                  patchSet(optionBlock.id, optionItem, optionTarget.id, {
                    load,
                  })
                }
              />
            )}
            <Field label="Set notes">
              <Textarea
                value={optionTarget.notes}
                onChange={(event) =>
                  patchSet(optionBlock.id, optionItem, optionTarget.id, {
                    notes: event.target.value,
                  })
                }
              />
            </Field>
          </Modal>
        )}
      </DialogContent>
    </Dialog>
  )
}
