// Weight (BUILD_SPEC 6.1 weight): per ordered size, the weight of each glove
// weighed, in g. Every value may be missing while the inspection is a draft;
// the average and the deviation from the indicative weight are computed.
import { z } from "zod";
import { DecimalCellSchema, perSizeData } from "@/modules/_framework";

export const WeightSizeSchema = z.strictObject({
  /** Grams, glove 1 first: the size's n values (glovesFor: the gloves for dimension, 13 on STD_EG; 1 on SAFEDON_EG). */
  values: z.array(DecimalCellSchema).default([]),
});
export type WeightSize = z.infer<typeof WeightSizeSchema>;

export const WeightDataSchema = perSizeData(WeightSizeSchema);
export type WeightData = z.infer<typeof WeightDataSchema>;

export function emptyWeight(): WeightData {
  return WeightDataSchema.parse({});
}
