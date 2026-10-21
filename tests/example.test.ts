import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHybridExample } from "../examples/hybrid-hypertrophy";
import { computeLedger } from "../server/domain";
import { normalizeEquipment, normalizeExercise } from "../server/training";

describe("public Hybrid Hypertrophy example", () => {
  it("has deterministic generated data, exact allocation and no results or private history", () => {
    const manifest = buildHybridExample();
    expect(JSON.parse(readFileSync("examples/hybrid-hypertrophy.json", "utf8"))).toEqual(manifest);
    const ledger = computeLedger(manifest.weeks[0], manifest.workouts, []);
    expect(ledger.plannedTotal).toBe(111);
    expect(ledger.rows.every(row => row.planned === row.target)).toBe(true);
    expect(manifest.sessions).toEqual([]);
    expect(manifest.sources).toEqual([]);
    expect(manifest.exercises.every(e => !e.historyAliases && !e.notes && e.defaultLoad?.value == null)).toBe(true);
    expect(manifest.workouts.map(w => w.blocks.flatMap(b => b.items).filter(i => i.role === "lifting").reduce((n, i) => n + i.sets.length, 0))).toEqual([26, 19, 0, 19, 21, 26]);
    for (const workout of manifest.workouts) for (const item of workout.blocks.flatMap(b => b.items)) {
      if (item.role === "lifting") expect([3, 4]).toContain(item.sets.length);
      expect(item.sets.every(s => s.load?.value == null)).toBe(true);
    }
    for (const record of manifest.equipment) expect(normalizeEquipment(record)).toEqual(record);
    for (const record of manifest.exercises) expect(normalizeExercise(record)).toEqual(record);
  });
});
