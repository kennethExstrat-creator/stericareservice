// Physical Properties (BUILD_SPEC 6.1 tensile, ASTM D6319): per ordered
// size, the lab report's tensile strength and elongation at break averages,
// typed as printed (the app holds no individual readings), and the lab
// report itself. Every value may be missing while the inspection is a draft.
import { z } from "zod";
import { DecimalCellSchema, perSizeData } from "@/modules/_framework";

export const TensileSizeSchema = z.strictObject({
  /** MPa (N/mm²): the lab report's average. */
  tensileStrength: DecimalCellSchema,
  /** %: the lab report's average, as a percentage (536, not 5.36). */
  elongationAtBreak: DecimalCellSchema,
});
export type TensileSize = z.infer<typeof TensileSizeSchema>;

export const TensileDataSchema = perSizeData(TensileSizeSchema).extend({
  /**
   * The lab report ('Refer to attached lab. reports'), required: the id of its
   * inspection_files row (kind lab_report, module tensile), which the capture
   * screen sets when it queues the upload. Further reports of the same module
   * are kept as files too.
   */
  labReport: z.uuid().nullable().default(null),
});
export type TensileData = z.infer<typeof TensileDataSchema>;

export function emptyTensile(): TensileData {
  return TensileDataSchema.parse({});
}

export function emptyTensileSize(): TensileSize {
  return TensileSizeSchema.parse({});
}
