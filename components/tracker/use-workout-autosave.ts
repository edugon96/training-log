"use client"

import { useEffect, useRef, useState, type SetStateAction } from "react"
import {
  Workout,
  type WorkoutRecord,
  type SessionRecord,
} from "@/contracts/models"
import { withGroups } from "@/lib/workout-groups"
import { archiveRecovery, offlineDb } from "@/lib/offline"
import { mergeWorkout, sameValue } from "@/lib/autosave-merge"
import { subscribeSaved } from "@/lib/autosave-events"

export function useWorkoutAutosave({
  ownerId,
  draftKey,
  workout,
  onSave,
  onBeforeChange,
  manual = false,
  sessionId,
}: {
  manual?: boolean
  sessionId?: string
  ownerId: string
  draftKey: string
  workout: WorkoutRecord
  onSave: (value: WorkoutRecord, base: WorkoutRecord) => Promise<WorkoutRecord>
  onBeforeChange?: (value: WorkoutRecord) => Promise<boolean>
}) {
  const key = `${ownerId}:${draftKey}`
  const [draft, render] = useState(() => withGroups(workout))
  const [ready, setReady] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState("")
  const latest = useRef(draft),
    baseline = useRef(draft)
  const initial = useRef(draft)
  const requested = useRef(false)
  const saveCallback = useRef(onSave),
    beforeChange = useRef(onBeforeChange)
  const localWrite = useRef<Promise<unknown>>(Promise.resolve())
  const inFlight = useRef<Promise<boolean> | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    saveCallback.current = onSave
    beforeChange.current = onBeforeChange
  }, [onSave, onBeforeChange])
  const publishError = (message: string) => {
    if (mounted.current) setError(message)
  }
  const persist = (value: WorkoutRecord, base: WorkoutRecord) => {
    localWrite.current = localWrite.current
      .catch(() => undefined)
      .then(() => offlineDb.editorDrafts.put({ key, ownerId, value, base }))
    void localWrite.current.catch(() =>
      publishError("Unable to save on this device. Check available storage.")
    )
  }
  async function flush() {
    if (debounce.current) clearTimeout(debounce.current)
    await localWrite.current
    if (inFlight.current) return inFlight.current
    const task = async () => {
      while (
        (manual && !requested.current) ||
        !sameValue(latest.current, baseline.current)
      ) {
        const snapshot = latest.current,
          base = baseline.current
        const parsed = Workout.safeParse(snapshot)
        if (!parsed.success || !snapshot.title.trim()) {
          publishError(
            snapshot.title.trim()
              ? "Check the workout fields. Your draft is kept on this device."
              : "Enter a workout name to save."
          )
          return false
        }
        try {
          let result = withGroups(await saveCallback.current(parsed.data, base))
          // A fast server acknowledgement may have already advanced the
          // baseline while this local persistence callback was resolving.
          if (baseline.current !== base)
            result = mergeWorkout(snapshot, result, baseline.current)
          requested.current = true
          if (manual && mounted.current) setSubmitted(true)
          baseline.current = result
          latest.current =
            latest.current === snapshot
              ? result
              : mergeWorkout(snapshot, latest.current, result)
          await localWrite.current
          if (sameValue(latest.current, baseline.current))
            await offlineDb.editorDrafts.delete(key)
          else persist(latest.current, baseline.current)
          if (mounted.current) render(latest.current)
          publishError("")
        } catch (exception) {
          publishError(
            exception instanceof Error
              ? exception.message
              : "Unable to save on this device"
          )
          return false
        }
      }
      return true
    }
    inFlight.current = task().finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  const persistRef = useRef(persist)
  useEffect(() => {
    persistRef.current = persist
  })
  useEffect(() => {
    mounted.current = true
    void offlineDb.editorDrafts
      .get(key)
      .then(async (stored) => {
        if (!mounted.current) return
        if (stored) {
          if (stored.base) {
            latest.current = manual
              ? withGroups(stored.value)
              : mergeWorkout(stored.base, stored.value, initial.current)
            baseline.current = manual
              ? withGroups(stored.base)
              : initial.current
          } else if (
            manual ||
            stored.value.revision === initial.current.revision
          )
            latest.current = withGroups(stored.value)
          else {
            await archiveRecovery(
              ownerId,
              key,
              stored.value,
              "Legacy editor draft has no baseline"
            )
            await offlineDb.editorDrafts.delete(key)
            stored = undefined
          }
          if (stored && manual) {
            requested.current =
              !!(await offlineDb.planEdits.get(
                `${ownerId}:${stored.value.id}`
              )) || stored.value.revision > 0
            if (mounted.current) setSubmitted(requested.current)
          }
        }
        if (!mounted.current) return
        render(latest.current)
        setReady(true)
        if (stored && !manual)
          void flushRef.current().catch((e) => publishError(String(e)))
      })
      .catch((e) => {
        publishError(String(e))
        setReady(true)
      })
    const asWorkout = (value: SessionRecord): WorkoutRecord => ({
      ...baseline.current,
      revision: value.revision,
      title: value.title,
      date: value.performedOn,
      blocks: value.blocks,
      notes: value.notes,
    })
    const unsubscribe = subscribeSaved((event) => {
      if (event.ownerId !== ownerId) return
      const match =
        event.kind === "sessions"
          ? event.after.id === sessionId
          : !sessionId && event.after.id === latest.current.id
      if (!match) return
      const before =
        event.kind === "sessions" ? asWorkout(event.before) : event.before
      const after =
        event.kind === "sessions" ? asWorkout(event.after) : event.after
      latest.current = mergeWorkout(before, latest.current, after)
      baseline.current = mergeWorkout(before, baseline.current, after)
      if (!sameValue(latest.current, baseline.current))
        persistRef.current(latest.current, baseline.current)
      if (mounted.current) render(latest.current)
    })
    return () => {
      mounted.current = false
      unsubscribe()
      if (debounce.current) clearTimeout(debounce.current)
      if (!manual) void flushRef.current().catch(() => undefined)
    }
  }, [key, manual, ownerId, sessionId])
  function setDraft(action: SetStateAction<WorkoutRecord>) {
    const current = latest.current
    const value = withGroups(
      typeof action === "function" ? action(current) : action
    )
    const ids = (w: WorkoutRecord) =>
      w.blocks.map((b) => [
        b.id,
        b.items.map((i) => [i.id, i.sets.map((s) => s.id)]),
      ])
    const structure = !sameValue(ids(current), ids(value))
    const apply = () => {
      latest.current = value
      render(value)
      persist(value, baseline.current)
      if (debounce.current) clearTimeout(debounce.current)
      if (!manual)
        debounce.current = setTimeout(
          () => void flushRef.current().catch((e) => publishError(String(e))),
          structure ? 0 : 450
        )
    }
    if (structure && beforeChange.current)
      void beforeChange.current(value).then((allowed) => {
        if (allowed && latest.current === current) apply()
      })
    else apply()
  }
  async function discard() {
    if (debounce.current) clearTimeout(debounce.current)
    await localWrite.current
    await offlineDb.editorDrafts.delete(key)
  }
  return { draft, setDraft, ready, submitted, error, flush, discard }
}
