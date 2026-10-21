import { eq } from "drizzle-orm";
import { TrainingDefaults, defaultTargets, type TrainingDefaultsRecord, type EquipmentRecord, type ExerciseRecord } from "../contracts/models";
import { anatomyOptions, cleanEquipmentName, equipmentDetails, equipmentTypeOptions, normalizeMuscle, patternOptions } from "../contracts/training";
import type { Store } from "./db";
import type { Actor } from "./security";
import { demand } from "./errors";
import { trainingDefaults, weeks } from "./schema";

export async function storedTrainingDefaults(db: Store, ownerId: string): Promise<TrainingDefaultsRecord | null> {
  const [row] = await db.select().from(trainingDefaults).where(eq(trainingDefaults.ownerId, ownerId));
  return row ? { revision: row.revision, targets: row.targets } : null;
}
export async function getTrainingDefaults(db: Store, ownerId: string): Promise<TrainingDefaultsRecord> {
  const saved = await storedTrainingDefaults(db, ownerId);
  if (saved) return saved;
  const available = await db.select({ data: weeks.data }).from(weeks).where(eq(weeks.ownerId, ownerId));
  available.sort((a, b) => b.data.startDate.localeCompare(a.data.startDate) || a.data.id.localeCompare(b.data.id));
  return { revision: 0, targets: structuredClone(available[0]?.data.targets ?? defaultTargets) };
}
export async function saveTrainingDefaults(db: Store, actor: Actor, input: unknown, expectedRevision: number) {
  const value = TrainingDefaults.parse(input);
  const current = await getTrainingDefaults(db, actor.ownerId);
  demand(current.revision === expectedRevision && value.revision === expectedRevision, 409, "revision_conflict",
    "Training defaults changed elsewhere", { current });
  const next = { revision: current.revision + 1, targets: value.targets };
  if (current.revision === 0) {
    await db.insert(trainingDefaults).values({ ownerId: actor.ownerId, ...next });
  } else {
    await db.update(trainingDefaults).set(next).where(eq(trainingDefaults.ownerId, actor.ownerId));
  }
  // Imported lazily to keep the generic repository's library normalization independent.
  const { recordAudit } = await import("./repository");
  await recordAudit(db, actor, current.revision ? "updated" : "created", "training_defaults", actor.ownerId, next.revision);
  return next;
}
export function normalizeEquipment(value: EquipmentRecord): EquipmentRecord {
  const enriched = equipmentDetails(value);
  const type = enriched.type!.trim().toLowerCase();
  demand(equipmentTypeOptions.some(option => option.value === type), 422, "equipment_type", "Choose an equipment type from the catalog");
  return { ...enriched, name: cleanEquipmentName(enriched), model: enriched.model.trim(), brand: enriched.brand?.trim(), type };
}
export function normalizeExercise(value: ExerciseRecord): ExerciseRecord {
  const pattern = value.pattern.trim().toLowerCase() || "other";
  demand(patternOptions.some(option => option.value === pattern), 422, "pattern", "Choose a movement pattern from the catalog");
  const secondaryMuscles = [...new Set(value.secondaryMuscles.map(normalizeMuscle).filter(Boolean))];
  demand(secondaryMuscles.every(muscle => anatomyOptions.some(option => option.value === muscle)), 422, "muscle",
    "Choose secondary muscles from the catalog");
  return { ...value, pattern, secondaryMuscles };
}
