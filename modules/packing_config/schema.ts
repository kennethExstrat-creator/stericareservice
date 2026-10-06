// Packing configuration (BUILD_SPEC 6.1 packing_config): how many gloves go
// in an inner unit and how many inner units in a case, page 1 of both
// reports, plus the onsite forms' Packing Mode text. Counts are whole numbers
// (6.2 rule 1); every value may be missing while the inspection is a draft.
import { z } from "zod";
import { CountCellSchema, TextCellSchema } from "@/modules/_framework";

/**
 * TextCellSchema's limit (lib/validation/cells.ts). Saved data that fails the
 * schema cannot be shown or edited (invalid_data), so the Packing Mode field
 * takes no more and setPackingMode keeps no more.
 */
export const TEXT_MAX_LENGTH = 2000;

export const PackingConfigDataSchema = z.strictObject({
  /** Gloves in one inner unit: 200 per inner box, 125 per plastic pack. */
  glovesPerInner: CountCellSchema,
  /** Inner units in one case. */
  innersPerCase: CountCellSchema,
  /** As printed. Checked against glovesPerInner x innersPerCase, never replaced by it. */
  glovesPerCase: CountCellSchema,
  /** Free text as written on site; config.fields.packingMode shows it. */
  packingMode: TextCellSchema,
});
export type PackingConfigData = z.infer<typeof PackingConfigDataSchema>;

export function emptyPackingConfig(): PackingConfigData {
  return PackingConfigDataSchema.parse({});
}
