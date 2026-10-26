// Sampling Plan (BUILD_SPEC 6.1 sampling_plan): per ordered size, what was
// sampled and how many gloves or inner units each test takes. Every value may
// be missing while the inspection is a draft. The plan's code letter and n
// are computed (6.2 rule 2), never stored here, and so are the gloves taken
// per inner box and those put back (calc.ts). The inner units sampled in all
// are worked out from the cases while the inner units per case are entered
// (withCount; Kenneth, 27 October 2026). Sampling Settings (Kenneth, 27
// October 2026) keep two choices for the inspection beside the sizes: its
// inspection level and how Auto Calculate Sampling rounds the cases.
import { z } from "zod";
import { InspectionLevelSchema, type InspectionLevel } from "@/lib/aql";
import { CountCellSchema, perSizeData } from "@/modules/_framework";
import { innerUnitsFromCases } from "./inner-boxes";

export const SamplingSizeSchema = z.strictObject({
  /** Cases sampled. carton_sampling lists exactly this many box/carton numbers (6.2 rule 6). */
  cases: CountCellSchema,
  /**
   * Inner units taken from each sampled case, from 1 (Kenneth, 27 October
   * 2026). Optional: entered, innerUnits is cases × this; empty (data saved
   * before, a document that gives only the total), innerUnits is typed.
   */
  innerUnitsPerCase: z
    .number()
    .int()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      "Inner units taken from each sampled case, only where a document states the count per case. Never derived from a total: a total goes into innerUnits.",
    ),
  /**
   * Inner units sampled in all: inner boxes, plastic packs, dispenser boxes
   * or pouches (packing_config's inner unit). Cases × innerUnitsPerCase
   * while that is entered.
   */
  innerUnits: CountCellSchema.describe(
    "Inner units sampled for the size in all: the total a document gives, as the paper form's Sampling Plan does (Inner Box). The app works it out from cases and innerUnitsPerCase when both are entered.",
  ),
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
 * What Auto Calculate Sampling rounds each size's cases up to while Sampling
 * Settings say so (Kenneth, 27 October 2026: "round up to nearest 5 or 10,
 * which means 72 round to 75, 78 round to 80, not either 5 or 10"): the next
 * multiple of 5, the nearest 5 or 10 above.
 */
export const CASE_ROUNDING = 5;

/**
 * What `roundCasesTo` holds while the rounding is on: 5, as the switch saves
 * it, or 10, which the choice of 5 or 10 it replaced may have saved. Either
 * reads as on, and rounds to the nearest 5 or 10.
 */
const SAVED_ROUNDINGS = [CASE_ROUNDING, 10] as const;

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
    .literal(SAVED_ROUNDINGS)
    .optional()
    .describe(
      "Set while Auto Calculate Sampling rounds each size's cases up to the nearest 5 or 10, as the inspector switched on screen. Never set from a document.",
    ),
});
export type SamplingPlanData = z.infer<typeof SamplingPlanDataSchema>;

/** The inspection's Sampling Settings (Kenneth, 27 October 2026). */
export type SamplingSettings = {
  /** The level set for this inspection; null for the default (calc's resolveInspectionLevel). */
  inspectionLevel: InspectionLevel | null;
  /** Auto Calculate Sampling rounds each size's cases up to the nearest 5 or 10 (CASE_ROUNDING). */
  roundCases: boolean;
};

export function samplingSettings(data: SamplingPlanData): SamplingSettings {
  return { inspectionLevel: data.inspectionLevel ?? null, roundCases: data.roundCasesTo !== undefined };
}

/**
 * `data` with the settings saved: a level that is null leaves the data, so
 * the inspection is back on the default level; the rounding switched on is
 * saved as `roundCasesTo` 5, switched off it leaves the data. The counts
 * stay as they are. The same `data` when nothing changes.
 */
export function withSamplingSettings(data: SamplingPlanData, settings: SamplingSettings): SamplingPlanData {
  const current = samplingSettings(data);
  if (current.inspectionLevel === settings.inspectionLevel && current.roundCases === settings.roundCases) return data;
  const next: SamplingPlanData = { ...data };
  delete next.inspectionLevel;
  delete next.roundCasesTo;
  if (settings.inspectionLevel !== null) next.inspectionLevel = settings.inspectionLevel;
  if (settings.roundCases) next.roundCasesTo = CASE_ROUNDING;
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
 * rule 4). While the size's inner units per case are entered, setting them
 * or its cases (by hand or by Auto Calculate Sampling) writes cases × per
 * case into innerUnits, null while the cases are empty; emptying them keeps
 * the total as it is, to be typed again (Kenneth, 27 October 2026). The
 * same `data` when nothing changes.
 */
export function withCount(
  data: SamplingPlanData,
  size: string,
  column: keyof SamplingSize,
  value: number | null,
): SamplingPlanData {
  const row = data.sizes[size] ?? emptySamplingSize();
  if (row[column] === value) return data;
  const next: SamplingSize = { ...row, [column]: value };
  if ((column === "cases" || column === "innerUnitsPerCase") && next.innerUnitsPerCase !== null) {
    next.innerUnits = innerUnitsFromCases(next.cases, next.innerUnitsPerCase);
  }
  return { ...data, sizes: { ...data.sizes, [size]: next } };
}

/**
 * `data` with Auto Calculate Sampling's counts in (Capture.tsx): each size's
 * cases, then its gloves where it has a number for them (auto-gloves.ts: a
 * size whose lot is not known keeps its own). Through withCount, so a total
 * of inner units worked out from the cases follows them.
 */
export function withAutoSampling(
  data: SamplingPlanData,
  sizes: readonly string[],
  cases: Readonly<Record<string, number>>,
  gloves: Readonly<Record<string, number>>,
): SamplingPlanData {
  return sizes.reduce((next, size) => {
    const withCases = withCount(next, size, "cases", cases[size] ?? null);
    const count = gloves[size];
    return count === undefined ? withCases : withCount(withCases, size, "gloves", count);
  }, data);
}

/**
 * `data` with each empty total of inner units worked out where the size's
 * cases and inner units per case are entered, as withCount would: for a
 * reading that gives the count per case (Steri-AI never works a total out
 * itself; lib/inspections/source-documents.ts). A total that holds a number
 * stays (calc warns when it is not cases × per case). The same `data` when
 * nothing changes.
 */
export function withWorkedInnerUnits(data: SamplingPlanData): SamplingPlanData {
  let sizes: Record<string, SamplingSize> | null = null;
  for (const [size, row] of Object.entries(data.sizes)) {
    const worked = innerUnitsFromCases(row.cases, row.innerUnitsPerCase);
    if (worked === null || row.innerUnits !== null) continue;
    sizes ??= { ...data.sizes };
    sizes[size] = { ...row, innerUnits: worked };
  }
  return sizes === null ? data : { ...data, sizes };
}
