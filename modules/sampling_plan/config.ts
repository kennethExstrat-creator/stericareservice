// Defaults a template can override: the heading, the column labels (STD_EG's
// wording) and the config (BUILD_SPEC 6.1: columns on/off, inspection level).
import { z } from "zod";
import { InspectionLevelSchema } from "@/lib/aql";
import type { SamplingValues } from "@/modules/_framework";

export const SAMPLING_PLAN_TITLE = "Sampling Plan";

/** Columns of the sampling plan, in report order; the last two are surgical (SG onsite form). */
export const SAMPLING_COLUMNS = [
  "cases",
  "innerUnits",
  "gloves",
  "glovesWatertightVisual",
  "glovesDimensions",
  "glovesPhysical",
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
  innerUnitsDispensing: "packagingDispensing",
  pouches: "pouches",
  pouchesDyeLeak: "pouchesDyeLeak",
} as const satisfies Readonly<Record<SamplingColumn, keyof SamplingValues>>;

export const SAMPLING_PLAN_LABELS = {
  cases: "Case",
  innerUnits: "Inner Box",
  gloves: "Gloves",
  glovesWatertightVisual: "# gloves for watertight & Visual",
  glovesDimensions: "# gloves for dimension",
  glovesPhysical: "# gloves for FAB",
  innerUnitsDispensing: "# inner box for packaging & dispensing inspection",
  pouches: "Pouches",
  pouchesDyeLeak: "# pouches (dye leak test)",
  codeLetter: "Code letter",
  planSampleSize: "Sample size by plan",
  totals: "Total:",
  samplingQuantity: "Sampling Quantity",
  orderQty: "Order Qty (case)",
  // Captions of the capture screen that the reports do not print.
  gloveSize: "Glove Size",
  inspectionLevel: "Inspection level",
  lotSizeGloves: "Lot size (gloves)",
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
      innerUnitsDispensing: z.boolean(),
      pouches: z.boolean(),
      pouchesDyeLeak: z.boolean(),
    })
    .describe("Columns shown on this template. The surgical pouch columns are off by default."),
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
