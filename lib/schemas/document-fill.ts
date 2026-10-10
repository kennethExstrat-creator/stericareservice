// Reading an order document on /inspections/new (docs/AI.md, "Reading order
// documents"): what Claude reads from an uploaded file, and what the form
// posts on to the new inspection. Client-safe.
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { IsoDateSchema, ProductTypeSchema } from "./common";

/** What the reader accepts: PDFs as they are; photos are turned into JPEG in the browser first. */
export const DOCUMENT_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type DocumentMediaType = (typeof DOCUMENT_MEDIA_TYPES)[number];

/** Vercel caps a request at 4.5 MB, so a file stays under 4 MB. */
export const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;

const text = (description: string) => z.string().nullable().describe(description);

/** Claude's answer (structured output). A field the document does not give is null. */
export const DocumentReadingSchema = z.object({
  clientId: text("The id of the client in the client list that the document's client (buyer, customer, consignee) matches; null when none matches."),
  clientName: text("The client (buyer, customer, consignee) as printed."),
  manufacturerId: text("The id of the manufacturer in the manufacturer list that the document's manufacturer, supplier or factory matches; null when none matches."),
  manufacturerName: text("The manufacturer, supplier or factory as printed."),
  productType: ProductTypeSchema.nullable().describe(
    "examination for disposable examination gloves (counted in pieces), surgical for sterile surgical gloves (counted in pairs).",
  ),
  productName: text("Brand, product code and description as printed, on one line."),
  productCode: text("The product, item or article code on its own."),
  factoryGloveCode: text("The factory's own glove code, when printed separately from the product code."),
  poNo: text("The purchase order number; with the sales order or client reference in brackets when both are printed: PO-0001 (SO-0001)."),
  mfgDate: text("Manufacturing date as YYYY-MM-DD; the first of the month when only month and year are printed."),
  expiryDate: text("Expiry date as YYYY-MM-DD; the first of the month when only month and year are printed."),
  sizes: z
    .array(
      z.object({
        size: z.string().describe("The glove size: XS, S, M, L, XL, XXL, or 5.5 to 9.0."),
        qtyCases: z
          .number()
          .nullable()
          .describe("Cases (cartons) ordered of this size; null when the document gives no case count."),
        lotNumbers: z.array(z.string()).describe("Lot or batch numbers of this size, as printed."),
      }),
    )
    .describe("One entry per size ordered."),
  notes: text("One or two plain sentences on anything unclear or not matched; null when all is clear."),
});
export type DocumentReading = z.infer<typeof DocumentReadingSchema>;

const HeaderTextSchema = z.string().trim().min(1).max(2000).nullable();

/** What the form posts with Create: the values that go into the new inspection's header and order. */
export const DocumentFillSchema = z.object({
  fileName: z.string().max(255),
  header: z.object({
    poNo: HeaderTextSchema,
    productCode: HeaderTextSchema,
    factoryGloveCode: HeaderTextSchema,
    mfgDate: IsoDateSchema.nullable(),
    expiryDate: IsoDateSchema.nullable(),
  }),
  sizes: z.record(
    CanonicalSizeSchema,
    z.object({
      qtyCases: z.number().int().min(0).max(1_000_000).nullable(),
      lotNumbers: z.array(z.string().trim().min(1).max(200)).max(50),
    }),
  ),
});
export type DocumentFill = z.infer<typeof DocumentFillSchema>;
export type DocumentHeaderField = keyof DocumentFill["header"];

/** The new-inspection form's own fields, as the document filled them. */
export type DocumentFormFields = {
  clientId: string | null;
  clientName: string | null;
  manufacturerId: string | null;
  manufacturerName: string | null;
  productType: z.infer<typeof ProductTypeSchema> | null;
  productName: string | null;
};

export type DocumentReadResult =
  | { status: "read"; fileName: string; form: DocumentFormFields; fill: DocumentFill; notes: string | null }
  | { status: "error"; message: string };
