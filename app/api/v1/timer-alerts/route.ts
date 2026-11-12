import { notificationBody, notificationRoute } from "@/server/notification-http"
import { scheduleTimerAlert } from "@/server/timer-alerts"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export function PUT(request: Request) {
  return notificationRoute(request, async (actor) =>
    scheduleTimerAlert(actor.ownerId, await notificationBody(request))
  )
}
