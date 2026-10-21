import { muscleLabels, muscleNames, type CatalogRecord, type EquipmentRecord, type ExerciseRecord, type SessionRecord, type SetResult, type TrackingField, type WorkoutItem } from "./models";

const labels = (values: readonly string[]) => values.map(value => ({
  value, label: value.replaceAll("_", " ").replace(/^./, c => c.toUpperCase()),
}));
export const anatomyOptions = [
  ...muscleNames.map(value => ({ value, label: muscleLabels[value] })),
  ...labels(["core", "abductors", "adductors", "lower_back", "upper_back", "forearms", "lats", "shoulders", "hip_flexors", "serratus", "rotator_cuff", "grip"]),
];
export const patternOptions = labels(["push", "pull", "legs", "core", "conditioning", "carry", "mobility", "other"]);
export const equipmentTypeOptions = labels(["machine", "cable", "barbell", "dumbbell", "kettlebell", "bodyweight", "band", "cardio", "sled", "rig", "ball", "box", "other"]);
export const trackingOptions: { value: TrackingField; label: string }[] = [
  { value: "reps", label: "Reps" }, { value: "load", label: "Weight" },
  { value: "durationSeconds", label: "Time" }, { value: "distanceMeters", label: "Distance" },
];
export function normalizeMuscle(value: string): string {
  const key = value.trim().toLowerCase().replaceAll(" ", "_");
  return ({ "glute_med/abductors": "abductors", glute_med: "abductors", "—": "" } as Record<string, string>)[key] ?? key;
}
/** Keep the editable equipment name separate from its structured brand/model. */
export function cleanEquipmentName(record: EquipmentRecord): string {
  let name = record.name.trim();
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (record.brand?.trim()) name = name.replace(new RegExp(`^${escape(record.brand.trim())}\\b[\\s,·:–-]*`, "i"), "");
  if (record.model?.trim()) name = name.replace(new RegExp(`\\b${escape(record.model.trim())}\\b`, "ig"), "");
  name = name.replace(/\s+/g, " ").replace(/^[\s,·:–+-]+|[\s,·:–+-]+$/g, "").trim();
  // Model-only legacy labels need a confirmed descriptive name, never a guess.
  return name || record.name.trim();
}
export function equipmentDetails(record: EquipmentRecord): EquipmentRecord {
  const brand = record.brand ?? (/provisional/i.test(record.name) ? "" : record.name.match(/^(Atlantis|Centr|Pit Shark|Glutebuilder|Assault|Concept2)\b/i)?.[1] ?? "");
  const n = record.name.toLowerCase();
  const type = record.type ?? (
    /cable/.test(n) ? "cable" : /dumbbell/.test(n) ? "dumbbell" :
    /kettlebell/.test(n) ? "kettlebell" : /barbell|trap bar|ez bar/.test(n) ? "barbell" :
    /rowerg|bike|tread|runner/.test(n) ? "cardio" : /ball/.test(n) ? "ball" : /bodyweight|floor/.test(n) ? "bodyweight" :
    /sled/.test(n) ? "sled" : /band/.test(n) ? "band" :
    /box/.test(n) ? "box" : /rig|pull-up/.test(n) ? "rig" : brand || /machine/.test(n) ? "machine" : "other");
  return { ...record, brand, type };
}
export function buildCatalog(equipment: EquipmentRecord[]): CatalogRecord {
  const brands = new Map<string, Set<string>>();
  for (const item of equipment.map(equipmentDetails)) {
    if (!item.brand) continue;
    const key = [...brands.keys()].find(b => b.toLowerCase() === item.brand!.toLowerCase()) ?? item.brand;
    if (!brands.has(key)) brands.set(key, new Set());
    if (item.model) brands.get(key)!.add(item.model);
  }
  return { muscles: anatomyOptions, patterns: patternOptions, equipmentTypes: equipmentTypeOptions,
    brands: [...brands].sort(([a], [b]) => a.localeCompare(b)).map(([name, models]) => ({ name, models: [...models].sort() })) };
}
export function trackingFields(item: WorkoutItem | ExerciseRecord): TrackingField[] {
  if (item.trackingFields?.length) return [...new Set(item.trackingFields)];
  const sets = "sets" in item ? item.sets : [];
  const fields: TrackingField[] = [];
  if (sets.some(s => s.repsMin !== null || s.repsMax !== null)) fields.push("reps");
  if (sets.some(s => s.durationSeconds !== null)) fields.push("durationSeconds");
  if (sets.some(s => s.distanceMeters !== null)) fields.push("distanceMeters");
  const prose = sets.map(s => s.notes).join(" ");
  if (!fields.length) {
    if (/\b(min|minutes|seconds|secs)\b|\d\s*[–-]\s*\d+s\b|hold|plank/i.test(`${item.name} ${prose}`)) fields.push("durationSeconds");
    else if (/\b(rowerg|rowing|erg|bike|cycling|run|sprint|walk|carry|carries|sled|treadmill)\b/i.test(item.name) ||
      (/^row$/i.test(item.name) && /rowerg|cardio/i.test(item.equipment))) fields.push("distanceMeters");
    else fields.push("reps");
  }
  const load = "defaultLoad" in item ? item.defaultLoad : sets.find(s => s.load)?.load;
  if (load && (load.basis !== "bodyweight" || (load.value !== null && load.value > 0))) fields.push("load");
  if (!load && /barbell|dumbbell|kettlebell|machine|cable/i.test(item.equipment) && fields.includes("reps")) fields.push("load");
  return fields;
}
export function inferredStatus(item: WorkoutItem, result: SetResult): SetResult["status"] {
  if (result.status === "skipped") return "skipped";
  const complete = trackingFields(item).every(field => {
    if (field === "load") return result.load?.value !== null && result.load?.value !== undefined && result.load.value >= 0;
    return result[field] !== null && result[field]! > 0;
  });
  return complete ? "completed" : "unlogged";
}
/** Automatic sessions use this same rule in the client and API. Legacy history stays explicit. */
export function normalizeSessionResults(session: SessionRecord): SessionRecord {
  if (session.loggingMode !== "automatic") return session;
  const items = new Map(session.blocks.flatMap(b => b.items).map(i => [i.id, i]));
  return { ...session, results: session.results.map(result => {
    const item = items.get(result.itemId);
    return item && result.targetId ? { ...result, status: inferredStatus(item, result) } : result;
  }) };
}
