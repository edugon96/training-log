import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { defaultTargets, Exercise, makeItem, type ExerciseRecord, type WeekRecord, type WorkoutRecord } from "../contracts/models";
import { computeLedger, findPrevious, startSession, validateSession, cloneBlocks } from "./domain";
import { authorize, checkOrigin, type Actor } from "./security";

const exercise: ExerciseRecord = {
  id: randomUUID(), revision: 1, name: "Single-arm curl", equipmentId: null, equipment: "Cable",
  setup: "Bayesian", primaryMuscle: "biceps", secondaryMuscles: ["forearms"], pattern: "curl",
  defaultRole: "lifting", defaultLoad: null, notes: "", archived: false,
};
const week: WeekRecord = { id: randomUUID(), revision: 1, startDate: "2026-10-19", title: "Test", targets: defaultTargets, notes: "" };
function plan(): WorkoutRecord {
  return { id: randomUUID(), revision: 1, kind: "planned", routineId: null, weekId: week.id, date: "2026-10-19",
    title: "Upper", focus: "Test", blocks: [{ id: randomUUID(), title: "A", kind: "superset", restSeconds: 90,
      rounds: null, items: [makeItem(exercise, 3), { ...makeItem(exercise, 4), role: "power" }], notes: "" }], notes: "", source: null };
}
describe("session snapshots and ledger", () => {
  it("starts blank actuals and preserves independent unequal set counts", () => {
    const workout = plan();
    const session = startSession(workout, "2026-10-19");
    expect(session.results).toHaveLength(7);
    expect(session.results.every(r => r.reps === null && r.load === null && r.status === "unlogged")).toBe(true);
    workout.blocks[0].items[0].name = "Changed";
    expect(session.blocks[0].items[0].name).toBe("Single-arm curl");
  });
  it("counts a unilateral target once and excludes power and warmups", () => {
    const workout = plan();
    workout.blocks[0].items[0].unilateral = true;
    workout.blocks[0].items[0].sets[0].kind = "warmup";
    const session = startSession(workout, "2026-10-19");
    session.results.forEach(r => { r.status = "completed"; });
    const ledger = computeLedger(week, [workout], [session]);
    expect(ledger.plannedTotal).toBe(2);
    expect(ledger.completedTotal).toBe(2);
    expect(ledger.rows.find(r => r.muscle === "biceps")?.completed).toBe(2);
  });
  it("completed session status never infers completed sets", () => {
    const workout = plan();
    const session = startSession(workout, "2026-10-19");
    session.status = "completed";
    expect(computeLedger(week, [workout], [session]).completedTotal).toBe(0);
    expect(computeLedger(week, [workout], [session]).unloggedSets).toBe(3);
  });
  it("rejects duplicate target results and foreign result items", () => {
    const session = startSession(plan(), "2026-10-19");
    session.results.push({ ...session.results[0], id: randomUUID() });
    expect(() => validateSession(session)).toThrow("Only one result");
    session.results.pop();
    session.results[0].itemId = randomUUID();
    expect(() => validateSession(session)).toThrow("Result item");
  });
  it("clones blocks with independent IDs", () => {
    const blocks = plan().blocks;
    const cloned = cloneBlocks(blocks);
    expect(cloned[0].id).not.toBe(blocks[0].id);
    expect(cloned[0].items[0].sets[0].id).not.toBe(blocks[0].items[0].sets[0].id);
  });
  it("validates paused workout timestamps without changing historical sessions", () => {
    const session = startSession(plan(), "2026-10-19");
    session.startedAt = "2026-10-19T12:00:00.000Z";
    expect(() => validateSession(session)).not.toThrow();
    session.timerPausedAt = "2026-10-19T12:01:00.000Z";
    session.pausedDurationMs = 30_000;
    expect(() => validateSession(session)).not.toThrow();
    expect(() => validateSession({ ...session, startedAt: null })).toThrow("Only a started");
    expect(() => validateSession({ ...session, status: "completed" })).toThrow("Only a started");
    expect(() => validateSession({ ...session, timerPausedAt: "2026-10-19T11:59:00.000Z" })).toThrow("Pause must follow");
    expect(() => validateSession({ ...session, pausedDurationMs: 61_000 })).toThrow("Paused time cannot exceed");
    expect(() => validateSession({ ...session, startedAt: null, timerPausedAt: null })).toThrow("Paused time requires");
  });
  it("allows a stopped clock with unfinished sets, but completing the workout still requires resolving them", () => {
    const session = startSession(plan(), "2026-10-19");
    session.startedAt = "2026-10-19T12:00:00.000Z";
    session.finishedAt = "2026-10-19T13:00:00.000Z";
    for (const loggingMode of ["checked", "automatic"] as const) {
      expect(() => validateSession({ ...session, loggingMode })).not.toThrow();
      expect(() => validateSession({ ...session, loggingMode, status: "completed" })).toThrow("Log or skip");
    }
    expect(() => validateSession({ ...session, finishedAt: "2026-10-19T11:59:00.000Z" })).toThrow("Finish must follow");
    expect(() => validateSession({ ...session, timerPausedAt: session.finishedAt })).toThrow("Only a started");
  });
});
describe("history match", () => {
  it("matches verified legacy identities without rewriting snapshots or credit", () => {
    const workout = plan();
    const old = startSession(workout, "2026-10-12");
    old.results[0].status = "completed";
    old.results[0].reps = 10;
    const original = structuredClone(old);
    const before = computeLedger(week, [workout], [old]);
    const renamed = Exercise.parse({ ...exercise, equipment: "Cable station", setup: "Low pulley, facing away",
      historyAliases: [{ exerciseId: exercise.id, equipment: exercise.equipment, setup: exercise.setup }] });
    expect(renamed.historyAliases).toHaveLength(1);
    expect(findPrevious(renamed, null, "2026-10-19", [old])?.results[0].reps).toBe(10);
    expect(old).toEqual(original);
    expect(computeLedger(week, [workout], [old])).toEqual(before);
  });
  it("matches only explicit complete alias tuples, not other setups or transitive aliases", () => {
    const old = startSession(plan(), "2026-10-12");
    old.results[0].status = "completed";
    const current = Exercise.parse({ ...exercise, id: randomUUID(), equipment: "New label",
      historyAliases: [{ exerciseId: exercise.id, equipment: exercise.equipment, setup: exercise.setup }] });
    expect(findPrevious(current, null, "2026-10-19", [old])?.sessionId).toBe(old.id);
    old.blocks[0].items[0].setup = "Different stance";
    expect(findPrevious(current, null, "2026-10-19", [old])).toBeNull();
    old.blocks[0].items[0].setup = exercise.setup;
    old.blocks[0].items[0].exerciseId = randomUUID();
    expect(findPrevious(current, null, "2026-10-19", [old])).toBeNull();
  });
  it("uses the latest comparable session even when an older session shares the routine", () => {
    const old = startSession(plan(), "2026-10-12");
    const recent = startSession(plan(), "2026-10-16");
    old.routineId = randomUUID();
    old.results[0].status = recent.results[0].status = "completed";
    expect(findPrevious(exercise, old.routineId, "2026-10-19", [recent, old])?.sessionId).toBe(recent.id);
    expect(findPrevious(exercise, old.routineId, "2026-10-19", [recent, old])?.match).toBe("exercise");
    expect(findPrevious(exercise, null, "2026-10-19", [old, recent])?.sessionId).toBe(recent.id);
  });
  it("returns completed sets in target order with their kinds, preserving source results", () => {
    const session = startSession(plan(), "2026-10-22");
    const item = session.blocks[0].items[0];
    item.sets[0].kind = "warmup";
    session.results.slice(0, 3).forEach((row, index) => {
      row.status = "completed";
      row.reps = 10 + index;
      row.load = { value: index ? 70 : 40, unit: "lb", basis: "added" };
    });
    session.results.reverse();
    const source = structuredClone(session);
    const history = findPrevious(exercise, null, "2026-10-24", [session]);
    expect(history?.results.map(row => row.reps)).toEqual([10, 11, 12]);
    expect(history?.targets.find(target => target.id === item.sets[0].id)?.kind).toBe("warmup");
    expect(session).toEqual(source);
  });
  it("does not mix setup or equipment or future dates", () => {
    const session = startSession(plan(), "2026-10-19");
    session.results[0].status = "completed";
    expect(findPrevious(exercise, null, "2026-10-19", [session])).toBeNull();
    session.blocks[0].items[0].equipment = "Different machine";
    expect(findPrevious(exercise, null, "2026-10-20", [session])).toBeNull();
  });
});
describe("security gates", () => {
  const actor: Actor = { ownerId: "owner", label: "Reader", session: false, scopes: ["read"], user: { id: "owner", name: "Reader", email: "" } };
  it("scoped agent cannot write or manage credentials", () => {
    expect(() => authorize(actor, "read")).not.toThrow();
    expect(() => authorize(actor, "results:write")).toThrow("results:write");
    expect(() => authorize(actor, "read", true)).toThrow("signed-in user");
  });
  it("browser mutations require configured exact origin", () => {
    const original = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    try {
      expect(() => checkOrigin(new Request("http://localhost:3000/api/v1/weeks", { headers: { origin: "https://attacker.test" } }), { ...actor, session: true })).toThrow("Origin");
      expect(() => checkOrigin(new Request("http://localhost:3000/api/v1/weeks", { headers: { origin: "http://localhost:3000" } }), { ...actor, session: true })).not.toThrow();
    } finally { process.env.BETTER_AUTH_URL = original; }
  });
});
