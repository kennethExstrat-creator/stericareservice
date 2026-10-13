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
   * By row of the capture screen's table (Kenneth, 13 October 2026): index i
   * is row i + 1, the No. calc's messages name; a row left empty is null and
   * the empty rows at the end are not stored. Nothing moves up to close a
   * gap. A list saved before then, in the order entered without gaps, fills
   * rows 1 to n; one saved from the earlier 10 x 5 grid keeps its blanks in
   * their rows. Blanks are no cartons. The screen refuses a number another
   * row holds, but a list saved before may repeat one: duplicates are kept,
   * so that calc can point at them (6.2 rule 6).
   */
  cartonNumbers: z.array(CartonNumberCellSchema).max(MAX_CARTONS_PER_SIZE).default([]),
});
export type CartonSize = z.infer<typeof CartonSizeSchema>;

export const CartonSamplingDataSchema = perSizeData(CartonSizeSchema);
export type CartonSamplingData = z.infer<typeof CartonSamplingDataSchema>;

export function emptyCartonSampling(): CartonSamplingData {
  return CartonSamplingDataSchema.parse({});
}

/** The box/carton numbers entered, empty rows left out, in row order. */
export function enteredCartons(row: CartonSize | undefined): number[] {
  return (row?.cartonNumbers ?? []).filter((carton): carton is number => carton !== null);
}
