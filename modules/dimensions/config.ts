// Defaults a template can override: the heading, the labels (STD_EG's
// wording; SAFEDON_EG relabels the statistic and the result words) and the
// config (BUILD_SPEC 6.1: measures on/off, median or average, a spec per
// size per measure, decimals; gloves per size).
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { SpecSchema } from "@/modules/_framework";

export const DIMENSIONS_TITLE = "Dimension";

/** Report column order. The same keys as lib/coverage's MEASURES (the test checks). */
export const MEASURES = ["length", "width", "fingerThickness", "palmThickness", "cuffThickness"] as const;
export const MeasureSchema = z.enum(MEASURES);
export type Measure = z.infer<typeof MeasureSchema>;

export const STATISTICS = ["median", "average"] as const;

export const DIMENSIONS_LABELS = {
  length: "Length",
  width: "Width",
  fingerThickness: "Finger Thickness",
  palmThickness: "Palm Thickness",
  cuffThickness: "Cuff Thickness",
  /** The statistic row: "Average" on SAFEDON_EG. */
  statistic: "Median",
  /** The result row: "A / Rej." on SAFEDON_EG. */
  measureResult: "P/F *",
  /** `{size}` is the size's label. */
  sizeHeading: "Dimension - Size {size}",
  rowNo: "No.",
  specRow: "Spec.",
  pass: "Passed",
  fail: "Failed",
} as const satisfies Readonly<Record<string, string>>;

/** Most gloves per size, from the template or the sampling plan: a mistyped n cannot stall the screen. */
export const MAX_ROWS = 200;

const MeasureSpecsSchema = z
  .strictObject({
    length: SpecSchema,
    width: SpecSchema,
    fingerThickness: SpecSchema,
    palmThickness: SpecSchema,
    cuffThickness: SpecSchema,
  })
  .partial();

export const DimensionSpecRowSchema = z.strictObject({
  size: CanonicalSizeSchema.describe("Size, in its canonical spelling (M, 7.0)"),
  specs: MeasureSpecsSchema.describe("Spec of each measure for this size; a measure left out is not judged"),
});
export type DimensionSpecRow = z.infer<typeof DimensionSpecRowSchema>;

const DecimalsSchema = z.number().int().min(0).max(10);

export const DimensionsConfigSchema = z.strictObject({
  measures: z
    .array(MeasureSchema)
    .min(1)
    .refine((measures) => new Set(measures).size === measures.length, { error: "List each measure once." })
    .describe("Measures on, in column order"),
  statistic: z
    .enum(STATISTICS)
    .describe("Median (EN 455 style) or average (ASTM style) of each size's gloves. Relabel statistic to match."),
  // A list, so a child template replaces every row at once (lib/templates/merge.ts).
  specs: z
    .array(DimensionSpecRowSchema)
    .superRefine((rows, context) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        if (seen.has(row.size)) {
          context.addIssue({ code: "custom", message: `Size ${row.size} has two spec rows.`, path: [index, "size"] });
        }
        seen.add(row.size);
      });
    })
    .describe("Spec per size and measure: minimum, maximum, range, nominal ± tolerance or NA. A size without a row is not judged."),
  decimals: z
    .strictObject({
      length: DecimalsSchema,
      width: DecimalsSchema,
      fingerThickness: DecimalsSchema,
      palmThickness: DecimalsSchema,
      cuffThickness: DecimalsSchema,
    })
    .describe("Decimals each statistic is printed with; the printed value is the one judged against the spec"),
  rows: z
    .number()
    .int()
    .min(1)
    .max(MAX_ROWS)
    .describe("Gloves measured per size when the sampling plan gives no number for dimension"),
});
export type DimensionsConfig = z.infer<typeof DimensionsConfigSchema>;

/** STD_EG's: every measure, the median, 0 decimals for length and width and 2 for thickness, 13 gloves. */
export const DIMENSIONS_DEFAULT_CONFIG: DimensionsConfig = {
  measures: [...MEASURES],
  statistic: "median",
  // Specs belong to the product (BUILD_SPEC 13): none until a template sets them.
  specs: [],
  decimals: { length: 0, width: 0, fingerThickness: 2, palmThickness: 2, cuffThickness: 2 },
  rows: 13,
};
