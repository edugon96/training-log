import { z } from "zod";

export const muscleNames = [
  "chest", "back", "front_delts", "side_delts", "rear_delts", "biceps",
  "triceps", "quads", "hamstrings", "glutes", "calves", "abs", "obliques",
] as const;
export const Muscle = z.enum(muscleNames);
export const muscleLabels: Record<z.infer<typeof Muscle>, string> = {
  chest: "Chest", back: "Back", front_delts: "Front delts", side_delts: "Side delts",
  rear_delts: "Rear delts", biceps: "Biceps", triceps: "Triceps", quads: "Quads",
  hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves", abs: "Abs", obliques: "Obliques",
};
export const defaultTargets: Record<z.infer<typeof Muscle>, number> = {
  chest: 14, back: 14, front_delts: 3, side_delts: 10, rear_delts: 6, biceps: 9,
  triceps: 9, quads: 14, hamstrings: 10, glutes: 4, calves: 6, abs: 6, obliques: 6,
};
const Id = z.string().uuid();
const Text = z.string().max(30000);
const NumberOrNull = z.number().finite().nonnegative().nullable();
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
  "Use a real calendar date",
);
export const Role = z.enum(["preparation", "power", "lifting", "conditioning", "cooldown"]);
export const Load = z.object({
  value: NumberOrNull,
  unit: z.enum(["lb", "kg", "unknown"]),
  basis: z.enum(["total", "per_hand", "added", "bodyweight", "assistance", "unknown"]),
}).strict();
export const Source = z.object({
  key: z.string().min(1).max(500),
  file: z.string().max(1000),
  excerpt: Text,
  certainty: z.enum(["confirmed", "approximate", "ambiguous"]),
}).strict();
export const Equipment = z.object({
  id: Id,
  revision: z.number().int().nonnegative(),
  name: z.string().min(1).max(200),
  model: z.string().max(200),
  brand: z.string().max(200).optional(),
  type: z.string().max(100).optional(),
  notes: Text,
  startingResistance: Load.nullable(),
  archived: z.boolean(),
}).strict();
export const Exercise = z.object({
  id: Id,
  revision: z.number().int().nonnegative(),
  name: z.string().min(1).max(200),
  equipmentId: Id.nullable(),
  equipment: z.string().max(200),
  setup: z.string().max(500),
  historyAliases: z.array(z.object({
    exerciseId: Id,
    equipment: z.string().max(200),
    setup: z.string().max(500),
  }).strict()).max(100).optional(),
  primaryMuscle: Muscle.nullable(),
  secondaryMuscles: z.array(z.string().min(1).max(100)).max(30),
  pattern: z.string().max(100),
  defaultRole: Role,
  defaultLoad: Load.nullable(),
  trackingFields: z.array(z.enum(["reps", "load", "durationSeconds", "distanceMeters"])).min(1).max(4).optional(),
  notes: Text,
  archived: z.boolean(),
}).strict();
export const Target = z.object({
  id: Id,
  repsMin: NumberOrNull,
  repsMax: NumberOrNull,
  load: Load.nullable(),
  durationSeconds: NumberOrNull,
  distanceMeters: NumberOrNull,
  rir: NumberOrNull,
  tempo: z.string().max(30),
  kind: z.enum(["working", "warmup"]),
  notes: Text,
}).strict().refine(
  (s) => s.repsMin === null || s.repsMax === null || s.repsMax >= s.repsMin,
  "Maximum reps cannot be below minimum reps",
);
export const Item = z.object({
  id: Id,
  exerciseId: Id,
  name: z.string().min(1).max(200),
  equipment: z.string().max(200),
  setup: z.string().max(500),
  primaryMuscle: Muscle.nullable(),
  secondaryMuscles: z.array(z.string().max(100)).max(30),
  role: Role,
  unilateral: z.boolean(),
  trackingFields: z.array(z.enum(["reps", "load", "durationSeconds", "distanceMeters"])).min(1).max(4).optional(),
  sets: z.array(Target).max(100),
  notes: Text,
}).strict();
export const Block = z.object({
  id: Id,
  title: z.string().min(1).max(200),
  kind: z.enum(["straight", "superset", "circuit"]),
  restSeconds: NumberOrNull,
  rounds: z.number().int().min(1).max(100).nullable(),
  items: z.array(Item).max(50),
  notes: Text,
}).strict();
export const Targets = z.record(Muscle, z.number().int().min(0).max(1000));
export const TrainingDefaults = z.object({
  revision: z.number().int().nonnegative(),
  targets: Targets,
}).strict();
export const Catalog = z.object({
  muscles: z.array(z.object({ value: z.string(), label: z.string() })),
  patterns: z.array(z.object({ value: z.string(), label: z.string() })),
  equipmentTypes: z.array(z.object({ value: z.string(), label: z.string() })),
  brands: z.array(z.object({ name: z.string(), models: z.array(z.string()) })),
});
export const Week = z.object({
  id: Id,
  revision: z.number().int().nonnegative(),
  startDate: DateOnly,
  title: z.string().min(1).max(200),
  targets: Targets,
  notes: Text,
}).strict();
export const Workout = z.object({
  id: Id,
  revision: z.number().int().nonnegative(),
  kind: z.enum(["routine", "planned"]),
  routineId: Id.nullable(),
  weekId: Id.nullable(),
  date: DateOnly.nullable(),
  title: z.string().min(1).max(200),
  focus: z.string().max(200),
  blocks: z.array(Block).max(50),
  notes: Text,
  source: Source.nullable(),
}).strict();
export const Result = z.object({
  id: Id,
  itemId: Id,
  targetId: Id.nullable(),
  status: z.enum(["unlogged", "completed", "skipped"]),
  reps: NumberOrNull,
  load: Load.nullable(),
  durationSeconds: NumberOrNull,
  distanceMeters: NumberOrNull,
  rir: NumberOrNull,
  notes: Text,
  userNotes: Text.optional(),
  source: Source.nullable(),
}).strict();
export const Session = z.object({
  id: Id,
  revision: z.number().int().nonnegative(),
  workoutId: Id.nullable(),
  routineId: Id.nullable(),
  weekId: Id.nullable(),
  performedOn: DateOnly,
  title: z.string().min(1).max(200),
  status: z.enum(["active", "completed"]),
  loggingMode: z.enum(["explicit", "automatic"]).optional(),
  blocks: z.array(Block).max(50),
  results: z.array(Result).max(2000),
  notes: Text,
  userNotes: Text.optional(),
  source: Source.nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  timerPausedAt: z.string().datetime().nullable().optional(),
  pausedDurationMs: z.number().int().nonnegative().optional(),
}).strict();
export const Ledger = z.object({
  weekId: Id,
  rows: z.array(z.object({
    muscle: Muscle, target: z.number(), planned: z.number(), completed: z.number(),
  })),
  plannedTotal: z.number(),
  completedTotal: z.number(),
  unloggedSets: z.number(),
});
export const Previous = z.object({
  sessionId: Id, date: DateOnly, title: z.string(),
  match: z.enum(["routine", "exercise"]),
  results: z.array(Result),
  notes: z.string(),
}).nullable();
export const Scope = z.enum(["read", "plans:write", "results:write", "library:write"]);
export const ApiKeyInfo = z.object({
  id: z.string(), name: z.string(), prefix: z.string(),
  scopes: z.array(Scope), createdAt: z.string(), revokedAt: z.string().nullable(),
});
export const Change = z.object({
  id: z.string(), actor: z.string(), action: z.string(), entityType: z.string(),
  entityId: z.string(), at: z.string(), revision: z.number(),
});
export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export const TimerSettings = z.object({
  revision: z.number().int().nonnegative(),
  presets: z.array(z.number().int().min(1).max(3600)).min(1).max(12),
  soundEnabled: z.boolean(),
  keepScreenAwake: z.boolean(),
}).strict();
export const defaultTimerSettings = { revision: 0, presets: [30, 60, 90, 120, 150, 180], soundEnabled: true, keepScreenAwake: false };
export type TimerSettingsRecord = z.infer<typeof TimerSettings>;
export const ImportManifest = z.object({
  version: z.literal(1),
  sources: z.array(z.object({ file: z.string(), sha256: z.string(), notes: z.string() })),
  equipment: z.array(Equipment),
  exercises: z.array(Exercise),
  weeks: z.array(Week),
  workouts: z.array(Workout),
  sessions: z.array(Session),
  trainingDefaults: TrainingDefaults.optional(),
  timerSettings: TimerSettings.optional(),
});

export type MuscleName = z.infer<typeof Muscle>;
export type LoadValue = z.infer<typeof Load>;
export type EquipmentRecord = z.infer<typeof Equipment>;
export type ExerciseRecord = z.infer<typeof Exercise>;
export type SetTarget = z.infer<typeof Target>;
export type WorkoutItem = z.infer<typeof Item>;
export type WorkoutBlock = z.infer<typeof Block>;
export type WorkoutRecord = z.infer<typeof Workout>;
export type WeekRecord = z.infer<typeof Week>;
export type SetResult = z.infer<typeof Result>;
export type SessionRecord = z.infer<typeof Session>;
export type LedgerRecord = z.infer<typeof Ledger>;
export type PreviousRecord = z.infer<typeof Previous>;
export type ImportData = z.infer<typeof ImportManifest>;
export type TrainingDefaultsRecord = z.infer<typeof TrainingDefaults>;
export type CatalogRecord = z.infer<typeof Catalog>;
export type TrackingField = "reps" | "load" | "durationSeconds" | "distanceMeters";

export function emptyTarget(): SetTarget {
  return { id: crypto.randomUUID(), repsMin: null, repsMax: null, load: null,
    durationSeconds: null, distanceMeters: null, rir: null, tempo: "", kind: "working", notes: "" };
}
export function makeItem(exercise: ExerciseRecord, count = 3): WorkoutItem {
  return { id: crypto.randomUUID(), exerciseId: exercise.id, name: exercise.name,
    equipment: exercise.equipment, setup: exercise.setup, primaryMuscle: exercise.primaryMuscle,
    secondaryMuscles: [...exercise.secondaryMuscles], role: exercise.defaultRole, unilateral: false,
    ...(exercise.trackingFields ? { trackingFields: [...exercise.trackingFields] } : {}),
    sets: Array.from({ length: count }, () => ({ ...emptyTarget(), load: exercise.defaultLoad })),
    notes: "" };
}
