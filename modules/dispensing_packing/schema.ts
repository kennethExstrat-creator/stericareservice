// Glove Packing Check (BUILD_SPEC 6.1 dispensing_packing): per ordered size,
// one row per dispenser box, its box/carton number (6.2 rule 7; Kenneth, 13
// October 2026: one of the size's sampled carton numbers, typed or picked
// from the suggestions), with layering %, dispensing % and a stickiness
// code. Each size also has one aged sample (Kenneth, 26 October 2026: "each
// size has aged sample for packing check"): the same values as a box row,
// no box/carton number, and never one of the boxes. Whether the step has an
// aged sample at all is the inspector's answer to "Aged Sample?", one for
// every size (Kenneth, 30 October 2026: "no aged sample then turn it off and
// let the page complete"). Every value may be missing while the inspection
// is a draft. Averages, code letters and results are computed (rule 2),
// never stored here.
import { z } from "zod";
import { BoxNumberCellSchema, DecimalCellSchema, perSizeData, TextCellSchema } from "@/modules/_framework";

/** A stickiness code: "A", "B1". The template's codes are in config.stickinessCodes. */
export const STICKINESS_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;

export const PackingBoxSchema = z.strictObject({
  /** The box/carton number (rule 7), as typed: one the size's sampled list does not hold is calc's warning. */
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

/** The size's aged sample: a box row's values, with the same types and limits, and no box/carton number. */
export const PackingAgedSampleSchema = PackingBoxSchema.omit({ boxNo: true });
export type PackingAgedSample = z.infer<typeof PackingAgedSampleSchema>;

export const PackingSizeSchema = z.strictObject({
  /** In "Item" order: item 1 is boxes[0]. Blank rows are ignored. */
  boxes: z
    .array(PackingBoxSchema)
    .default([])
    .describe("One row per dispenser box tested, in the document's order. Never the aged sample: that is agedSample."),
  /** Optional: data saved before 26 October 2026 has none, and an emptied one is not saved. */
  agedSample: PackingAgedSampleSchema.optional().describe(
    "The size's aged sample: the packing row marked as aged (a remark such as \"Aged sample\"), usually with no box/carton number. One per size, never one of the boxes.",
  ),
});
export type PackingSize = z.infer<typeof PackingSizeSchema>;

/** The answers to "Aged Sample?". */
export const AGED_SAMPLE_ANSWERS = ["yes", "no"] as const;
export type AgedSampleAnswer = (typeof AGED_SAMPLE_ANSWERS)[number];

export const DispensingPackingDataSchema = perSizeData(PackingSizeSchema).extend({
  /**
   * "Aged Sample?" for the whole step (Kenneth, 30 October 2026). Unanswered
   * (absent or null, as data saved before holds) and "yes" expect every
   * size's aged sample; "no" turns it off: no size waits for one, and the
   * values saved in it are kept but not counted.
   */
  hasAgedSample: z
    .enum(AGED_SAMPLE_ANSWERS)
    .nullable()
    .optional()
    .describe("Whether the inspection has an aged sample, as the inspector answered on screen. Never set from a document."),
});
export type DispensingPackingData = z.infer<typeof DispensingPackingDataSchema>;

/** The inspector answered No to "Aged Sample?": no size waits for its aged sample, and what is saved in one is not counted. */
export function agedSampleOff(data: Pick<DispensingPackingData, "hasAgedSample">): boolean {
  return data.hasAgedSample === "no";
}

export function emptyDispensingPacking(): DispensingPackingData {
  return DispensingPackingDataSchema.parse({});
}

export function emptyPackingBox(): PackingBox {
  return PackingBoxSchema.parse({});
}

export function emptyAgedSample(): PackingAgedSample {
  return PackingAgedSampleSchema.parse({});
}

/** Nothing entered: the grid's empty rows, which count for nothing. */
export function isBlankPackingBox(box: PackingBox): boolean {
  return box.boxNo === null && isBlankAgedSample(box);
}

/** Nothing entered in the aged sample (or in a box row's values): none, as far as calc is concerned. */
export function isBlankAgedSample(sample: PackingAgedSample | undefined): boolean {
  return (
    sample === undefined ||
    (sample.layeringPct === null &&
      sample.dispensingPct === null &&
      sample.stickiness === null &&
      (sample.note === null || sample.note.trim() === ""))
  );
}
