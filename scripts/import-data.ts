/**
 * Reviewed, deterministic import from the read-only Fitness source documents.
 * Plans are parsed mechanically. Actual results come ONLY from the reviewed
 * source-manifest.json, with literal source-excerpt and checksum validation.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ImportManifest, defaultTargets, muscleNames,
  type ExerciseRecord, type EquipmentRecord, type ImportData, type LoadValue,
  type MuscleName, type SessionRecord, type SetTarget, type WorkoutBlock,
  type WorkoutItem, type WorkoutRecord,
} from "../contracts/models";
import { anatomyOptions, normalizeMuscle, patternOptions } from "../contracts/training";
import { normalizeExercise } from "../server/training";

const trackerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultFitnessRoot = resolve(trackerRoot, "..");
const unit = z.enum(["lb", "kg", "unknown"]);
const nullableNumber = z.number().nonnegative().nullable();
const sourceEntry = z.object({
  date: z.string(), file: z.string(), excerpt: z.string().min(1),
  certainty: z.enum(["confirmed", "approximate", "ambiguous"]).default("confirmed"),
});
const actualEntry = sourceEntry.extend({
  exercise: z.string(),
  replaces: z.string().optional(),
  equipment: z.string().optional(),
  setup: z.string().optional(),
  role: z.enum(["preparation", "power", "lifting", "conditioning", "cooldown"]).default("lifting"),
  kind: z.enum(["working", "warmup", "failure", "drop"]).default("working"),
  primaryMuscle: z.enum(muscleNames).optional(),
  basis: z.enum(["total", "per_hand", "added", "bodyweight", "assistance", "unknown"]).default("unknown"),
  values: z.array(z.tuple([nullableNumber, nullableNumber, unit,
    nullableNumber.optional(), nullableNumber.optional()])),
  notes: z.string().default(""),
});
const reviewedSchema = z.object({
  version: z.literal(1), description: z.string(),
  files: z.array(z.object({ file: z.string(), sha256: z.string(), notes: z.string() })),
  sessionNotes: z.array(sourceEntry),
  actuals: z.array(actualEntry),
});

export function stableId(key: string): string {
  const hash = createHash("sha256").update(`fitness-import-v1:${key}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
}
function clean(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "\n").replace(/\*\*/g, "").trim();
}
function baseTarget(key: string): SetTarget {
  return { id: stableId(key), repsMin: null, repsMax: null, load: null,
    durationSeconds: null, distanceMeters: null, rir: null, tempo: "",
    kind: "working", notes: "" };
}

const aliases: Record<string, string> = {
  "Incline DB Press": "Incline DB Bench Press",
  "Flat DB Bench Press": "DB Bench Press",
  "Straight-Arm Pulldown": "Straight Arm Lat Pulldown (Pulley)",
  "Overhead Tricep Extension (DB)": "Single Arm Overhead DB Tricep Extension",
};
const preferredEquipment: Record<string, string> = {
  "Barbell Bench Press": "Barbell + bench",
  "Strict Pull-Up": "Pull-up bar",
  "Pendulum Squat (Machine)": "Atlantis PW212",
  "Pec Deck (Machine Fly)": "Atlantis P156",
  "Machine Pullover": "Atlantis P144",
  "Incline Chest Press Machine": "Atlantis P143",
  "Machine Shoulder Press": "Atlantis E149",
  "Standing Calf Raise (Machine)": "Atlantis M318, bilateral",
  "Leg Extension": "Atlantis C105",
  "Seated Leg Curl": "Atlantis C108",
  "Hack Squat (Machine)": "Atlantis PW412",
  "Hip Thrust (Machine)": "Glutebuilder",
  "Seated Cable Row": "Cable row station",
  "Chest-Supported Row (Machine)": "Chest-supported row machine, model unknown",
  "Cable Lateral Raise": "Low cable",
  "Cable Rear Delt Fly": "Cable station",
  "Face Away Bayesian Curl": "Low cable",
  "Triceps Pressdown (High Pulley)": "High cable",
  "Cable Chop (High-to-Low)": "High cable",
  "Cable Crunch (Kneeling)": "High cable + rope",
  "Standing DB Curl": "Dumbbells, supinated grip",
  "Crossbody Hammer Curl": "Dumbbells",
  "Reverse DB Fly": "Dumbbells",
  "Overhead DB Extension": "One dumbbell, two hands",
  "Single-Leg KB RDL": "One kettlebell",
};
function normalizedEquipment(name: string, raw: string, fallback: string): string {
  // Exact models override generic prescription labels, never the other way round.
  const model = raw.match(/Atlantis\s+([A-Z]\d{3}|PW\d{3})/i)?.[1]?.toUpperCase();
  if (model === "M318") return /single.leg/i.test(raw) ? "Atlantis M318, single-leg" : "Atlantis M318, bilateral";
  if (model) return `Atlantis ${model}`;
  if (/Glutebuilder/i.test(raw)) return "Glutebuilder";
  if (raw && !/self.selected|current working|reference/i.test(raw)) {
    if (/chest.supported.*machine|same.*machine/i.test(raw) && /Chest-Supported Row/.test(name))
      return preferredEquipment[name];
    return raw;
  }
  return preferredEquipment[name] ?? fallback;
}
function ledgerMuscle(name: string, primary: string): MuscleName | null {
  if (name === "Cable Chop (High-to-Low)") return "obliques";
  const first = primary.split(/[,/·]/)[0].trim().toLowerCase();
  const map: Record<string, MuscleName> = {
    chest: "chest", lats: "back", "upper back": "back", back: "back",
    "front delts": "front_delts", "side delts": "side_delts", "rear delts": "rear_delts",
    biceps: "biceps", triceps: "triceps", quads: "quads", hamstrings: "hamstrings",
    glutes: "glutes", calves: "calves", core: "abs", abs: "abs", "rectus abs": "abs",
    obliques: "obliques",
  };
  return map[first] ?? null;
}
function roleFromCategory(category: string): WorkoutItem["role"] {
  if (/conditioning/i.test(category)) return "conditioning";
  if (/power/i.test(category)) return "power";
  if (/skill|mobility|prehab/i.test(category)) return "preparation";
  return "lifting";
}
function parseLoad(raw: string): LoadValue | null {
  if (!raw || /self.selected|select during|establish|minimum resistance|crisp|self.paced/i.test(raw)) return null;
  if (/\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?\s*(?:lb|kg)/i.test(raw)) return null;
  if (/^bodyweight$/i.test(raw.trim())) return { value: null, unit: "unknown", basis: "bodyweight" };
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(lb|kg)\b/i);
  const setting = raw.match(/(\d+(?:\.\d+)?)\s*(?:machine|stack) setting|(?:machine|stack) setting\s*(\d+(?:\.\d+)?)/i);
  if (!match && !setting) return null;
  return {
    value: Number(match?.[1] ?? setting?.[1] ?? setting?.[2]),
    unit: match ? match[2].toLowerCase() as "lb" | "kg" : "unknown",
    basis: /\/hand|per hand/i.test(raw) ? "per_hand" : /added/i.test(raw) ? "added" : /total/i.test(raw) ? "total" : "unknown",
  };
}
function parseTargets(dose: string, load: string, tempo: string, rir: string, key: string, rounds: number | null): SetTarget[] {
  const compact = dose.replace(/\s+/g, " ");
  const multiple = compact.match(/(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)(?:[–-](\d+(?:\.\d+)?))?/);
  const single = compact.match(/^(\d+(?:\.\d+)?)(?:[–-](\d+(?:\.\d+)?))?/);
  const count = multiple ? Number(multiple[1]) : (single ? (rounds ?? 1) : 0);
  const min = Number(multiple?.[2] ?? single?.[1] ?? 0);
  const max = Number(multiple ? multiple[3] ?? min : single?.[2] ?? min);
  const timed = /^\d+(?:\.\d+)?(?:[–-]\d+)?\s*(?:minutes|min|s)\b/i.test(compact.replace(/^\d+\s*[×x]\s*/, ""));
  const distance = /^\d+(?:\.\d+)?\s*m\b/.test(compact.replace(/^\d+\s*[×x]\s*/, ""));
  const ambiguousUnit = /marked sections|yd|yards|in\b/.test(compact);
  const restRir = Number(rir.match(/^\d+/)?.[0]);
  return Array.from({ length: Math.min(count, 100) }, (_, index) => ({
    ...baseTarget(`${key}:set:${index}`),
    repsMin: !timed && !distance && !ambiguousUnit ? min : null,
    repsMax: !timed && !distance && !ambiguousUnit ? max : null,
    durationSeconds: timed && min === max ? min * (/min/i.test(compact) ? 60 : 1) : null,
    distanceMeters: distance ? min : null,
    load: parseLoad(load), tempo,
    rir: Number.isFinite(restRir) ? restRir : null,
    notes: `Original dose: ${dose}${load ? ` · ${load}` : ""}${rir ? ` · RIR: ${rir}` : ""}`,
  }));
}

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const focuses = ["Upper", "Quad-Focused Lower", "Athletic", "Pull", "Push", "Cleans And Lower", "Rest"];
function datePlus(start: string, offset: number): string {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function buildImportManifest(
  fitnessRoot = process.env.FITNESS_SOURCE_ROOT || defaultFitnessRoot,
  reviewedManifest = process.env.FITNESS_REVIEWED_MANIFEST || resolve(trackerRoot, "data/source-manifest.json"),
): ImportData {
  const reviewed = reviewedSchema.parse(JSON.parse(readFileSync(reviewedManifest, "utf8")));
  const texts = new Map<string, string>();
  for (const source of reviewed.files) {
    const text = readFileSync(resolve(fitnessRoot, source.file), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== source.sha256)
      throw new Error(`Source changed since review: ${source.file}. Review and update the manifest before importing.`);
    texts.set(source.file, text);
  }
  for (const source of [...reviewed.actuals, ...reviewed.sessionNotes]) {
    if (!texts.get(source.file)?.includes(source.excerpt))
      throw new Error(`Reviewed excerpt not found: ${source.date} ${source.file}: ${source.excerpt}`);
  }

  const equipment: EquipmentRecord[] = [];
  const exercises: ExerciseRecord[] = [];
  const equipmentByName = new Map<string, EquipmentRecord>();
  const exerciseByName = new Map<string, ExerciseRecord>();
  function ensureEquipment(name: string, notes = "", startingResistance: LoadValue | null = null): EquipmentRecord {
    const model = name.match(/\b(?:PW|[A-Z])\d{3}\b/)?.[0] ?? "";
    const brand = name.match(/^(Atlantis|Centr|Pit Shark|Glutebuilder|Assault|Concept2)\b/i)?.[1] ?? "";
    const existing = equipmentByName.get(name) ?? (model && brand ? equipment.find(e => e.model === model && e.brand?.toLowerCase() === brand.toLowerCase()) : undefined);
    if (existing) return existing;
    const entry: EquipmentRecord = {
      id: stableId(`equipment:${name}`), revision: 0, name,
      model, brand,
      notes, startingResistance, archived: false,
    };
    equipment.push(entry);
    equipmentByName.set(name, entry);
    return entry;
  }
  for (const line of texts.get("equipment.md")!.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*(?:Station|---)/.test(line)) continue;
    const [name, reference, convention] = cells(line);
    const resistance = name.includes("PW212") ? { value: 45, unit: "lb" as const, basis: "unknown" as const }
      : name.includes("C201") ? { value: 80, unit: "lb" as const, basis: "unknown" as const } : null;
    ensureEquipment(name, `${reference}\n${convention}\nSource: equipment.md`, resistance);
  }
  function ensureExercise(name: string, fallbackEquipment = "Unspecified", primary: MuscleName | null = null, defaultRole: WorkoutItem["role"] = "lifting"): ExerciseRecord {
    name = aliases[name] ?? name;
    const existing = exerciseByName.get(name);
    if (existing) return existing;
    const eq = preferredEquipment[name] ?? fallbackEquipment;
    const entry: ExerciseRecord = {
      id: stableId(`exercise:${name}`), revision: 0, name, equipmentId: ensureEquipment(eq).id,
      equipment: eq, setup: "", primaryMuscle: primary, secondaryMuscles: [],
      pattern: "other", defaultRole, defaultLoad: null,
      notes: "Imported historical movement. Exact source description is preserved in session notes.", archived: false,
    };
    exercises.push(entry);
    exerciseByName.set(name, entry);
    return entry;
  }
  function ensureVariant(base: ExerciseRecord, eq: string, setup = ""): ExerciseRecord {
    if (base.equipment === eq && base.setup === setup) return base;
    const key = `${base.name}\u0000${eq}\u0000${setup}`;
    const existing = exerciseByName.get(key);
    if (existing) return existing;
    const variant = {
      ...base, id: stableId(`exercise-variant:${key}`),
      equipment: eq, equipmentId: ensureEquipment(eq).id, setup,
    };
    exercises.push(variant);
    exerciseByName.set(key, variant);
    return variant;
  }
  for (const line of texts.get("movements.md")!.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*(?:Movement|---)/.test(line)) continue;
    const [name, primary, secondary, eq, tempo, category, pattern, zones, notes] = cells(line);
    if (!category) continue;
    const entry = ensureExercise(name, eq, ledgerMuscle(name, primary));
    // Alias rows do not overwrite the preferred canonical definition.
    if (aliases[name]) continue;
    entry.secondaryMuscles = [...new Set([...secondary.split(","), ...primary.split(",")]
      .map(normalizeMuscle).filter(m => m !== entry.primaryMuscle && anatomyOptions.some(o => o.value === m)))];
    entry.pattern = pattern;
    entry.defaultRole = roleFromCategory(category);
    entry.notes = `${notes}\nAnatomical primary tags: ${primary}. Tempo: ${tempo}. Category: ${category}. Zones: ${zones}.\nSource: movements.md\n${line}`.trim();
  }
  ensureExercise("Captain's-Chair Leg Raise", "Captain's chair, back pad", "abs");
  ensureExercise("KB RDL (Stance Unreported)", "One kettlebell", "hamstrings");
  ensureExercise("Triceps Machine (Movement Unconfirmed)", "Atlantis T163", "triceps");
  ensureExercise("Push-Up (Execution Unreported)", "Floor, unassisted", "chest");
  const singleLegCalf = ensureVariant(ensureExercise("Standing Calf Raise (Machine)"), "Atlantis M318, single-leg");
  singleLegCalf.notes += "\nSeparate single-leg variant. Library presence does not establish completed work. Source: equipment.md";

  const weeks: ImportData["weeks"] = [];
  const workouts: WorkoutRecord[] = [];
  const dated = new Map<string, WorkoutRecord>();
  const daySources = new Map<string, { file: string; text: string }>();
  for (const source of reviewed.files.filter(s => s.file.startsWith("weeks/"))) {
    const startDate = source.file.match(/\d{4}-\d{2}-\d{2}/)![0];
    const weekId = stableId(`week:${startDate}`);
    const text = texts.get(source.file)!;
    const header = text.split("\n")[0].replace(/^# /, "");
    weeks.push({ id: weekId, revision: 0, startDate, title: header, targets: { ...defaultTargets },
      notes: `Imported from ${source.file}. ${source.notes}\nPrescribed and completed volume remain separate. Source SHA-256: ${source.sha256}` });
    const matches = [...text.matchAll(/^## (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [^\n]+/gm)];
    for (const [idx, match] of matches.entries()) {
      const day = days.indexOf(match[1]);
      const date = datePlus(startDate, day);
      const end = matches[idx + 1]?.index ?? text.indexOf("## Planning Details", match.index);
      const section = text.slice(match.index, end >= 0 ? end : text.length)
        .replace(/<\/details>\s*(?:<details>[\s\S]*?<summary>[\s\S]*?<\/summary>)?\s*$/, "").trim();
      daySources.set(date, { file: source.file, text: section });
      if (!/### (?:Strength and Assistance|Power)/.test(section)) continue;
      const blocks: WorkoutBlock[] = [];
      let role: WorkoutItem["role"] = "preparation";
      let block: WorkoutBlock | null = null;
      let headerCells: string[] = [];
      let blockOrdinal = 0;
      let noStructuredDose = false;
      const workoutId = stableId(`workout:${date}`);
      const newBlock = (title: string, line: string, kind: WorkoutBlock["kind"] = "straight"): WorkoutBlock => {
        const roundMatch = line.match(/(\d+)\s*rounds/i);
        const created: WorkoutBlock = {
          id: stableId(`${workoutId}:block:${blockOrdinal++}`), title: clean(title).slice(0, 200),
          kind, restSeconds: Number(line.match(/rest\s+(\d+)/i)?.[1]) || null,
          rounds: roundMatch ? Number(roundMatch[1]) : null, items: [], notes: line,
        };
        blocks.push(created);
        headerCells = [];
        noStructuredDose = false;
        return created;
      };
      for (const line of section.split("\n").slice(1)) {
        if (/^### /.test(line)) {
          const title = line.slice(4);
          if (/Performed|Session notes/.test(title)) { block = null; headerCells = []; continue; }
          role = /Power/.test(title) ? "power" : /Strength/.test(title) ? "lifting"
            : /Conditioning/.test(title) ? "conditioning" : /Cooldown/.test(title) ? "cooldown" : "preparation";
          block = newBlock(title, "", "straight");
          continue;
        }
        if (/^\*\*(?:Actual|Performed|Session notes|Hard sets|Lifting sets)/.test(line)) {
          block = null; headerCells = []; continue;
        }
        if (/^\*\*(?:[A-Z] ·|Power clean|[0-9]+ rounds|[0-9]+-minute|Steady cycling|Easy cycling)/.test(line)) {
          const title = line.match(/^\*\*(.*?)\*\*/)?.[1] ?? line;
          block = newBlock(title, line, line.includes("↔") ? "superset" : /rounds|AMRAP|→/.test(line) ? "circuit" : "straight");
          continue;
        }
        if (!block) continue;
        if (line.startsWith("|")) {
          const values = cells(line);
          if (values.every(v => /^[: -]+$/.test(v))) continue;
          if (/^(?:Exercise|Movement)/.test(values[0])) {
            headerCells = values;
            noStructuredDose = !values.some(v => /^(?:Sets|Dose|Preparation Dose)/.test(v));
            continue;
          }
          if (!headerCells.length || noStructuredDose) continue;
          const get = (pattern: RegExp) => values[headerCells.findIndex(v => pattern.test(v))] ?? "";
          const rawName = get(/^(?:Exercise|Movement)$/);
          if (!rawName) continue;
          const name = aliases[rawName] ?? rawName;
          const doseRaw = get(/Sets|Dose|Preparation Dose/);
          const dose = doseRaw.split(" @ ")[0];
          const load = get(/^Load$/) || doseRaw.split(" @ ").slice(1).join(" @ ");
          const entry = ensureExercise(name, "Unspecified", null, role);
          let equipmentText = get(/^Equipment$/);
          if (!equipmentText && /Atlantis|Glutebuilder/.test(load)) equipmentText = load.match(/Atlantis\s+\w+|Glutebuilder/)?.[0] ?? "";
          const eq = normalizedEquipment(name, equipmentText, entry.equipment);
          const variant = ensureVariant(entry, eq);
          const key = `${block.id}:item:${block.items.length}:${name}`;
          const itemRole = name === "Trap-Bar Deadlift" ? "power" : role;
          const item: WorkoutItem = {
            id: stableId(key), exerciseId: variant.id, name, equipment: eq, setup: "",
            primaryMuscle: entry.primaryMuscle, secondaryMuscles: [...entry.secondaryMuscles],
            role: itemRole, unilateral: /\/(?:arm|side|leg)|single.leg|bulgarian|walking lunges/i.test(`${dose} ${name}`),
            sets: parseTargets(dose, load, get(/^Tempo$/), get(/^RIR$/), key, block.rounds),
            notes: `Source: ${source.file}\nOriginal prescription row:\n${line}`,
          };
          if (name === "Copenhagen Plank") item.role = "preparation";
          block.items.push(item);
          continue;
        }
        if (line.trim()) block.notes = `${block.notes}\n${line}`.trim();
      }
      // Preserve prose-only preparation, conditioning and cooldown. Empty heading shells are redundant.
      const retained = blocks.filter(b => b.items.length || b.notes.trim());
      const workout: WorkoutRecord = {
        id: workoutId, revision: 0, kind: "planned", routineId: stableId(`routine:${day}`),
        weekId, date, title: clean(match[0].replace(/^## /, "")), focus: focuses[day],
        blocks: retained, notes: `Imported prescription snapshot. Do not infer completion.\nSource: ${source.file}`,
        source: { key: `plan:${date}`, file: source.file, excerpt: section, certainty: "confirmed" },
      };
      workouts.push(workout);
      dated.set(date, workout);
    }
  }
  // Templates carry only prescriptions. Last known routine definitions remain editable.
  for (let day = 0; day < 6; day++) {
    const last = workouts.filter(w => w.routineId === stableId(`routine:${day}`)).at(-1);
    if (!last) continue;
    const routine = structuredClone(last);
    routine.id = stableId(`routine:${day}`);
    routine.kind = "routine";
    routine.routineId = null;
    routine.weekId = null;
    routine.date = null;
    routine.title = `${days[day]} · ${focuses[day]}`;
    routine.notes = `Reusable prescription copied from ${last.date}. Actual results are never copied.`;
    workouts.push(routine);
  }

  const sessions: SessionRecord[] = [];
  const sourceFor = (row: z.infer<typeof sourceEntry>, key: string) => ({
    key, file: row.file, excerpt: row.excerpt, certainty: row.certainty,
  });
  const allDates = [...new Set([...reviewed.actuals, ...reviewed.sessionNotes].map(a => a.date))].sort();
  for (const date of allDates) {
    const plan = dated.get(date);
    const week = weeks.find(w => date >= w.startDate && date <= datePlus(w.startDate, 6))!;
    const notes = reviewed.sessionNotes.filter(n => n.date === date);
    const rows = reviewed.actuals.filter(a => a.date === date);
    if (!rows.length && notes.some(n => /Friday and Saturday workouts skipped/.test(n.excerpt))) {
      week.notes += `\n${date}: explicitly skipped. ${notes.map(n => `${n.excerpt} (Source: ${n.file})`).join(" ")}`;
      continue;
    }
    const sessionId = stableId(`session:${date}`);
    const day = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const session: SessionRecord = {
      id: sessionId, revision: 0, workoutId: plan?.id ?? null,
      routineId: plan?.routineId ?? (workouts.some(w => w.id === stableId(`routine:${day}`)) ? stableId(`routine:${day}`) : null),
      weekId: week.id, performedOn: date, title: `${date} · ${focuses[day]}`,
      status: "completed", blocks: [], results: [],
      notes: [
        "Historical session is closed. Completed status does not establish exercise completion.",
        ...notes.map(n => `[${n.certainty}] ${n.excerpt}\nSource: ${n.file}`),
        ...(daySources.has(date) ? [`Original day record:\n${daySources.get(date)!.text}`] : []),
      ].join("\n\n"),
      source: plan?.source ?? (rows[0] ? sourceFor(rows[0], `session:${date}`) : sourceFor(notes[0], `session:${date}`)),
      startedAt: null, finishedAt: null,
    };
    for (const [index, actual] of rows.entries()) {
      const original = plan?.blocks.flatMap(b => b.items).find(i => i.name === actual.exercise || i.name === actual.replaces);
      const entry = ensureExercise(actual.exercise, actual.equipment, actual.primaryMuscle ?? null);
      const eq = normalizedEquipment(actual.exercise, actual.equipment ?? original?.equipment ?? "", entry.equipment);
      const variant = ensureVariant(entry, eq, actual.setup ?? "");
      const itemId = stableId(`${sessionId}:actual:${index}:${actual.exercise}`);
      const item: WorkoutItem = {
        id: itemId, exerciseId: variant.id, name: entry.name,
        equipment: eq, setup: actual.setup ?? "",
        primaryMuscle: actual.primaryMuscle ?? entry.primaryMuscle,
        secondaryMuscles: [...entry.secondaryMuscles], role: actual.role,
        unilateral: original?.unilateral ?? /single.leg|bulgarian|copenhagen|chop|lateral|curl|walking lunges/i.test(actual.exercise),
        sets: actual.values.map((_, setIndex) => ({ ...baseTarget(`${itemId}:set:${setIndex}`), kind: actual.kind,
          notes: "Historical performed-set slot. Prescription is preserved separately, actual values are in the result." })),
        notes: [
          actual.replaces ? `Performed instead of ${actual.replaces}.` : "",
          actual.notes,
          `Source: ${actual.file}\n${actual.excerpt}`,
        ].filter(Boolean).join("\n"),
      };
      session.blocks.push({
        id: stableId(`${sessionId}:actual-block:${index}`), title: entry.name,
        kind: "straight", restSeconds: null, rounds: null, items: [item],
        notes: "Performed entry. Pairing/order remains in source notes where reported. No unreported sequence inferred.",
      });
      actual.values.forEach((value, setIndex) => {
        const [reps, load, loadUnit, seconds, meters] = value;
        session.results.push({
          id: stableId(`${itemId}:result:${setIndex}`), itemId, targetId: item.sets[setIndex].id,
          status: "completed", reps,
          load: load === null && actual.basis !== "bodyweight" ? null : { value: load, unit: loadUnit, basis: actual.basis },
          durationSeconds: seconds ?? null, distanceMeters: meters ?? null, rir: null,
          notes: actual.notes, source: sourceFor(actual, `actual:${date}:${actual.exercise}:${index}:${setIndex}`),
        });
      });
    }
    // Sources remain authoritative. Unknown performed work has no invented target/result.
    sessions.push(session);
  }
  const manifest = ImportManifest.parse({ version: 1, sources: reviewed.files,
    equipment, exercises: exercises.map(e => normalizeExercise({ ...e,
      pattern: patternOptions.some(p => p.value === e.pattern.toLowerCase()) ? e.pattern : "other",
    })), weeks, workouts, sessions });
  validateImportReferences(manifest);
  return manifest;
}

export function validateImportReferences(manifest: ImportData): void {
  const exerciseIds = new Set(manifest.exercises.map(e => e.id));
  const weekIds = new Set(manifest.weeks.map(w => w.id));
  const workoutIds = new Set(manifest.workouts.map(w => w.id));
  const routineIds = new Set(manifest.workouts.filter(w => w.kind === "routine").map(w => w.id));
  for (const record of [...manifest.workouts, ...manifest.sessions]) {
    if (record.weekId && !weekIds.has(record.weekId)) throw new Error(`Missing week ${record.weekId}`);
    if (record.routineId && !routineIds.has(record.routineId)) throw new Error(`Missing routine ${record.routineId}`);
    if ("workoutId" in record && record.workoutId && !workoutIds.has(record.workoutId)) throw new Error(`Missing workout ${record.workoutId}`);
    for (const item of record.blocks.flatMap(b => b.items))
      if (!exerciseIds.has(item.exerciseId)) throw new Error(`Missing exercise ${item.exerciseId}`);
  }
  for (const session of manifest.sessions) {
    const items = new Map(session.blocks.flatMap(b => b.items).map(i => [i.id, i]));
    for (const result of session.results) {
      const item = items.get(result.itemId);
      if (!item || (result.targetId && !item.sets.some(s => s.id === result.targetId)))
        throw new Error(`Dangling result ${result.id}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = buildImportManifest();
  const output = resolve(trackerRoot, "data/import.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({
    output, sources: manifest.sources.length, equipment: manifest.equipment.length,
    exercises: manifest.exercises.length, weeks: manifest.weeks.length,
    workouts: manifest.workouts.filter(w => w.kind === "planned").length,
    routines: manifest.workouts.filter(w => w.kind === "routine").length,
    sessions: manifest.sessions.length, results: manifest.sessions.reduce((n, s) => n + s.results.length, 0),
  }, null, 2));
}
