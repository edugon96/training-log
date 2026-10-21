import { test, expect } from "@playwright/test";
import { betterAuth } from "better-auth";
import { randomUUID } from "node:crypto";
import { authOptions } from "../../server/auth";
import { getPool } from "../../server/db";
import { signInPage } from "./auth-helper";
import { buildHybridExample } from "../../examples/hybrid-hypertrophy";
import { startSession } from "../../server/domain";

test("public profile imports through Profile and corrected history survives reload", async ({ page }) => {
  const email = `starter-${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
  const user = await betterAuth(authOptions(true)).api.signUpEmail({ body: { email, password, name: "Sample Athlete" } });
  const ownerId = user.user.id;
  try {
    await signInPage(page, email, password);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles("examples/hybrid-hypertrophy.json");
    const importResponse = page.waitForResponse(r => r.url().endsWith("/api/v1/import") && r.request().method() === "POST");
    await page.getByRole("dialog", { name: "Confirm change" }).getByRole("button", { name: "Continue", exact: true }).click();
    const importedResponse = await importResponse;
    expect(importedResponse.ok(), await importedResponse.text()).toBe(true);
    const imported = await page.request.get("/api/v1/export");
    expect(imported.ok()).toBe(true);
    const data = await imported.json() as ReturnType<typeof buildHybridExample>;
    expect(data.sessions).toEqual([]);
    const ledger = await page.request.get(`/api/v1/ledger?weekId=${data.weeks[0].id}`);
    expect((await ledger.json()).plannedTotal).toBe(111);
    const workout = data.workouts.find(w => w.title === "Upper")!;
    const session = startSession(workout, "2026-01-05");
    session.startedAt = null;
    const first = session.results[0];
    first.reps = 8;
    first.load = { value: 100, unit: "lb", basis: "total" };
    const headers = { Origin: process.env.BETTER_AUTH_URL || "http://localhost:3000", "Idempotency-Key": randomUUID() };
    const created = await page.request.post("/api/v1/sessions", { headers, data: { value: session } });
    expect(created.ok(), await created.text()).toBe(true);
    const saved = await created.json();
    const old = data.exercises.find(e => e.name === "Barbell Bench Press")!;
    const updated = { ...old, equipment: "Barbell Station", setup: "Flat bench, verified setup",
      historyAliases: [{ exerciseId: old.id, equipment: old.equipment, setup: old.setup }] };
    const correction = await page.request.put(`/api/v1/exercises/${old.id}`, { headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: { expectedRevision: old.revision, value: updated } });
    expect(correction.ok(), await correction.text()).toBe(true);
    const history = await page.request.get(`/api/v1/history?exerciseId=${old.id}&before=2026-01-06`);
    expect((await history.json()).results[0].reps).toBe(8);
    const preserved = await page.request.get(`/api/v1/sessions/${session.id}`);
    expect(await preserved.json()).toEqual(saved);
    await page.reload();
    const persisted = await page.request.get(`/api/v1/exercises/${old.id}`);
    expect((await persisted.json()).historyAliases).toEqual(updated.historyAliases);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page.getByText("Quad-Focused Lower", { exact: true }).first()).toBeVisible();
  } finally {
    for (const table of ["training_defaults", "timer_settings", "result_sets", "workout_sessions", "workouts", "weeks", "exercises", "equipment", "audit_events", "mutation_receipts", "import_sources"])
      await getPool().query(`DELETE FROM "${table}" WHERE owner_id = $1`, [ownerId]);
    await getPool().query('DELETE FROM "apikey" WHERE "referenceId" = $1', [ownerId]);
    await getPool().query('DELETE FROM "user" WHERE id = $1', [ownerId]);
  }
});
