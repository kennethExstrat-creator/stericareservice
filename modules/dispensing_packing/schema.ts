// Glove Packing Check (BUILD_SPEC 6.1 dispensing_packing): per ordered size,
// one row per dispenser box, its box number as the inspector types it (6.2
// rule 7: not a carton number), with layering %, dispensing % and a
// stickiness code. Every value may be missing while the inspection is a
// draft. Averages, code letters and results are computed (rule 2), never
// stored here.
import { z } from "zod";
import { BoxNumberCellSchema, DecimalCellSchema, perSizeData, TextCellSchema } from "@/modules/_framework";

/** A stickiness code: "A", "B1". The template's codes are in config.stickinessCodes. */
export const STICKINESS_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;

export const PackingBoxSchema = z.strictObject({
  /** The box's own number, typed (rule 7): a box picked from the carton list before 12 October 2026 reads as it was. */
  boxNo: BoxNumberCellSchema,
  /** %, 0 to 100 (88, not 0.88). */
  layeringPct: DecimalCellSchema,
  /** %, 0 to 100. */
  dispensingPct: DecimalCellSchema,
  /** One of config.stickinessCodes; calc reports a code the template does not have. */
  stickiness: z.string().regex(STICKINESS_CODE_PATTERN).nullable().default(null),
  /** The EG onsite form's "Others:" column. */
  note: TextCellSchema,
});
export type PackingBox = z.infer<typeof PackingBoxSchema>;

export const PackingSizeSchema = z.strictObject({
  /** In "Item" order: item 1 is boxes[0]. Blank rows are ignored. */
  boxes: z.array(PackingBoxSchema).default([]),
});
export type PackingSize = z.infer<typeof PackingSizeSchema>;

export const DispensingPackingDataSchema = perSizeData(PackingSizeSchema);
export type DispensingPackingData = z.infer<typeof DispensingPackingDataSchema>;

export function emptyDispensingPacking(): DispensingPackingData {
  return DispensingPackingDataSchema.parse({});
}

export function emptyPackingBox(): PackingBox {
  return PackingBoxSchema.parse({});
}

/** Nothing entered: the grid's empty rows, which count for nothing. */
export function isBlankPackingBox(box: PackingBox): boolean {
  return (
    box.boxNo === null &&
    box.layeringPct === null &&
    box.dispensingPct === null &&
    box.stickiness === null &&
    (box.note === null || box.note.trim() === "")
  );
}
