"use client"

import Dexie, { type Table } from "dexie"
import { useEffect, useRef, useState } from "react"
import type { RestTimerState } from "./timers"
import {
  NotificationConfig,
  TimerAlertStatus,
  type TimerAlertRequest,
} from "@/contracts/models"
import { offlineDb } from "./offline"

type AlertIntent = TimerAlertRequest
type LocalDevice = {
  ownerId: string
  deviceId: string
  enabled: boolean
  sequence: number
  signature: string | null
  pending: AlertIntent | null
  pendingDisable: boolean
  resetSubscription?: boolean
}
class NotificationStore extends Dexie {
  devices!: Table<LocalDevice, string>
  constructor() {
    super("training-phone-notifications")
    this.version(1).stores({ devices: "ownerId,deviceId" })
  }
}
let database: NotificationStore | undefined
const store = () => (database ??= new NotificationStore())
const CHANGED = "training-notifications-changed"
const signal = () => window.dispatchEvent(new Event(CHANGED))
const inFlight = new Map<string, Promise<void>>()
const intentInvocations = new Map<string, symbol>()
const activeOwners = new Map<string, number>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const retryCounts = new Map<string, number>()
function clearRetry(ownerId: string) {
  clearTimeout(retryTimers.get(ownerId))
  retryTimers.delete(ownerId)
}
function retryLater(ownerId: string) {
  const attempts = retryCounts.get(ownerId) ?? 0
  if (
    !activeOwners.has(ownerId) ||
    document.visibilityState !== "visible" ||
    !navigator.onLine ||
    attempts >= 4 ||
    retryTimers.has(ownerId)
  )
    return
  retryCounts.set(ownerId, attempts + 1)
  retryTimers.set(
    ownerId,
    setTimeout(() => {
      retryTimers.delete(ownerId)
      void flushTimerAlerts(ownerId).catch(() => undefined)
    }, [1000, 2000, 4000, 8000][attempts])
  )
}

export function notificationSupport() {
  if (typeof window === "undefined") return false
  return (
    window.isSecureContext &&
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator
  )
}
export function needsHomeScreen() {
  if (typeof window === "undefined") return false
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  return (
    ios &&
    !window.matchMedia("(display-mode: standalone)").matches &&
    !(navigator as Navigator & { standalone?: boolean }).standalone
  )
}
class NotificationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    keepalive: method !== "GET",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  })
  const value = await response.json()
  if (!response.ok)
    throw new NotificationRequestError(
      value.error?.message ?? "Phone notifications are temporarily unavailable",
      response.status,
      value.error?.code
    )
  return value as T
}
async function device(ownerId: string) {
  return store().transaction("rw", store().devices, async () => {
    const existing = await store().devices.get(ownerId)
    if (existing) return existing
    const value: LocalDevice = {
      ownerId,
      deviceId: crypto.randomUUID(),
      enabled: false,
      sequence: 0,
      signature: null,
      pending: null,
      pendingDisable: false,
    }
    await store().devices.put(value)
    return value
  })
}
function publicKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
export async function prepareNotificationWorker() {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const cleanup: (() => void)[] = []
  try {
    return await Promise.race([
      (async () => {
        const registration = await navigator.serviceWorker.register("/sw.js")
        await registration.update()
        if (expired) throw new Error("Notification setup timed out")
        // Existing installations can still be controlled by the pre-push worker.
        // Wait for this update's activation, then verify its capability directly.
        const worker =
          registration.installing ?? registration.waiting ?? registration.active
        if (!worker)
          throw new Error("Notification setup is not ready. Try again.")
        if (worker.state !== "activated")
          await new Promise<void>((resolve, reject) => {
            const changed = () => {
              if (worker.state === "activated") {
                worker.removeEventListener("statechange", changed)
                resolve()
              } else if (worker.state === "redundant") {
                worker.removeEventListener("statechange", changed)
                reject(
                  new Error("Notification setup was interrupted. Try again.")
                )
              }
            }
            worker.addEventListener("statechange", changed)
            cleanup.push(() =>
              worker.removeEventListener("statechange", changed)
            )
            changed()
          })
        if (expired) throw new Error("Notification setup timed out")
        await new Promise<void>((resolve) => {
          const channel = new MessageChannel()
          cleanup.push(() => channel.port1.close())
          channel.port1.onmessage = (event) => {
            if (event.data?.restTimerPush === 1) {
              channel.port1.close()
              resolve()
            }
          }
          worker.postMessage({ type: "training-notification-capability" }, [
            channel.port2,
          ])
        })
        return registration
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          expired = true
          reject(
            new Error(
              "Notification setup took too long. Try again when you are online."
            )
          )
        }, 10_000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
    cleanup.forEach((finish) => finish())
  }
}
export async function enablePhoneNotifications(ownerId: string) {
  if (!notificationSupport() || needsHomeScreen())
    throw new Error(
      "Open Training from your Home Screen to enable phone notifications."
    )
  // Permission is requested directly from the Enable button's user gesture.
  const permission = await Notification.requestPermission()
  if (permission !== "granted")
    throw new Error(
      "Allow notifications for Training in your phone settings, then try again."
    )
  const config = NotificationConfig.parse(await request("notification-config"))
  if (!config.configured || !config.publicKey)
    throw new Error("Phone notifications are not configured yet.")
  const registration = await prepareNotificationWorker()
  const local = await device(ownerId)
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && local.resetSubscription) {
    await subscription.unsubscribe()
    subscription = null
  }
  if (subscription && subscription.options.applicationServerKey) {
    const key = new Uint8Array(subscription.options.applicationServerKey)
    const configured = publicKeyBytes(config.publicKey)
    if (
      key.length !== configured.length ||
      key.some((value, index) => value !== configured[index])
    ) {
      await subscription.unsubscribe()
      subscription = null
    }
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: publicKeyBytes(config.publicKey),
  })
  await request("notification-device", "PUT", {
    deviceId: local.deviceId,
    subscription: subscription.toJSON(),
  })
  await store().devices.update(ownerId, {
    enabled: true,
    pendingDisable: false,
    resetSubscription: false,
    signature: null,
  })
  signal()
}
export async function disablePhoneNotifications(ownerId: string) {
  clearRetry(ownerId)
  retryCounts.delete(ownerId)
  intentInvocations.set(ownerId, Symbol())
  // Removing the browser subscription also prevents an old owner's alerts after
  // an offline sign-out, including when IndexedDB is unavailable. The server
  // disable is persisted and retried whenever storage remains available.
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      await subscription?.unsubscribe()
    } catch {
      /* Server disable still proceeds if the browser subscription is unavailable. */
    }
  }
  const local = await store().devices.get(ownerId)
  if (!local) return
  await store().devices.update(ownerId, {
    enabled: false,
    pending: null,
    signature: null,
    pendingDisable: true,
  })
  signal()
  await flushTimerAlerts(ownerId)
}
export async function testPhoneNotification(ownerId: string) {
  const local = await device(ownerId)
  await request("notification-test", "POST", { deviceId: local.deviceId })
}
export async function phoneNotificationState(ownerId: string) {
  const local = await store().devices.get(ownerId)
  return {
    enabled:
      !!local?.enabled &&
      notificationSupport() &&
      Notification.permission === "granted",
    pending: !!local?.pending || !!local?.pendingDisable,
  }
}
export async function notificationConfiguration() {
  return NotificationConfig.parse(await request("notification-config"))
}
export function subscribeNotificationChanges(callback: () => void) {
  window.addEventListener(CHANGED, callback)
  return () => window.removeEventListener(CHANGED, callback)
}

// A timer's absolute deadline is the scheduling identity. Ticks never write to
// IndexedDB or the network. The monotonic sequence also orders overlapping tabs.
export function timerAlertSignature(timer: RestTimerState | null) {
  return timer?.status === "running" && timer.deadline !== null
    ? `${timer.id}:${timer.deadline}:${timer.sessionId ?? ""}`
    : "cancelled"
}
export async function queueTimerAlert(
  ownerId: string,
  timer: RestTimerState | null
) {
  // Invocation order must precede every asynchronous lookup. A slow draft lookup
  // cannot turn an older Start into a newer intent after Pause or Cancel.
  const invocation = Symbol()
  intentInvocations.set(ownerId, invocation)
  let changed = false
  // Draft workout IDs exist before their first autosave. A generic notification
  // still works immediately, while only acknowledged sessions get a deep link.
  const cached = timer?.sessionId
    ? await offlineDb.sessions
        .get(`${ownerId}:${timer.sessionId}`)
        .catch(() => undefined)
    : undefined
  if (intentInvocations.get(ownerId) !== invocation) return
  const serverSessionId =
    cached && cached.serverRevision > 0 ? (timer?.sessionId ?? null) : null
  await store().transaction("rw", store().devices, async () => {
    const local = await store().devices.get(ownerId)
    if (intentInvocations.get(ownerId) !== invocation) return
    if (!local?.enabled) return
    const signature = timerAlertSignature(timer)
    if (signature === local.signature) return
    changed = true
    const running = timer?.status === "running" && timer.deadline !== null
    const sequence = Math.max(Date.now(), local.sequence + 1)
    await store().devices.put({
      ...local,
      sequence,
      signature,
      pending: {
        deviceId: local.deviceId,
        sequence,
        timerId: running ? timer.id : null,
        sessionId: running ? serverSessionId : null,
        deadline: running ? timer.deadline : null,
      },
    })
  })
  if (changed) {
    clearRetry(ownerId)
    retryCounts.delete(ownerId)
  }
  signal()
  await flushTimerAlerts(ownerId)
}
export async function flushTimerAlerts(ownerId: string): Promise<void> {
  const existing = inFlight.get(ownerId)
  if (existing) return existing
  if (!navigator.onLine) return
  let retryNeeded = false
  const work = (async () => {
    // This loop drains only edited intent. It never polls the server for time.
    for (let count = 0; count < 10; count++) {
      const local = await store().devices.get(ownerId)
      if (!local?.pending && !local?.pendingDisable) break
      try {
        if (local.pendingDisable) {
          await request("notification-device", "DELETE", {
            deviceId: local.deviceId,
          })
          await store().devices.update(ownerId, { pendingDisable: false })
        } else if (local.enabled && local.pending) {
          const sentSequence = local.pending.sequence
          const status = TimerAlertStatus.parse(
            await request("timer-alerts", "PUT", local.pending)
          )
          await store().transaction("rw", store().devices, async () => {
            const current = await store().devices.get(ownerId)
            if (current && current.pending?.sequence === sentSequence)
              await store().devices.update(ownerId, {
                pending: null,
                sequence: Math.max(current.sequence, status.sequence),
              })
          })
        } else break
      } catch (error) {
        if (
          error instanceof NotificationRequestError &&
          error.code === "notifications_disabled"
        ) {
          await store().devices.update(ownerId, {
            enabled: false,
            pending: null,
            signature: null,
            resetSubscription: true,
          })
        }
        retryNeeded =
          !(error instanceof NotificationRequestError) ||
          error.status >= 500 ||
          error.status === 429 ||
          error.status === 404
        break
      }
    }
  })().finally(() => {
    inFlight.delete(ownerId)
    if (retryNeeded) retryLater(ownerId)
    else {
      clearRetry(ownerId)
      retryCounts.delete(ownerId)
    }
    signal()
  })
  inFlight.set(ownerId, work)
  return work
}

export function useTimerAlerts(
  ownerId: string,
  timer: RestTimerState | null,
  audio: {
    soundEnabled: boolean
    soundReady: boolean
    canSound?: (timerId: string, deadline: number) => boolean
  } = { soundEnabled: true, soundReady: false }
) {
  const previous = useRef<RestTimerState | null>(null)
  const sound = useRef(audio)
  const audibleTimer = useRef<{ id: string; deadline: number } | null>(null)
  const [enabledEpoch, setEnabledEpoch] = useState(0)
  useEffect(() => {
    sound.current = audio
  }, [audio])
  useEffect(() => {
    if (!notificationSupport()) return
    activeOwners.set(ownerId, (activeOwners.get(ownerId) ?? 0) + 1)
    let active = true
    let wasEnabled: boolean | undefined
    const sync = () => {
      void phoneNotificationState(ownerId)
        .then((state) => {
          if (!active) return
          if (wasEnabled !== state.enabled) {
            wasEnabled = state.enabled
            setEnabledEpoch((value) => value + 1)
          }
        })
        .catch(() => undefined)
    }
    const retry = () => {
      clearRetry(ownerId)
      retryCounts.delete(ownerId)
      void flushTimerAlerts(ownerId).catch(() => undefined)
    }
    const context = (event: MessageEvent) => {
      if (
        event.data?.type !== "training-alert-context" ||
        event.data.ownerId !== ownerId ||
        !event.ports[0]
      )
        return
      void store()
        .devices.get(ownerId)
        .then((local) => {
          const matching =
            audibleTimer.current?.id === event.data.timerId &&
            audibleTimer.current?.deadline === event.data.deadline &&
            Date.now() < event.data.deadline + 60_000
          const hasAudio = sound.current.canSound
            ? sound.current.canSound(event.data.timerId, event.data.deadline)
            : sound.current.soundReady && matching
          event.ports[0].postMessage({
            silent:
              !!local?.enabled &&
              local.deviceId === event.data.deviceId &&
              document.visibilityState === "visible" &&
              (!sound.current.soundEnabled || hasAudio),
          })
        })
        .catch(() => undefined)
    }
    sync()
    retry()
    const unsubscribe = subscribeNotificationChanges(sync)
    window.addEventListener("online", retry)
    window.addEventListener("pagehide", retry)
    document.addEventListener("visibilitychange", retry)
    navigator.serviceWorker.addEventListener("message", context)
    return () => {
      active = false
      const remaining = (activeOwners.get(ownerId) ?? 1) - 1
      if (remaining) activeOwners.set(ownerId, remaining)
      else {
        activeOwners.delete(ownerId)
        clearRetry(ownerId)
        retryCounts.delete(ownerId)
      }
      unsubscribe()
      window.removeEventListener("online", retry)
      window.removeEventListener("pagehide", retry)
      document.removeEventListener("visibilitychange", retry)
      navigator.serviceWorker.removeEventListener("message", context)
    }
  }, [ownerId])
  useEffect(() => {
    const before = previous.current
    previous.current = timer
    if (timer?.status === "running" && timer.deadline !== null)
      audibleTimer.current = { id: timer.id, deadline: timer.deadline }
    else if (
      timer?.status !== "complete" &&
      !(timer === null && before?.status === "complete")
    )
      audibleTimer.current = null
    // Completion is not cancellation. Keep the admitted notification alive when
    // the dial reaches zero or its completed state disappears from the screen.
    if (
      timer?.status === "complete" ||
      (!timer && (!before || before.status === "complete"))
    )
      return
    void queueTimerAlert(ownerId, timer).catch(() => undefined)
  }, [ownerId, timer, enabledEpoch])
}
