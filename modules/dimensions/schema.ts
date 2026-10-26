// Dimension (BUILD_SPEC 6.1 dimensions): per ordered size, one row per glove
// with a reading in mm for each measure. Every reading may be missing while
// the inspection is a draft; the statistics are computed, never stored. A
// measure's P/F may be set by hand, with the inspector's comment, and its
// spec changed for this inspection, by hand or by Steri-AI from the form's
// Spec row (Kenneth, 26 October 2026): saving either writes an audit row
// (pass_fail_changed, spec_changed).
import { z } from "zod";
import type { Spec } from "@/lib/stats";
import { DecimalCellSchema, perSizeData, SpecSchema } from "@/modules/_framework";
import { MeasureSchema, type Measure } from "./config";

/** The longest comment a P/F set by hand keeps. */
export const MANUAL_COMMENT_MAX = 500;

/** A P/F set by hand for one measure of one size, and why. */
export const ManualResultSchema = z.strictObject({
  result: z.enum(["pass", "fail"]),
  comment: z.string().trim().min(1).max(MANUAL_COMMENT_MAX),
});
export type ManualResult = z.infer<typeof ManualResultSchema>;

/** One glove's readings in mm. The template's `measures` decide which are shown and judged. */
export const DimensionGloveSchema = z.strictObject({
  length: DecimalCellSchema,
  width: DecimalCellSchema,
  fingerThickness: DecimalCellSchema,
  palmThickness: DecimalCellSchema,
  cuffThickness: DecimalCellSchema,
});
export type DimensionGlove = z.infer<typeof DimensionGloveSchema>;

export const DimensionSizeSchema = z.strictObject({
  /** Glove 1 first. Gloves past the size's n stay saved but are not counted. */
  gloves: z.array(DimensionGloveSchema).default([]),
  /** P/F set by hand, by measure: it takes the place of the readings' verdict. */
  manualResults: z
    .partialRecord(MeasureSchema, ManualResultSchema)
    .optional()
    .describe("P/F the inspector set by hand on screen, with a comment. Never set from a document."),
  /** The spec for this inspection, by measure: it takes the place of the template's. */
  specOverrides: z
    .partialRecord(MeasureSchema, SpecSchema)
    .optional()
    .describe(
      "Spec of a measure for this inspection, as the form's Spec row for the size gives it: ≥240 is {kind: min, min: 240}; ≤80 is {kind: max, max: 80}; 80±10 is {kind: tolerance, nominal: 80, tolerance: 10}; 230-250 is {kind: range, min: 230, max: 250}; NA is {kind: na}.",
    ),
});
export type DimensionSize = z.infer<typeof DimensionSizeSchema>;

export const DimensionsDataSchema = perSizeData(DimensionSizeSchema);
export type DimensionsData = z.infer<typeof DimensionsDataSchema>;

export function emptyDimensions(): DimensionsData {
  return DimensionsDataSchema.parse({});
}

export function emptyGlove(): DimensionGlove {
  return DimensionGloveSchema.parse({});
}

/** The P/F set by hand for a size's measure; null when the readings decide. */
export function manualResultOf(data: DimensionsData | null, size: string, measure: Measure): ManualResult | null {
  return data?.sizes[size]?.manualResults?.[measure] ?? null;
}

/**
 * `data` with a measure's P/F set by hand, or given back to the readings
 * (null). The same `data` when nothing changes.
 */
export function withManualResult(
  data: DimensionsData,
  size: string,
  measure: Measure,
  manual: ManualResult | null,
): DimensionsData {
  const current = manualResultOf(data, size, measure);
  if (current?.result === manual?.result && current?.comment === manual?.comment) return data;
  const entry = data.sizes[size] ?? DimensionSizeSchema.parse({});
  const others = Object.fromEntries(Object.entries(entry.manualResults ?? {}).filter(([key]) => key !== measure));
  const manualResults: DimensionSize["manualResults"] = manual ? { ...others, [measure]: manual } : others;
  const next: DimensionSize = { ...entry, manualResults };
  if (Object.keys(manualResults).length === 0) delete next.manualResults;
  return { ...data, sizes: { ...data.sizes, [size]: next } };
}

/** The spec set for this inspection for a size's measure; null when the template's applies. */
export function specOverrideOf(data: DimensionsData | null, size: string, measure: Measure): Spec | null {
  return data?.sizes[size]?.specOverrides?.[measure] ?? null;
}

/** Two specs alike: the same kind and figures, in whatever order they were saved (jsonb reorders keys). */
export function sameSpec(a: Spec | null | undefined, b: Spec | null | undefined): boolean {
  const key = (spec: Spec | null | undefined) =>
    spec ? JSON.stringify(Object.entries(spec).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : null;
  return key(a) === key(b);
}

/**
 * `data` with a measure's spec set for this inspection, or given back to the
 * template (null). The same `data` when nothing changes.
 */
export function withSpecOverride(data: DimensionsData, size: string, measure: Measure, spec: Spec | null): DimensionsData {
  if (sameSpec(specOverrideOf(data, size, measure), spec)) return data;
  const entry = data.sizes[size] ?? DimensionSizeSchema.parse({});
  const others = Object.fromEntries(Object.entries(entry.specOverrides ?? {}).filter(([key]) => key !== measure));
  const specOverrides: DimensionSize["specOverrides"] = spec ? { ...others, [measure]: spec } : others;
  const next: DimensionSize = { ...entry, specOverrides };
  if (Object.keys(specOverrides).length === 0) delete next.specOverrides;
  return { ...data, sizes: { ...data.sizes, [size]: next } };
}

/** One measure whose spec for this inspection changed between two versions of the data. */
export type SpecOverrideChange = { size: string; measure: Measure; from: Spec | null; to: Spec | null };

/** The specs set for this inspection that differ between `before` and `after`, in size and measure order. */
export function specOverrideChanges(before: DimensionsData | null, after: DimensionsData | null): SpecOverrideChange[] {
  const sizes = [...new Set([...Object.keys(before?.sizes ?? {}), ...Object.keys(after?.sizes ?? {})])].sort();
  const changes: SpecOverrideChange[] = [];
  for (const size of sizes) {
    for (const measure of MeasureSchema.options) {
      const from = specOverrideOf(before, size, measure);
      const to = specOverrideOf(after, size, measure);
      if (!sameSpec(from, to)) changes.push({ size, measure, from, to });
    }
  }
  return changes;
}

/** One measure whose P/F set by hand changed between two versions of the data. */
export type ManualResultChange = { size: string; measure: Measure; from: ManualResult | null; to: ManualResult | null };

/**
 * The P/F set by hand that differ between `before` and `after`: set,
 * changed (result or comment) or given back to the readings. In size and
 * measure order, for the audit rows a save writes.
 */
export function manualResultChanges(before: DimensionsData | null, after: DimensionsData | null): ManualResultChange[] {
  const sizes = [...new Set([...Object.keys(before?.sizes ?? {}), ...Object.keys(after?.sizes ?? {})])].sort();
  const changes: ManualResultChange[] = [];
  for (const size of sizes) {
    for (const measure of MeasureSchema.options) {
      const from = manualResultOf(before, size, measure);
      const to = manualResultOf(after, size, measure);
      if (from?.result === to?.result && from?.comment === to?.comment) continue;
      changes.push({ size, measure, from, to });
    }
  }
  return changes;
}
