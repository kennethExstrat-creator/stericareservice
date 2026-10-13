// Glove Dispensing Inspection (BUILD_SPEC 6.1 dispensing_safedon): per
// ordered size, one entry per box dispensed, its box/carton number (6.2 rule
// 7; Kenneth, 13 October 2026: one of the size's sampled carton numbers,
// typed or picked from the suggestions), with a count per Safedon
// dispensing defect. Counts are tapped, never typed (BUILD_SPEC 8): a defect
// not counted yet is absent and counts as 0, as the kit's CounterTable reads
// it. Totals, rates and results are computed (rule 2), never stored here.
import { z } from "zod";
import { BoxNumberCellSchema, CountCellSchema, perSizeData } from "@/modules/_framework";

/** A defect code (defect_codes.code): no_cuff, finger_out. */
export const DEFECT_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

export const SafedonBoxSchema = z.strictObject({
  /** The box/carton number (rule 7), as typed: one the size's sampled list does not hold is calc's warning. */
  boxNo: BoxNumberCellSchema,
  /** Defects counted in this box by defect code (config.defects); a code not counted yet is absent. */
  counts: z.record(z.string().regex(DEFECT_CODE_PATTERN), CountCellSchema).default({}),
});
export type SafedonBox = z.infer<typeof SafedonBoxSchema>;

export const SafedonSizeSchema = z.strictObject({
  /** Box columns in sheet order: column 1 is boxes[0]. Blank columns are ignored. */
  boxes: z.array(SafedonBoxSchema).default([]),
});
export type SafedonSize = z.infer<typeof SafedonSizeSchema>;

export const DispensingSafedonDataSchema = perSizeData(SafedonSizeSchema);
export type DispensingSafedonData = z.infer<typeof DispensingSafedonDataSchema>;

export function emptyDispensingSafedon(): DispensingSafedonData {
  return DispensingSafedonDataSchema.parse({});
}

export function emptySafedonBox(): SafedonBox {
  return SafedonBoxSchema.parse({});
}

/** A stored count as a number: not counted yet is 0. */
export function countOf(box: SafedonBox, code: string): number {
  return box.counts[code] ?? 0;
}

/** No box/carton number and nothing counted: an empty column of the sheet. */
export function isBlankSafedonBox(box: SafedonBox): boolean {
  return box.boxNo === null && Object.values(box.counts).every((count) => count === null || count === 0);
}
