"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Pause,
  Play,
  Plus,
  MoreHorizontal,
  Pencil,
  Settings2,
  Copy,
  MessageSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ElapsedTime, TimerLaunch, WorkoutDial, useTimers } from "./timers"
import { ClockControls } from "./timer-face"
import { changeWorkoutTimer, settleWorkoutPause } from "@/lib/timers"
import { api } from "@/lib/api-client"
import {
  queueSession,
  saveCorrection,
  readCorrection,
  clearCorrection,
  flushQueue,
  readCachedSession,
  listPending,
  cachePrevious,
  readCachedPrevious,
} from "@/lib/offline"
import {
  cleanBlockTitle,
  isHistoricalCommentary,
  prescriptionLabel,
} from "@/lib/presentation"
import {
  inferredStatus,
  normalizeSessionResults,
  trackingFields,
} from "@/contracts/training"
import {
  emptyTarget,
  muscleLabels,
  type ExerciseRecord,
  type LoadValue,
  type PreviousRecord,
  type SessionRecord,
  type SetResult,
  type WorkoutItem,
  type WorkoutRecord,
} from "@/contracts/models"
import { Instructions, Modal, dateLabel, errorMessage } from "./shared"
import { ActionMenu, confirmAction } from "./responsive-panel"
import { WorkoutEditor } from "./workout-editor"
import {
  defaultEntryLoad,
  EntryUnits,
  hasEnteredResult,
  SessionSetRow,
  SessionSetHeader,
} from "./session-set-row"

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
  onBack,
  onSaved,
  onPersistence,
  plan,
  onPlanSaved,
  onBeforeLeave,
}: {
  initial: SessionRecord
  plan?: WorkoutRecord
  onPlanSaved: () => Promise<void>
  onBeforeLeave: (guard: (() => boolean) | null) => void
  ownerId: string
  exercises: ExerciseRecord[]
  onBack: () => void
  onSaved: () => void
  onPersistence?: (promise: Promise<unknown>) => void
}) {
  const [session, setSession] = useState(initial)
  const [previous, setPrevious] = useState<Record<string, PreviousRecord>>({})
  const [editingResults, setEditingResults] = useState(false)
  const [unitsItem, setUnitsItem] = useState<WorkoutItem | null>(null)
  const readOnly = session.status === "completed" && !editingResults
  const materialized = useRef(
    initial.revision > 0 ||
      initial.results.length > 0 ||
      !!initial.startedAt ||
      !!initial.notes ||
      !!initial.userNotes
  )
  const planRef = useRef(plan)
  const correctionPending = useRef(false)
  const [editing, setEditing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [editingTime, setEditingTime] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const restTimer = useTimers()
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set())
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
  const [staleCorrection, setStaleCorrection] = useState<SessionRecord | null>(
    null
  )
  const [reviewStaleCorrection, setReviewStaleCorrection] = useState(false)
  const draftRef = useRef(initial)
  const sequenceRef = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistRef = useRef<Promise<unknown>>(Promise.resolve())
  const unsavedRef = useRef(false)
  const completed = session.results.filter(
    (result) => result.status === "completed" && result.targetId !== null
  ).length
  const total = session.blocks
    .flatMap((block) => block.items)
    .reduce((count, item) => count + item.sets.length, 0)
  const remaining = remainingSets(session)

  useEffect(() => {
    let live = true
    void readCorrection(ownerId, initial.id).then((draft) => {
      if (!live || !draft) return
      if (draft.revision !== initial.revision) {
        setStaleCorrection(draft)
        setReviewStaleCorrection(true)
        setError(
          "Saved corrections are based on an older version. They remain on this device. Resolve the newer results before applying them."
        )
        return
      }
      draftRef.current = draft
      setSession(draft)
      setEditingResults(true)
      correctionPending.current = true
      setStatus("Resolve unfinished sets")
    })
    return () => {
      live = false
    }
  }, [ownerId, initial.id, initial.workoutId, initial.revision])
  useEffect(() => {
    onBeforeLeave(() => {
      if (correctionPending.current && remainingSets(draftRef.current).length) {
        setReviewing(true)
        return false
      }
      return true
    })
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

  useEffect(() => {
    let live = true
    const items = initial.blocks.flatMap((block) => block.items)
    void Promise.all(
      items.map(async (item) => {
        let value: PreviousRecord
        try {
          value = await api.previous(
            item.exerciseId,
            initial.routineId,
            initial.performedOn
          )
          await cachePrevious(ownerId, initial.id, item.id, value)
        } catch {
          value =
            (await readCachedPrevious(ownerId, initial.id, item.id)) ?? null
        }
        return [item.id, value] as const
      })
    ).then((values) => {
      if (live) setPrevious(Object.fromEntries(values))
    })
    return () => {
      live = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [
    initial.blocks,
    initial.routineId,
    initial.performedOn,
    initial.id,
    ownerId,
  ])

  async function sync() {
    try {
      await persistRef.current
      const version = sequenceRef.current
      const result = await flushQueue(ownerId)
      const pending = (await listPending(ownerId)).find(
        (entry) => entry.id === initial.id
      )
      if (result.authRequired) setStatus("Sign in to sync")
      else if (pending?.status === "conflict")
        setStatus("Resolve sync conflict in Profile")
      else if (pending?.status === "error") setStatus("Sync pending")
      else if (pending) {
        setStatus(navigator.onLine ? "" : "Offline · sync pending")
        if (navigator.onLine) {
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            void sync()
          }, 1000)
        }
      } else {
        const cached = await readCachedSession(ownerId, initial.id)
        if (cached && version === sequenceRef.current) {
          if (correctionPending.current) {
            // A preceding valid edit from this device may have just synced.
            // Retain the unfinished correction, rebased onto that saved revision.
            const correction = {
              ...draftRef.current,
              revision: cached.revision,
            }
            await saveCorrection(ownerId, correction)
            draftRef.current = correction
            setSession(correction)
          } else {
            draftRef.current = cached
            setSession(cached)
          }
        }
        if (!correctionPending.current)
          setStatus(navigator.onLine ? "" : "Offline · sync pending")
      }
      onSaved()
    } catch (exception) {
      setStatus(
        unsavedRef.current
          ? "Not saved"
          : navigator.onLine
            ? ""
            : "Offline · sync pending"
      )
      setError(errorMessage(exception))
    }
  }
  function update(value: SessionRecord, structure = false) {
    const next = normalizeSessionResults(value)
    draftRef.current = next
    correctionPending.current =
      next.status === "completed" && remainingSets(next).length > 0
    sequenceRef.current += 1
    const version = sequenceRef.current
    unsavedRef.current = true
    setSession(next)
    setStatus("")
    setError("")
    persistRef.current = persistRef.current
      .catch(() => undefined)
      .then(async () => {
        if (structure && !materialized.current && planRef.current) {
          const saved = await api.saveWorkout({
            ...planRef.current,
            title: next.title,
            date: next.performedOn,
            blocks: next.blocks,
          })
          planRef.current = saved
          await onPlanSaved()
          return
        }
        if (next.status === "completed" && remainingSets(next).length) {
          await saveCorrection(ownerId, next)
          return
        }
        materialized.current = true
        await queueSession(ownerId, next)
        await clearCorrection(ownerId, next.id)
      })
      .then(() => {
        if (version === sequenceRef.current) unsavedRef.current = false
        setStatus(
          correctionPending.current
            ? "Resolve unfinished sets"
            : navigator.onLine
              ? ""
              : "Offline · sync pending"
        )
      })
      .catch((exception) => {
        setStatus("Not saved")
        setError(errorMessage(exception))
        throw exception
      })
    void persistRef.current.catch(() => undefined)
    onPersistence?.(persistRef.current)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void sync()
    }, 1000)
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
    // Editing one historical row applies the current rule only to that row.
    // The rest of a legacy session retains its explicit recorded status.
    const changesPerformance = [
      "reps",
      "load",
      "durationSeconds",
      "distanceMeters",
      "status",
    ].some((field) => field in patch)
    if (changesPerformance)
      result.status = inferredStatus(item, {
        ...result,
        status: patch.status ?? "unlogged",
      })
    update({
      ...current,
      results: existing
        ? current.results.map((row) => (row.id === existing.id ? result : row))
        : [...current.results, result],
    })
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
    if (correctionPending.current && remainingSets(draftRef.current).length) {
      setReviewing(true)
      return
    }
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
      results,
      status: "completed",
      finishedAt:
        current.status === "completed"
          ? current.finishedAt
          : current.startedAt
            ? new Date(now).toISOString()
            : null,
      ...(current.status === "completed"
        ? {}
        : settleWorkoutPause(current, now)),
    })
    setReviewing(false)
    setEditingResults(false)
    void persistRef.current
      .then(() => restTimer.cancelForSession(current.id))
      .catch(() => undefined)
    void sync()
  }
  function controlWorkoutTimer(
    action: "start" | "pause" | "resume" | "reset" | "clear"
  ) {
    update({
      ...draftRef.current,
      ...changeWorkoutTimer(draftRef.current, action, new Date().getTime()),
    })
  }
  function finishOrReview() {
    if (remainingSets(draftRef.current).length) setReviewing(true)
    else if (draftRef.current.status === "completed") setEditingResults(false)
    else finish(false)
  }

  return (
    <div className="session-page">
      <div className="row spread">
        <Button variant="ghost" onClick={() => void close()}>
          <ArrowLeft size={16} /> Back
        </Button>
        {status && (
          <span className="save-status" role="status">
            {status}
          </span>
        )}
      </div>
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
          trigger={<MoreHorizontal size={20} />}
          actions={[
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
      <div className="progress-track">
        <span
          style={{
            width: `${total ? Math.min(100, (completed / total) * 100) : 0}%`,
          }}
        />
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {staleCorrection && (
        <Button
          variant="outline"
          onClick={() => setReviewStaleCorrection(true)}
        >
          Review saved corrections
        </Button>
      )}
      {staleCorrection && reviewStaleCorrection && (
        <Modal
          title="Results changed elsewhere"
          description="Your unfinished device corrections use an older version. Keep the latest saved results, or review your device draft. Saving that draft will replace the newer results. The latest workout timing will be preserved."
          onClose={() => setReviewStaleCorrection(false)}
        >
          <div className="dialog-footer">
            <Button
              variant="outline"
              onClick={async () => {
                await clearCorrection(ownerId, initial.id)
                setStaleCorrection(null)
                setReviewStaleCorrection(false)
                setError("")
              }}
            >
              Keep latest results
            </Button>
            <Button
              onClick={async () => {
                const draft = {
                  ...staleCorrection,
                  revision: initial.revision,
                  startedAt: initial.startedAt,
                  finishedAt: initial.finishedAt,
                  pausedDurationMs: initial.pausedDurationMs,
                  timerPausedAt: initial.timerPausedAt,
                }
                await saveCorrection(ownerId, draft)
                draftRef.current = draft
                correctionPending.current = true
                setSession(draft)
                setEditingResults(true)
                setStaleCorrection(null)
                setReviewStaleCorrection(false)
                setError("")
                setStatus("Resolve unfinished sets")
              }}
            >
              Review device draft
            </Button>
          </div>
        </Modal>
      )}
      {session.blocks.map((block, blockIndex) => (
        <section className="workout-block" key={block.id}>
          <button
            type="button"
            className="block-heading block-toggle"
            aria-label={`${collapsedBlocks.has(block.id) ? "Expand" : "Collapse"} ${cleanBlockTitle(block.title)}`}
            aria-expanded={!collapsedBlocks.has(block.id)}
            aria-controls={`block-content-${block.id}`}
            onClick={() =>
              setCollapsedBlocks((current) => {
                const next = new Set(current)
                if (next.has(block.id)) next.delete(block.id)
                else next.add(block.id)
                return next
              })
            }
          >
            <span className="block-letter">
              {String.fromCharCode(65 + blockIndex)}
            </span>
            <div>
              <h2>{cleanBlockTitle(block.title)}</h2>
              <p>
                {block.kind === "straight"
                  ? "Straight sets"
                  : block.kind === "superset"
                    ? "Superset"
                    : "Circuit"}
                {block.rounds ? ` · ${block.rounds} rounds` : ""}
                {block.restSeconds ? ` · ${block.restSeconds}s rest` : ""}
              </p>
            </div>
            <ChevronDown size={18} className="block-chevron" />
          </button>
          <div
            id={`block-content-${block.id}`}
            hidden={collapsedBlocks.has(block.id)}
          >
            {block.notes && (
              <div className="block-instructions">
                <Instructions text={block.notes} />
              </div>
            )}
            {block.items.map((item, itemIndex) => {
              const history = previous[item.id]
              const prior =
                history?.results.filter((row) => row.status === "completed") ??
                []
              const entryLoad = entryUnits[item.id] ?? defaultEntryLoad(item)
              const uniformTarget = item.sets.every(
                (set) =>
                  prescriptionLabel(set) === prescriptionLabel(item.sets[0]) &&
                  set.kind === item.sets[0].kind
              )
              const additional = session.results.filter(
                (row) => row.itemId === item.id && row.targetId === null
              )
              return (
                <div className="movement" key={item.id}>
                  <div className="movement-heading">
                    <div>
                      <div className="row">
                        <span className="movement-number">
                          {String.fromCharCode(65 + blockIndex)}
                          {itemIndex + 1}
                        </span>
                        <h3>{item.name}</h3>
                      </div>
                      <p className="movement-meta">
                        {[
                          item.primaryMuscle
                            ? muscleLabels[item.primaryMuscle]
                            : null,
                          item.equipment,
                          item.setup,
                          item.unilateral ? "Each side" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className={`role-tag role-${item.role}`}>
                      {item.role}
                    </span>
                  </div>
                  <div className="movement-log-toolbar">
                    <div className="movement-prescription">
                      {item.sets.length > 0 && (
                        <p className="movement-target">
                          {uniformTarget
                            ? `${item.sets.length} × ${prescriptionLabel(item.sets[0])}`
                            : `${item.sets.length} sets · targets shown per set`}
                        </p>
                      )}
                      <p className="previous-date">
                        {history ? (
                          <>
                            Previous · {dateLabel(history.date)}
                            {history.match === "exercise"
                              ? " · other routine"
                              : ""}
                          </>
                        ) : (
                          "No previous result"
                        )}
                      </p>
                    </div>
                    {!readOnly && trackingFields(item).includes("load") && (
                      <ActionMenu
                        label={`${item.name} actions`}
                        trigger={<MoreHorizontal size={18} />}
                        actions={[
                          {
                            label: "Units",
                            icon: Settings2,
                            onSelect: () => setUnitsItem(item),
                          },
                        ]}
                      />
                    )}
                  </div>
                  <div className="session-set-list">
                    <SessionSetHeader item={item} entryLoad={entryLoad} />
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
                          previous={prior[index]}
                          entryLoad={entryLoad}
                          showTarget={!uniformTarget}
                          onPatch={(patch) =>
                            patchResult(item, target.id, patch)
                          }
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
                        <SessionSetHeader item={item} entryLoad={entryLoad} />
                        {additional.map((result, index) => (
                          <SessionSetRow
                            key={result.id}
                            item={item}
                            readOnly={readOnly}
                            index={item.sets.length + index}
                            target={null}
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
                </div>
              )
            })}
          </div>
        </section>
      ))}
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
      <div className="session-footer">
        <div className="workout-clock-controls">
          <button
            className="session-time-button"
            aria-label="Edit workout time"
            title="Workout clock"
            onClick={() => setEditingTime(true)}
          >
            <ElapsedTime session={session} />
          </button>
          {session.status === "active" && session.startedAt && (
            <Button
              variant="ghost"
              size="icon"
              title={
                session.timerPausedAt
                  ? "Resume workout timer"
                  : "Pause workout timer"
              }
              aria-label={
                session.timerPausedAt
                  ? "Resume workout timer"
                  : "Pause workout timer"
              }
              onClick={() =>
                controlWorkoutTimer(session.timerPausedAt ? "resume" : "pause")
              }
            >
              {session.timerPausedAt ? <Play size={18} /> : <Pause size={18} />}
            </Button>
          )}
        </div>
        <div className="row">
          <TimerLaunch sessionId={session.id} />
          {!readOnly ? (
            <Button
              size="icon"
              title={
                session.status === "completed"
                  ? "Done editing"
                  : "Finish workout"
              }
              aria-label={
                session.status === "completed"
                  ? "Done editing"
                  : "Finish workout"
              }
              onClick={finishOrReview}
            >
              <Check size={16} />
            </Button>
          ) : (
            <span className="completed-label" title="Workout completed">
              <Check size={18} aria-hidden="true" />
              <span className="sr-only">Completed</span>
            </span>
          )}
        </div>
      </div>
      {editingTime && (
        <SessionTimeEditor
          session={session}
          readOnly={readOnly}
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
              ...value,
              timerPausedAt: null,
              pausedDurationMs: 0,
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
                setCollapsedBlocks(new Set())
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
            value={entryUnits[unitsItem.id] ?? defaultEntryLoad(unitsItem)}
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
          workout={{
            id: session.workoutId ?? crypto.randomUUID(),
            revision: 0,
            kind: "planned",
            routineId: session.routineId,
            weekId: session.weekId,
            date: session.performedOn,
            title: session.title,
            focus: "",
            blocks: session.blocks,
            notes: session.notes,
            source: null,
          }}
          exercises={exercises}
          onClose={() => setEditing(false)}
          onSave={async (workout) => {
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
            if (
              current.results.some(
                (result) => !retained(result) && hasEnteredResult(result)
              ) &&
              !(await confirmAction(
                "This removes sets with entered results. Continue?"
              ))
            )
              throw new Error(
                "Keep the existing sets, or confirm their removal."
              )
            update(
              {
                ...current,
                title: workout.title,
                performedOn: workout.date ?? current.performedOn,
                blocks: workout.blocks,
                notes: workout.notes,
                results: current.results.filter(retained),
              },
              true
            )
            await persistRef.current
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
  readOnly,
}: {
  session: SessionRecord
  onClose: () => void
  onChange: (value: Pick<SessionRecord, "startedAt" | "finishedAt">) => void
  readOnly: boolean
  onControl: (action: "start" | "pause" | "resume" | "reset" | "clear") => void
}) {
  const [editingTimes, setEditingTimes] = useState(false)
  const playing = !!session.startedAt && !session.timerPausedAt
  return (
    <Modal title="Workout time" onClose={onClose}>
      <div className="clock-panel">
        <div className="clock-menu">
          {!readOnly && (
            <ActionMenu
              label="Workout clock actions"
              trigger={<MoreHorizontal size={20} />}
              actions={[
                {
                  label: "Edit timestamps",
                  icon: Pencil,
                  onSelect: () => setEditingTimes(true),
                },
              ]}
            />
          )}
        </div>
        <WorkoutDial session={session} />
        {session.status === "active" && !readOnly && (
          <ClockControls
            playing={playing}
            playLabel={
              !session.startedAt
                ? "Start workout timer"
                : session.timerPausedAt
                  ? "Resume workout timer"
                  : "Pause workout timer"
            }
            resetLabel="Reset workout timer"
            onReset={() => onControl("reset")}
            onPlay={() =>
              onControl(
                !session.startedAt
                  ? "start"
                  : session.timerPausedAt
                    ? "resume"
                    : "pause"
              )
            }
          />
        )}
      </div>
      {editingTimes && !readOnly && (
        <TimestampEditor
          session={session}
          onChange={onChange}
          onClose={() => setEditingTimes(false)}
        />
      )}
    </Modal>
  )
}

function TimestampEditor({
  session,
  onChange,
  onClose,
}: {
  session: SessionRecord
  onChange: (value: Pick<SessionRecord, "startedAt" | "finishedAt">) => void
  onClose: () => void
}) {
  const [start, setStart] = useState(() => localDateTime(session.startedAt))
  const [finish, setFinish] = useState(() => localDateTime(session.finishedAt))
  const [error, setError] = useState("")
  function save() {
    if (
      start === localDateTime(session.startedAt) &&
      finish === localDateTime(session.finishedAt)
    )
      return
    if (
      (start && !Number.isFinite(Date.parse(start))) ||
      (finish && !Number.isFinite(Date.parse(finish)))
    ) {
      setError("Enter a valid date and time.")
      return
    }
    const startedAt =
      start === localDateTime(session.startedAt)
        ? session.startedAt
        : start
          ? new Date(start).toISOString()
          : null
    const finishedAt =
      finish === localDateTime(session.finishedAt)
        ? session.finishedAt
        : finish
          ? new Date(finish).toISOString()
          : null
    if (
      startedAt &&
      finishedAt &&
      Date.parse(finishedAt) < Date.parse(startedAt)
    ) {
      setError("Finish must follow start.")
      return
    }
    setError("")
    onChange({ startedAt, finishedAt })
  }
  return (
    <Modal title="Edit timestamps" onClose={onClose}>
      <label className="field">
        <span>Started</span>
        <Input
          aria-label="Workout started"
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          onBlur={save}
        />
      </label>
      <label className="field">
        <span>Finished</span>
        <Input
          aria-label="Workout finished"
          type="datetime-local"
          disabled={session.status !== "completed"}
          value={finish}
          onChange={(event) => setFinish(event.target.value)}
          onBlur={save}
        />
      </label>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <p className="muted text-sm">
        Editing timestamps clears recorded pauses. Leave unknown times blank.
      </p>
    </Modal>
  )
}
