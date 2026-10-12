// Defaults a template can override: the heading, the column labels (STD_EG's
// wording) and the config (BUILD_SPEC 6.1: columns on/off, inspection level).
import { z } from "zod";
import { InspectionLevelSchema } from "@/lib/aql";
import type { SamplingValues } from "@/modules/_framework";

export const SAMPLING_PLAN_TITLE = "Sampling Plan";

/**
 * Columns of the sampling plan, in report order; the last two are surgical
 * (SG onsite form). The forms print no gloves for weight: that row is the
 * app's, beside the other tests' counts, in step order (dimension, force at
 * break, weight).
 */
export const SAMPLING_COLUMNS = [
  "cases",
  "innerUnits",
  "gloves",
  "glovesWatertightVisual",
  "glovesDimensions",
  "glovesPhysical",
  "glovesWeight",
  "innerUnitsDispensing",
  "pouches",
  "pouchesDyeLeak",
] as const;
export type SamplingColumn = (typeof SAMPLING_COLUMNS)[number];

/** Where each column flows forward: the key other modules read in `context.sampling[size]` (BUILD_SPEC 8). */
export const SAMPLING_CONTEXT_KEYS = {
  cases: "cases",
  innerUnits: "innerUnits",
  gloves: "gloves",
  glovesWatertightVisual: "watertightVisual",
  glovesDimensions: "dimensions",
  glovesPhysical: "physical",
  glovesWeight: "weight",
  innerUnitsDispensing: "packagingDispensing",
  pouches: "pouches",
  pouchesDyeLeak: "pouchesDyeLeak",
} as const satisfies Readonly<Record<SamplingColumn, keyof SamplingValues>>;

export const SAMPLING_PLAN_LABELS = {
  cases: "Case",
  innerUnits: "Inner Box",
  gloves: "Gloves",
  glovesWatertightVisual: "# Gloves for Watertight & Visual",
  glovesDimensions: "# Gloves for Dimension",
  glovesPhysical: "# Gloves for FAB",
  glovesWeight: "# Gloves for Weight",
  innerUnitsDispensing: "# Inner Box for Packaging & Dispensing Inspection",
  pouches: "Pouches",
  pouchesDyeLeak: "# Pouches (Dye Leak Test)",
  codeLetter: "Code Letter",
  planSampleSize: "Sample Size by Plan",
  totals: "Total:",
  samplingQuantity: "Sampling Quantity",
  orderQty: "Order Qty (Case)",
  // Captions of the capture screen that the reports do not print.
  gloveSize: "Glove Size",
  inspectionLevel: "Inspection Level",
  lotSizeGloves: "Lot Size (Gloves)",
} as const satisfies Readonly<Record<string, string>>;

export const SamplingPlanConfigSchema = z.strictObject({
  columns: z
    .strictObject({
      cases: z.boolean(),
      innerUnits: z.boolean(),
      gloves: z.boolean(),
      glovesWatertightVisual: z.boolean(),
      glovesDimensions: z.boolean(),
      glovesPhysical: z.boolean(),
      // Added 12 October 2026: a template version saved before it (frozen once used) reads it as off,
      // so its inspections keep their rows and weight weighs the template's n.
      glovesWeight: z
        .boolean()
        .default(false)
        .describe("On where weight weighs glove by glove; off where it weighs one value per size or is not included."),
      innerUnitsDispensing: z.boolean(),
      pouches: z.boolean(),
      pouchesDyeLeak: z.boolean(),
    })
    .describe("Columns shown on this template. The surgical pouch columns and # Gloves for Weight are off by default."),
  inspectionLevel: InspectionLevelSchema.nullable().describe(
    "ISO 2859-1 inspection level. With a level, the plan for each size's lot (cases ordered x gloves per case) is computed and a watertight and visual sample below it is flagged. None: samples are entered directly with no plan check.",
  ),
});
export type SamplingPlanConfig = z.infer<typeof SamplingPlanConfigSchema>;

export const SAMPLING_PLAN_DEFAULT_CONFIG: SamplingPlanConfig = {
  columns: {
    cases: true,
    innerUnits: true,
    gloves: true,
    glovesWatertightVisual: true,
    glovesDimensions: true,
    glovesPhysical: true,
    glovesWeight: false,
    innerUnitsDispensing: true,
    pouches: false,
    pouchesDyeLeak: false,
  },
  inspectionLevel: null,
};

/** The columns a template shows, in report order. */
export function shownColumns(config: SamplingPlanConfig): SamplingColumn[] {
  return SAMPLING_COLUMNS.filter((column) => config.columns[column]);
}

const QUANTITY_COLUMNS: readonly SamplingColumn[] = ["cases", "innerUnits", "gloves", "pouches"];

/**
 * The shown columns as the forms group them: what was sampled under the
 * "Sampling Quantity" caption, then the gloves or inner units each test
 * takes. The SG form has no Gloves column and counts the watertight and
 * visual gloves inside Sampling Quantity ("Sampling Quantity (WTT & Visual)").
 */
export function columnGroups(config: SamplingPlanConfig): { quantity: SamplingColumn[]; tests: SamplingColumn[] } {
  const shown = shownColumns(config);
  const inQuantity = (column: SamplingColumn) =>
    QUANTITY_COLUMNS.includes(column) || (column === "glovesWatertightVisual" && !config.columns.gloves);
  const quantity = [...QUANTITY_COLUMNS, "glovesWatertightVisual" as const].filter(
    (column) => shown.includes(column) && inQuantity(column),
  );
  return { quantity, tests: shown.filter((column) => !quantity.includes(column)) };
}
