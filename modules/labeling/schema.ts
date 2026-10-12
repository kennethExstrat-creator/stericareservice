// Packaging Labeling Inspection (BUILD_SPEC 6.1 labeling): per ordered
// size, per level (inner unit, carton), how many boxes were inspected, their
// box numbers, and the defects found per check. Every value may be missing
// while the inspection is a draft.
import { z } from "zod";
import { BoxNumberSchema, CountCellSchema, perSizeData } from "@/modules/_framework";
import { LabelingCheckSchema } from "./config";

/** A count tapped on a stepper: a whole number from 0, never text (6.2 rule 1). */
const DefectCountSchema = z.number().int().min(0);

export const LabelingLevelDataSchema = z.strictObject({
  /** Boxes inspected; null until the inspector records it (prefilled from config n on screen). */
  inspected: CountCellSchema,
  /**
   * The box numbers of the boxes inspected, in the order typed: the
   * inspector's own numbers, not carton numbers (6.2 rule 7). Optional: the
   * reports print only how many were inspected. Numbers picked from the
   * carton list before 12 October 2026 read as they were.
   */
  boxNos: z.array(BoxNumberSchema).default([]),
  /** Defects found per check code; a check with no entry has none. */
  defects: z.partialRecord(LabelingCheckSchema, DefectCountSchema).default({}),
});
export type LabelingLevelData = z.infer<typeof LabelingLevelDataSchema>;

export const LabelingSizeDataSchema = z.strictObject({
  inner: LabelingLevelDataSchema.prefault({}),
  carton: LabelingLevelDataSchema.prefault({}),
});
export type LabelingSizeData = z.infer<typeof LabelingSizeDataSchema>;

export const LabelingDataSchema = perSizeData(LabelingSizeDataSchema);
export type LabelingData = z.infer<typeof LabelingDataSchema>;

export function emptyLabeling(): LabelingData {
  return LabelingDataSchema.parse({});
}

/** A size with nothing recorded yet, both levels empty. */
export function emptyLabelingSize(): LabelingSizeData {
  return LabelingSizeDataSchema.parse({});
}
