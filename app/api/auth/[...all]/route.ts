import { getAuth } from "@/server/auth"
import { z } from "zod"
export const runtime = "nodejs"
const allowed = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-out",
  "/api/auth/get-session",
  "/api/auth/ok",
  "/api/auth/update-user",
])
async function handle(request: Request) {
  if (!allowed.has(new URL(request.url).pathname)) {
    return Response.json(
      { error: { code: "not_found", message: "Endpoint not available" } },
      { status: 404 }
    )
  }
  if (new URL(request.url).pathname === "/api/auth/update-user") {
    if (request.method !== "POST")
      return Response.json({ message: "Use POST" }, { status: 405 })
    if (
      !process.env.BETTER_AUTH_URL ||
      request.headers.get("origin") !==
        new URL(process.env.BETTER_AUTH_URL).origin
    )
      return Response.json(
        { message: "Origin is not allowed" },
        { status: 403 }
      )
    const value = z
      .object({ name: z.string().trim().min(1).max(200) })
      .strict()
      .safeParse(await request.json().catch(() => null))
    if (!value.success)
      return Response.json(
        {
          message:
            "Provide a display name between 1 and 200 characters. Other profile fields are read-only.",
        },
        { status: 400 }
      )
    const headers = new Headers(request.headers)
    headers.delete("content-length")
    request = new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(value.data),
    })
  }
  return getAuth().handler(request)
}
export { handle as GET, handle as POST }
