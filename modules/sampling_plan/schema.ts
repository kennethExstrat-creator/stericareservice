// Sampling Plan (BUILD_SPEC 6.1 sampling_plan): per ordered size, what was
// sampled and how many gloves or inner units each test takes. Every value may
// be missing while the inspection is a draft. The plan's code letter and n
// are computed (6.2 rule 2), never stored here. Sampling Settings (Kenneth,
// 27 October 2026) keep two choices for the inspection beside the sizes: its
// inspection level and how Auto Calculate Sampling rounds the cases.
import { z } from "zod";
import { InspectionLevelSchema, type InspectionLevel } from "@/lib/aql";
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

/**
 * What Auto Calculate Sampling may round each size's cases up to (Kenneth,
 * 27 October 2026: "round up to nearest tenth or five"): the next multiple of
 * 5 or of 10.
 */
export const CASE_ROUNDINGS = [5, 10] as const;
export type CaseRounding = (typeof CASE_ROUNDINGS)[number];

export const SamplingPlanDataSchema = perSizeData(SamplingSizeSchema).extend({
  rowsOff: z
    .array(z.enum(ROW_SWITCHES))
    .optional()
    .describe("Test rows the inspector switched off on screen. Never set from a document."),
  // Saved before Sampling Settings (27 October 2026), the data has neither: the default level, no rounding.
  inspectionLevel: InspectionLevelSchema.optional().describe(
    'The ISO 2859-1 inspection level set for this inspection, in place of the template\'s or the client\'s. Fill it only from a document that states the level in words, such as "General Inspection Level II" (II) or "Special Inspection Level S-3" (S-3); never work it out from code letters, sample sizes or lot sizes.',
  ),
  roundCasesTo: z
    .literal(CASE_ROUNDINGS)
    .optional()
    .describe("Auto Calculate Sampling rounds each size's cases up to a multiple of this, as the inspector set on screen. Never set from a document."),
});
export type SamplingPlanData = z.infer<typeof SamplingPlanDataSchema>;

/** The inspection's Sampling Settings (Kenneth, 27 October 2026); null where it keeps none. */
export type SamplingSettings = {
  /** The level set for this inspection; null for the default (calc's resolveInspectionLevel). */
  inspectionLevel: InspectionLevel | null;
  /** The multiple Auto Calculate Sampling rounds each size's cases up to; null for no rounding. */
  roundCasesTo: CaseRounding | null;
};

export function samplingSettings(data: SamplingPlanData): SamplingSettings {
  return { inspectionLevel: data.inspectionLevel ?? null, roundCasesTo: data.roundCasesTo ?? null };
}

/**
 * `data` with the settings saved: a setting that is null leaves the data, so
 * the inspection is back on the default level, or rounds nothing. The counts
 * stay as they are. The same `data` when nothing changes.
 */
export function withSamplingSettings(data: SamplingPlanData, settings: SamplingSettings): SamplingPlanData {
  const current = samplingSettings(data);
  if (current.inspectionLevel === settings.inspectionLevel && current.roundCasesTo === settings.roundCasesTo) return data;
  const next: SamplingPlanData = { ...data };
  delete next.inspectionLevel;
  delete next.roundCasesTo;
  if (settings.inspectionLevel !== null) next.inspectionLevel = settings.inspectionLevel;
  if (settings.roundCasesTo !== null) next.roundCasesTo = settings.roundCasesTo;
  return next;
}

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
