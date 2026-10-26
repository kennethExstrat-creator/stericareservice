// Force At Break in Newton (BUILD_SPEC 6.1 force_at_break, EN 455): per
// ordered size, the force at break of each glove tested, read off the lab
// report. Only the readings are entered: their median and the result are
// computed (6.2 rule 2). Every value may be missing while the inspection is
// a draft.
import { z } from "zod";
import { DecimalCellSchema, LabReportsSchema, perSizeData, readingLabReports } from "@/modules/_framework";

export const ForceAtBreakSizeSchema = z.strictObject({
  /**
   * Newtons, glove 1 first; null for a glove not entered yet. One per glove
   * tested (the sampling plan's n, else config n): a reading past them is an
   * error, never silently dropped.
   */
  values: z.array(DecimalCellSchema).default([]),
});
export type ForceAtBreakSize = z.infer<typeof ForceAtBreakSizeSchema>;

export const ForceAtBreakDataSchema = readingLabReports(
  perSizeData(ForceAtBreakSizeSchema).extend({
    /**
     * The lab reports ('Refer to attached where applicable'), optional for
     * this module: each the id of its inspection_files row (kind lab_report),
     * which Steri-AI links from Source Documents, with the sizes it gives
     * results for; often one report per size (Kenneth, 26 October 2026). Data
     * saved with one `labReport` reads as a list of it, with no sizes.
     */
    labReports: LabReportsSchema,
  }),
);
export type ForceAtBreakData = z.infer<typeof ForceAtBreakDataSchema>;

export function emptyForceAtBreak(): ForceAtBreakData {
  return ForceAtBreakDataSchema.parse({});
}

export function emptyForceAtBreakSize(): ForceAtBreakSize {
  return ForceAtBreakSizeSchema.parse({});
}
