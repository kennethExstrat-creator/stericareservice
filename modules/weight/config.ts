// Defaults a template can override: the heading, the labels (STD_EG's
// wording; SAFEDON_EG titles it "Weight (g)" and prints "A") and the config
// (BUILD_SPEC 6.1: gloves weighed per size until the sampling plan gives its
// gloves for weight, an optional spec, the warning threshold for the
// indicative weight, decimals).
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { SpecSchema } from "@/modules/_framework";

export const WEIGHT_TITLE = "Weight (g) - Average of 13 Gloves per Size";

export const WEIGHT_LABELS = {
  values: "Weight (g)",
  average: "Average",
  deviationPct: "Deviation From Indicative Weight",
  /** The result row: "A / Rej." on SAFEDON_EG. */
  result: "Remark",
  /** Printed for a result with no spec: "A" on SAFEDON_EG. */
  info: "Info",
  // The grid's captions, as dimensions has them; SAFEDON_EG's words are "A" and "Rej.".
  rowNo: "No.",
  specRow: "Spec.",
  pass: "Passed",
  fail: "Failed",
} as const satisfies Readonly<Record<string, string>>;

/** Gloves a template can have weighed per size. */
export const MAX_N = 200;

export const WeightSpecRowSchema = z.strictObject({
  size: CanonicalSizeSchema.describe("Size, in its canonical spelling (M, 7.0)"),
  spec: SpecSchema,
});
export type WeightSpecRow = z.infer<typeof WeightSpecRowSchema>;

export const WeightConfigSchema = z.strictObject({
  n: z
    .number()
    .int()
    .min(1)
    .max(MAX_N)
    .describe("Gloves weighed per size when the sampling plan gives no number for weight; 1 weighs one value per size"),
  // A list, so a child template replaces every row at once (lib/templates/merge.ts).
  specs: z
    .array(WeightSpecRowSchema)
    .superRefine((rows, context) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        if (seen.has(row.size)) {
          context.addIssue({ code: "custom", message: `Size ${row.size} has two spec rows.`, path: [index, "size"] });
        }
        seen.add(row.size);
      });
    })
    .describe("Optional spec per size: minimum, maximum, range, nominal ± tolerance or NA. A size without a row is not judged."),
  warnThresholdPct: z
    .number()
    .min(0)
    .max(100)
    .describe("Deviation from the indicative weight, in %, above which the module warns (BUILD_SPEC 6.2 rule 9)"),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe("Decimals the average is printed with; the printed average is the one judged and compared"),
});
export type WeightConfig = z.infer<typeof WeightConfigSchema>;

/** STD_EG's: 13 gloves weighed one by one (until the sampling plan's gloves for weight say otherwise), no spec, a warning beyond 10%, 2 decimals. */
export const WEIGHT_DEFAULT_CONFIG: WeightConfig = {
  n: 13,
  specs: [],
  warnThresholdPct: 10,
  decimals: 2,
};
