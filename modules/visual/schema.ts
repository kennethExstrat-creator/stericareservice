// Visual Inspection (BUILD_SPEC 6.1 visual): per ordered size and defect
// class (critical, major, minor), the gloves inspected and the defects found
// by code. With the template's handSplit on (surgical gloves) the defects are
// kept per hand under `R` and `L`; the gloves inspected and the limits stay
// per size and class. Every value may be missing while the inspection is a
// draft. Totals, code letters, limits and results are computed (6.2 rule 2),
// never stored here.
import { z } from "zod";
import { CountCellSchema, perSizeData } from "@/modules/_framework";

/** Defect classes in report order. Severity is the class a template lists a code under (BUILD_SPEC 4.2 rule 4). */
export const DEFECT_CLASSES = ["critical", "major", "minor"] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];

/** A defect code (defect_codes.code), the key of every count: snake case. */
export const DefectCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, { error: "Defect codes are snake case, e.g. thin_spot." });

/** A count of defects: tapped, so a whole number from 0, never text or a date (6.2 rules 1 and 3). */
export const DefectCountSchema = z.number().int().min(0);

/**
 * A defect the template's list does not have, in the inspector's words, with
 * its count. Saved unmapped and flagged for an admin (BUILD_SPEC 4.2 rule 4, 8).
 */
export const OneOffDefectSchema = z.strictObject({
  label: z.string().max(200).regex(/\S/, { error: "A defect not in the list needs a name." }),
  count: DefectCountSchema,
});
export type OneOffDefect = z.infer<typeof OneOffDefectSchema>;

/** The defects of one class on one hand, or on the size without a hand split. */
export const VisualCountsSchema = z.strictObject({
  /** Defects per code from the class's list; a defect never tapped was not found. */
  counts: z.record(DefectCodeSchema, DefectCountSchema).default(() => ({})),
  unmapped: z.array(OneOffDefectSchema).default(() => []),
});
export type VisualCounts = z.infer<typeof VisualCountsSchema>;

/** One class of one size: the gloves inspected for it, and its defects without a hand split. */
export const VisualClassSchema = VisualCountsSchema.extend({
  /** No. of sample inspected: n for the class's AQL plan. Offered from the sampling plan, confirmed by the inspector. */
  inspected: CountCellSchema,
});
export type VisualClass = z.infer<typeof VisualClassSchema>;

/** One hand, with handSplit on: its defects per class. */
export const VisualHandSchema = z.strictObject({
  critical: VisualCountsSchema.prefault({}),
  major: VisualCountsSchema.prefault({}),
  minor: VisualCountsSchema.prefault({}),
});
export type VisualHand = z.infer<typeof VisualHandSchema>;

export const VisualSizeSchema = z.strictObject({
  critical: VisualClassSchema.prefault({}),
  major: VisualClassSchema.prefault({}),
  minor: VisualClassSchema.prefault({}),
  /** Right and left hands, with handSplit on: the defects go here instead of on the classes. */
  R: VisualHandSchema.optional(),
  L: VisualHandSchema.optional(),
});
export type VisualSize = z.infer<typeof VisualSizeSchema>;

export const VisualDataSchema = perSizeData(VisualSizeSchema);
export type VisualData = z.infer<typeof VisualDataSchema>;

export function emptyVisual(): VisualData {
  return VisualDataSchema.parse({});
}

export function emptyVisualSize(): VisualSize {
  return VisualSizeSchema.parse({});
}

export function emptyVisualHand(): VisualHand {
  return VisualHandSchema.parse({});
}
