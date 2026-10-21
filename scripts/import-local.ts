import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ImportManifest } from "../contracts/models";

config({ path: ".env.local", quiet: true });
const origin = process.env.BETTER_AUTH_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("This helper only imports into a local app.");
const manifest = ImportManifest.parse(JSON.parse(await readFile("data/import.json", "utf8")));
const login = await fetch(`${origin}/api/auth/sign-in/email`, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD }),
});
if (!login.ok) throw new Error(`Local login failed (${login.status})`);
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
if (!cookie) throw new Error("Local login did not return a session cookie");
try {
  const response = await fetch(`${origin}/api/v1/import`, {
    method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ manifest }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Import failed (${response.status}): ${JSON.stringify(result)}`);
  console.log("Local import:", result);
  const exported = await fetch(`${origin}/api/v1/export`, { headers: { Cookie: cookie } });
  if (!exported.ok) throw new Error("Import saved, but export verification failed");
  const verified = ImportManifest.parse(await exported.json());
  for (const key of ["equipment", "exercises", "weeks", "workouts", "sessions"] as const) {
    const actual = new Set(verified[key].map(record => record.id));
    if (manifest[key].some(record => !actual.has(record.id))) throw new Error(`Missing imported ${key}`);
  }
  console.log("Read-back verified all imported record IDs.");
} finally {
  await fetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
}
