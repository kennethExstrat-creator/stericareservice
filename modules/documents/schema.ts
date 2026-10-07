// Documents (BUILD_SPEC 6.1 documents): a checklist of certificates and
// reports. Per item the inspector records verified, not verified or NA, the
// reference no., the expiry date (from a date picker, 6.2 rule 3) and the
// file: an inspection_files row the screen uploads through the module's file
// slot, kept here by its id, since inspection_files says which module a file
// belongs to but not which item. Every value may be missing while the
// inspection is a draft.
import { z } from "zod";
import { DateCellSchema, FileIdCellSchema, TextCellSchema } from "@/modules/_framework";
import { DocumentStatusSchema, type DocumentItem } from "./config";

export const DocumentEntrySchema = z.strictObject({
  status: DocumentStatusSchema.nullable().default(null),
  /** Certificate or report number, as printed on the document. */
  referenceNo: TextCellSchema,
  /** `YYYY-MM-DD`. Compared with the inspection date: an earlier one warns. */
  expiryDate: DateCellSchema,
  /** The item's certificate or report: the id of its inspection_files row, the latest attached. */
  file: FileIdCellSchema,
});
export type DocumentEntry = z.infer<typeof DocumentEntrySchema>;

export function emptyDocumentEntry(): DocumentEntry {
  return DocumentEntrySchema.parse({});
}

const entry = () => DocumentEntrySchema.default(emptyDocumentEntry);

// Every item has a slot, whether the template shows it or not: switching an
// item off and on again keeps what was entered.
export const DocumentItemsSchema = z.strictObject({
  certificateOfAnalysis: entry(),
  labTestReports: entry(),
  sterilisation: entry(),
  iso13485: entry(),
  fdaCe: entry(),
  declarationOfOrigin: entry(),
} satisfies Record<DocumentItem, unknown>);

export const DocumentsDataSchema = z.strictObject({
  items: DocumentItemsSchema.default(() => DocumentItemsSchema.parse({})),
});
export type DocumentsData = z.infer<typeof DocumentsDataSchema>;

export function emptyDocuments(): DocumentsData {
  return DocumentsDataSchema.parse({});
}
