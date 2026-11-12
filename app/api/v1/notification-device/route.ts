import { z } from "zod"
import { notificationBody, notificationRoute } from "@/server/notification-http"
import {
  deviceStatus,
  disableDevice,
  enrollDevice,
} from "@/server/timer-alerts"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export function GET(request: Request) {
  return notificationRoute(request, (actor) =>
    deviceStatus(
      actor.ownerId,
      new URL(request.url).searchParams.get("deviceId") ?? ""
    )
  )
}
export function PUT(request: Request) {
  return notificationRoute(request, async (actor) =>
    enrollDevice(actor.ownerId, await notificationBody(request))
  )
}
export function DELETE(request: Request) {
  return notificationRoute(request, async (actor) => {
    const { deviceId } = z
      .object({ deviceId: z.uuid() })
      .strict()
      .parse(await notificationBody(request))
    return disableDevice(actor.ownerId, deviceId)
  })
}
