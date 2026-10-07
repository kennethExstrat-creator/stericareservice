// Defaults a template can override: the heading, the labels (SAFEDON_EG's
// wording, docs/DATA_DICTIONARY.md) and the config (BUILD_SPEC 6.1: specs
// and standard label; plus the decimals the report prints).
import { z } from "zod";

export const TENSILE_TITLE = "Physical Properties average (Refer to attached lab. reports)";

/** The two averages, in the order the report prints them. */
export const TENSILE_MEASURES = ["tensileStrength", "elongationAtBreak"] as const;
export type TensileMeasure = (typeof TENSILE_MEASURES)[number];

export const TENSILE_LABEL_KEYS = [
  ...TENSILE_MEASURES,
  "labReport",
  "tensileResult",
  "elongationResult",
  "specRow",
] as const;
export type TensileLabelKey = (typeof TENSILE_LABEL_KEYS)[number];

export const TENSILE_LABELS: Readonly<Record<TensileLabelKey, string>> = {
  tensileStrength: "Tensile Strength (Average) (MPa)",
  elongationAtBreak: "Elongation at break, average (%)",
  labReport: "Lab report",
  tensileResult: "Passed / Failed",
  elongationResult: "Passed / Failed",
  specRow: "Spec. ({standardLabel})",
};

const DecimalsSchema = z.number().int().min(0).max(6);

export const TensileConfigSchema = z.strictObject({
  tensileMin: z
    .number()
    .positive()
    .describe("Minimum tensile strength (average) in MPa, every size (ASTM D6319: 14).")
    .meta({ unit: "MPa" }),
  elongationMin: z
    .number()
    .positive()
    .describe("Minimum elongation at break (average) in %, every size (ASTM D6319: 500).")
    .meta({ unit: "%" }),
  standardLabel: z
    .string()
    .max(80)
    .describe("Standard printed with the specs: ASTM D6319 gives 'Spec. (ASTM D6319)'. Empty prints 'Spec.'."),
  decimals: z
    .strictObject({ tensileStrength: DecimalsSchema, elongationAtBreak: DecimalsSchema })
    .describe("Decimals each average and its minimum are printed with. Each is judged as printed."),
});
export type TensileConfig = z.infer<typeof TensileConfigSchema>;

export const TENSILE_DEFAULT_CONFIG: TensileConfig = {
  tensileMin: 14,
  elongationMin: 500,
  standardLabel: "ASTM D6319",
  decimals: { tensileStrength: 2, elongationAtBreak: 0 },
};
