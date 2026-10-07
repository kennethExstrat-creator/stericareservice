// Defaults a template can override: the heading, the labels (STD_EG's
// wording, docs/DATA_DICTIONARY.md) and the config (BUILD_SPEC 6.1: n, spec
// minimum, standard label; plus the decimals the report prints).
import { z } from "zod";

export const FORCE_AT_BREAK_TITLE = "Force at Break in Newton (Refer to Attached Where Applicable)";

export const FORCE_AT_BREAK_LABEL_KEYS = ["values", "labReport", "median", "result", "rowNo", "specRow"] as const;
export type ForceAtBreakLabelKey = (typeof FORCE_AT_BREAK_LABEL_KEYS)[number];

export const FORCE_AT_BREAK_LABELS: Readonly<Record<ForceAtBreakLabelKey, string>> = {
  values: "Force at Break (N)",
  labReport: "Lab Report",
  median: "Median",
  result: "Passed / Failed",
  /** The reading number column. */
  rowNo: "No.",
  // The standard label follows in brackets when the template sets one: "Spec. (EN 455)".
  specRow: "Spec.",
};

/** Readings per size the template may ask for. */
export const MAX_READINGS = 500;

export const ForceAtBreakConfigSchema = z.strictObject({
  n: z
    .number()
    .int()
    .min(1)
    .max(MAX_READINGS)
    .describe("Gloves tested per size, one reading each. The sampling plan's gloves for FAB replace it when entered."),
  specMin: z
    .number()
    .positive()
    .describe("Minimum median force at break in N, every size (EN 455: 6).")
    .meta({ unit: "N" }),
  standardLabel: z
    .string()
    .max(80)
    .regex(/\S/, { error: "Leave the standard empty (null) instead of blank." })
    .nullable()
    .describe("Standard printed with the spec, e.g. EN 455 gives 'Spec. (EN 455)'. Null prints none."),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(6)
    .describe("Decimals the median is printed with. It is judged as printed."),
});
export type ForceAtBreakConfig = z.infer<typeof ForceAtBreakConfigSchema>;

export const FORCE_AT_BREAK_DEFAULT_CONFIG: ForceAtBreakConfig = {
  n: 13,
  specMin: 6,
  standardLabel: null,
  decimals: 3,
};
