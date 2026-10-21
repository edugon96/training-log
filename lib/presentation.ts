import type { SetTarget } from "@/contracts/models";

/** Presentation only. Never replace the source evidence or stored history. */
export function cleanBlockTitle(value: string) {
  return value.replace(/\*\*/g, "").replace(/^[A-Z]\s*[·.:]\s*/, "").trim();
}
export function cleanInstructions(value: string) {
  return value.split("\n").filter(line =>
    !/^\s*\*\*[A-Z]\s*[·.:].*\*\*/.test(line) &&
    !/^\s*(Source:|Original (prescription row|record|dose):|\|)/i.test(line)
  ).join("\n").trim();
}
export function isHistoricalCommentary(value: string) {
  return /(?:^|\n)\s*(Source:|Original (prescription row|record|dose):|Historical|Imported from|Import note:)/i.test(value) ||
    /\|\s*Movement\s*\|/.test(value);
}
export function prescriptionLabel(set: SetTarget) {
  const parts: string[] = [];
  if (set.repsMin !== null)
    parts.push(`${set.repsMin}${set.repsMax !== null && set.repsMax !== set.repsMin ? `–${set.repsMax}` : ""} reps`);
  if (set.load?.value !== null && set.load?.value !== undefined) {
    const basis = { per_hand: "/hand", added: "added", assistance: "assisted", bodyweight: "+ BW", total: "", unknown: "" }[set.load.basis];
    parts.push(`${set.load.value} ${set.load.unit === "unknown" ? "" : set.load.unit}${basis ? ` ${basis}` : ""}`.trim());
  } else if (set.load?.basis === "bodyweight") parts.push("BW");
  if (set.durationSeconds !== null) parts.push(`${set.durationSeconds}s`);
  if (set.distanceMeters !== null) parts.push(`${set.distanceMeters}m`);
  const original = set.notes.match(/Original dose:\s*(.*)/i)?.[1];
  // Imported time/load ranges can carry information that a scalar couldn't represent.
  const range = original?.match(/\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?\s*(?:lb|kg|minutes?|min|seconds?|secs?|s\/side|s\b)/gi)?.join(" · ");
  if (range) parts.push(range);
  if (!parts.length && original) return original.replace(/^\d+\s*[×x]\s*/, "").split(" · RIR:")[0].trim();
  return parts.join(" · ") || "Self-selected";
}
export function weekLabel(start: string) {
  const date = new Date(`${start}T12:00:00`);
  const end = new Date(date);
  end.setDate(date.getDate() + 6);
  const from = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const to = date.getMonth() === end.getMonth()
    ? String(end.getDate())
    : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${from}–${to}, ${end.getFullYear()}`;
}
