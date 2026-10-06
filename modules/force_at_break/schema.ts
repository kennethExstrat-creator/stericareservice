// Force At Break in Newton (BUILD_SPEC 6.1 force_at_break, EN 455): per
// ordered size, the force at break of each glove tested, read off the lab
// report. Only the readings are entered: their median and the result are
// computed (6.2 rule 2). Every value may be missing while the inspection is
// a draft.
import { z } from "zod";
import { DecimalCellSchema, perSizeData } from "@/modules/_framework";

export const ForceAtBreakSizeSchema = z.strictObject({
  /**
   * Newtons, glove 1 first; null for a glove not entered yet. One per glove
   * tested (the sampling plan's n, else config n): a reading past them is an
   * error, never silently dropped.
   */
  values: z.array(DecimalCellSchema).default([]),
});
export type ForceAtBreakSize = z.infer<typeof ForceAtBreakSizeSchema>;

export const ForceAtBreakDataSchema = perSizeData(ForceAtBreakSizeSchema).extend({
  /**
   * The lab report ('Refer to attached where applicable'): the id of its
   * inspection_files row (kind lab_report, module force_at_break), which the
   * capture screen sets when it queues the upload. Optional for this module.
   */
  labReport: z.uuid().nullable().default(null),
});
export type ForceAtBreakData = z.infer<typeof ForceAtBreakDataSchema>;

export function emptyForceAtBreak(): ForceAtBreakData {
  return ForceAtBreakDataSchema.parse({});
}

export function emptyForceAtBreakSize(): ForceAtBreakSize {
  return ForceAtBreakSizeSchema.parse({});
}
