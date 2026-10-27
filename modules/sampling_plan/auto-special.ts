// Auto Calculate Sampling's tests at the special level (Kenneth, 27 October
// 2026: "for dimension and FAB, use Special Inspection Level S2, based on
// total lot size of each size, so both general inspection and special
// inspection is in use. for packaging and inspection, number of inner box
// sampled is also Level S2, based on total innerbox of that size (carton x
// inner box per carton)"). Dimension and FAB take the sample size of the code
// letter of the size's lot in gloves (lotSizeGloves) at the special level in
// force (calc's resolveSpecialInspectionLevel: the inspection's, else the
// template's, else S-2); Packaging & Dispensing that of its lot in inner
// boxes, its order cases × the packing configuration's inner boxes per case.
// A lot over 35,000 gloves at S-2 is code E, 13 gloves; 1,180 cases of 10
// inner boxes, 11,800 inner boxes, is code D, 8. Never more than the lot
// (docs/AQL.md rule 8). Only the rows the template shows and the inspector
// has not switched off; a size whose lot is not known keeps its count, and
// Auto Calculate's notice names it (auto-gloves.ts autoCalculateNotice).
import type { SpecialInspectionLevel } from "@/lib/aql";
import type { InspectionContext } from "@/modules/_framework";
import { NEEDS_LOT_SIZE, type LeftRow } from "./auto-gloves";
import { samplesAtLevel, type LevelSamples } from "./code-letters";
import { shownColumns, type SamplingPlanConfig } from "./config";
import { rowsOff, SPECIAL_ROWS, type SamplingPlanData, type SpecialRow } from "./schema";

/** What a special row's lot counts: Dimension and FAB sample the size's gloves, Packaging & Dispensing its inner boxes. */
export type LotUnit = "gloves" | "innerBoxes";
export const SPECIAL_ROW_LOTS: Readonly<Record<SpecialRow, LotUnit>> = {
  glovesDimensions: "gloves",
  glovesPhysical: "gloves",
  innerUnitsDispensing: "innerBoxes",
};

/** What Auto Calculate's notice says a row lacks, by its lot (autoCalculateNotice). */
export const LOT_NEEDS: Readonly<Record<LotUnit, string>> = {
  gloves: NEEDS_LOT_SIZE,
  innerBoxes: "the inner boxes per case",
};

/**
 * A size's lot in inner boxes: its order cases × the packing configuration's
 * inner boxes per case; null until both are known.
 */
export function lotSizeInnerBoxes(context: Pick<InspectionContext, "order" | "packing">, size: string): number | null {
  const cases = context.order[size]?.qtyCases ?? null;
  const perCase = context.packing.innersPerCase;
  return cases === null || perCase === null ? null : cases * perCase;
}

/**
 * The special rows Auto Calculate Sampling fills: those the template shows
 * (shownColumns) and the inspector has not switched off (rowsOff), in table
 * order. A row switched off keeps whatever it holds.
 */
export function specialRowsToFill(config: SamplingPlanConfig, data: Pick<SamplingPlanData, "rowsOff">): SpecialRow[] {
  const shown: readonly string[] = shownColumns(config);
  const off = rowsOff(data);
  return SPECIAL_ROWS.filter((row) => shown.includes(row) && !off.has(row));
}

/** An ordered size and its two lots, in gloves and in inner boxes; null until known. */
export type SizeLots = { size: string; gloves: number | null; innerBoxes: number | null };

/** Auto Calculate Sampling's counts for the special rows it fills. */
export type SpecialSamples = {
  /** Per row filled, each size's count, for the sizes whose lot is known. */
  counts: Partial<Record<SpecialRow, Record<string, number>>>;
  /** Per row filled, the sizes whose lot is not known, in order: their counts are left as they are. */
  unknownLot: Partial<Record<SpecialRow, string[]>>;
};

export const NO_SPECIAL_SAMPLES: SpecialSamples = { counts: {}, unknownLot: {} };

/**
 * The counts of the special rows Auto Calculate Sampling fills (`rows`: those
 * the template shows and the inspector has not switched off) at the special
 * level, each from its lot (SPECIAL_ROW_LOTS).
 */
export function autoSampleSpecial(lots: readonly SizeLots[], level: SpecialInspectionLevel, rows: readonly SpecialRow[]): SpecialSamples {
  const byLot: Readonly<Record<LotUnit, LevelSamples>> = {
    gloves: samplesAtLevel(
      lots.map(({ size, gloves }) => ({ size, lot: gloves })),
      level,
    ),
    innerBoxes: samplesAtLevel(
      lots.map(({ size, innerBoxes }) => ({ size, lot: innerBoxes })),
      level,
    ),
  };
  const result: SpecialSamples = { counts: {}, unknownLot: {} };
  for (const row of SPECIAL_ROWS) {
    if (!rows.includes(row)) continue;
    const { counts, unknownLot } = byLot[SPECIAL_ROW_LOTS[row]];
    result.counts[row] = counts;
    if (unknownLot.length > 0) result.unknownLot[row] = unknownLot;
  }
  return result;
}

/**
 * The special rows Auto Calculate Sampling left for some sizes, for its
 * notice (autoCalculateNotice `rows`), in table order, each worded as the
 * table shows it (`shown`: "Packaging & Dispensing Inspection") with what it
 * lacks: "Packaging & Dispensing Inspection needs the inner boxes per case
 * for S: …".
 */
export function leftSpecialRows(unknownLot: SpecialSamples["unknownLot"], shown: (row: SpecialRow) => string): LeftRow[] {
  return SPECIAL_ROWS.flatMap((row) => {
    const sizes = unknownLot[row] ?? [];
    return sizes.length === 0 ? [] : [{ label: shown(row), needs: LOT_NEEDS[SPECIAL_ROW_LOTS[row]], sizes }];
  });
}
