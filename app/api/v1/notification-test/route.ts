import { z } from "zod"
import { notificationBody, notificationRoute } from "@/server/notification-http"
import { testDeviceNotification } from "@/server/timer-alerts"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export function POST(request: Request) {
  return notificationRoute(request, async (actor) => {
    const { deviceId } = z
      .object({ deviceId: z.uuid() })
      .strict()
      .parse(await notificationBody(request))
    return testDeviceNotification(actor.ownerId, deviceId)
  })
}
