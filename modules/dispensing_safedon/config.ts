// Defaults a template can override: the heading, the labels (the SAFEDON_EG
// report's wording) and the config (BUILD_SPEC 6.1: the defect list with the
// hints shown in the app, gloves per pack, maximum rate, boxes per size).
// docs/DATA_DICTIONARY.md has the keys.
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { DEFECT_CODE_PATTERN } from "./schema";

export const DISPENSING_SAFEDON_TITLE = "Glove Dispensing Inspection";

/**
 * Data field keys, computed keys and captions. `heading` holds the
 * {codeLetters} placeholder the app fills in (safedonHeading). Each defect's
 * row label and hint are in config.defects.
 */
export const DISPENSING_SAFEDON_LABELS: Readonly<Record<string, string>> = {
  boxNo: "Box #",
  counts: "Safedon Packing Defects",
  codeLetter: "Sampling Code Letter",
  boxDefects: "Defects / Gloves per Pack",
  boxRatePct: "Defect Rate",
  boxesTested: "Boxes Tested",
  boxesFailed: "Boxes Failed",
  totalDefects: "Total",
  glovesInspected: "Gloves Inspected",
  ratePct: "Defect Rate (%)",
  result: "Conclusion",
  heading: "Glove Dispensing Inspection (Sampling Code Letter {codeLetters})",
  totalGroup: "Total",
  specRow: "Specification / Requirement",
};

/** More box columns than this per size is a typing slip, not a plan. */
export const MAX_BOXES_PER_SIZE = 500;

const LabelSchema = z
  .string()
  .max(200)
  .refine((label) => label.trim() !== "", { error: "Enter the wording." });

export const SafedonDefectSchema = z.strictObject({
  code: z.string().regex(DEFECT_CODE_PATTERN).describe("Defect code (defect_codes): no_cuff, finger_out"),
  label: LabelSchema.describe("Row label, in the template's wording"),
  hint: z.string().max(500).describe("The definition shown under the label"),
});
export type SafedonDefect = z.infer<typeof SafedonDefectSchema>;

export const BoxesPerSizeSchema = z
  .strictObject({
    default: z.number().int().min(1).max(MAX_BOXES_PER_SIZE).describe("Box columns for every size"),
    bySize: z
      .record(CanonicalSizeSchema, z.number().int().min(1).max(MAX_BOXES_PER_SIZE))
      .optional()
      .describe("Box columns for a particular size"),
  })
  .describe("Box columns per size when the sampling plan gives no inner units for dispensing");
export type BoxesPerSize = z.infer<typeof BoxesPerSizeSchema>;

export const DispensingSafedonConfigSchema = z.strictObject({
  defects: z
    .array(SafedonDefectSchema)
    .min(1)
    .refine((defects) => new Set(defects.map((entry) => entry.code)).size === defects.length, {
      error: "Each defect code once.",
    })
    .describe("The defects counted per box, in the template's order and wording, with the definition as a hint"),
  glovesPerPack: z.number().int().min(1).max(10_000).describe("Gloves dispensed per box: the denominator of the rates"),
  maxRatePct: z.number().min(0).max(100).describe("Maximum defect rate per size, in % (a rate equal to it passes)"),
  boxesPerSize: BoxesPerSizeSchema,
});
export type DispensingSafedonConfig = z.infer<typeof DispensingSafedonConfigSchema>;

/** The Safedon sheet's six defects with the app's definitions (onsite/SAFEDON_EG.md), 125 per pack, at most 5%. */
export const DISPENSING_SAFEDON_DEFAULT_CONFIG: DispensingSafedonConfig = {
  defects: [
    { code: "no_cuff", label: "No Cuff", hint: "Cuff should ideally be at least 2 cm out" },
    { code: "finger_out", label: "Finger Out", hint: "Only the cuff, not a finger, should come out first" },
    { code: "multiple_out", label: "Multiple Gloves Out", hint: "Only one glove should come out at a time" },
    { code: "stuck", label: "Glove Stuck", hint: "Glove could not be dispensed or was very difficult to dispense" },
    { code: "sticky", label: "Sticky Glove", hint: "Two or more gloves out at once because they stick together" },
    { code: "faulty_cuff", label: "Faulty Cuff", hint: "Deformed or misshapen cuff causing a dispensing problem" },
  ],
  glovesPerPack: 125,
  maxRatePct: 5,
  boxesPerSize: { default: 13 },
};
