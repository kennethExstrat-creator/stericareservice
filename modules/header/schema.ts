// Manufacturer Information (BUILD_SPEC 6.1 header): what the inspector enters
// on page 1 of both reports. The manufacturer and the client are the
// inspection's own (picked on /inspections/new) and the inspector is the
// logged-in user, so the header shows them from the context instead of
// keeping a second copy that could drift (6.2 rules 10 and 11). Every value
// may be missing while the inspection is a draft.
import { z } from "zod";
import { DateCellSchema, TextCellSchema } from "@/modules/_framework";

/**
 * TextCellSchema's limit (lib/validation/cells.ts). Saved data that fails the
 * schema cannot be shown or edited (invalid_data), so the fields take no more
 * and setText keeps no more.
 */
export const TEXT_MAX_LENGTH = 2000;

export const HeaderDataSchema = z.strictObject({
  /** Prefilled from the picked manufacturer's address. */
  factoryAddress: TextCellSchema,
  /** One value as printed: the PO with the SO or the client's reference in brackets, "PO-0001 (SO-0001)". */
  poNo: TextCellSchema,
  /** Brand, code and description as printed, up to two lines. */
  productName: TextCellSchema,
  /** The code on its own, entered once and used everywhere: export, report header, file names (rule 10). */
  productCode: TextCellSchema,
  factoryGloveCode: TextCellSchema,
  /** `YYYY-MM-DD` from a date picker (rule 3). Blank: the inspection row's date applies. */
  inspectionDate: DateCellSchema,
  /** With month precision (config.mfgExpiryPrecision), the first of the month. */
  mfgDate: DateCellSchema,
  expiryDate: DateCellSchema,
});
export type HeaderData = z.infer<typeof HeaderDataSchema>;

export const HEADER_TEXT_FIELDS = [
  "factoryAddress",
  "poNo",
  "productName",
  "productCode",
  "factoryGloveCode",
] as const satisfies readonly (keyof HeaderData)[];
export type HeaderTextField = (typeof HEADER_TEXT_FIELDS)[number];

export const HEADER_DATE_FIELDS = ["inspectionDate", "mfgDate", "expiryDate"] as const satisfies readonly (keyof HeaderData)[];
export type HeaderDateField = (typeof HEADER_DATE_FIELDS)[number];

export function emptyHeader(): HeaderData {
  return HeaderDataSchema.parse({});
}
