"use client"

import { useEffect, useId, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  Clock3,
  Plus,
  Pencil,
  Settings2,
  Copy,
  MessageSquare,
  Trash2,
  ArrowUp,
  RefreshCw,
  FolderInput,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ElapsedTime, RestTime, WorkoutDial, useTimers } from "./timers"
import { ClockControls } from "./timer-face"
import {
  changeWorkoutTimer,
  editWorkoutTime,
  finishWorkoutTime,
  workoutTimerRunning,
} from "@/lib/timers"
import {
  acceptedSuggestion,
  automaticRestSeconds,
  previousSet,
  sessionVolume,
  setSuggestion,
} from "@/lib/set-logging"
import { api } from "@/lib/api-client"
import { queuePlanEdit, flushPlanEdits } from "@/lib/workout-edits"
import { DeleteWorkoutDialog } from "./delete-workout-dialog"
import {
  queueSession,
  saveCorrection,
  readCorrection,
  clearCorrection,
  flushQueue,
  cachePrevious,
  readCachedPrevious,
  offlineDb,
} from "@/lib/offline"
import { isHistoricalCommentary, prescriptionLabel } from "@/lib/presentation"
import {
  inferredStatus,
  normalizeSessionResults,
  trackingFields,
} from "@/contracts/training"
import {
  emptyTarget,
  makeItem,
  type MovementNoteRecord,
  type ExerciseRecord,
  type EquipmentRecord,
  type LoadValue,
  type PreviousRecord,
  type SessionRecord,
  type SetResult,
  type SetTarget,
  type WorkoutItem,
  type WorkoutRecord,
} from "@/contracts/models"
import { Modal, Field, NativeSelect, dateLabel, errorMessage } from "./shared"
import { ActionMenu, confirmAction } from "./responsive-panel"
import { WorkoutEditor } from "./workout-editor"
import { AutosaveStatus } from "./autosave"
import { mergeSession, mergeWorkout, sameValue } from "@/lib/autosave-merge"
import { subscribeSaved } from "@/lib/autosave-events"
import {
  defaultEntryLoad,
  EntryUnits,
  hasEnteredResult,
  SessionSetRow,
  SessionSetHeader,
} from "./session-set-row"

import {
  withGroups,
  newGroup,
  moveMovement,
  movementRest,
} from "@/lib/workout-groups"
import { WorkoutGroup, MoveToGroup } from "./workout-group"
import { MovementCard, type CardNote } from "./movement-card"
import { MovementRestPanel } from "./movement-controls"
import { MovementReorderPanel } from "./movement-reorder-panel"
import {
  WorkoutExercisePicker,
  TrackingFieldsPicker,
} from "./workout-exercise-picker"
import {
  creationNotes,
  changeCreationNotes,
  retainMovementNotes,
} from "@/lib/movement-notes"

function emptyResult(itemId: string, targetId: string | null): SetResult {
  return {
    id: crypto.randomUUID(),
    itemId,
    targetId,
    status: "unlogged",
    reps: null,
    load: null,
    durationSeconds: null,
    distanceMeters: null,
    rir: null,
    notes: "",
    source: null,
  }
}
function remainingSets(session: SessionRecord) {
  return session.blocks.flatMap((block) =>
    block.items.flatMap((item) =>
      item.sets.flatMap((target, index) => {
        const result = session.results.find(
          (row) => row.itemId === item.id && row.targetId === target.id
        )
        return !result || result.status === "unlogged"
          ? [{ item, target, index, result }]
          : []
      })
    )
  )
}

export function SessionView({
  initial,
  ownerId,
  exercises,
  equipment,
  onBack,
  onSaved,
  onPersistence,
  plan,
  onBeforeLeave,
  onDeleted,
}: {
  initial: SessionRecord
  plan?: WorkoutRecord
  onBeforeLeave: (guard: (() => boolean) | null) => void
  onDeleted: () => Promise<void>
  ownerId: string
  exercises: ExerciseRecord[]
  equipment: EquipmentRecord[]
  onBack: () => void
  onSaved: () => void
  onPersistence?: (promise: Promise<unknown>) => void
}) {
  const [storedSession, setSession] = useState(() => withGroups(initial))
  const session = withGroups(storedSession)
  const [previous, setPrevious] = useState<Record<string, PreviousRecord>>({})
  const [editingResults, setEditingResults] = useState(false)
  const [volumeInfo, setVolumeInfo] = useState(false)
  const [restItemId, setRestItemId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [settingsItemId, setSettingsItemId] = useState<string | null>(null)
  const [setDetails, setSetDetails] = useState<{
    itemId: string
    targetId: string
  } | null>(null)
  const [movementPicker, setMovementPicker] = useState<{
    blockId: string
    itemId?: string
    replace?: boolean
  } | null>(null)
  const [unitsItem, setUnitsItem] = useState<WorkoutItem | null>(null)
  const readOnly = session.status === "completed" && !editingResults
  const materialized = useRef(
    initial.revision > 0 ||
      initial.results.length > 0 ||
      !!initial.startedAt ||
      !!initial.userNotes ||
      !!Object.keys(initial.movementNotes ?? {}).length
  )
  const planRef = useRef(plan)
  const correctionPending = useRef(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [editingTime, setEditingTime] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const restTimer = useTimers()
  const [movingItem, setMovingItem] = useState<string | null>(null)
  const [expandVersion, setExpandVersion] = useState(0)
  const [newGroupId, setNewGroupId] = useState<string | null>(null)
  const [entryUnits, setEntryUnits] = useState<Record<string, LoadValue>>(
    () => {
      try {
        return JSON.parse(
          localStorage.getItem(
            `entry-units:${ownerId}:${initial.workoutId ?? initial.id}`
          ) || "{}"
        )
      } catch {
        return {}
      }
    }
  )
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const draftRef = useRef(session)
  const sequenceRef = useRef(0)
  const persistRef = useRef<Promise<unknown>>(Promise.resolve())
  const unsavedRef = useRef(false)
  const completed = session.results.filter(
    (result) => result.status === "completed" && result.targetId !== null
  ).length
  const total = session.blocks
    .flatMap((block) => block.items)
    .reduce((count, item) => count + item.sets.length, 0)
  const remaining = remainingSets(session)
  const volume = sessionVolume(session)
  const volumePounds = Math.round(volume.pounds)

  useEffect(() => {
    if (!materialized.current && initial.workoutId)
      void offlineDb.planEdits
        .get(`${ownerId}:${initial.workoutId}`)
        .then((pending) => {
          if (pending) planRef.current = pending.value
        })
    return subscribeSaved((event) => {
      if (event.ownerId !== ownerId) return
      if (event.kind === "sessions" && event.after.id === initial.id) {
        const next = mergeSession(event.before, draftRef.current, event.after)
        draftRef.current = next
        setSession(next)
      } else if (
        event.kind === "workouts" &&
        !materialized.current &&
        event.after.id === initial.workoutId &&
        planRef.current
      ) {
        const current = draftRef.current
        const next = mergeWorkout(
          event.before,
          {
            ...planRef.current,
            title: current.title,
            date: current.performedOn,
            blocks: current.blocks,
          },
          event.after
        )
        planRef.current = next
        draftRef.current = {
          ...current,
          title: next.title,
          performedOn: next.date ?? current.performedOn,
          blocks: next.blocks,
        }
        setSession(draftRef.current)
      }
    })
  }, [ownerId, initial.id, initial.workoutId])
  useEffect(() => {
    let live = true
    const sequence = sequenceRef.current
    void readCorrection(ownerId, initial.id, initial)
      .then((draft) => {
        if (!live || !draft || sequenceRef.current !== sequence) return
        draftRef.current = withGroups(draft)
        setSession(draft)
        setEditingResults(true)
        correctionPending.current = true
        setStatus("Finish editing this set")
      })
      .catch((e) => {
        if (live) setError(errorMessage(e))
      })
    return () => {
      live = false
    }
  }, [ownerId, initial])
  useEffect(() => {
    onBeforeLeave(null)
    return () => onBeforeLeave(null)
  }, [onBeforeLeave])

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (unsavedRef.current) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", protectDraft)
    return () => window.removeEventListener("beforeunload", protectDraft)
  }, [])

  const historyItemsKey = JSON.stringify(
    session.blocks
      .flatMap((block) => block.items.map((item) => [item.id, item.exerciseId]))
      .sort(([a], [b]) => a.localeCompare(b))
  )
  useEffect(() => {
    let live = true
    let request = 0
    let inFlight: Promise<void> | undefined
    let foreground: ReturnType<typeof setTimeout> | undefined
    const items = JSON.parse(historyItemsKey) as [string, string][]
    const refresh = async () => {
      if (inFlight) return inFlight
      const run = async () => {
        const version = ++request
        let batch: Record<string, PreviousRecord> | undefined
        try {
          batch = await api.previousBatch(
            ownerId,
            items.map(([, exerciseId]) => exerciseId),
            session.routineId,
            session.performedOn
          )
        } catch {
          // Use the owner-scoped offline history if this refresh cannot reach the server.
        }
        const values = await Promise.all(
          items.map(async ([itemId, exerciseId]) => {
            let value: PreviousRecord
            if (batch && exerciseId in batch) value = batch[exerciseId]
            else {
              value = await readCachedPrevious(ownerId, initial.id, itemId).catch(
                () => null
              )
            }
            if (live && version === request) {
              // A cache-write failure must not discard a successful history response.
              await cachePrevious(ownerId, initial.id, itemId, value).catch(
                () => {}
              )
            }
            return [itemId, value] as const
          })
        )
        if (live && version === request) setPrevious(Object.fromEntries(values))
      }
      inFlight = run().finally(() => {
        inFlight = undefined
      })
      return inFlight
    }
    const visible = () => {
      if (document.visibilityState !== "visible") return
      clearTimeout(foreground)
      foreground = setTimeout(() => void refresh(), 100)
    }
    void refresh()
    window.addEventListener("online", visible)
    window.addEventListener("focus", visible)
    document.addEventListener("visibilitychange", visible)
    return () => {
      live = false
      clearTimeout(foreground)
      window.removeEventListener("online", visible)
      window.removeEventListener("focus", visible)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [
    historyItemsKey,
    session.routineId,
    session.performedOn,
    initial.id,
    ownerId,
  ])

  async function sync() {
    await persistRef.current
    if (!materialized.current) await flushPlanEdits(ownerId)
    else await flushQueue(ownerId)
    onSaved()
  }
  function update(
    value: SessionRecord,
    structure = false,
    planFields?: Pick<WorkoutRecord, "notes" | "focus" | "revision">,
    planBase?: WorkoutRecord
  ) {
    const previous = draftRef.current
    const previousPlan =
      planBase ??
      (planRef.current
        ? {
            ...planRef.current,
            title: previous.title,
            date: previous.performedOn,
            blocks: previous.blocks,
          }
        : undefined)
    const next = normalizeSessionResults({
      ...retainMovementNotes(withGroups(value)),
      loggingMode:
        value.loggingMode === "automatic" ? "checked" : value.loggingMode,
    })
    const saveToPlan = structure && !materialized.current && !!planRef.current
    if (!saveToPlan) materialized.current = true
    draftRef.current = next
    const incompleteCorrection =
      next.status === "completed" &&
      (next.loggingMode === "checked" || next.loggingMode === "automatic") &&
      remainingSets(next).length > 0
    correctionPending.current = incompleteCorrection
    sequenceRef.current += 1
    const version = sequenceRef.current
    unsavedRef.current = true
    setSession(next)
    setStatus("")
    setError("")
    persistRef.current = persistRef.current
      .catch(() => undefined)
      .then(async () => {
        if (saveToPlan && planRef.current) {
          const value = {
            ...planRef.current,
            ...planFields,
            title: next.title,
            date: next.performedOn,
            blocks: next.blocks,
          }
          const queued = await queuePlanEdit(ownerId, value, previousPlan)
          planRef.current = queued
          if (version === sequenceRef.current) {
            draftRef.current = {
              ...next,
              title: queued.title,
              performedOn: queued.date ?? next.performedOn,
              blocks: queued.blocks,
            }
            setSession(draftRef.current)
          }
          return
        }
        if (incompleteCorrection) {
          await saveCorrection(ownerId, next, previous)
          return
        }
        materialized.current = true
        const immediate =
          structure ||
          !sameValue(
            [
              previous.status,
              previous.startedAt,
              previous.finishedAt,
              previous.timerPausedAt,
              previous.pausedDurationMs,
            ],
            [
              next.status,
              next.startedAt,
              next.finishedAt,
              next.timerPausedAt,
              next.pausedDurationMs,
            ]
          ) ||
          next.results.some(
            (result) =>
              result.status !==
              (previous.results.find(
                (before) => before.targetId === result.targetId
              )?.status ?? "unlogged")
          )
        const correction =
          next.status === "completed"
            ? await offlineDb.corrections.get(`${ownerId}:${next.id}`)
            : undefined
        const queued = await queueSession(
          ownerId,
          next,
          correction?.base ?? previous,
          immediate ? 0 : 450
        )
        if (version === sequenceRef.current) {
          draftRef.current = queued
          setSession(queued)
        }
        await clearCorrection(ownerId, next.id)
      })
      .then(() => {
        if (version === sequenceRef.current) unsavedRef.current = false
        setStatus(correctionPending.current ? "Finish editing this set" : "")
      })
      .catch((exception) => {
        setStatus("Not saved")
        setError(errorMessage(exception))
        throw exception
      })
    void persistRef.current.catch(() => undefined)
    onPersistence?.(persistRef.current)
  }
  function changeNotes(
    itemId: string,
    scope: CardNote["scope"],
    transform: (notes: MovementNoteRecord[]) => MovementNoteRecord[]
  ) {
    const current = draftRef.current
    const block = current.blocks.find((block) =>
      block.items.some((item) => item.id === itemId)
    )
    const item = block?.items.find((item) => item.id === itemId)
    if (!block || !item) return
    update(
      scope === "session"
        ? {
            ...current,
            movementNotes: {
              ...current.movementNotes,
              [itemId]: transform(current.movementNotes?.[itemId] ?? []),
            },
          }
        : {
            ...current,
            blocks: changeCreationNotes(
              current.blocks,
              itemId,
              transform(creationNotes(block, item))
            ),
          }
    )
  }
  function changeBlocks(
    transform: (blocks: SessionRecord["blocks"]) => SessionRecord["blocks"]
  ) {
    update(
      { ...draftRef.current, blocks: transform(draftRef.current.blocks) },
      true
    )
  }
  function patchMovement(itemId: string, patch: Partial<WorkoutItem>) {
    const current = draftRef.current
    update(
      {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((item) =>
            item.id === itemId ? { ...item, ...patch } : item
          ),
        })),
      },
      true
    )
  }
  function patchTarget(
    item: WorkoutItem,
    targetId: string,
    patch: Partial<SetTarget>
  ) {
    const current = draftRef.current.blocks
      .flatMap((block) => block.items)
      .find((value) => value.id === item.id)
    if (current)
      patchMovement(item.id, {
        sets: current.sets.map((set) =>
          set.id === targetId ? { ...set, ...patch } : set
        ),
      })
  }
  async function removeGroup(id: string) {
    const block = draftRef.current.blocks.find((value) => value.id === id)
    if (!block) return
    if (
      block.items.length &&
      !(await confirmAction(
        `Remove ${block.title}, all its movements, and any entered results from this workout?`
      ))
    )
      return
    const current = draftRef.current
    const ids = new Set(
      current.blocks
        .find((value) => value.id === id)
        ?.items.map((item) => item.id)
    )
    update(
      {
        ...current,
        blocks: current.blocks.filter((value) => value.id !== id),
        results: current.results.filter((result) => !ids.has(result.itemId)),
      },
      true
    )
  }
  async function removeMovement(item: WorkoutItem) {
    const current = draftRef.current
    if (
      current.results.some(
        (result) => result.itemId === item.id && hasEnteredResult(result)
      ) &&
      !(await confirmAction(
        "Remove this movement and its entered results from this session?"
      ))
    )
      return
    update(
      {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.filter((value) => value.id !== item.id),
        })),
        results: current.results.filter((result) => result.itemId !== item.id),
      },
      true
    )
  }
  async function pickMovements(selected: ExerciseRecord[]) {
    if (!movementPicker) return
    const current = draftRef.current
    const { blockId, itemId, replace } = movementPicker
    if (
      replace &&
      current.results.some(
        (result) => result.itemId === itemId && hasEnteredResult(result)
      ) &&
      !(await confirmAction(
        "Replace this movement and remove its entered results?"
      ))
    )
      return
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
    update(
      {
        ...current,
        blocks: current.blocks.map((block) =>
          block.id !== blockId
            ? block
            : {
                ...block,
                items: replace
                  ? block.items.flatMap((item) =>
                      item.id === itemId ? items.slice(0, 1) : [item]
                    )
                  : [...block.items, ...items],
              }
        ),
        results: replace
          ? current.results.filter((result) => result.itemId !== itemId)
          : current.results,
      },
      true
    )
    setMovementPicker(null)
  }
  function patchResult(
    item: WorkoutItem,
    targetId: string | null,
    patch: Partial<SetResult>,
    resultId?: string
  ) {
    const current = draftRef.current
    const existing = current.results.find((row) =>
      resultId
        ? row.id === resultId
        : row.itemId === item.id && row.targetId === targetId
    )
    const result = { ...(existing ?? emptyResult(item.id, targetId)), ...patch }
    // Editing a completed value requires a fresh check. Existing historical rows retain their status.
    if (
      ["reps", "load", "durationSeconds", "distanceMeters"].some(
        (field) => field in patch
      ) &&
      !("status" in patch)
    )
      result.status = "unlogged"
    update({
      ...current,
      results: existing
        ? current.results.map((row) => (row.id === existing.id ? result : row))
        : [...current.results, result],
    })
  }
  function checkSet(
    item: WorkoutItem,
    target: SetTarget | null,
    existing?: SetResult
  ) {
    const current = draftRef.current
    const result = existing ?? emptyResult(item.id, target?.id ?? null)
    if (result.status === "completed") {
      patchResult(item, target?.id ?? null, { status: "unlogged" }, result.id)
      return
    }
    const accepted = acceptedSuggestion(
      result.load || !entryUnits[item.id]
        ? result
        : { ...result, load: { ...entryUnits[item.id], value: null } },
      target
        ? setSuggestion(
            item,
            target,
            current.results,
            previousSet(item, target, previous[item.id], true),
            result.load ??
              entryUnits[item.id] ??
              defaultEntryLoad(
                item,
                previousSet(item, target, previous[item.id], true)?.load
              )
          )
        : {}
    )
    if (inferredStatus(item, accepted) !== "completed") {
      setError(
        `Enter ${trackingFields(item)
          .map(
            (field) =>
              ({
                load: "weight",
                reps: "reps",
                durationSeconds: "time",
                distanceMeters: "distance",
              })[field]
          )
          .join(" and ")} before checking ${item.name}.`
      )
      return
    }
    patchResult(item, target?.id ?? null, accepted, existing?.id)
    if (target && current.status === "active") {
      const block = current.blocks.find((value) =>
        value.items.some((movement) => movement.id === item.id)
      )
      const seconds =
        block &&
        automaticRestSeconds(block, item, target, draftRef.current.results)
      if (seconds) restTimer.start(seconds, current.id)
    }
  }
  function changeSetType(
    item: WorkoutItem,
    target: SetTarget,
    kind: SetTarget["kind"]
  ) {
    const current = draftRef.current
    update(
      {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((movement) =>
            movement.id === item.id
              ? {
                  ...movement,
                  sets: movement.sets.map((set) =>
                    set.id === target.id ? { ...set, kind } : set
                  ),
                }
              : movement
          ),
        })),
      },
      true
    )
  }
  async function clearResult(
    item: WorkoutItem,
    targetId: string | null,
    result?: SetResult
  ) {
    if (
      hasEnteredResult(result) &&
      !(await confirmAction("Clear the entered values for this set?"))
    )
      return
    patchResult(
      item,
      targetId,
      {
        reps: null,
        load: null,
        durationSeconds: null,
        distanceMeters: null,
        rir: null,
        status: "unlogged",
      },
      result?.id
    )
  }
  async function removeSet(
    item: WorkoutItem,
    targetId: string | null,
    result?: SetResult
  ) {
    if (
      hasEnteredResult(result) &&
      !(await confirmAction(
        "Remove this set and its entered results from this session?"
      ))
    )
      return
    const current = draftRef.current
    update(
      {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((movement) =>
            movement.id === item.id
              ? {
                  ...movement,
                  sets: movement.sets.filter((set) => set.id !== targetId),
                }
              : movement
          ),
        })),
        results: current.results.filter((row) =>
          targetId
            ? !(row.itemId === item.id && row.targetId === targetId)
            : row.id !== result?.id
        ),
      },
      true
    )
  }
  function addSet(item: WorkoutItem) {
    const current = draftRef.current
    const movement =
      current.blocks
        .flatMap((block) => block.items)
        .find((row) => row.id === item.id) ?? item
    const target = {
      ...structuredClone(movement.sets.at(-1) ?? emptyTarget()),
      id: crypto.randomUUID(),
      kind: "working" as const,
    }
    update(
      {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((row) =>
            row.id === item.id ? { ...row, sets: [...row.sets, target] } : row
          ),
        })),
      },
      true
    )
  }
  async function close() {
    try {
      await persistRef.current
      onBack()
    } catch {
      setError(
        "Your latest edits could not be saved on this device. Keep this workout open and retry."
      )
    }
  }
  function finish(skipRemaining: boolean) {
    const current = draftRef.current
    const now = new Date().getTime()
    const results = [...current.results]
    if (skipRemaining) {
      for (const { item, target, result } of remainingSets(current)) {
        const skipped = {
          ...(result ?? emptyResult(item.id, target.id)),
          status: "skipped" as const,
        }
        const index = results.findIndex((row) => row.id === skipped.id)
        if (index < 0) results.push(skipped)
        else results[index] = skipped
      }
    }
    update({
      ...current,
      ...finishWorkoutTime(current, now),
      results,
    })
    setReviewing(false)
    setEditingResults(false)
    void persistRef.current
      .then(() => restTimer.cancelForSession(current.id))
      .catch(() => undefined)
    void sync().catch(() => undefined)
  }
  function controlWorkoutTimer(
    action: "start" | "pause" | "resume" | "reset" | "clear" | "toggle",
    now: number
  ) {
    const current = draftRef.current
    const nextAction =
      action === "toggle"
        ? !current.startedAt
          ? "start"
          : workoutTimerRunning(current)
            ? "pause"
            : "resume"
        : action
    if (nextAction === "start" || nextAction === "resume")
      restTimer.prepareSound()
    update({
      ...current,
      ...changeWorkoutTimer(current, nextAction, now),
    })
  }
  function finishOrReview() {
    if (remainingSets(draftRef.current).length) setReviewing(true)
    else if (draftRef.current.status === "completed") setEditingResults(false)
    else finish(false)
  }

  return (
    <div className="session-page">
      <header className="workout-toolbar">
        <Button variant="ghost" onClick={() => void close()}>
          <ArrowLeft size={17} /> Back
        </Button>
        <div className="workout-toolbar-actions">
          <AutosaveStatus ownerId={ownerId} />
          {restTimer.timer?.sessionId === session.id &&
            restTimer.timer.status !== "idle" && (
              <span
                className="workout-rest-countdown"
                aria-label="Rest remaining"
              >
                <RestTime timer={restTimer.timer} />
              </span>
            )}
          <Button
            variant="ghost"
            size="icon"
            className="workout-clock-button"
            aria-label="Open workout clock"
            title="Clock"
            onClick={() => setEditingTime(true)}
          >
            <Clock3 className="size-5" />
          </Button>
          {!readOnly ? (
            <Button
              aria-label={
                session.status === "completed"
                  ? "Done editing"
                  : "Finish workout"
              }
              onClick={finishOrReview}
            >
              {session.status === "completed" ? "Done" : "Finish"}
            </Button>
          ) : (
            <span className="completed-label">
              <Check size={17} /> Completed
            </span>
          )}
        </div>
      </header>
      {status && (
        <p className="save-status" role="status">
          {status}
        </p>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {dateLabel(session.performedOn, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1>{session.title}</h1>
          <p className="muted">
            {completed} / {total} sets logged
          </p>
        </div>
        <ActionMenu
          label="Workout actions"

          actions={[
            {
              label: "Delete workout",
              icon: Trash2,
              destructive: true,
              disabled: !navigator.onLine,
              onSelect: () => {
                void (async () => {
                  await persistRef.current
                  await flushQueue(ownerId)
                  setDeleting(true)
                })().catch((e) => setError(errorMessage(e)))
              },
            },
            {
              label: "Session notes",
              icon: MessageSquare,
              onSelect: () => setShowNotes(true),
            },
            ...(session.status === "completed"
              ? [
                  {
                    label: "Edit results",
                    icon: Pencil,
                    onSelect: () => setEditingResults(true),
                  },
                ]
              : []),
            {
              label: "Edit movements",
              icon: Settings2,
              onSelect: () => {
                if (session.status === "completed") setEditingResults(true)
                setEditing(true)
              },
            },
            {
              label: "Save as routine",
              icon: Copy,
              onSelect: () => {
                void api
                  .saveWorkout({
                    id: crypto.randomUUID(),
                    revision: 0,
                    kind: "routine",
                    weekId: null,
                    date: null,
                    routineId: null,
                    title: session.title,
                    focus: "",
                    blocks: session.blocks,
                    notes: "",
                    source: null,
                  })
                  .then(() => setStatus(""))
                  .catch((exception) => setError(errorMessage(exception)))
              },
            },
          ]}
        />
      </div>
      <div
        className="workout-summary"
        role="group"
        aria-label="Workout summary"
      >
        <div>
          <span>Duration</span>
          <strong>
            <ElapsedTime session={session} compact />
          </strong>
        </div>
        <div>
          <span>
            Volume{" "}
            <button
              aria-label="About workout volume"
              onClick={() => setVolumeInfo(true)}
            >
              ⓘ
            </button>
          </span>
          <strong aria-label={`${volumePounds.toLocaleString()} pounds`}>
            <span className="summary-volume-full">
              {volumePounds.toLocaleString()}
            </span>
            <span className="summary-volume-compact" aria-hidden="true">
              {volumePounds >= 10000
                ? volumePounds.toLocaleString("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  })
                : volumePounds.toLocaleString()}
            </span>{" "}
            <small>lb</small>
          </strong>
        </div>
        <div>
          <span>Sets</span>
          <strong>
            {completed}
            <small> / {total}</small>
          </strong>
        </div>
        <div>
          <span>Exercises</span>
          <strong>
            {session.blocks.flatMap((block) => block.items).length}
          </strong>
        </div>
      </div>
      <div className="progress-track">
        <span
          style={{
            width: `${total ? Math.min(100, (completed / total) * 100) : 0}%`,
          }}
        />
      </div>
      {volumeInfo && (
        <Modal title="Workout volume" onClose={() => setVolumeInfo(false)}>
          <p className="mb-3 font-semibold">
            {volumePounds.toLocaleString()} lb total volume
          </p>
          <p className="muted text-sm">
            Completed reps × entered external weight, including warm-ups.
            Kilograms are converted to pounds for this summary. Each entered
            weight is counted once, including per-hand and unilateral work.
            Bodyweight, assistance, and sets without a recorded weight or weight
            unit are excluded.
          </p>
          <p className="muted mt-3 text-sm">
            {volume.excluded} completed sets have no eligible volume.
          </p>
        </Modal>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {session.blocks.map((block) => (
        <WorkoutGroup
          key={block.id}
          block={block}
          expandVersion={expandVersion}
          readOnly={readOnly}
          focusOnMount={newGroupId === block.id}
          onChange={(patch) =>
            changeBlocks((blocks) =>
              blocks.map((value) =>
                value.id === block.id ? { ...value, ...patch } : value
              )
            )
          }
          onAdd={() => {
            setNewGroupId(null)
            setMovementPicker({ blockId: block.id })
          }}
          onRemove={() => {
            void removeGroup(block.id)
          }}
          onReorder={() => setReordering(true)}
        >
          {block.items.map((item) => {
            const history = previous[item.id]
            const entryLoad =
              entryUnits[item.id] ??
              defaultEntryLoad(
                item,
                item.sets[0]
                  ? previousSet(item, item.sets[0], history, true)?.load
                  : null
              )
            const uniformTarget = item.sets.every(
              (set) =>
                prescriptionLabel(set) === prescriptionLabel(item.sets[0]) &&
                set.kind === item.sets[0].kind
            )
            const additional = session.results.filter(
              (row) => row.itemId === item.id && row.targetId === null
            )
            return (
              <MovementCard
                key={item.id}
                className="movement"
                name={item.name}
                detail={[
                  item.equipment,
                  item.setup,
                  item.unilateral ? "Each side" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                readOnly={readOnly}
                restSeconds={movementRest(block, item).restSeconds}
                onRest={() => setRestItemId(item.id)}
                notes={[
                  ...creationNotes(block, item).map((note) => ({
                    ...note,
                    scope: "workout" as const,
                  })),
                  ...(session.movementNotes?.[item.id] ?? []).map((note) => ({
                    ...note,
                    scope: "session" as const,
                  })),
                ]}
                onAddNote={(id) =>
                  changeNotes(item.id, "session", (notes) => [
                    ...notes,
                    { id, text: "" },
                  ])
                }
                onChangeNote={(note, text) =>
                  changeNotes(item.id, note.scope, (notes) =>
                    notes.map((value) =>
                      value.id === note.id ? { id: value.id, text } : value
                    )
                  )
                }
                onDeleteNote={(note) =>
                  changeNotes(item.id, note.scope, (notes) =>
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
                      setMovementPicker({
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
                    onSelect: () => setSettingsItemId(item.id),
                  },
                  {
                    label: "Set details",
                    icon: Settings2,
                    disabled: !item.sets.length,
                    onSelect: () =>
                      setSetDetails({
                        itemId: item.id,
                        targetId: item.sets[0].id,
                      }),
                  },
                  {
                    label: "Remove exercise",
                    icon: Trash2,
                    destructive: true,
                    separator: true,
                    onSelect: () => {
                      void removeMovement(item)
                    },
                  },
                ]}
              >
                <div className="movement-reference-summary">
                  {uniformTarget && item.sets[0] && (
                    <span>
                      {item.sets.length} × {prescriptionLabel(item.sets[0])}
                    </span>
                  )}
                  {history && (
                    <span>
                      Previous · {dateLabel(history.date)}
                      {history.match === "exercise" ? " · other routine" : ""}
                    </span>
                  )}
                </div>
                <div className="session-set-list">
                  <SessionSetHeader
                    item={item}
                    entryLoad={entryLoad}
                    onUnits={!readOnly ? () => setUnitsItem(item) : undefined}
                  />
                  {item.sets.map((target, index) => {
                    const result = session.results.find(
                      (row) =>
                        row.itemId === item.id && row.targetId === target.id
                    )
                    return (
                      <SessionSetRow
                        key={target.id}
                        item={item}
                        readOnly={readOnly}
                        index={index}
                        target={target}
                        result={result}
                        previous={previousSet(item, target, history)}
                        entryLoad={entryLoad}
                        showTarget={!uniformTarget}
                        suggestion={setSuggestion(
                          item,
                          target,
                          session.results,
                          previousSet(item, target, history, true),
                          result?.load ?? entryLoad
                        )}
                        detailsOpen={
                          setDetails?.itemId === item.id &&
                          setDetails.targetId === target.id
                        }
                        onCloseDetails={() => setSetDetails(null)}
                        detailsSelector={
                          <Field label="Set">
                            <NativeSelect
                              label={`${item.name} set details`}
                              value={target.id}
                              onChange={(targetId) =>
                                setSetDetails({ itemId: item.id, targetId })
                              }
                            >
                              {item.sets.map((set, ordinal) => (
                                <option key={set.id} value={set.id}>
                                  Set {ordinal + 1}
                                </option>
                              ))}
                            </NativeSelect>
                          </Field>
                        }
                        onTargetPatch={(patch) =>
                          patchTarget(item, target.id, patch)
                        }
                        onCheck={() => checkSet(item, target, result)}
                        onType={(kind) => changeSetType(item, target, kind)}
                        onPatch={(patch) => patchResult(item, target.id, patch)}
                        onRemove={() => removeSet(item, target.id, result)}
                        onUndo={() => clearResult(item, target.id, result)}
                        onSkip={() =>
                          patchResult(item, target.id, {
                            status:
                              result?.status === "skipped"
                                ? "unlogged"
                                : "skipped",
                          })
                        }
                      />
                    )
                  })}
                </div>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="add-session-set"
                    onClick={() => addSet(item)}
                  >
                    <Plus size={14} /> Add set
                  </Button>
                )}
                {additional.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="text-muted-foreground">
                      Additional historical sets ({additional.length})
                    </summary>
                    <div className="mt-3">
                      <SessionSetHeader
                        item={item}
                        entryLoad={entryLoad}
                        onUnits={
                          !readOnly ? () => setUnitsItem(item) : undefined
                        }
                      />
                      {additional.map((result, index) => (
                        <SessionSetRow
                          key={result.id}
                          item={item}
                          readOnly={readOnly}
                          index={item.sets.length + index}
                          target={null}
                          onCheck={() => checkSet(item, null, result)}
                          result={result}
                          entryLoad={entryLoad}
                          onPatch={(patch) =>
                            patchResult(item, null, patch, result.id)
                          }
                          onRemove={() => removeSet(item, null, result)}
                          onUndo={() => clearResult(item, null, result)}
                          onSkip={() =>
                            patchResult(
                              item,
                              null,
                              {
                                status:
                                  result.status === "skipped"
                                    ? "unlogged"
                                    : "skipped",
                              },
                              result.id
                            )
                          }
                        />
                      ))}
                    </div>
                  </details>
                )}
              </MovementCard>
            )
          })}
        </WorkoutGroup>
      ))}
      {!readOnly && (
        <Button
          className="add-exercises-button"
          variant="outline"
          onClick={() => {
            const group = newGroup(draftRef.current.blocks)
            changeBlocks((blocks) => [...blocks, group])
            setNewGroupId(group.id)
          }}
        >
          <Plus size={17} /> Add group
        </Button>
      )}
      {movingItem && (
        <MoveToGroup
          blocks={session.blocks}
          itemId={movingItem}
          onClose={() => setMovingItem(null)}
          onMove={(destination) => {
            const group = destination ? null : newGroup(draftRef.current.blocks)
            changeBlocks((blocks) =>
              moveMovement(
                group ? [...blocks, group] : blocks,
                movingItem,
                destination ?? group!.id
              )
            )
            void persistRef.current
              .then(() => {
                if (group) setNewGroupId(group.id)
                setMovingItem(null)
              })
              .catch(() => undefined)
          }}
        />
      )}
      {reordering && (
        <MovementReorderPanel
          blocks={session.blocks}
          onChange={(blocks) => changeBlocks(() => blocks)}
          onClose={() => setReordering(false)}
        />
      )}
      {restItemId &&
        (() => {
          const block = session.blocks.find((value) =>
            value.items.some((item) => item.id === restItemId)
          )
          const item = block?.items.find((item) => item.id === restItemId)
          if (!block || !item) return null
          return (
            <MovementRestPanel
              name={item.name}
              rest={movementRest(block, item)}
              onChange={(patch) => patchMovement(item.id, patch)}
              onClose={() => setRestItemId(null)}
            />
          )
        })()}
      {movementPicker && (
        <Modal
          title={
            movementPicker.replace
              ? "Replace movement"
              : `Add to ${session.blocks.find((block) => block.id === movementPicker.blockId)?.title ?? "group"}`
          }
          onClose={() => setMovementPicker(null)}
        >
          <WorkoutExercisePicker
            exercises={exercises}
            single={movementPicker.replace}
            onSelect={(selected) => {
              void pickMovements(selected)
            }}
          />
        </Modal>
      )}
      {settingsItemId &&
        (() => {
          const item = session.blocks
            .flatMap((block) => block.items)
            .find((value) => value.id === settingsItemId)
          if (!item) return null
          return (
            <Modal
              title={`${item.name} settings`}
              onClose={() => setSettingsItemId(null)}
            >
              <TrackingFieldsPicker
                label={`${item.name} tracking`}
                values={trackingFields(item)}
                onChange={(trackingFields) =>
                  patchMovement(item.id, { trackingFields })
                }
              />
              <Field label="Setup">
                <Input
                  value={item.setup}
                  onChange={(event) =>
                    patchMovement(item.id, { setup: event.target.value })
                  }
                />
              </Field>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={item.unilateral}
                  onChange={(event) =>
                    patchMovement(item.id, { unilateral: event.target.checked })
                  }
                />{" "}
                Each side
              </label>
              {trackingFields(item).includes("load") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSettingsItemId(null)
                    setUnitsItem(item)
                  }}
                >
                  Weight units
                </Button>
              )}
            </Modal>
          )
        })()}
      {showNotes && (
        <Modal title="Session notes" onClose={() => setShowNotes(false)}>
          {readOnly ? (
            <p className="muted text-sm whitespace-pre-wrap">
              {(session.userNotes ??
                (isHistoricalCommentary(session.notes) ? "" : session.notes)) ||
                "No session notes"}
            </p>
          ) : (
            <Textarea
              aria-label="Session notes"
              placeholder="Add a note…"
              rows={5}
              value={
                session.userNotes !== undefined ||
                isHistoricalCommentary(session.notes)
                  ? (session.userNotes ?? "")
                  : session.notes
              }
              onChange={(event) =>
                update(
                  session.userNotes !== undefined ||
                    isHistoricalCommentary(session.notes)
                    ? { ...draftRef.current, userNotes: event.target.value }
                    : { ...draftRef.current, notes: event.target.value }
                )
              }
            />
          )}
        </Modal>
      )}
      {editingTime && (
        <SessionTimeEditor
          session={session}
          onClose={() => setEditingTime(false)}
          onControl={controlWorkoutTimer}
          onChange={(value) => {
            const current = draftRef.current
            if (
              value.startedAt === current.startedAt &&
              value.finishedAt === current.finishedAt
            )
              return
            update({
              ...current,
              ...editWorkoutTime(current, value, Date.now()),
            })
          }}
        />
      )}
      {reviewing && (
        <Modal
          title="Review your workout"
          description={`${remaining.length} ${remaining.length === 1 ? "set is" : "sets are"} still unlogged. Partial entries will be preserved.`}
          onClose={() => setReviewing(false)}
        >
          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            {remaining.map(({ item, target, index, result }) => (
              <div
                className="flex justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-0"
                key={target.id}
              >
                <span>
                  {item.name} · Set {index + 1}
                </span>
                <span className="text-xs text-muted-foreground">
                  {hasEnteredResult(result) ? "Partial entry" : "Not logged"}
                </span>
              </div>
            ))}
          </div>
          <div className="dialog-footer">
            <Button
              variant="outline"
              onClick={() => {
                setReviewing(false)
                setExpandVersion((value) => value + 1)
                const id = remaining[0]?.target.id
                if (id)
                  requestAnimationFrame(() =>
                    document
                      .getElementById(`set-${id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  )
              }}
            >
              Review sets
            </Button>
            <Button onClick={() => finish(true)}>
              {session.status === "completed"
                ? "Skip remaining and done"
                : "Skip remaining and finish"}
            </Button>
          </div>
        </Modal>
      )}
      {unitsItem && (
        <Modal
          title={`${unitsItem.name} units`}
          description="Applies to new entries only. Recorded sets keep their units."
          onClose={() => setUnitsItem(null)}
        >
          <EntryUnits
            prefix={`${unitsItem.name} new entries`}
            value={
              entryUnits[unitsItem.id] ??
              defaultEntryLoad(
                unitsItem,
                unitsItem.sets[0]
                  ? previousSet(
                      unitsItem,
                      unitsItem.sets[0],
                      previous[unitsItem.id],
                      true
                    )?.load
                  : null
              )
            }
            onChange={(value) => {
              const next = { ...entryUnits, [unitsItem.id]: value }
              setEntryUnits(next)
              localStorage.setItem(
                `entry-units:${ownerId}:${initial.workoutId ?? initial.id}`,
                JSON.stringify(next)
              )
            }}
          />
        </Modal>
      )}
      {editing && (
        <WorkoutEditor
          ownerId={ownerId}
          draftKey={`session:${session.id}`}
          creation={false}
          workout={{
            id: session.workoutId ?? session.id,
            revision: session.revision || plan?.revision || 0,
            kind: "planned",
            routineId: session.routineId,
            weekId: session.weekId,
            date: session.performedOn,
            title: session.title,
            focus: plan?.focus ?? "",
            blocks: session.blocks,
            notes:
              session.revision || session.results.length || session.startedAt
                ? session.notes
                : (plan?.notes ?? session.notes),
            source: null,
          }}
          exercises={exercises}
          onClose={() => setEditing(false)}
          equipment={equipment}
          onBeforeChange={async (workout) => {
            const items = new Set(
              workout.blocks.flatMap((b) => b.items.map((i) => i.id))
            )
            const sets = new Set(
              workout.blocks.flatMap((b) =>
                b.items.flatMap((i) => i.sets.map((s) => s.id))
              )
            )
            const removesResults = draftRef.current.results.some(
              (result) =>
                hasEnteredResult(result) &&
                (!items.has(result.itemId) ||
                  (result.targetId !== null && !sets.has(result.targetId)))
            )
            return (
              !removesResults ||
              (await confirmAction(
                "Remove these movements or sets and their entered results? This cannot be undone."
              ))
            )
          }}
          sessionId={
            session.revision ||
            session.results.length ||
            session.startedAt ||
            session.userNotes ||
            Object.keys(session.movementNotes ?? {}).length
              ? session.id
              : undefined
          }
          onSave={async (workout, base) => {
            const current = draftRef.current
            const validItems = new Set(
              workout.blocks.flatMap((block) =>
                block.items.map((item) => item.id)
              )
            )
            const validIds = new Set(
              workout.blocks.flatMap((block) =>
                block.items.flatMap((item) => item.sets.map((set) => set.id))
              )
            )
            const retained = (result: SetResult) =>
              validItems.has(result.itemId) &&
              (result.targetId === null || validIds.has(result.targetId))
            const desired = {
              ...current,
              title: workout.title,
              performedOn: workout.date ?? current.performedOn,
              blocks: workout.blocks,
              notes: workout.notes,
              results: current.results.filter(retained),
            }
            const next = materialized.current
              ? mergeSession(
                  {
                    ...current,
                    title: base.title,
                    performedOn: base.date ?? current.performedOn,
                    blocks: base.blocks,
                    notes: base.notes,
                  },
                  desired,
                  current
                )
              : desired
            update(
              next,
              true,
              {
                notes: workout.notes,
                focus: workout.focus,
                revision: workout.revision,
              },
              base
            )
            await persistRef.current
            return {
              ...workout,
              title: draftRef.current.title,
              date: draftRef.current.performedOn,
              blocks: draftRef.current.blocks,
              notes: materialized.current
                ? draftRef.current.notes
                : (planRef.current?.notes ?? workout.notes),
              revision: materialized.current
                ? draftRef.current.revision
                : (planRef.current?.revision ?? workout.revision),
            }
          }}
        />
      )}
      {deleting && (
        <DeleteWorkoutDialog
          ownerId={ownerId}
          resource={session.workoutId ? "workouts" : "sessions"}
          id={session.workoutId ?? session.id}
          onClose={() => setDeleting(false)}
          onDeleted={(ids) => {
            restTimer.cancelForSession(session.id)
            ids.forEach((id) => restTimer.cancelForSession(id))
            unsavedRef.current = false
            onBeforeLeave(null)
            void onDeleted().catch((e) => setError(errorMessage(e)))
          }}
        />
      )}
    </div>
  )
}

function localDateTime(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
function SessionTimeEditor({
  session,
  onClose,
  onChange,
  onControl,
}: {
  session: SessionRecord
  onClose: () => void
  onChange: (value: Pick<SessionRecord, "startedAt" | "finishedAt">) => void
  onControl: (
    action: "start" | "pause" | "resume" | "reset" | "clear" | "toggle",
    now: number
  ) => void
}) {
  const [clockTab, setClockTab] = useState<"rest" | "workout">(
    session.status === "completed" ? "workout" : "rest"
  )
  type TimeDraft = Partial<
    Record<"start" | "finish", { value: string; invalid: boolean }>
  >
  const [draft, setDraft] = useState<TimeDraft>({})
  const draftRef = useRef<TimeDraft>({})
  const [error, setError] = useState("")
  const errorId = useId()
  const setTimeDraft = (next: TimeDraft) => {
    draftRef.current = next
    setDraft(next)
  }
  function saveTimes() {
    if (!Object.keys(draftRef.current).length) return true
    try {
      const timestamp = (field: "start" | "finish", current: string | null) => {
        const edit = draftRef.current[field]
        if (!edit) return current
        if (
          edit.invalid ||
          (edit.value && !Number.isFinite(Date.parse(edit.value)))
        )
          throw new Error("Enter a valid date and time.")
        // Preserve seconds and milliseconds in fields the user hasn't changed.
        if (edit.value === localDateTime(current)) return current
        return edit.value ? new Date(edit.value).toISOString() : null
      }
      const value = {
        startedAt: timestamp("start", session.startedAt),
        finishedAt: timestamp("finish", session.finishedAt),
      }
      editWorkoutTime(session, value, Date.now())
      onChange(value)
      setTimeDraft({})
      setError("")
      return true
    } catch (error) {
      setError(errorMessage(error))
      return false
    }
  }
  const timers = useTimers()
  const bindSession = timers.bindSession
  useEffect(() => bindSession(session.id), [bindSession, session.id])
  const playing = workoutTimerRunning(session)
  return (
    <Modal
      title="Clock"
      onClose={() => {
        saveTimes()
        onClose()
      }}
    >
      <div className="clock-tabs" role="tablist" aria-label="Clock mode">
        <button
          role="tab"
          aria-selected={clockTab === "rest"}
          onClick={() => {
            saveTimes()
            setClockTab("rest")
          }}
        >
          Rest timer
        </button>
        <button
          role="tab"
          aria-selected={clockTab === "workout"}
          onClick={() => {
            saveTimes()
            setClockTab("workout")
          }}
        >
          Workout clock
        </button>
      </div>
      {clockTab === "rest" ? (
        timers.controls
      ) : (
        <div className="clock-panel">
          <WorkoutDial session={session} />
          {session.status === "active" && (
            <ClockControls
              playing={playing}
              playLabel={
                !session.startedAt
                  ? "Start workout timer"
                  : playing
                    ? "Pause workout timer"
                    : "Resume workout timer"
              }
              resetLabel="Reset workout timer"
              onReset={() => {
                setTimeDraft({})
                setError("")
                onControl("reset", Date.now())
              }}
              onPlay={() => {
                if (saveTimes()) onControl("toggle", Date.now())
              }}
            />
          )}
          <div className="workout-clock-times">
            <Field label="Start time">
              <Input
                aria-label="Workout start time"
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                type="datetime-local"
                value={draft.start?.value ?? localDateTime(session.startedAt)}
                onChange={(event) =>
                  setTimeDraft({
                    ...draftRef.current,
                    start: {
                      value: event.target.value,
                      invalid: event.target.validity.badInput,
                    },
                  })
                }
                onBlur={saveTimes}
              />
            </Field>
            <Field label="End time">
              <Input
                aria-label="Workout end time"
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                type="datetime-local"
                value={draft.finish?.value ?? localDateTime(session.finishedAt)}
                onChange={(event) =>
                  setTimeDraft({
                    ...draftRef.current,
                    finish: {
                      value: event.target.value,
                      invalid: event.target.validity.badInput,
                    },
                  })
                }
                onBlur={saveTimes}
              />
            </Field>
            {error && (
              <p role="alert" id={errorId} className="error-message">
                {error}
              </p>
            )}
            {!!(session.pausedDurationMs || session.timerPausedAt) && (
              <p className="muted text-sm">
                Changing these times clears recorded pauses.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
