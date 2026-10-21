import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeItem, type ExerciseRecord } from "../contracts/models";
import { equipmentDetails, normalizeSessionResults, trackingFields } from "../contracts/training";
import { startSession, validateSession } from "./domain";
import { normalizeEquipment, normalizeExercise } from "./training";
import { exportCsv } from "./api";

const exercise: ExerciseRecord = {
  id: randomUUID(), revision: 0, name: "Bench press", equipmentId: null,
  equipment: "Barbell", setup: "", primaryMuscle: "chest", secondaryMuscles: ["Triceps", "Front Delts"],
  pattern: "Push", defaultRole: "lifting", defaultLoad: { value: 135, unit: "lb", basis: "total" },
  notes: "", archived: false,
};
function session() {
  const item = makeItem(exercise, 1);
  item.sets[0].repsMin = 5;
  return startSession({ id: randomUUID(), revision: 1, kind: "planned", routineId: null, weekId: null,
    date: "2026-10-20", title: "Test", focus: "", blocks: [{ id: randomUUID(), title: "Press",
      kind: "straight", restSeconds: null, rounds: null, items: [item], notes: "" }], notes: "", source: null }, "2026-10-20");
}
describe("automatic session rules", () => {
  it("snapshots required fields, completes from actuals and returns to unlogged when erased", () => {
    const draft = session();
    expect(draft.loggingMode).toBe("automatic");
    expect(draft.blocks[0].items[0].trackingFields).toEqual(["reps", "load"]);
    draft.results[0].reps = 8;
    expect(normalizeSessionResults(draft).results[0].status).toBe("unlogged");
    draft.results[0].load = { value: 0, unit: "lb", basis: "added" };
    expect(normalizeSessionResults(draft).results[0].status).toBe("completed");
    draft.results[0].reps = 0;
    expect(normalizeSessionResults(draft).results[0].status).toBe("unlogged");
  });
  it("preserves skips and legacy explicit statuses", () => {
    const draft = session();
    draft.results[0].status = "skipped";
    expect(normalizeSessionResults(draft).results[0].status).toBe("skipped");
    delete draft.loggingMode;
    draft.results[0].status = "completed";
    expect(normalizeSessionResults(draft).results[0].status).toBe("completed");
    draft.status = "completed";
    expect(() => validateSession(draft)).not.toThrow();
  });
  it("rejects finishing unresolved planned sets including absent result rows", () => {
    const draft = session();
    draft.status = "completed";
    expect(() => validateSession(normalizeSessionResults(draft))).toThrow("Log or skip");
    draft.results = [];
    expect(() => validateSession(normalizeSessionResults(draft))).toThrow("Log or skip");
  });
  it("supports explicit field selection and time/distance inference", () => {
    expect(trackingFields({ ...exercise, name: "Plank", defaultLoad: null, equipment: "Bodyweight" })).toEqual(["durationSeconds"]);
    expect(trackingFields({ ...exercise, name: "Row", defaultLoad: null, equipment: "RowErg" })).toEqual(["distanceMeters"]);
    expect(trackingFields({ ...exercise, name: "3-Point DB Row", defaultLoad: null, equipment: "Dumbbell" })).toEqual(["reps", "load"]);
    expect(trackingFields({ ...exercise, trackingFields: ["durationSeconds", "distanceMeters"] })).toEqual(["durationSeconds", "distanceMeters"]);
    expect(trackingFields({ ...exercise, name: "Weighted pull-up", equipment: "Rig",
      defaultLoad: { value: 25, unit: "lb", basis: "bodyweight" } })).toEqual(["reps", "load"]);
  });
  it("exports personal notes separately from preserved source commentary", () => {
    const draft = session();
    draft.notes = "Original workout commentary";
    draft.userNotes = "My workout note";
    draft.results[0].notes = "Original set commentary";
    draft.results[0].userNotes = "My set note";
    const normalized = normalizeSessionResults(draft);
    expect(normalized.results[0].notes).toBe("Original set commentary");
    expect(normalized.results[0].userNotes).toBe("My set note");
    const csv = exportCsv({ version: 1, sources: [], equipment: [], exercises: [], weeks: [], workouts: [], sessions: [normalized] });
    expect(csv).toContain('"Notes","User Notes","Workout Notes","Workout User Notes"');
    expect(csv).toContain('"Original set commentary","My set note","Original workout commentary","My workout note"');
  });
});
describe("library catalog validation", () => {
  it("classifies slam balls before floor wording", () => {
    expect(equipmentDetails({ id: randomUUID(), revision: 0, name: "Slam-rated ball + clear floor",
      model: "", notes: "", startingResistance: null, archived: false }).type).toBe("ball");
  });
  it("normalizes legacy labels but rejects arbitrary muscles, patterns and equipment types", () => {
    expect(normalizeExercise(exercise)).toMatchObject({ pattern: "push", secondaryMuscles: ["triceps", "front_delts"] });
    expect(normalizeExercise({ ...exercise, secondaryMuscles: ["Glute Med/Abductors", "—"] }).secondaryMuscles).toEqual(["abductors"]);
    expect(() => normalizeExercise({ ...exercise, pattern: "teleport" })).toThrow("pattern");
    expect(() => normalizeExercise({ ...exercise, secondaryMuscles: ["made-up"] })).toThrow("secondary muscles");
    expect(() => normalizeEquipment({ id: randomUUID(), revision: 0, name: "Test", model: "", type: "spaceship",
      notes: "", startingResistance: null, archived: false })).toThrow("equipment type");
  });
  it("enriches legacy equipment without changing identity or load conventions", () => {
    const record = { id: randomUUID(), revision: 4, name: "Atlantis PW212", model: "PW212",
      notes: "Keep notes", startingResistance: { value: 45, unit: "lb" as const, basis: "unknown" as const }, archived: false };
    expect(equipmentDetails(record)).toEqual({ ...record, brand: "Atlantis", type: "machine" });
  });
  it("separates descriptive equipment names from brand and model on save", () => {
    const record = { id: randomUUID(), revision: 1, name: "Atlantis P156 Pec Deck", model: "P156",
      brand: "Atlantis", type: "machine", notes: "Source preserved", startingResistance: null, archived: false };
    expect(normalizeEquipment(record)).toEqual({ ...record, name: "Pec Deck" });
    expect(normalizeEquipment({ ...record, name: "Pec Deck" }).name).toBe("Pec Deck");
    expect(normalizeEquipment({ ...record, name: "Atlantis P156" }).name).toBe("Atlantis P156");
  });
});
