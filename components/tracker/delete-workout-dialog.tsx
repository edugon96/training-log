"use client"
import { useEffect, useRef, useState } from "react"
import { Trash2 } from "lucide-react"
import { api, ApiError } from "@/lib/api-client"
import { purgeWorkout } from "@/lib/offline"
import { DeletionSnapshot, type DeletionPreview } from "@/contracts/models"
import { Button } from "@/components/ui/button"
import { Modal, dateLabel, errorMessage } from "./shared"

export function DeleteWorkoutDialog({
  ownerId,
  resource,
  id,
  onClose,
  onDeleted,
}: {
  ownerId: string
  resource: "workouts" | "sessions"
  id: string
  onClose: () => void
  onDeleted: (sessionIds: string[]) => void
}) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)
  const requestKey = useRef(crypto.randomUUID())
  useEffect(() => {
    let live = true
    void api
      .getDeletionPreview(resource, id)
      .then((value) => {
        if (live) setPreview(value)
      })
      .catch((e) => {
        if (live) setError(errorMessage(e))
      })
    return () => {
      live = false
    }
  }, [resource, id])
  async function remove() {
    if (!preview || deleting.current) return
    if (!navigator.onLine) {
      setError("Connect to the internet to delete a workout.")
      return
    }
    deleting.current = true
    setBusy(true)
    setError("")
    try {
      const removed = await api.deleteWorkout(preview, requestKey.current)
      await purgeWorkout(ownerId, removed)
      localStorage.removeItem(
        `entry-units:${ownerId}:${removed.workoutId ?? id}`
      )
      onDeleted(removed.sessionIds)
    } catch (exception) {
      if (
        exception instanceof ApiError &&
        exception.code === "deletion_changed"
      ) {
        const details = exception.details as { current?: unknown } | undefined
        const next = DeletionSnapshot.safeParse(details?.current)
        if (next.success) setPreview(next.data)
        requestKey.current = crypto.randomUUID()
      }
      setError(errorMessage(exception))
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Delete workout?"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {preview ? (
        <div className="stack">
          <strong>{preview.title}</strong>
          {preview.date && <p className="muted">{dateLabel(preview.date)}</p>}
          <p>
            This deletes this workout and all {preview.loggedSets} logged{" "}
            {preview.loggedSets === 1 ? "set" : "sets"} across{" "}
            {preview.sessions.length}{" "}
            {preview.sessions.length === 1 ? "session" : "sessions"}. This
            cannot be undone.
          </p>
          <p className="muted">
            Reusable routines and other workouts stay unchanged.
          </p>
        </div>
      ) : (
        !error && <p role="status">Checking workout…</p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={!preview || busy}
          onClick={() => void remove()}
        >
          <Trash2 size={16} />
          {busy ? "Deleting…" : "Delete workout"}
        </Button>
      </div>
    </Modal>
  )
}
