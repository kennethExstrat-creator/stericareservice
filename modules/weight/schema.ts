// Weight (BUILD_SPEC 6.1 weight): per ordered size, one value, the size's
// average weight in g as the dimension sheet prints it (Kenneth, 26 October
// 2026). It may be missing while the inspection is a draft; the deviation
// from the indicative weight is computed.
import { z } from "zod";
import { DecimalCellSchema, perSizeData } from "@/modules/_framework";

export const WeightSizeSchema = z.strictObject({
  /**
   * Grams: one value, the size's average weight. An inspection saved before
   * 26 October 2026 holds one value per glove weighed (13 on STD_EG), glove 1
   * first: their average is the size's weight.
   */
  values: z
    .array(DecimalCellSchema)
    .default([])
    .describe("One value: the size's average weight in g, as a document prints it (a dimension sheet's Weight (g)), e.g. [3.4]"),
});
export type WeightSize = z.infer<typeof WeightSizeSchema>;

export const WeightDataSchema = perSizeData(WeightSizeSchema);
export type WeightData = z.infer<typeof WeightDataSchema>;

export function emptyWeight(): WeightData {
  return WeightDataSchema.parse({});
}
