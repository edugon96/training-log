import { randomUUID } from "node:crypto";
import { demand } from "./errors";
import { muscleNames, type SessionRecord, type WorkoutRecord, type WorkoutBlock, type WeekRecord, type ExerciseRecord, type LedgerRecord } from "../contracts/models";
import { inferredStatus, trackingFields } from "../contracts/training";

export function validateBlocks(blocks: WorkoutBlock[]) {
  const ids = new Set<string>();
  for (const block of blocks) {
    demand(!ids.has(block.id), 422, "duplicate_id", "Block IDs must be unique");
    ids.add(block.id);
    for (const item of block.items) {
      demand(!ids.has(item.id), 422, "duplicate_id", "Item IDs must be unique");
      ids.add(item.id);
      const noteIds = new Set<string>();
      for (const note of item.noteEntries ?? []) {
        demand(!noteIds.has(note.id), 422, "duplicate_id", "Note IDs must be unique within a movement");
        noteIds.add(note.id);
      }
      for (const target of item.sets) {
        demand(!ids.has(target.id), 422, "duplicate_id", "Set IDs must be unique");
        ids.add(target.id);
      }
    }
  }
}
export function validateSession(session: SessionRecord) {
  validateBlocks(session.blocks);
  const items = new Map(session.blocks.flatMap(b => b.items).map(i => [i.id, i]));
  for (const [itemId, notes] of Object.entries(session.movementNotes ?? {})) {
    demand(items.has(itemId), 422, "invalid_note", "Note movement is not in the session");
    demand(new Set(notes.map(note => note.id)).size === notes.length, 422, "duplicate_id", "Session note IDs must be unique within a movement");
  }
  const resultIds = new Set<string>();
  const targets = new Set<string>();
  for (const result of session.results) {
    demand(!resultIds.has(result.id), 422, "duplicate_id", "Result IDs must be unique");
    resultIds.add(result.id);
    const item = items.get(result.itemId);
    demand(item, 422, "invalid_result", "Result item is not in the session");
    if (session.loggingMode === "checked" && result.status === "completed") {
      demand(inferredStatus(item, result) === "completed", 422, "incomplete_set", "Enter every tracked value before checking a set");
    }
    if (result.targetId) {
      demand(item.sets.some(s => s.id === result.targetId), 422, "invalid_result", "Result target does not belong to its item");
      demand(!targets.has(result.targetId), 422, "duplicate_result", "Only one result is allowed per target");
      targets.add(result.targetId);
    }
  }
  demand(!session.finishedAt || !session.startedAt || Date.parse(session.finishedAt) >= Date.parse(session.startedAt), 422, "invalid_time", "Finish must follow start");
  if (session.timerPausedAt) {
    demand(session.status === "active" && !session.finishedAt && !!session.startedAt, 422, "invalid_time", "Only a started, active workout can be paused");
    demand(Date.parse(session.timerPausedAt) >= Date.parse(session.startedAt!), 422, "invalid_time", "Pause must follow start");
  }
  if (session.pausedDurationMs) {
    demand(!!session.startedAt, 422, "invalid_time", "Paused time requires a start time");
    const end = session.finishedAt || session.timerPausedAt;
    demand(!end || session.pausedDurationMs <= Date.parse(end) - Date.parse(session.startedAt!), 422, "invalid_time", "Paused time cannot exceed workout duration");
  }
  // Stopping the clock leaves the workout open for logging. Only completing
  // the workout requires every set to be resolved.
  if ((session.loggingMode === "automatic" || session.loggingMode === "checked") && session.status === "completed") {
    const logged = new Map(session.results.filter(result => result.targetId).map(result => [result.targetId, result]));
    const unresolved = session.blocks.flatMap(block => block.items.flatMap(item =>
      item.sets.filter(target => !logged.has(target.id) || logged.get(target.id)!.status === "unlogged")
        .map(target => ({ itemId: item.id, targetId: target.id }))));
    demand(!unresolved.length, 422, "unlogged_sets", "Log or skip every planned set before finishing", { unresolved });
  }
}
export function startSession(workout: WorkoutRecord, performedOn: string): SessionRecord {
  return {
    id: randomUUID(), revision: 0, workoutId: workout.id,
    routineId: workout.kind === "routine" ? workout.id : workout.routineId,
    weekId: workout.weekId, performedOn, title: workout.title, status: "active", loggingMode: "automatic",
    blocks: workout.blocks.map(block => ({ ...structuredClone(block),
      items: block.items.map(item => ({ ...structuredClone(item), trackingFields: trackingFields(item) })) })),
    results: workout.blocks.flatMap(b => b.items.flatMap(i => i.sets.map(t => ({
      id: randomUUID(), itemId: i.id, targetId: t.id, status: "unlogged" as const,
      reps: null, load: null, durationSeconds: null, distanceMeters: null, rir: null,
      notes: "", source: null,
    })))),
    notes: "", source: null, startedAt: new Date().toISOString(), finishedAt: null,
  };
}
export function computeLedger(week: WeekRecord, workouts: WorkoutRecord[], sessions: SessionRecord[]): LedgerRecord {
  const rows = muscleNames.map(muscle => ({ muscle, target: week.targets[muscle], planned: 0, completed: 0 }));
  const lookup = new Map(rows.map(row => [row.muscle, row]));
  let unloggedSets = 0;
  for (const workout of workouts.filter(w => w.weekId === week.id && w.kind === "planned")) {
    for (const item of workout.blocks.flatMap(b => b.items)) {
      if (item.role === "lifting" && item.primaryMuscle) {
        lookup.get(item.primaryMuscle)!.planned += item.sets.filter(s => s.kind !== "warmup").length;
      }
    }
  }
  for (const session of sessions.filter(s => s.weekId === week.id)) {
    const logged = new Map(session.results.filter(r => r.targetId).map(r => [r.targetId, r]));
    for (const item of session.blocks.flatMap(b => b.items)) {
      if (item.role !== "lifting" || !item.primaryMuscle) continue;
      for (const set of item.sets.filter(s => s.kind !== "warmup")) {
        const result = logged.get(set.id);
        if (result?.status === "completed") lookup.get(item.primaryMuscle)!.completed++;
        else if (!result || result.status === "unlogged") unloggedSets++;
      }
    }
  }
  return { weekId: week.id, rows, plannedTotal: rows.reduce((n, r) => n + r.planned, 0),
    completedTotal: rows.reduce((n, r) => n + r.completed, 0), unloggedSets };
}
export function findPrevious(exercise: ExerciseRecord, routineId: string | null, before: string, sessions: SessionRecord[]) {
  const identities = [{ exerciseId: exercise.id, equipment: exercise.equipment, setup: exercise.setup },
    ...(exercise.historyAliases ?? [])];
  const candidates = sessions.filter(s => s.performedOn < before).sort((a, b) => b.performedOn.localeCompare(a.performedOn) || (b.startedAt || "").localeCompare(a.startedAt || ""));
  const matching = candidates.flatMap(session => {
    const items = session.blocks.flatMap(b => b.items).filter(i =>
      identities.some(identity => i.exerciseId === identity.exerciseId && i.equipment === identity.equipment && i.setup === identity.setup));
    const results = items.flatMap(item => {
      const order = new Map(item.sets.map((target, index) => [target.id, index]));
      return session.results.filter(r => r.itemId === item.id && r.status === "completed")
        .sort((a, b) => (order.get(a.targetId ?? "") ?? Infinity) - (order.get(b.targetId ?? "") ?? Infinity));
    });
    return results.length ? [{ session, results, targets: items.flatMap(item => item.sets) }] : [];
  });
  const match = matching[0];
  return match ? { sessionId: match.session.id, date: match.session.performedOn, title: match.session.title,
    match: routineId && match.session.routineId === routineId ? "routine" as const : "exercise" as const,
    results: match.results, targets: match.targets, notes: match.session.notes } : null;
}
export function cloneBlocks(blocks: WorkoutBlock[]) {
  return blocks.map(b => ({ ...structuredClone(b), id: randomUUID(),
    items: b.items.map(i => ({ ...structuredClone(i), id: randomUUID(),
      ...(i.noteEntries ? { noteEntries: i.noteEntries.map(note => ({ ...note, id: randomUUID() })) } : {}),
      sets: i.sets.map(s => ({ ...structuredClone(s), id: randomUUID() })) })) }));
}
