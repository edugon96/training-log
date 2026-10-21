import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildImportManifest, validateImportReferences } from "../scripts/import-data";
import type { SessionRecord } from "../contracts/models";

// Synthetic inputs travel with the repository. No personal history is read.
const root = resolve(import.meta.dirname, "fixtures/import");
const temp = mkdtempSync(resolve(tmpdir(), "tracker-import-test-"));
const path = resolve(temp, "reviewed.json");
const file = "weeks/2026-01-05.md";
const reviewed = {
  version: 1, description: "Synthetic importer regression fixture",
  files: ["equipment.md", "movements.md", file].map(file => ({ file,
    sha256: createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex"), notes: "Synthetic" })),
  sessionNotes: [
    { date: "2026-01-06", file, excerpt: "Workout completed, exact quantities unreported." },
    { date: "2026-01-09", file, excerpt: "Friday and Saturday workouts skipped." },
    { date: "2026-01-10", file, excerpt: "Friday and Saturday workouts skipped." },
  ],
  actuals: [
    { date: "2026-01-05", file, excerpt: "Pendulum: 11.25 at 45 lb added.", exercise: "Pendulum Squat (Machine)",
      equipment: "Atlantis PW212", basis: "added", values: [[11.25, 45, "lb"]], notes: "Partial final rep" },
    { date: "2026-01-05", file, excerpt: "Curl: 10 at setting 30, unit unknown.", exercise: "Seated Leg Curl",
      equipment: "Atlantis C106", basis: "unknown", values: [[10, 30, "unknown"]], notes: "Unknown unit" },
    { date: "2026-01-07", file, excerpt: "Curl: 9, load unreported.", exercise: "Seated Leg Curl",
      equipment: "Atlantis C108", values: [[9, null, "unknown"]], notes: "No reported load" },
    { date: "2026-01-07", file, excerpt: "Reverse DB fly instead of cable fly: 8 at 10 lb per hand.",
      exercise: "Reverse DB Fly", replaces: "Cable Rear Delt Fly", primaryMuscle: "rear_delts",
      basis: "per_hand", values: [[8, 10, "lb"]], notes: "Substitution" },
    { date: "2026-01-07", file, excerpt: "Trap bar: 2 reps, same weight, not reported.",
      exercise: "Trap-Bar Deadlift", role: "power", values: [[2, null, "unknown"]], notes: "No inferred load" },
    { date: "2026-01-07", file, excerpt: "Bench ramp: 5 at 45 lb.", exercise: "Barbell Bench Press",
      kind: "warmup", values: [[5, 45, "lb"]], notes: "Ramp only" },
  ],
};
writeFileSync(path, JSON.stringify(reviewed));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const manifest = buildImportManifest(root, path);
const items = (s: { blocks: SessionRecord["blocks"] }) => s.blocks.flatMap(b => b.items);
const session = (date: string) => manifest.sessions.find(s => s.performedOn === date)!;

describe("reviewed historical import", () => {
  it("uses preparation defaults for newly imported warm-ups and catalog-safe labels", () => {
    expect(manifest.exercises.find(e => e.name === "Cat-Cow")?.defaultRole).toBe("preparation");
    expect(manifest.exercises.every(e => e.pattern === e.pattern.toLowerCase())).toBe(true);
    expect(manifest.exercises.every(e => !e.secondaryMuscles.includes("—"))).toBe(true);
  });
  it("is deterministic and validates references", () => {
    expect(buildImportManifest(root, path)).toEqual(manifest);
    expect(() => validateImportReferences(manifest)).not.toThrow();
  });
  it("never infers actuals from plans or completion prose", () => {
    expect(session("2026-01-06").results).toHaveLength(0);
    expect(manifest.sessions.some(s => s.performedOn === "2026-01-08")).toBe(false);
  });
  it("keeps unequal superset lengths and uncertain loads", () => {
    const pair = manifest.workouts.find(w => w.date === "2026-01-05")!.blocks.find(b => b.kind === "superset")!;
    expect(pair.items.map(i => i.sets.length)).toEqual([3, 4]);
    expect(pair.items[1].sets[0].load).toBeNull();
    expect(pair.items[1].sets[0].notes).toContain("200–240 lb");
  });
  it("retains ordered rep ranges", () => {
    for (const plan of manifest.workouts) for (const item of items(plan)) for (const set of item.sets)
      if (set.repsMin !== null && set.repsMax !== null) expect(set.repsMax).toBeGreaterThanOrEqual(set.repsMin);
  });
  it("keeps setups consistent with exercise identities", () => {
    for (const item of [...manifest.workouts, ...manifest.sessions].flatMap(items)) {
      const exercise = manifest.exercises.find(e => e.id === item.exerciseId)!;
      expect(item.equipment).toBe(exercise.equipment);
      expect(item.setup).toBe(exercise.setup);
    }
  });
  it("separates equipment variants", () => {
    const a = items(session("2026-01-05")).find(i => i.equipment === "Atlantis C106")!;
    const b = items(session("2026-01-07")).find(i => i.equipment === "Atlantis C108")!;
    expect(a.exerciseId).not.toBe(b.exerciseId);
    const calves = manifest.exercises.filter(e => e.name === "Standing Calf Raise (Machine)");
    expect(calves.find(e => e.equipment.endsWith(", bilateral"))!.id)
      .not.toBe(calves.find(e => e.equipment.endsWith(", single-leg"))!.id);
  });
  it("keeps starting resistance separate from actual load", () => {
    expect(manifest.equipment.find(e => e.model === "PW212")?.startingResistance?.value).toBe(45);
    expect(manifest.equipment.find(e => e.model === "C201")?.startingResistance?.value).toBe(80);
    expect(session("2026-01-05").results[0].load?.value).toBe(45);
  });
  it("preserves explicit skips without completed sessions", () => {
    for (const date of ["2026-01-09", "2026-01-10"]) {
      expect(manifest.sessions.some(s => s.performedOn === date)).toBe(false);
      expect(manifest.weeks[0].notes).toContain(`${date}: explicitly skipped`);
    }
  });
  it("preserves fractional reps, unknown units and absent loads", () => {
    expect(session("2026-01-05").results[0].reps).toBe(11.25);
    expect(session("2026-01-05").results[1].load?.unit).toBe("unknown");
    expect(session("2026-01-07").results[0].load).toBeNull();
  });
  it("records substitutions without crediting prescribed movements", () => {
    expect(items(session("2026-01-07")).some(i => i.name === "Cable Rear Delt Fly")).toBe(false);
    expect(items(session("2026-01-07")).find(i => i.name === "Reverse DB Fly")?.primaryMuscle).toBe("rear_delts");
  });
  it("separates power and warmups from lifting credits", () => {
    const s = session("2026-01-07");
    const credits = s.results.filter(r => {
      const item = items(s).find(i => i.id === r.itemId)!;
      return item.role === "lifting" && item.primaryMuscle && item.sets.find(t => t.id === r.targetId)?.kind === "working";
    });
    expect(credits).toHaveLength(2);
    expect(s.results[2].load).toBeNull();
  });
  it("preserves evidence for every result", () => {
    for (const s of manifest.sessions) for (const result of s.results) {
      expect(result.source?.file).toBe(file);
      expect(result.source?.excerpt).toBeTruthy();
    }
  });
  it("rejects changed sources", () => {
    const changed = structuredClone(reviewed);
    changed.files[0].sha256 = "invalid";
    const invalid = resolve(temp, "hash.json");
    writeFileSync(invalid, JSON.stringify(changed));
    expect(() => buildImportManifest(root, invalid)).toThrow("Source changed since review");
  });
  it("rejects invented evidence", () => {
    const changed = structuredClone(reviewed);
    changed.actuals[0].excerpt = "This was never reported";
    const invalid = resolve(temp, "excerpt.json");
    writeFileSync(invalid, JSON.stringify(changed));
    expect(() => buildImportManifest(root, invalid)).toThrow("Reviewed excerpt not found");
  });
  it("rejects dangling targets", () => {
    const corrupted = structuredClone(manifest);
    corrupted.sessions[0].results[0].targetId = "00000000-0000-5000-a000-000000000000";
    expect(() => validateImportReferences(corrupted)).toThrow("Dangling result");
  });
});
