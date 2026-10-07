// Glove Information (BUILD_SPEC 6.1 glove_info): four values from page 1 of
// both reports. Every value may be missing while the inspection is a draft.
import { z } from "zod";
import { DecimalCellSchema, TextCellSchema } from "@/modules/_framework";

/**
 * TextCellSchema's limit (lib/validation/cells.ts). Saved data that fails the
 * schema cannot be shown or edited (invalid_data), so the fields take no more
 * and setText keeps no more.
 */
export const TEXT_MAX_LENGTH = 2000;

export const GLOVE_INFO_TEXT_FIELDS = ["surfaceTexture", "colour", "length"] as const;
export type GloveInfoTextField = (typeof GLOVE_INFO_TEXT_FIELDS)[number];

export const GloveInfoDataSchema = z.strictObject({
  /** "Finger-textured". */
  surfaceTexture: TextCellSchema,
  /** Grams, for the size in config.indicativeWeightSize (M on both reports). Weight compares against it. */
  indicativeWeight: DecimalCellSchema,
  colour: TextCellSchema,
  /** As printed: "240 mm minimum". Text, not a measurement: dimensions measures length. */
  length: TextCellSchema,
});
export type GloveInfoData = z.infer<typeof GloveInfoDataSchema>;

export function emptyGloveInfo(): GloveInfoData {
  return GloveInfoDataSchema.parse({});
}
