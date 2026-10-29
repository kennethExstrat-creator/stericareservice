// Defaults a template can override: the heading, the field labels (STD_EG's
// wording) and the config (BUILD_SPEC 6.1: fields on/off). The manufacturer
// and the client are picked when the inspection is created (and changed on
// the capture screen's General Information) and the inspector is recorded by
// the app (6.2 rule 11), so their switches only show or hide the row.
import { z } from "zod";

export const HEADER_TITLE = "Manufacturer Information";

/** Every row of the header, in report order. */
export const HEADER_FIELDS = [
  "manufacturer",
  "factoryAddress",
  "poNo",
  "productName",
  "productCode",
  "client",
  "factoryGloveCode",
  "inspectionDate",
  "mfgDate",
  "expiryDate",
  "inspector",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

export const HEADER_LABELS: Readonly<Record<HeaderField, string>> = {
  manufacturer: "Manufacturer / Supplier",
  factoryAddress: "Supplier Factory Address / Location",
  poNo: "PO / SO Number",
  productName: "Product Name (Brand, Code & Description)",
  productCode: "Product Code",
  client: "Client Name",
  factoryGloveCode: "Factory Glove Code",
  inspectionDate: "Inspection Date",
  mfgDate: "Manufacturing Date",
  expiryDate: "Expiry Date",
  inspector: "Inspected By",
};

export const MFG_EXPIRY_PRECISIONS = ["day", "month"] as const;
export type MfgExpiryPrecision = (typeof MFG_EXPIRY_PRECISIONS)[number];

export const HeaderConfigSchema = z.strictObject({
  fields: z
    .strictObject({
      manufacturer: z.boolean(),
      factoryAddress: z.boolean(),
      poNo: z.boolean(),
      productName: z.boolean(),
      productCode: z.boolean(),
      client: z.boolean(),
      factoryGloveCode: z.boolean(),
      inspectionDate: z.boolean(),
      mfgDate: z.boolean(),
      expiryDate: z.boolean(),
      inspector: z.boolean(),
    })
    .describe("Fields shown on this template. The inspector is recorded even when its row is off."),
  mfgExpiryPrecision: z
    .enum(MFG_EXPIRY_PRECISIONS)
    .describe(
      "Manufacturing and expiry dates as a full date (day), or as month and year (month), stored as the first of the month.",
    ),
});
export type HeaderConfig = z.infer<typeof HeaderConfigSchema>;

export const HEADER_DEFAULT_CONFIG: HeaderConfig = {
  fields: {
    manufacturer: true,
    factoryAddress: true,
    poNo: true,
    productName: true,
    productCode: true,
    client: true,
    factoryGloveCode: true,
    inspectionDate: true,
    mfgDate: true,
    expiryDate: true,
    inspector: true,
  },
  mfgExpiryPrecision: "day",
};
