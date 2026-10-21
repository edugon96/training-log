import { createHash } from "node:crypto";
import { defaultTargets, ImportManifest, type ExerciseRecord, type MuscleName, type WorkoutBlock, type WorkoutRecord } from "../contracts/models";

// Synthetic public prescriptions. Never read personal exports or source manifests.
const id = (key: string) => {
  const h = createHash("sha256").update(`training-log:hybrid-example:v1:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const implementsList = [
  ["Barbell", "barbell"], ["Dumbbell", "dumbbell"], ["Cable Station", "cable"],
  ["Pull-Up Bar", "rig"], ["Parallel Bars", "rig"], ["Pec Deck", "machine"],
  ["Pendulum Squat", "machine"], ["Hack Squat", "machine"], ["Leg Extension", "machine"],
  ["Seated Leg Curl", "machine"], ["Standing Calf Raise", "machine"], ["Hip Thrust Machine", "machine"],
  ["Kettlebell", "kettlebell"], ["Row Ergometer", "cardio"], ["Stationary Bike", "cardio"],
  ["Bodyweight", "bodyweight"], ["Plyometric Box", "box"], ["Slam Ball", "ball"], ["Push Sled", "sled"],
] as const;
const equipment = implementsList.map(([name, type]) => ({ id: id(`equipment:${name}`), revision: 0,
  name, brand: "", model: "", type, notes: "", startingResistance: null, archived: false }));
type Definition = [string, typeof implementsList[number][0], MuscleName | null, string, string, string[]];
const definitions: Definition[] = [
  ["Barbell Bench Press", "Barbell", "chest", "push", "Flat bench", ["front_delts", "triceps"]],
  ["Strict Pull-Up", "Pull-Up Bar", "back", "pull", "Pronated grip, strict", ["biceps", "forearms"]],
  ["Pec Deck Fly", "Pec Deck", "chest", "push", "Seated", ["front_delts"]],
  ["Dumbbell Curl", "Dumbbell", "biceps", "pull", "Standing, supinated grip", ["forearms"]],
  ["Cable Lateral Raise", "Cable Station", "side_delts", "push", "Low pulley, single arm", []],
  ["Cable Rear Delt Fly", "Cable Station", "rear_delts", "pull", "Standing", ["upper_back"]],
  ["Seated Cable Row", "Cable Station", "back", "pull", "Neutral grip", ["biceps", "rear_delts"]],
  ["Cable Triceps Pushdown", "Cable Station", "triceps", "push", "High pulley, rope attachment", []],
  ["Pendulum Squat", "Pendulum Squat", "quads", "legs", "Bilateral", ["glutes", "adductors"]],
  ["Leg Extension", "Leg Extension", "quads", "legs", "Seated, bilateral", []],
  ["Seated Leg Curl", "Seated Leg Curl", "hamstrings", "legs", "Bilateral", []],
  ["Standing Calf Raise", "Standing Calf Raise", "calves", "legs", "Bilateral", []],
  ["Hanging Knee Raise", "Pull-Up Bar", "abs", "core", "Hanging, bent knees", ["hip_flexors", "grip"]],
  ["Cable Chop", "Cable Station", "obliques", "core", "High to low, both sides", ["core"]],
  ["Chest-Supported Dumbbell Row", "Dumbbell", "back", "pull", "Prone on incline bench", ["biceps", "rear_delts"]],
  ["Lat Pulldown", "Cable Station", "back", "pull", "Seated, pronated grip", ["biceps"]],
  ["Bayesian Cable Curl", "Cable Station", "biceps", "pull", "Low pulley, facing away", []],
  ["Cable Crunch", "Cable Station", "abs", "core", "Kneeling, high pulley and rope", []],
  ["Hack Squat", "Hack Squat", "quads", "legs", "Bilateral", ["glutes", "adductors"]],
  ["Dumbbell Walking Lunge", "Dumbbell", "quads", "legs", "Alternating steps", ["glutes", "adductors"]],
  ["Single-Leg Kettlebell RDL", "Kettlebell", "hamstrings", "legs", "One kettlebell, both sides", ["glutes", "lower_back"]],
  ["Machine Hip Thrust", "Hip Thrust Machine", "glutes", "legs", "Bilateral", ["hamstrings"]],
  ["Incline Dumbbell Press", "Dumbbell", "chest", "push", "Incline bench", ["front_delts", "triceps"]],
  ["Parallel-Bar Dip", "Parallel Bars", "chest", "push", "Forward torso lean", ["triceps", "front_delts"]],
  ["Seated Dumbbell Overhead Press", "Dumbbell", "front_delts", "push", "Back-supported bench", ["side_delts", "triceps"]],
  ["Overhead Cable Triceps Extension", "Cable Station", "triceps", "push", "Rope attachment", []],
  ["Row Ergometer", "Row Ergometer", null, "conditioning", "", ["back", "quads"]],
  ["Stationary Cycling", "Stationary Bike", null, "conditioning", "", ["quads"]],
  ["Farmer Carry", "Dumbbell", null, "carry", "One dumbbell per hand", ["grip", "core"]],
  ["Sled Push", "Push Sled", null, "conditioning", "Clear turf lane", ["quads", "glutes", "calves"]],
  ["Box Jump", "Plyometric Box", null, "legs", "Step down between repetitions", ["quads", "glutes", "calves"]],
  ["Medicine Ball Slam", "Slam Ball", null, "conditioning", "Clear floor", ["core", "lats", "shoulders"]],
];
const exercises: ExerciseRecord[] = definitions.map(([name, implement, primaryMuscle, pattern, setup, secondaryMuscles]) => {
  const machine = equipment.find(e => e.name === implement)!;
  const bodyweight = ["Strict Pull-Up", "Parallel-Bar Dip", "Hanging Knee Raise", "Box Jump"].includes(name);
  const timed = ["Stationary Cycling"].includes(name);
  const distance = ["Row Ergometer", "Farmer Carry", "Sled Push"].includes(name);
  return { id: id(`exercise:${name}`), revision: 0, name, equipmentId: machine.id, equipment: machine.name,
    setup, primaryMuscle, secondaryMuscles, pattern,
    defaultRole: name === "Box Jump" || name === "Medicine Ball Slam" ? "power" : primaryMuscle ? "lifting" : "conditioning",
    defaultLoad: bodyweight || timed || name === "Row Ergometer" ? null : { value: null, unit: "lb", basis: machine.type === "dumbbell" ? "per_hand" : "total" },
    trackingFields: timed ? ["durationSeconds"] : distance ? name === "Row Ergometer" ? ["distanceMeters"] : ["distanceMeters", "load"] : bodyweight ? ["reps"] : ["reps", "load"],
    notes: "", archived: false };
});
type Prescription = [string, number, number, number?, boolean?];
export function buildHybridExample() {
  const week = { id: id("week"), revision: 0, startDate: "2026-01-05", title: "Hybrid Hypertrophy", targets: { ...defaultTargets }, notes: "Illustrative week. Repeat onto your chosen Monday and choose your own working loads." };
  const workouts: WorkoutRecord[] = [];
  function day(offset: number, title: string, warmup: string, groups: { title: string; items: Prescription[]; kind?: WorkoutBlock["kind"]; rest?: number; notes?: string }[]) {
    const date = `2026-01-${String(5 + offset).padStart(2, "0")}`;
    const key = `workout:${date}`;
    const blocks: WorkoutBlock[] = [{ id: id(`${key}:warmup`), title: "Preparation", kind: "straight", restSeconds: null, rounds: null, items: [], notes: warmup }];
    groups.forEach((group, index) => blocks.push({ id: id(`${key}:block:${index}`), title: group.title, kind: group.kind ?? "straight", restSeconds: group.rest ?? 120, rounds: null, notes: group.notes ?? "",
      items: group.items.map(([name, count, min, max = min, unilateral = false], itemIndex) => {
        const exercise = exercises.find(e => e.name === name)!;
        const itemKey = `${key}:${index}:${itemIndex}`;
        const field = exercise.trackingFields![0];
        return { id: id(itemKey), exerciseId: exercise.id, name, equipment: exercise.equipment, setup: exercise.setup, primaryMuscle: exercise.primaryMuscle, secondaryMuscles: exercise.secondaryMuscles, role: exercise.defaultRole, unilateral, trackingFields: exercise.trackingFields,
          notes: unilateral ? "Repetitions are per side. Complete both sides for each set." : "",
          sets: Array.from({ length: count }, (_, n) => ({ id: id(`${itemKey}:set:${n}`), repsMin: field === "reps" ? min : null, repsMax: field === "reps" ? max : null,
            load: exercise.defaultLoad, durationSeconds: field === "durationSeconds" ? min : null, distanceMeters: field === "distanceMeters" ? min : null,
            rir: exercise.defaultRole === "lifting" ? 2 : null, tempo: "", kind: "working" as const, notes: "" })) };
      }) }));
    workouts.push({ id: id(key), revision: 0, kind: "planned", routineId: null, weekId: week.id, date, title, focus: "", blocks, notes: "", source: null });
  }
  const upper = "Easy row or bike for 3–5 minutes. Cat-cow ×6, thoracic rotation ×6/side, scapular push-up ×8. Ramp the first press and pull before working sets.";
  const lower = "Easy bike for 3–5 minutes. Ankle rocks ×8/side, adductor rock-back ×8/side, bodyweight squat ×8. Ramp the first lower-body lift before working sets.";
  day(0, "Upper", upper, [
    { title: "Bench Press", items: [["Barbell Bench Press", 4, 5, 8]], rest: 180 },
    { title: "Strict Pull-Up", items: [["Strict Pull-Up", 4, 6, 10]], rest: 150 },
    { title: "Chest And Biceps", kind: "superset", items: [["Pec Deck Fly", 3, 10, 15], ["Dumbbell Curl", 3, 8, 12]], notes: "Bring dumbbells beside the pec deck if space permits." },
    { title: "Cable Shoulders", kind: "superset", items: [["Cable Lateral Raise", 3, 12, 15, true], ["Cable Rear Delt Fly", 3, 12, 15]] },
    { title: "Cable Row And Triceps", kind: "superset", items: [["Seated Cable Row", 3, 8, 12], ["Cable Triceps Pushdown", 3, 10, 15]], notes: "Pair only if both stations are available nearby." },
    { title: "Row And Carry", kind: "circuit", items: [["Row Ergometer", 3, 250], ["Farmer Carry", 3, 30]], rest: 90 },
  ]);
  day(1, "Quad-Focused Lower", lower, [
    { title: "Pendulum Squat", items: [["Pendulum Squat", 4, 8, 10]], rest: 180 },
    { title: "Leg Extension And Curl", kind: "superset", items: [["Leg Extension", 3, 10, 15], ["Seated Leg Curl", 3, 10, 15]], notes: "Use nearby machines when available." },
    { title: "Calves", items: [["Standing Calf Raise", 3, 10, 15]] },
    { title: "Hanging Knee Raise", items: [["Hanging Knee Raise", 3, 10, 15]] },
    { title: "Cable Chop", items: [["Cable Chop", 3, 10, 12, true]] },
  ]);
  day(2, "Athletic Conditioning", "Easy cycling for 5 minutes. Dynamic lunges, ankle rocks and three progressive build-ups. Keep jumps crisp and land under control.", [
    { title: "Jumps And Slams", kind: "superset", items: [["Box Jump", 3, 3, 5], ["Medicine Ball Slam", 3, 5]], rest: 120 },
    { title: "Sled Push", items: [["Sled Push", 4, 15]], rest: 120, notes: "Choose a load that allows a smooth, repeatable push. Distance in meters." },
    { title: "Easy Cycling", items: [["Stationary Cycling", 1, 1200]], notes: "Conversational effort." },
  ]);
  day(3, "Pull", upper, [
    { title: "Chest-Supported Row", items: [["Chest-Supported Dumbbell Row", 4, 8, 12]], rest: 150 },
    { title: "Lat Pulldown", items: [["Lat Pulldown", 3, 8, 12]] },
    { title: "Cable Curl And Lateral Raise", kind: "superset", items: [["Bayesian Cable Curl", 3, 10, 15, true], ["Cable Lateral Raise", 3, 12, 15, true]] },
    { title: "Rear Delts And Abs", kind: "superset", items: [["Cable Rear Delt Fly", 3, 12, 15], ["Cable Crunch", 3, 10, 15]] },
  ]);
  day(4, "Posterior-Focused Lower", lower, [
    { title: "Single-Leg RDL", items: [["Single-Leg Kettlebell RDL", 4, 8, 12, true]], rest: 150 },
    { title: "Hack Squat", items: [["Hack Squat", 4, 8, 10]], rest: 180 },
    { title: "Hip Thrust", items: [["Machine Hip Thrust", 4, 8, 12]] },
    { title: "Walking Lunges", items: [["Dumbbell Walking Lunge", 3, 10, 12, true]] },
    { title: "Hamstrings And Calves", kind: "superset", items: [["Seated Leg Curl", 3, 10, 15], ["Standing Calf Raise", 3, 10, 15]], notes: "Separate these if the machines are not nearby." },
  ]);
  day(5, "Push And Arms", upper, [
    { title: "Incline Press", items: [["Incline Dumbbell Press", 4, 6, 10]], rest: 150 },
    { title: "Dips", items: [["Parallel-Bar Dip", 3, 6, 10]] },
    { title: "Dumbbell Press And Curl", kind: "superset", items: [["Seated Dumbbell Overhead Press", 3, 8, 12], ["Dumbbell Curl", 3, 8, 12]] },
    { title: "Cable Delts And Triceps", kind: "superset", items: [["Cable Lateral Raise", 4, 12, 15, true], ["Overhead Cable Triceps Extension", 3, 10, 15]], notes: "Complete the fourth lateral-raise set on its own." },
    { title: "High Cable Pair", kind: "superset", items: [["Cable Triceps Pushdown", 3, 10, 15], ["Cable Chop", 3, 10, 12, true]] },
  ]);
  return ImportManifest.parse({ version: 1, sources: [], equipment, exercises, weeks: [week], workouts, sessions: [], trainingDefaults: { revision: 0, targets: { ...defaultTargets } } });
}
