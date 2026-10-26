// Defaults a template can override: the heading, the labels (the STD_EG
// report's wording, plus the EG onsite form's "Others:", "Box/Carton #"
// for its "Box #": Kenneth, 13 October 2026, box # and carton # are one
// number, and "Aged Sample", each size's aged sample: Kenneth, 26 October
// 2026; a template saved before it shows this default) and the config
// (BUILD_SPEC 6.1: minimum layering and dispensing, stickiness codes with
// pass or fail, boxes per size). docs/DATA_DICTIONARY.md has the keys.
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { STICKINESS_CODE_PATTERN } from "./schema";

export const DISPENSING_PACKING_TITLE = "Glove Packing Check";

/**
 * Data field keys, computed keys and captions. `heading` holds placeholders
 * the app fills in (headingText): {codeLetters}, {minLayeringPct},
 * {minDispensingPct}.
 */
export const DISPENSING_PACKING_LABELS: Readonly<Record<string, string>> = {
  boxNo: "Box/Carton #",
  layeringPct: "Layering %",
  dispensingPct: "Dispensing %",
  stickiness: "Stickiness **",
  note: "Others:",
  codeLetter: "Sampling Code Letter",
  layeringAverage: "Average",
  dispensingAverage: "Average",
  stickinessSummary: "Average",
  layeringResult: "Passed / Failed",
  dispensingResult: "Passed / Failed",
  stickinessResult: "Passed / Failed",
  heading:
    "Glove Packing Check (Sampling Code Letter {codeLetters}) : Min. {minLayeringPct}% Layering & {minDispensingPct}% Dispensing",
  itemColumn: "Item",
  agedSample: "Aged Sample",
  stickinessLegend: "**Glove Stickiness Code",
};

/** More box rows than this per size is a typing slip, not a plan. */
export const MAX_BOXES_PER_SIZE = 500;

const PercentSchema = z.number().min(0).max(100);

const LabelSchema = z
  .string()
  .max(200)
  .refine((label) => label.trim() !== "", { error: "Enter the wording." });

export const StickinessCodeSchema = z.strictObject({
  code: z.string().regex(STICKINESS_CODE_PATTERN).describe("The code as the report prints it: A, B, B1"),
  label: LabelSchema.describe("The legend, in the template's wording"),
  pass: z.boolean().describe("A box with this code passes"),
});
export type StickinessCode = z.infer<typeof StickinessCodeSchema>;

export const BoxesPerSizeSchema = z
  .strictObject({
    default: z.number().int().min(1).max(MAX_BOXES_PER_SIZE).describe("Box rows for every size"),
    bySize: z
      .record(CanonicalSizeSchema, z.number().int().min(1).max(MAX_BOXES_PER_SIZE))
      .optional()
      .describe("Box rows for a particular size, e.g. 5 for XL"),
  })
  .describe("Box rows per size when the sampling plan gives no inner units for dispensing");
export type BoxesPerSize = z.infer<typeof BoxesPerSizeSchema>;

export const DispensingPackingConfigSchema = z.strictObject({
  minLayeringPct: PercentSchema.describe("Minimum average layering, in %"),
  minDispensingPct: PercentSchema.describe("Minimum average dispensing, in %"),
  stickinessCodes: z
    .array(StickinessCodeSchema)
    .min(1)
    .refine((codes) => new Set(codes.map((entry) => entry.code)).size === codes.length, {
      error: "Each stickiness code once.",
    })
    .describe("Stickiness codes from least to most sticky, with the legend and whether they pass"),
  boxesPerSize: BoxesPerSizeSchema,
});
export type DispensingPackingConfig = z.infer<typeof DispensingPackingConfigSchema>;

/** BUILD_SPEC 6.1's minimums and the STD_EG report's stickiness legend, [sic] fixed ("sickiness"). */
export const DISPENSING_PACKING_DEFAULT_CONFIG: DispensingPackingConfig = {
  minLayeringPct: 70,
  minDispensingPct: 80,
  stickinessCodes: [
    { code: "A", label: "Non sticky", pass: true },
    { code: "B", label: "A mix of non sticky to lightly sticky", pass: true },
    { code: "B1", label: "A mix of non sticky to light stickiness at the bead", pass: true },
    { code: "C", label: "Lightly sticky but dispensable", pass: true },
    { code: "D", label: "Too sticky & affect dispensing", pass: false },
  ],
  boxesPerSize: { default: 13 },
};
