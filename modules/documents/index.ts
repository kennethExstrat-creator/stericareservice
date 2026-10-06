// Documents (BUILD_SPEC 6.1, optional): certificates and reports checked on site.
import { defineModule, type CanonicalPath } from "@/modules/_framework";
import { calcDocuments, type DocumentsComputed } from "./calc";
import {
  DOCUMENT_ITEMS,
  DOCUMENTS_DEFAULT_CONFIG,
  DOCUMENTS_LABELS,
  DOCUMENTS_TITLE,
  DocumentsConfigSchema,
  type DocumentsConfig,
} from "./config";
import { DocumentsDataSchema, emptyDocuments, type DocumentsData } from "./schema";

// A client form may ask for a certificate's number or expiry in its own section.
const canonicalPaths: CanonicalPath[] = DOCUMENT_ITEMS.flatMap((item) => [
  {
    path: `items.${item}.referenceNo`,
    label: `${DOCUMENTS_LABELS[item]}: ${DOCUMENTS_LABELS.referenceNo}`,
    type: "text",
  },
  {
    path: `items.${item}.expiryDate`,
    label: `${DOCUMENTS_LABELS[item]}: ${DOCUMENTS_LABELS.expiryDate}`,
    type: "date",
  },
]);

export const definition = defineModule<DocumentsData, DocumentsConfig, DocumentsComputed>({
  key: "documents",
  title: DOCUMENTS_TITLE,
  labels: DOCUMENTS_LABELS,
  dataSchema: DocumentsDataSchema,
  emptyData: emptyDocuments,
  configSchema: DocumentsConfigSchema,
  defaultConfig: DOCUMENTS_DEFAULT_CONFIG,
  canonicalPaths,
  calc: calcDocuments,
  loadCapture: () => import("./Capture"),
});

export { DOCUMENT_FILE_KIND } from "./config";
export type { DocumentEntry, DocumentsData } from "./schema";
export type { DocumentItem, DocumentItemConfig, DocumentsConfig, DocumentStatus } from "./config";
export type { DocumentsComputed } from "./calc";
