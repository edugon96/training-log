import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb, getPool, withTransaction } from "./db";
import { transactionAuth } from "./auth";
import { save, list } from "./repository";
import { defaultTargets, makeItem, type EquipmentRecord, type ExerciseRecord } from "../contracts/models";
import type { Actor } from "./security";
import { exportOwner, importOwner } from "./api";
import { getTrainingDefaults, saveTrainingDefaults, storedTrainingDefaults } from "./training";
import { startSession } from "./domain";
import { results } from "./schema";
import { eq } from "drizzle-orm";
import { getTimerSettings, saveTimerSettings } from "./timers";
import { buildHybridExample } from "../examples/hybrid-hypertrophy";
import { computeLedger } from "./domain";

config({ path: ".env.local", quiet: true });
const enabled = process.env.RUN_DATABASE_TESTS === "1";
const actor = (): Actor => {
  const id = randomUUID();
  return { ownerId: id, label: "Database test", session: true,
    scopes: ["read", "plans:write", "results:write", "library:write"],
    user: { id, name: "Test", email: "test@example.invalid" } };
};
const equipment = (): EquipmentRecord => ({ id: randomUUID(), revision: 0, name: "Test cable", model: "", notes: "", startingResistance: null, archived: false });
describe.skipIf(!enabled)("repository with real PostgreSQL, all changes rolled back", () => {
  it("imports the public starter profile additively with its exact ledger", async () => {
    await testTransaction(async tx => {
      const owner = actor();
      const profile = buildHybridExample();
      const count = profile.equipment.length + profile.exercises.length + profile.weeks.length + profile.workouts.length + 1;
      expect(await importOwner(tx, owner, profile)).toEqual({ created: count, unchanged: 0 });
      expect(await importOwner(tx, owner, profile)).toEqual({ created: 0, unchanged: count });
      const restored = await exportOwner(tx, owner.ownerId);
      expect(restored.sessions).toEqual([]);
      const ledger = computeLedger(restored.weeks[0], restored.workouts, []);
      expect(ledger.plannedTotal).toBe(111);
      expect(ledger.rows.every(row => row.planned === row.target)).toBe(true);
    });
  });
  it("isolates timer settings, checks revisions and roundtrips optional backup settings", async () => {
    await testTransaction(async tx => {
      const first = actor(), second = actor();
      const initial = await getTimerSettings(tx, first.ownerId);
      expect(initial.presets).toEqual([30, 60, 90, 120, 150, 180]);
      const saved = await saveTimerSettings(tx, first, { ...initial, presets: [45, 120], soundEnabled: false }, 0);
      expect(saved.revision).toBe(1);
      expect(await getTimerSettings(tx, second.ownerId)).toEqual(initial);
      await expect(saveTimerSettings(tx, first, initial, 0)).rejects.toThrow("changed elsewhere");
      const backup = await exportOwner(tx, first.ownerId);
      expect(backup.timerSettings).toEqual(saved);
      await importOwner(tx, second, backup);
      expect((await getTimerSettings(tx, second.ownerId)).presets).toEqual([45, 120]);
      await expect(saveTimerSettings(tx, first, { ...saved, presets: [45, 45] }, 1)).rejects.toThrow("distinct");
    });
  });
  const rollback = new Error("test rollback");
  afterAll(async () => { await getPool().end(); });
  async function testTransaction(run: Parameters<ReturnType<typeof getDb>["transaction"]>[0]) {
    await expect(getDb().transaction(async tx => { await run(tx); throw rollback; })).rejects.toBe(rollback);
  }
  it("scopes reads and rejects foreign-owned equipment references", async () => {
    await testTransaction(async tx => {
      const first = actor(), second = actor();
      const item = await save(tx, first, "equipment", equipment(), null);
      expect(await list(tx, second.ownerId, "equipment")).toEqual([]);
      const movement: ExerciseRecord = { id: randomUUID(), revision: 0, name: "Curl",
        equipmentId: item.id, equipment: "Test", setup: "", primaryMuscle: "biceps", secondaryMuscles: [],
        pattern: "pull", defaultRole: "lifting", defaultLoad: null, notes: "", archived: false };
      await expect(save(tx, second, "exercises", movement, null)).rejects.toThrow("not found");
    });
  });
  it("rejects stale revisions and never overwrites creation", async () => {
    await testTransaction(async tx => {
      const owner = actor();
      const raw = equipment();
      const first = await save(tx, owner, "equipment", raw, null);
      expect(first.revision).toBe(1);
      const second = await save(tx, owner, "equipment", { ...first, notes: "Updated" }, 1);
      expect(second.revision).toBe(2);
      await expect(save(tx, owner, "equipment", first, 1)).rejects.toThrow("changed elsewhere");
      await expect(save(tx, owner, "equipment", raw, null)).rejects.toThrow("already exists");
    });
  });
  it("restores forward and cyclic history aliases and rejects foreign-owned alias IDs", async () => {
    await testTransaction(async tx => {
      const owner = actor(), other = actor();
      const first: ExerciseRecord = { id: randomUUID(), revision: 0, name: "Curl",
        equipmentId: null, equipment: "Cable", setup: "Low pulley", primaryMuscle: "biceps",
        secondaryMuscles: [], pattern: "pull", defaultRole: "lifting", defaultLoad: null, notes: "", archived: false };
      const second: ExerciseRecord = { ...first, id: randomUUID(), name: "Legacy curl", archived: true };
      first.historyAliases = [{ exerciseId: second.id, equipment: "Low cable", setup: "" }];
      second.historyAliases = [{ exerciseId: first.id, equipment: "Cable", setup: "Low pulley" }];
      const backup = await exportOwner(tx, owner.ownerId);
      backup.exercises = [first, second];
      expect(await importOwner(tx, owner, backup)).toEqual({ created: 2, unchanged: 0 });
      const exported = await exportOwner(tx, owner.ownerId);
      expect(exported.exercises.find(e => e.id === first.id)?.historyAliases).toEqual(first.historyAliases);
      expect(exported.exercises.find(e => e.id === second.id)?.historyAliases).toEqual(second.historyAliases);
      expect(await importOwner(tx, owner, exported)).toEqual({ created: 0, unchanged: 2 });
      await expect(save(tx, other, "exercises", { ...first, id: randomUUID() }, null)).rejects.toThrow("not found");
      const self = { ...first, id: randomUUID() };
      self.historyAliases = [{ exerciseId: self.id, equipment: "Legacy cable", setup: "" }];
      expect((await save(tx, other, "exercises", self, null)).historyAliases).toEqual(self.historyAliases);
    });
  });
  it("roundtrips backup idempotently and rejects changed imported records", async () => {
    await testTransaction(async tx => {
      const owner = actor();
      await save(tx, owner, "weeks", { id: randomUUID(), revision: 0, startDate: "2026-10-19",
        title: "Test", targets: defaultTargets, notes: "Raw notes preserved" }, null);
      const backup = await exportOwner(tx, owner.ownerId);
      expect(await importOwner(tx, owner, backup)).toEqual({ created: 0, unchanged: 1 });
      backup.weeks[0].notes = "Different notes";
      await expect(importOwner(tx, owner, backup)).rejects.toThrow("overwrite");
    });
  });
  it("rolls back Better Auth key creation together with application changes", async () => {
    let keyId = "";
    await expect(withTransaction(async (_db, client) => {
      const auth = transactionAuth(client, true);
      const user = await auth.api.signUpEmail({ body: {
        email: `rollback-${randomUUID()}@example.test`, password: randomUUID() + randomUUID(), name: "Rollback Test",
      } });
      const key = await auth.api.createApiKey({
        body: { name: "Rollback test", userId: user.user.id, permissions: { workout: ["read"] } },
      });
      keyId = key.id;
      throw rollback;
    })).rejects.toBe(rollback);
    expect(keyId).not.toBe("");
    const persisted = await getPool().query('SELECT id FROM "apikey" WHERE id = $1', [keyId]);
    expect(persisted.rows).toEqual([]);
  });
  it("defaults read latest week without writing, then persist with revisions and isolate owners", async () => {
    await testTransaction(async tx => {
      const owner = actor(), other = actor();
      expect(await getTrainingDefaults(tx, owner.ownerId)).toEqual({ revision: 0, targets: defaultTargets });
      await save(tx, owner, "weeks", { id: randomUUID(), revision: 0, startDate: "2026-10-12", title: "Old",
        targets: { ...defaultTargets, chest: 10 }, notes: "" }, null);
      await save(tx, owner, "weeks", { id: randomUUID(), revision: 0, startDate: "2026-10-19", title: "New",
        targets: { ...defaultTargets, chest: 12 }, notes: "" }, null);
      expect((await getTrainingDefaults(tx, owner.ownerId)).targets.chest).toBe(12);
      expect(await storedTrainingDefaults(tx, owner.ownerId)).toBeNull();
      const saved = await saveTrainingDefaults(tx, owner, { revision: 0, targets: { ...defaultTargets, chest: 16 } }, 0);
      expect(saved.revision).toBe(1);
      await expect(saveTrainingDefaults(tx, owner, { ...saved, revision: 0 }, 0)).rejects.toThrow("changed elsewhere");
      expect((await getTrainingDefaults(tx, other.ownerId)).targets.chest).toBe(14);
      expect((await list(tx, owner.ownerId, "weeks")).map(w => w.targets.chest).sort()).toEqual([10, 12]);
    });
  });
  it("defaults backup restores additively, keeps old backups compatible and conflicts never overwrite", async () => {
    await testTransaction(async tx => {
      const owner = actor(), restoredOwner = actor();
      await saveTrainingDefaults(tx, owner, { revision: 0, targets: { ...defaultTargets, calves: 3 } }, 0);
      const backup = await exportOwner(tx, owner.ownerId);
      expect(backup.trainingDefaults?.targets.calves).toBe(3);
      expect(await importOwner(tx, restoredOwner, backup)).toEqual({ created: 1, unchanged: 0 });
      expect(await importOwner(tx, restoredOwner, backup)).toEqual({ created: 0, unchanged: 1 });
      backup.trainingDefaults!.targets.calves = 6;
      await expect(importOwner(tx, restoredOwner, backup)).rejects.toThrow("overwrite");
      expect((await storedTrainingDefaults(tx, restoredOwner.ownerId))!.targets.calves).toBe(3);
      delete backup.trainingDefaults;
      expect(await importOwner(tx, restoredOwner, backup)).toEqual({ created: 0, unchanged: 0 });
      expect((await storedTrainingDefaults(tx, restoredOwner.ownerId))!.targets.calves).toBe(3);
    });
  });
  it("normalizes automatic results before relational persistence and blocks unfinished or downgraded sessions", async () => {
    await testTransaction(async tx => {
      const owner = actor();
      const movement = await save(tx, owner, "exercises", { id: randomUUID(), revision: 0, name: "Press",
        equipmentId: null, equipment: "Barbell", setup: "", primaryMuscle: "chest", secondaryMuscles: [],
        pattern: "push", defaultRole: "lifting", defaultLoad: { value: 100, unit: "lb", basis: "total" }, notes: "", archived: false }, null);
      const workout = await save(tx, owner, "workouts", { id: randomUUID(), revision: 0, kind: "routine",
        routineId: null, weekId: null, date: null, title: "Press", focus: "", notes: "", source: null,
        blocks: [{ id: randomUUID(), title: "Press", kind: "straight", restSeconds: null, rounds: null,
          items: [makeItem(movement, 2)], notes: "" }] }, null);
      let session = await save(tx, owner, "sessions", startSession(workout, "2026-10-20"), null);
      session.results[0].reps = 8;
      session.results[0].load = { value: 100, unit: "lb", basis: "total" };
      session = await save(tx, owner, "sessions", session, session.revision);
      expect(session.results[0].status).toBe("completed");
      const persisted = await tx.select().from(results).where(eq(results.sessionId, session.id));
      expect(persisted.find(r => r.id === session.results[0].id)?.status).toBe("completed");
      await expect(save(tx, owner, "sessions", { ...session, status: "completed" }, session.revision)).rejects.toThrow("Log or skip");
      await expect(save(tx, owner, "sessions", { ...session, loggingMode: "explicit" }, session.revision)).rejects.toThrow("automatic logging");
      session.results[1].status = "skipped";
      expect((await save(tx, owner, "sessions", { ...session, status: "completed" }, session.revision)).status).toBe("completed");
    });
  });
});
