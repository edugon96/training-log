"use client"

import { useEffect, useState } from "react"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  disablePhoneNotifications,
  enablePhoneNotifications,
  needsHomeScreen,
  notificationConfiguration,
  notificationSupport,
  phoneNotificationState,
  subscribeNotificationChanges,
  testPhoneNotification,
} from "@/lib/timer-alerts"

export function NotificationSettings({ ownerId }: { ownerId: string }) {
  const [enabled, setEnabled] = useState(false)
  const [available, setAvailable] = useState(false)
  const [hint, setHint] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  useEffect(() => {
    let active = true
    const refresh = () => {
      void phoneNotificationState(ownerId)
        .then((state) => {
          if (active) setEnabled(state.enabled)
        })
        .catch(() => undefined)
    }
    refresh()
    const initialize = () => {
      void phoneNotificationState(ownerId)
        .then(async () => {
          if (!active) return
          if (needsHomeScreen())
            setHint(
              "Open Training from your Home Screen to enable notifications."
            )
          else if (!notificationSupport())
            setHint("This browser does not support phone notifications.")
          else {
            const config = await notificationConfiguration()
            if (!active) return
            setAvailable(config.configured)
            setHint(
              config.configured
                ? ""
                : "Phone notifications are not configured yet."
            )
          }
        })
        .catch(() => {
          if (active)
            setHint("Connect to the internet to set up notifications.")
        })
    }
    initialize()
    window.addEventListener("online", initialize)
    const unsubscribe = subscribeNotificationChanges(refresh)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener("online", initialize)
    }
  }, [ownerId])
  async function act(action: () => Promise<unknown>, success = "") {
    setBusy(true)
    setMessage("")
    try {
      await action()
      setMessage(success)
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Try again when you are online."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-5 space-y-3">
      <div>
        <h3 className="font-semibold">Phone notifications</h3>
        <p className="muted text-sm">
          Get a notification when rest ends, including when this phone is
          locked. Sound follows your phone’s notification settings.
        </p>
      </div>
      {hint && <p className="muted text-sm">{hint}</p>}
      <div className="row wrap">
        <Button
          variant="outline"
          disabled={busy || (!available && !enabled)}
          onClick={() =>
            void act(() =>
              enabled
                ? disablePhoneNotifications(ownerId)
                : enablePhoneNotifications(ownerId)
            )
          }
        >
          <Bell size={16} />{" "}
          {enabled ? "Turn off on this device" : "Enable on this device"}
        </Button>
        {enabled && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(
                () => testPhoneNotification(ownerId),
                "Test notification sent."
              )
            }
          >
            Test notification
          </Button>
        )}
      </div>
      {message && (
        <p className="muted text-sm" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
