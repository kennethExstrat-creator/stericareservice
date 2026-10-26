// Sampling Plan (BUILD_SPEC 6.1 sampling_plan): per ordered size, what was
// sampled and how many gloves or inner units each test takes. Every value may
// be missing while the inspection is a draft. The plan's code letter and n
// are computed (6.2 rule 2), never stored here.
import { z } from "zod";
import { CountCellSchema, perSizeData } from "@/modules/_framework";

export const SamplingSizeSchema = z.strictObject({
  /** Cases sampled. carton_sampling lists exactly this many box/carton numbers (6.2 rule 6). */
  cases: CountCellSchema,
  /** Inner units sampled: inner boxes, plastic packs, dispenser boxes or pouches (packing_config's inner unit). */
  innerUnits: CountCellSchema,
  /** Gloves sampled. */
  gloves: CountCellSchema,
  /** n of watertight and visual (BUILD_SPEC 8), checked against the inspection level's plan (6.2 rule 8). */
  glovesWatertightVisual: CountCellSchema,
  /** The dimension rows. */
  glovesDimensions: CountCellSchema,
  /** Gloves for the physical test: force at break (EN 455) or tensile (ASTM D6319). */
  glovesPhysical: CountCellSchema,
  /**
   * The gloves weighed, a row from 12 to 26 October 2026: no template shows
   * it any more (shownColumns), and weight records one value per size. Kept
   * so the inspections that saved it still load; unused.
   */
  glovesWeight: CountCellSchema.describe("Not used: never fill"),
  /** Inner units for the packaging and dispensing check: its box rows. */
  innerUnitsDispensing: CountCellSchema,
  /** Surgical: pouches sampled. */
  pouches: CountCellSchema,
  /** Surgical: pouches for the dye leak test. */
  pouchesDyeLeak: CountCellSchema,
});
export type SamplingSize = z.infer<typeof SamplingSizeSchema>;

/**
 * The test rows the inspector may switch off on screen when the inspection
 * does not run that test (Kenneth, 26 October 2026): greyed, never hidden,
 * and no longer asked for. Data saved before the switches existed has none
 * off. glovesWeight has no row to switch any more; data that switched it
 * off still loads.
 */
export const ROW_SWITCHES = [
  "glovesWatertightVisual",
  "glovesDimensions",
  "glovesPhysical",
  "glovesWeight",
  "innerUnitsDispensing",
] as const satisfies readonly (keyof SamplingSize)[];
export type RowSwitch = (typeof ROW_SWITCHES)[number];

export const SamplingPlanDataSchema = perSizeData(SamplingSizeSchema).extend({
  rowsOff: z
    .array(z.enum(ROW_SWITCHES))
    .optional()
    .describe("Test rows the inspector switched off on screen. Never set from a document."),
});
export type SamplingPlanData = z.infer<typeof SamplingPlanDataSchema>;

export function isRowSwitch(column: string): column is RowSwitch {
  return (ROW_SWITCHES as readonly string[]).includes(column);
}

/** The test rows switched off. */
export function rowsOff(data: SamplingPlanData): ReadonlySet<RowSwitch> {
  return new Set(data.rowsOff ?? []);
}

/** `data` with one test row switched off or on; the same `data` when nothing changes. */
export function withRowOff(data: SamplingPlanData, column: RowSwitch, off: boolean): SamplingPlanData {
  const current = rowsOff(data);
  if (current.has(column) === off) return data;
  const next = ROW_SWITCHES.filter((entry) => (entry === column ? off : current.has(entry)));
  return { ...data, rowsOff: next };
}

export function emptySamplingPlan(): SamplingPlanData {
  return SamplingPlanDataSchema.parse({});
}

/** One size's row with nothing entered. */
export function emptySamplingSize(): SamplingSize {
  return SamplingSizeSchema.parse({});
}

/**
 * `data` with one count of one size set. Every other size is kept, also one
 * no longer ordered, so its data returns if the size is ordered again (6.2
 * rule 4). The same `data` when nothing changes.
 */
export function withCount(
  data: SamplingPlanData,
  size: string,
  column: keyof SamplingSize,
  value: number | null,
): SamplingPlanData {
  const row = data.sizes[size] ?? emptySamplingSize();
  if (row[column] === value) return data;
  return { ...data, sizes: { ...data.sizes, [size]: { ...row, [column]: value } } };
}
