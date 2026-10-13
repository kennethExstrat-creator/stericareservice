// Packaging Labeling Inspection (BUILD_SPEC 6.1 labeling): per ordered
// size, per level (inner unit, carton), how many boxes were inspected, their
// box/carton numbers, and the defects found per check. Every value may be
// missing while the inspection is a draft.
import { z } from "zod";
import { BoxNumberSchema, CountCellSchema, perSizeData } from "@/modules/_framework";
import { LabelingCheckSchema } from "./config";

/** A count tapped on a stepper: a whole number from 0, never text (6.2 rule 1). */
const DefectCountSchema = z.number().int().min(0);

export const LabelingLevelDataSchema = z.strictObject({
  /** Boxes inspected; null until the inspector records it (prefilled from config n on screen). */
  inspected: CountCellSchema,
  /**
   * The box/carton numbers of the boxes inspected, in the order entered:
   * the size's sampled carton numbers (6.2 rule 7; Kenneth, 13 October 2026),
   * one the size's list does not hold stored as typed and warned about by
   * calc. Optional: the reports print only how many were inspected.
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
