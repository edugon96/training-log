import { pgTable, uuid, text, integer, doublePrecision, jsonb, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import type { EquipmentRecord, ExerciseRecord, WeekRecord, WorkoutRecord, SessionRecord, SetResult, TrainingDefaultsRecord, TimerSettingsRecord } from "../contracts/models";

const columns = <T>() => ({
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  revision: integer("revision").notNull(),
  data: jsonb("data").$type<T>().notNull(),
});
export const equipment = pgTable("equipment", columns<EquipmentRecord>(), (t) => [index("equipment_owner").on(t.ownerId)]);
export const exercises = pgTable("exercises", columns<ExerciseRecord>(), (t) => [index("exercises_owner").on(t.ownerId)]);
export const weeks = pgTable("weeks", columns<WeekRecord>(), (t) => [index("weeks_owner").on(t.ownerId)]);
export const workouts = pgTable("workouts", columns<WorkoutRecord>(), (t) => [index("workouts_owner").on(t.ownerId)]);
export const sessions = pgTable("workout_sessions", columns<SessionRecord>(), (t) => [index("sessions_owner").on(t.ownerId)]);
export const exerciseMuscles = pgTable("exercise_muscles", {
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
  muscle: text("muscle").notNull(),
  role: text("role").notNull(),
}, (t) => [primaryKey({ columns: [t.exerciseId, t.muscle, t.role] })]);
export const results = pgTable("result_sets", {
  id: uuid("id").notNull(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  itemId: uuid("item_id").notNull(),
  targetId: uuid("target_id"),
  status: text("status").notNull(),
  reps: doublePrecision("reps"),
  data: jsonb("data").$type<SetResult>().notNull(),
}, (t) => [primaryKey({ columns: [t.sessionId, t.id] }), index("result_owner").on(t.ownerId)]);
export const audit = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  revision: integer("revision").notNull(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("audit_owner").on(t.ownerId)]);
export const receipts = pgTable("mutation_receipts", {
  ownerId: text("owner_id").notNull(),
  key: text("key").notNull(),
  hash: text("hash").notNull(),
  response: text("response").notNull(),
  status: integer("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.key] })]);
export const importSources = pgTable("import_sources", {
  ownerId: text("owner_id").notNull(),
  file: text("file").notNull(),
  sha256: text("sha256").notNull(),
  notes: text("notes").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.file, t.sha256] })]);
export const trainingDefaults = pgTable("training_defaults", {
  ownerId: text("owner_id").primaryKey(),
  revision: integer("revision").notNull(),
  targets: jsonb("targets").$type<TrainingDefaultsRecord["targets"]>().notNull(),
});
export const timerSettings = pgTable("timer_settings", {
  ownerId: text("owner_id").primaryKey(),
  revision: integer("revision").notNull(),
  data: jsonb("data").$type<TimerSettingsRecord>().notNull(),
});
