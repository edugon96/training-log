import webpush, { type PushSubscription } from "web-push"
import { demand } from "./errors"
import { NotificationSubscription } from "../contracts/models"

const providerDomains = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.services.microsoft.com",
]
export const PushSubscriptionInput = NotificationSubscription.extend({
  endpoint: NotificationSubscription.shape.endpoint.refine((value) => {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      providerDomains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      )
    )
  }, "Use a subscription issued by this browser"),
}).strict()

export const ALERT_LIFETIME_MS = 60_000
export function pushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  const configured = !!(
    publicKey &&
    privateKey &&
    subject &&
    /^(mailto:|https:\/\/)/.test(subject)
  )
  return { configured, publicKey: configured ? publicKey! : null }
}
export type TimerPush = {
  type: "rest-timer" | "test"
  ownerId: string
  deviceId: string
  timerId: string
  sequence: number
  deadline: number
  url: string
}
export async function sendPush(
  subscription: PushSubscription,
  payload: TimerPush,
  now = Date.now()
) {
  demand(
    pushConfiguration().configured,
    503,
    "push_unavailable",
    "Phone notifications are not configured yet"
  )
  const ttl = Math.min(
    60,
    Math.max(0, Math.ceil((payload.deadline + ALERT_LIFETIME_MS - now) / 1000))
  )
  // Expiry is checked before contacting the provider. Received pushes always
  // produce a visible notification, as required by iOS.
  if (!ttl) return
  await webpush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: ttl,
    urgency: "high",
    topic:
      `${payload.deviceId.replaceAll("-", "").slice(0, 16)}-${payload.sequence}`.slice(
        0,
        32
      ),
    timeout: 5000,
    vapidDetails: {
      subject: process.env.VAPID_SUBJECT!,
      publicKey: process.env.VAPID_PUBLIC_KEY!,
      privateKey: process.env.VAPID_PRIVATE_KEY!,
    },
  })
}
export function pushStatus(error: unknown): number | undefined {
  return typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : undefined
}
