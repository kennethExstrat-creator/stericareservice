// Packaging Labeling Inspection (BUILD_SPEC 6.1 labeling): per ordered
// size, per level (inner unit, carton), how many boxes were inspected, which
// cartons they came from, and the defects found per check. Every value may
// be missing while the inspection is a draft.
import { z } from "zod";
import { CountCellSchema, perSizeData } from "@/modules/_framework";
import { LabelingCheckSchema } from "./config";

/** A count tapped on a stepper: a whole number from 0, never text (6.2 rule 1). */
const DefectCountSchema = z.number().int().min(0);

/** A carton number picked from the size's carton list (6.2 rule 7). */
const BoxNumberSchema = z.number().int().min(1);

export const LabelingLevelDataSchema = z.strictObject({
  /** Boxes inspected; null until the inspector records it (prefilled from config n on screen). */
  inspected: CountCellSchema,
  /**
   * The cartons the inspected boxes came from, in pick order. Optional: the
   * reports print only how many were inspected. Inner boxes may share a carton.
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
