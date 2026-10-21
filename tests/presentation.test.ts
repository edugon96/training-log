import { describe, expect, it } from "vitest";
import { emptyTarget } from "../contracts/models";
import { cleanBlockTitle, cleanInstructions, isHistoricalCommentary, prescriptionLabel, weekLabel } from "../lib/presentation";

describe("clean workout presentation", () => {
  it("separates block metadata from useful Markdown instructions", () => {
    expect(cleanBlockTitle("**C · Chest and biceps**")).toBe("Chest and biceps");
    const source = "**C · Chest and biceps** ↔ · 3 rounds · rest 90–120s after pair\nBring dumbbells beside the pec deck.\nSource: private/plan.md\nOriginal prescription row: copied evidence";
    expect(cleanInstructions(source)).toBe("Bring dumbbells beside the pec deck.");
    expect(source).toContain("Source: private/plan.md");
  });
  it("recognizes generated comments without hiding personal notes", () => {
    expect(isHistoricalCommentary("Original dose: 3 × 8–12")).toBe(true);
    expect(isHistoricalCommentary("Source: notes.md")).toBe(true);
    expect(isHistoricalCommentary("Felt strong. Use a lower cable next time.")).toBe(false);
  });
  it("preserves useful target ranges while removing source labels", () => {
    const target = { ...emptyTarget(), repsMin: 8, repsMax: 12,
      load: { value: 40, unit: "kg" as const, basis: "per_hand" as const } };
    expect(prescriptionLabel(target)).toBe("8–12 reps · 40 kg /hand");
    expect(prescriptionLabel({ ...emptyTarget(), notes: "Original dose: 15–20 min" })).toBe("15–20 min");
  });
  it("shows a concise week selection across month boundaries", () => {
    expect(weekLabel("2026-10-19")).toBe("Oct 19–25, 2026");
    expect(weekLabel("2026-09-28")).toBe("Sep 28–Oct 4, 2026");
  });
});
