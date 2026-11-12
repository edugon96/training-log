"use client"

import { liveQuery } from "dexie"
import { useEffect, useState } from "react"
import { CloudAlert, CloudOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { offlineDb, flushQueue } from "@/lib/offline"
import { flushPlanEdits } from "@/lib/workout-edits"
import { Workout } from "@/contracts/models"
import { Modal } from "./shared"

async function pending(ownerId: string, includeDrafts = false) {
  const [plans, sessions] = await Promise.all([
    offlineDb.planEdits.where("ownerId").equals(ownerId).toArray(),
    offlineDb.pending.where("ownerId").equals(ownerId).toArray(),
  ])
  const entries = [
    ...plans.map((p) => ({
      id: p.value.id,
      version: p.version,
      error: p.error,
      failure: p.failure,
      readyAt: 0,
    })),
    ...sessions.map((p) => ({
      id: p.id,
      version: p.version,
      error: p.message,
      failure: p.failure,
      readyAt: p.request ? 0 : (p.readyAt ?? 0),
    })),
  ]
  if (includeDrafts) {
    const [drafts, corrections] = await Promise.all([
      offlineDb.editorDrafts.where("ownerId").equals(ownerId).toArray(),
      offlineDb.corrections.where("ownerId").equals(ownerId).toArray(),
    ])
    for (const draft of drafts) {
      if (draft.key.startsWith(`${ownerId}:new:`)) continue
      const valid =
        Workout.safeParse(draft.value).success && !!draft.value.title.trim()
      entries.push({
        id: draft.key.startsWith(`${ownerId}:session:`)
          ? draft.key.slice(`${ownerId}:session:`.length)
          : draft.value.id,
        version: "draft",
        readyAt: 0,
        error: valid ? undefined : "Check the workout fields",
        failure: valid ? undefined : "invalid",
      })
    }
    for (const draft of corrections)
      entries.push({
        id: draft.session.id,
        version: "correction",
        readyAt: 0,
        error: "Finish editing this set",
        failure: "invalid",
      })
  }
  return entries
}

/** One foreground worker owns retries. Components only wait for IndexedDB. */
export function useAutosaveCoordinator(ownerId: string | undefined) {
  useEffect(() => {
    if (!ownerId) return
    let live = true,
      working = false,
      delay = 1000,
      signature = ""
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (ms = 0) => {
      if (!live || !navigator.onLine || document.visibilityState === "hidden")
        return
      clearTimeout(timer)
      timer = setTimeout(() => void run(), ms)
    }
    const run = async () => {
      if (!live || working || !navigator.onLine) return
      working = true
      try {
        // Acknowledgements already publish the changed records. Reloading every
        // resource here multiplies database transfer for every field edit.
        await flushQueue(ownerId)
        await flushPlanEdits(ownerId)
      } catch {
        // Failures remain durable and observable in the queue. Network retries
        // never become global error banners or rejected navigation promises.
      } finally {
        working = false
        if (live) {
          try {
            const entries = await pending(ownerId)
            if (entries.length) {
              const readyAt = Math.min(...entries.map((e) => e.readyAt))
              schedule(readyAt > Date.now() ? readyAt - Date.now() : delay)
              delay = Math.min(delay * 2, 30000)
            } else delay = 1000
          } catch {
            schedule(30000)
          }
        }
      }
    }
    const subscription = liveQuery(() => pending(ownerId)).subscribe({
      next: (entries) => {
        const next = JSON.stringify(entries.map((e) => [e.id, e.version]))
        if (next !== signature) {
          signature = next
          delay = 1000
          if (entries.length)
            schedule(
              Math.max(
                0,
                Math.min(...entries.map((e) => e.readyAt)) - Date.now()
              )
            )
        }
      },
      error: () => {
        /* The status indicator reports cache failures. */
      },
    })
    const resume = () => {
      delay = 1000
      schedule()
    }
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    document.addEventListener("visibilitychange", resume)
    schedule()
    return () => {
      live = false
      clearTimeout(timer)
      subscription.unsubscribe()
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
      document.removeEventListener("visibilitychange", resume)
    }
  }, [ownerId])
}

export function AutosaveStatus({
  ownerId,
  id,
}: {
  ownerId: string
  id?: string
}) {
  const [state, setState] = useState("Saved")
  const [detail, setDetail] = useState("Changes saved")
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let entries: Awaited<ReturnType<typeof pending>> = []
    let attentionTimer: ReturnType<typeof setTimeout> | undefined
    const render = () => {
      const selected = entries.filter((e) => !id || e.id === id)
      const failed = selected.find((e) => e.error)
      const error = failed?.error
      const auth =
        failed?.failure === "auth" ||
        (error && /sign in|unauth|session expired/i.test(error))
      const invalid =
        failed?.failure === "invalid" ||
        (error && /fields|invalid|permission|forbidden|incomplete/i.test(error))
      const nextState = !navigator.onLine
        ? "Offline"
        : auth
          ? "Sign in to save"
          : invalid
            ? "Unable to save"
            : selected.length
              ? "Saving…"
              : "Saved"
      const nextDetail = !navigator.onLine
        ? "Edits are kept on this device and save automatically when connected"
        : error
          ? `Edits are kept on this device. ${error}`
          : selected.length
            ? "Saving your changes automatically"
            : "Changes saved"
      clearTimeout(attentionTimer)
      const update = () => {
        setState(nextState)
        setDetail(nextDetail)
        if (nextState === "Saved" || nextState === "Saving…") setOpen(false)
      }
      // Incomplete fields are normal while typing. Don't flash an icon between
      // the local draft write and its validated autosave.
      if (navigator.onLine && (auth || invalid))
        attentionTimer = setTimeout(update, 1500)
      else update()
    }
    const subscription = liveQuery(() => pending(ownerId, true)).subscribe({
      next: (next) => {
        entries = next
        render()
      },
      error: () => {
        clearTimeout(attentionTimer)
        setState("Unable to save")
        setDetail("Device storage is unavailable")
      },
    })
    window.addEventListener("online", render)
    window.addEventListener("offline", render)
    return () => {
      clearTimeout(attentionTimer)
      subscription.unsubscribe()
      window.removeEventListener("online", render)
      window.removeEventListener("offline", render)
    }
  }, [ownerId, id])
  if (state === "Saved" || state === "Saving…") return null
  const Icon = state === "Offline" ? CloudOff : CloudAlert
  return (
    <>
      <span role="status" aria-label={`Autosave: ${state}`}>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground"
          aria-label={
            state === "Offline" ? "Offline, changes kept on this device" : state
          }
          onClick={() => setOpen(true)}
        >
          <Icon className="size-4" />
        </Button>
      </span>
      {open && (
        <Modal title={state} onClose={() => setOpen(false)}>
          <p className="muted text-sm">{detail}</p>
        </Modal>
      )}
    </>
  )
}
