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

/** What the inspector found for an item. Codes, labelled `status.<code>`. */
export const DOCUMENT_STATUSES = ["verified", "not_verified", "na"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);

/** Per item: what is entered (the file is an inspection_files row, uploaded by the screen). */
export const DOCUMENT_FIELDS = ["status", "referenceNo", "expiryDate"] as const;
export type DocumentField = (typeof DOCUMENT_FIELDS)[number];

type DocumentsLabelKey = DocumentField | "file" | "expired" | DocumentItem | `status.${DocumentStatus}`;

export const DOCUMENTS_LABELS: Readonly<Record<DocumentsLabelKey, string>> = {
  status: "Status",
  referenceNo: "Reference no.",
  expiryDate: "Expiry date",
  file: "File",
  expired: "Expired",
  certificateOfAnalysis: "Certificate of analysis",
  labTestReports: "Lab test reports",
  sterilisation: "Sterilisation certificate and records",
  iso13485: "ISO 13485",
  fdaCe: "FDA / CE certificates",
  declarationOfOrigin: "Declaration of origin",
  "status.verified": "Verified",
  "status.not_verified": "Not verified",
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
