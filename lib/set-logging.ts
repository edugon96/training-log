import { movementRest } from "./workout-groups"
import type {
  LoadValue,
  PreviousRecord,
  SessionRecord,
  SetResult,
  SetTarget,
  WorkoutBlock,
  WorkoutItem,
} from "@/contracts/models"

/** Match the same kind and ordinal, so a warm-up never seeds a working set. */
export function previousSet(
  item: WorkoutItem,
  target: SetTarget,
  history: PreviousRecord | undefined,
  repeatLast = false
): SetResult | undefined {
  if (!history) return
  const ordinal = item.sets
    .filter((set) => set.kind === target.kind)
    .findIndex((set) => set.id === target.id)
  if (ordinal < 0) return
  if (history.targets) {
    const targets = history.targets.filter((set) => set.kind === target.kind)
    const completed = new Map(
      history.results
        .filter((row) => row.status === "completed")
        .map((row) => [row.targetId, row])
    )
    // Missing or skipped rows keep their position in the previous workout.
    if (targets[ordinal]) return completed.get(targets[ordinal].id)
    return repeatLast
      ? targets
          .map((set) => completed.get(set.id))
          .filter(Boolean)
          .at(-1)
      : undefined
  }
  const results = history.results.filter(
    (row) => row.status === "completed" && target.kind === "working"
  )
  return results[ordinal] ?? (repeatLast ? results.at(-1) : undefined)
}

function suggestedLoad(
  load: LoadValue | null | undefined,
  units?: LoadValue
): LoadValue | null | undefined {
  if (load?.value == null || !units) return load
  if (
    load.basis !== units.basis &&
    load.basis !== "unknown" &&
    units.basis !== "unknown"
  )
    return null
  let value = load.value
  if (load.unit !== units.unit) {
    if (load.unit === "unknown" || units.unit === "unknown") return null
    value =
      Math.round(
        value * (units.unit === "kg" ? 1 / 2.2046226218 : 2.2046226218) * 100
      ) / 100
  }
  return { ...units, value }
}

/** Suggestions never become results until the user accepts them. */
export function setSuggestion(
  item: WorkoutItem,
  target: SetTarget,
  results: SetResult[],
  history?: SetResult,
  units?: LoadValue
): Partial<SetResult> {
  const index = item.sets.findIndex((set) => set.id === target.id)
  const preceding = item.sets[index - 1]
  const same =
    preceding &&
    [
      "kind",
      "repsMin",
      "repsMax",
      "load",
      "durationSeconds",
      "distanceMeters",
      "rir",
      "tempo",
    ].every(
      (key) =>
        JSON.stringify(preceding[key as keyof SetTarget]) ===
        JSON.stringify(target[key as keyof SetTarget])
    )
  const previous = same
    ? results.find(
        (row) =>
          row.itemId === item.id &&
          row.targetId === preceding.id &&
          row.status !== "skipped"
      )
    : undefined
  return {
    reps:
      previous?.reps ??
      target.repsMin ??
      target.repsMax ??
      history?.reps ??
      null,
    load: suggestedLoad(
      previous?.load?.value != null
        ? previous.load
        : target.load?.value != null || target.load?.basis === "bodyweight"
          ? target.load
          : history?.load?.value != null
            ? history.load
            : target.load,
      units
    ),
    durationSeconds:
      previous?.durationSeconds ??
      target.durationSeconds ??
      history?.durationSeconds ??
      null,
    distanceMeters:
      previous?.distanceMeters ??
      target.distanceMeters ??
      history?.distanceMeters ??
      null,
    rir: previous?.rir ?? target.rir,
  }
}

export function acceptedSuggestion(
  result: SetResult,
  suggestion: Partial<SetResult>
): SetResult {
  return {
    ...result,
    status: "completed",
    reps: result.reps ?? suggestion.reps ?? null,
    load:
      result.load?.value != null
        ? result.load
        : suggestion.load
          ? {
              ...suggestion.load,
              ...(result.load
                ? { unit: result.load.unit, basis: result.load.basis }
                : {}),
            }
          : result.load,
    durationSeconds:
      result.durationSeconds ?? suggestion.durationSeconds ?? null,
    distanceMeters: result.distanceMeters ?? suggestion.distanceMeters ?? null,
    rir: result.rir ?? suggestion.rir ?? null,
  }
}

/** Count entered weight once. An unspecified basis doesn't erase a known weight. */
export function sessionVolume(session: SessionRecord) {
  let pounds = 0
  let excluded = 0
  for (const result of session.results.filter(
    (row) => row.status === "completed"
  )) {
    const load = result.load
    if (
      result.reps == null ||
      load?.value == null ||
      load.unit === "unknown" ||
      load.basis === "bodyweight" ||
      load.basis === "assistance"
    ) {
      excluded++
      continue
    }
    pounds += result.reps * load.value * (load.unit === "kg" ? 2.2046226218 : 1)
  }
  return { pounds, excluded }
}

/** Each movement owns its rest. Never interrupt a following drop set. */
export function automaticRestSeconds(
  block: WorkoutBlock,
  item: WorkoutItem,
  target: SetTarget,
  results: SetResult[]
) {
  // Retain the existing call signature while removing group completion timing.
  void results
  const rest = movementRest(block, item)
  if (!rest.automaticRest || !rest.restSeconds) return null
  const index = item.sets.findIndex((set) => set.id === target.id)
  if (index < 0 || item.sets[index + 1]?.kind === "drop") return null
  return rest.restSeconds
}
