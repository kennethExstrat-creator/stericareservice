// Freedom from Holes by watertight test (BUILD_SPEC 6.1 watertight): per
// ordered size, the gloves tested and the holes found by location. With the
// template's handSplit on (surgical gloves) the holes are kept per hand under
// `R` and `L`; the gloves tested and the limits stay per size. Every value may
// be missing while the inspection is a draft. Totals, code letters, limits
// and the result are computed (6.2 rule 2), never stored here.
import { z } from "zod";
import { CountCellSchema, perSizeData, TextCellSchema } from "@/modules/_framework";

/** A defect code (defect_codes.code), the key of every count: snake case. */
export const DefectCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, { error: "Defect codes are snake case, e.g. hole_finger." });

/** A count of holes or defects: tapped, so a whole number from 0, never text or a date (6.2 rules 1 and 3). */
export const DefectCountSchema = z.number().int().min(0);

/**
 * A defect the template's list does not have, in the inspector's words, with
 * its count. Saved unmapped and flagged for an admin (BUILD_SPEC 4.2 rule 4, 8).
 */
export const OneOffDefectSchema = z.strictObject({
  label: z.string().max(200).regex(/\S/, { error: "A defect not in the list needs a name." }),
  count: DefectCountSchema,
});
export type OneOffDefect = z.infer<typeof OneOffDefectSchema>;

/** What one hand (or the size, without a hand split) records. */
export const WatertightHandSchema = z.strictObject({
  /** Holes per location code from the template's list; a location never tapped has none. */
  holes: z.record(DefectCodeSchema, DefectCountSchema).default(() => ({})),
  /** Where the holes counted under "Other :" are (the reports' "Other :" row). */
  otherDescription: TextCellSchema,
  unmapped: z.array(OneOffDefectSchema).default(() => []),
});
export type WatertightHand = z.infer<typeof WatertightHandSchema>;

export const WatertightSizeSchema = WatertightHandSchema.extend({
  /** No. of sample tested: n for the AQL plan. Offered from the sampling plan, confirmed by the inspector. */
  tested: CountCellSchema,
  /** Right and left hands, with handSplit on: the holes go here instead of on the size. */
  R: WatertightHandSchema.optional(),
  L: WatertightHandSchema.optional(),
});
export type WatertightSize = z.infer<typeof WatertightSizeSchema>;

export const WatertightDataSchema = perSizeData(WatertightSizeSchema);
export type WatertightData = z.infer<typeof WatertightDataSchema>;

export function emptyWatertight(): WatertightData {
  return WatertightDataSchema.parse({});
}

export function emptyWatertightSize(): WatertightSize {
  return WatertightSizeSchema.parse({});
}

export function emptyWatertightHand(): WatertightHand {
  return WatertightHandSchema.parse({});
}
