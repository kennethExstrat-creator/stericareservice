// Physical Properties (BUILD_SPEC 6.1 tensile, ASTM D6319): per ordered
// size, the lab report's tensile strength and elongation at break averages,
// typed as printed (the app holds no individual readings), and the lab
// reports themselves. Every value may be missing while the inspection is a
// draft.
import { z } from "zod";
import { DecimalCellSchema, LabReportsSchema, perSizeData, readingLabReports } from "@/modules/_framework";

export const TensileSizeSchema = z.strictObject({
  /** MPa (N/mm²): the lab report's average. */
  tensileStrength: DecimalCellSchema,
  /** %: the lab report's average, as a percentage (536, not 5.36). */
  elongationAtBreak: DecimalCellSchema,
});
export type TensileSize = z.infer<typeof TensileSizeSchema>;

export const TensileDataSchema = readingLabReports(
  perSizeData(TensileSizeSchema).extend({
    /**
     * The lab reports ('Refer to attached lab. reports'), at least one
     * required: each the id of its inspection_files row (kind lab_report),
     * which Steri-AI links from Source Documents, with the sizes it gives
     * results for; often one report per size (Kenneth, 26 October 2026). Data
     * saved with one `labReport` reads as a list of it, with no sizes.
     */
    labReports: LabReportsSchema,
  }),
);
export type TensileData = z.infer<typeof TensileDataSchema>;

export function emptyTensile(): TensileData {
  return TensileDataSchema.parse({});
}

export function emptyTensileSize(): TensileSize {
  return TensileSizeSchema.parse({});
}
