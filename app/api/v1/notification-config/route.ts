import { pushConfiguration } from "@/server/push"
import { notificationRoute } from "@/server/notification-http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export function GET(request: Request) {
  return notificationRoute(request, async () => pushConfiguration())
}
