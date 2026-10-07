// Defaults a template can override: the heading, the labels (the data
// dictionary's wording: no current form has this checklist, it comes from the
// QC scope on the website) and the config (BUILD_SPEC 6.1: items on/off and
// required).
import { z } from "zod";

export const DOCUMENTS_TITLE = "Documents";

/** The checklist in default screen order (BUILD_SPEC 6.1). Each key is also the item's label key. */
export const DOCUMENT_ITEMS = [
  "certificateOfAnalysis",
  "labTestReports",
  "sterilisation",
  "iso13485",
  "fdaCe",
  "declarationOfOrigin",
] as const;
export type DocumentItem = (typeof DOCUMENT_ITEMS)[number];
export const DocumentItemSchema = z.enum(DOCUMENT_ITEMS);

/**
 * The inspection_files kind (BUILD_SPEC 5) of a file attached to an item, for
 * the screen that uploads it while the item is in focus.
 */
export const DOCUMENT_FILE_KIND: Readonly<Record<DocumentItem, "lab_report" | "certificate" | "other">> = {
  certificateOfAnalysis: "certificate",
  labTestReports: "lab_report",
  sterilisation: "certificate",
  iso13485: "certificate",
  fdaCe: "certificate",
  declarationOfOrigin: "certificate",
};

/** What the inspector found for an item. Codes, labelled `status.<code>`. */
export const DOCUMENT_STATUSES = ["verified", "not_verified", "na"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);

/** Per item: what is entered; the file as the id of the inspection_files row the screen uploaded. */
export const DOCUMENT_FIELDS = ["status", "referenceNo", "expiryDate", "file"] as const;
export type DocumentField = (typeof DOCUMENT_FIELDS)[number];

type DocumentsLabelKey =
  | DocumentField
  | "expired"
  | "itemStatus"
  | "counts"
  | "fileState"
  | "required"
  | DocumentItem
  | `status.${DocumentStatus}`;

export const DOCUMENTS_LABELS: Readonly<Record<DocumentsLabelKey, string>> = {
  status: "Status",
  referenceNo: "Reference No.",
  expiryDate: "Expiry Date",
  file: "File",
  expired: "Expired",
  itemStatus: "Item Result",
  counts: "Items per Status",
  fileState: "File Status",
  required: "Required",
  certificateOfAnalysis: "Certificate of Analysis",
  labTestReports: "Lab Test Reports",
  sterilisation: "Sterilisation Certificate and Records",
  iso13485: "ISO 13485",
  fdaCe: "FDA / CE Certificates",
  declarationOfOrigin: "Declaration of Origin",
  "status.verified": "Verified",
  "status.not_verified": "Not Verified",
  "status.na": "NA",
};

const DocumentItemConfigSchema = z.strictObject({
  key: DocumentItemSchema.describe("The document"),
  include: z.boolean().describe("On the checklist"),
  required: z.boolean().describe("Must be verified: not verified or NA fails the module"),
});
export type DocumentItemConfig = z.infer<typeof DocumentItemConfigSchema>;

export const DocumentsConfigSchema = z.strictObject({
  items: z
    .array(DocumentItemConfigSchema)
    .superRefine((items, context) => {
      const seen = new Set<DocumentItem>();
      items.forEach((item, index) => {
        if (seen.has(item.key)) {
          context.addIssue({ code: "custom", message: `${item.key} is listed twice.`, path: [index, "key"] });
        }
        seen.add(item.key);
      });
    })
    .describe("Documents on the checklist, in screen order: on or off, and required or not"),
});
export type DocumentsConfig = z.infer<typeof DocumentsConfigSchema>;

export const DOCUMENTS_DEFAULT_CONFIG: DocumentsConfig = {
  items: DOCUMENT_ITEMS.map((key) => ({ key, include: true, required: false })),
};

/** The items the template shows, in its order; `required` counts only for these. */
export function checklist(config: DocumentsConfig): DocumentItemConfig[] {
  return config.items.filter((item) => item.include);
}
