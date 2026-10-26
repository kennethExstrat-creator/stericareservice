// Defaults a template can override: the heading, the column labels (STD_EG's
// wording) and the config (BUILD_SPEC 6.1: columns on/off, inspection level).
import { z } from "zod";
import { InspectionLevelSchema } from "@/lib/aql";
import type { SamplingValues } from "@/modules/_framework";

export const SAMPLING_PLAN_TITLE = "Sampling Plan";

/**
 * Columns of the sampling plan, in report order; the last two are surgical
 * (SG onsite form). glovesWeight was the app's own row of gloves weighed (no
 * form prints it): no template shows it any more (shownColumns).
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

/** A column a template can show: every column but the gloves for weight. */
export type ShownColumn = Exclude<SamplingColumn, "glovesWeight">;

/** Where each column flows forward: the key other modules read in `context.sampling[size]` (BUILD_SPEC 8). */
export const SAMPLING_CONTEXT_KEYS = {
  cases: "cases",
  innerUnits: "innerUnits",
  gloves: "gloves",
  glovesWatertightVisual: "watertightVisual",
  glovesDimensions: "dimensions",
  glovesPhysical: "physical",
  innerUnitsDispensing: "packagingDispensing",
  pouches: "pouches",
  pouchesDyeLeak: "pouchesDyeLeak",
} as const satisfies Readonly<Record<ShownColumn, keyof SamplingValues>>;

export const SAMPLING_PLAN_LABELS = {
  cases: "Case",
  innerUnits: "Inner Box",
  gloves: "Gloves",
  glovesWatertightVisual: "# Gloves for Watertight & Visual",
  glovesDimensions: "# Gloves for Dimension",
  glovesPhysical: "# Gloves for FAB",
  // The row no template shows any more: templates still word it.
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
      // Added 12 October 2026 (a template version saved before it reads it as off); no template shows
      // the row since 26 October 2026, whatever this says (shownColumns).
      glovesWeight: z
        .boolean()
        .default(false)
        .describe("Not used since 26 October 2026: the sampling plan shows no gloves for weight, as weight records one value per size."),
      innerUnitsDispensing: z.boolean(),
      pouches: z.boolean(),
      pouchesDyeLeak: z.boolean(),
    })
    .describe("Columns shown on this template. The surgical pouch columns are off by default; # Gloves for Weight is never shown."),
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

/**
 * The columns a template shows, in report order. Never the gloves for weight,
 * whatever the template says (Kenneth, 26 October 2026: "remove this, this is
 * not needed"): weight records one value per size, the size's average. A
 * count an older inspection saved there is kept, unused.
 */
export function shownColumns(config: SamplingPlanConfig): ShownColumn[] {
  return SAMPLING_COLUMNS.filter((column): column is ShownColumn => column !== "glovesWeight" && config.columns[column]);
}

const QUANTITY_COLUMNS: readonly ShownColumn[] = ["cases", "innerUnits", "gloves", "pouches"];

/**
 * The shown columns as the forms group them: what was sampled under the
 * "Sampling Quantity" caption, then the gloves or inner units each test
 * takes. The SG form has no Gloves column and counts the watertight and
 * visual gloves inside Sampling Quantity ("Sampling Quantity (WTT & Visual)").
 */
export function columnGroups(config: SamplingPlanConfig): { quantity: ShownColumn[]; tests: ShownColumn[] } {
  const shown = shownColumns(config);
  const inQuantity = (column: ShownColumn) =>
    QUANTITY_COLUMNS.includes(column) || (column === "glovesWatertightVisual" && !config.columns.gloves);
  const quantity = [...QUANTITY_COLUMNS, "glovesWatertightVisual" as const].filter(
    (column) => shown.includes(column) && inQuantity(column),
  );
  return { quantity, tests: shown.filter((column) => !quantity.includes(column)) };
}
