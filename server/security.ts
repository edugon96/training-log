import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getAuth } from "./auth";
import { demand } from "./errors";
import { Scope } from "../contracts/models";

export type Actor = { ownerId: string; label: string; session: boolean; scopes: z.infer<typeof Scope>[]; user: { id: string; name: string; email: string } };
export async function authenticate(request: Request): Promise<Actor> {
  const bearer = request.headers.get("authorization");
  if (bearer) {
    demand(bearer.startsWith("Bearer "), 401, "unauthorized", "Use Bearer authentication");
    const verified = await getAuth().api.verifyApiKey({ body: { key: bearer.slice(7) } });
    demand(verified.valid && verified.key, 401, "unauthorized", "Invalid or revoked API key");
    const key = verified.key;
    const scopes = z.array(Scope).parse(key.permissions?.workout ?? []);
    return { ownerId: key.referenceId, label: `Agent: ${key.name || key.id}`, session: false, scopes,
      user: { id: key.referenceId, name: "API agent", email: "" } };
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  demand(session, 401, "unauthorized", "Sign in to continue");
  return { ownerId: session.user.id, label: session.user.name, session: true, scopes: Scope.options, user: session.user };
}
export function authorize(actor: Actor, scope: z.infer<typeof Scope>, sessionOnly = false) {
  demand(!sessionOnly || actor.session, 403, "session_required", "This operation requires a signed-in user");
  demand(actor.scopes.includes(scope), 403, "insufficient_scope", `This key needs ${scope}`);
}
export function checkOrigin(request: Request, actor: Actor) {
  if (!actor.session) return;
  const configured = process.env.BETTER_AUTH_URL;
  demand(configured, 503, "configuration", "Application origin is not configured");
  demand(request.headers.get("origin") === new URL(configured).origin, 403, "origin", "Origin is not allowed");
}
export function fingerprint(method: string, path: string, body: unknown) {
  return createHash("sha256").update(canonical([method, path, body])).digest("hex");
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function secret() {
  demand(process.env.BETTER_AUTH_SECRET, 503, "configuration", "Application secret is not configured");
  return createHash("sha256").update(process.env.BETTER_AUTH_SECRET).digest();
}
// Receipts may contain a one-time API key. Encrypt every receipt at rest.
export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
export function unseal(value: string): unknown {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", secret(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}
