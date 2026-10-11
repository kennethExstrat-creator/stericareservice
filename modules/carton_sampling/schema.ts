// Finished Goods Sampling Information (BUILD_SPEC 6.1 carton_sampling): per
// ordered size, the numbers of the cartons sampled. The count is computed
// (6.2 rule 2) and checked against the sampling plan, never stored. The
// edits the capture screen makes are in edit.ts.
import { z } from "zod";
import { CartonNumberCellSchema, perSizeData } from "@/modules/_framework";

/** More than any sampling plan takes: the largest ISO 2859-1 sample is 2,000. */
export const MAX_CARTONS_PER_SIZE = 2000;

export const CartonSizeSchema = z.strictObject({
  /**
   * In the order entered. The capture screen stores them without gaps; a list
   * saved from the earlier 10 x 5 grid may hold blanks (null) between its
   * numbers, which are no cartons and still read. Duplicates are kept so that
   * calc can point at them (6.2 rule 6).
   */
  cartonNumbers: z.array(CartonNumberCellSchema).max(MAX_CARTONS_PER_SIZE).default([]),
});
export type CartonSize = z.infer<typeof CartonSizeSchema>;

export const CartonSamplingDataSchema = perSizeData(CartonSizeSchema);
export type CartonSamplingData = z.infer<typeof CartonSamplingDataSchema>;

export function emptyCartonSampling(): CartonSamplingData {
  return CartonSamplingDataSchema.parse({});
}

/** The carton numbers entered, blanks left out, in the order stored. */
export function enteredCartons(row: CartonSize | undefined): number[] {
  return (row?.cartonNumbers ?? []).filter((carton): carton is number => carton !== null);
}
