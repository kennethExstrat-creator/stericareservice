// Dimension (BUILD_SPEC 6.1 dimensions): per ordered size, one row per glove
// with a reading in mm for each measure. Every reading may be missing while
// the inspection is a draft; the statistics are computed, never stored.
import { z } from "zod";
import { DecimalCellSchema, perSizeData } from "@/modules/_framework";

/** One glove's readings in mm. The template's `measures` decide which are shown and judged. */
export const DimensionGloveSchema = z.strictObject({
  length: DecimalCellSchema,
  width: DecimalCellSchema,
  fingerThickness: DecimalCellSchema,
  palmThickness: DecimalCellSchema,
  cuffThickness: DecimalCellSchema,
});
export type DimensionGlove = z.infer<typeof DimensionGloveSchema>;

export const DimensionSizeSchema = z.strictObject({
  /** Glove 1 first. Gloves past the size's n stay saved but are not counted. */
  gloves: z.array(DimensionGloveSchema).default([]),
});
export type DimensionSize = z.infer<typeof DimensionSizeSchema>;

export const DimensionsDataSchema = perSizeData(DimensionSizeSchema);
export type DimensionsData = z.infer<typeof DimensionsDataSchema>;

export function emptyDimensions(): DimensionsData {
  return DimensionsDataSchema.parse({});
}

export function emptyGlove(): DimensionGlove {
  return DimensionGloveSchema.parse({});
}
