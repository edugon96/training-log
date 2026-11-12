import { z } from "zod"
import { authenticate, authorize, checkOrigin, type Actor } from "./security"
import { HttpError } from "./errors"

export async function notificationRoute(
  request: Request,
  run: (actor: Actor) => Promise<unknown>
) {
  try {
    const actor = await authenticate(request)
    authorize(actor, "read", true)
    if (request.method !== "GET") checkOrigin(request, actor)
    return notificationResponse(await run(actor))
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : 503
    return notificationResponse(
      {
        error: {
          code:
            error instanceof HttpError
              ? error.code
              : error instanceof z.ZodError
                ? "validation"
                : "notifications_unavailable",
          message:
            error instanceof HttpError
              ? error.message
              : error instanceof z.ZodError
                ? "Check the notification settings"
                : "Phone notifications are temporarily unavailable",
        },
      },
      status
    )
  }
}
export function notificationResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Authorization",
    },
  })
}
export async function notificationBody(request: Request) {
  const body = await request.text()
  if (body.length > 16_384)
    throw new HttpError(413, "too_large", "Notification request is too large")
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new HttpError(400, "invalid_json", "Check the notification request")
  }
}
