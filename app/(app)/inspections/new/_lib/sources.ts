// New Inspection's Source Documents card (docs/AI.md, "Reading order
// documents"): what it holds before Create and how a reading fills the form.
// Nothing is stored before Create, since there is no inspection yet: the
// files stay in the browser. Steri-AI reads the documents one at a time, only
// until the client, manufacturer, product type and product name are filled,
// and a reading fills only what is still empty (the first answer wins). The
// header values and order lines of every document read go in with Create.
// Pure, so the rules are unit-tested without a browser.
import { mediaKind } from "@/lib/inspections/source-documents";
import { FILE_SIZE_LIMIT } from "@/lib/photos/paths";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MEDIA_TYPES,
  type DocumentFill,
  type DocumentFormFields,
  type DocumentReadResult,
} from "@/lib/schemas/document-fill";
import { HEADER_LABELS } from "@/modules/header/config";
import type { NewInspectionChoices } from "./draft";

export type DocumentRead = Extract<DocumentReadResult, { status: "read" }>;

/** Where a held document stands with this page's reader. */
export type ReadState =
  /** Its turn comes while the form still needs values. */
  | { step: "waiting" }
  | { step: "reading" }
  | { step: "read"; read: DocumentRead }
  | { step: "failed"; message: string }
  /** Not read here: the reader takes PDFs and photos up to 4 MB. Source Documents reads it after Create. */
  | { step: "later" };

/** A document held for the new inspection: a PDF as it is, a photo as 2048 px JPEG (lib/photos/readable.ts). */
export type HeldDocument = { key: string; file: File; url: string; state: ReadState };

/** A photo or video held for the new inspection's Auto-Sort. */
export type HeldMedia = { key: string; file: File; url: string; kind: "photo" | "video" };

const MB = 1024 * 1024;

/** Why a file stays off Files, or null when it may go on. */
export function documentRefusal(file: { type: string; name: string; size: number }): string | null {
  if (!isPdf(file) && mediaKind(file) !== "photo") return "Files takes PDFs and photos. Add videos under Media.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > FILE_SIZE_LIMIT) return `The file is larger than ${FILE_SIZE_LIMIT / MB} MB.`;
  return null;
}

/** Why a file stays off Media, or null when it may go on. */
export function mediaRefusal(file: { type: string; name: string; size: number }): string | null {
  const kind = mediaKind(file);
  if (kind === null) return "Media takes photos and videos. Add documents under Files.";
  if (file.size === 0) return "The file is empty.";
  if (kind === "video" && file.size > FILE_SIZE_LIMIT) return `The video is larger than ${FILE_SIZE_LIMIT / MB} MB.`;
  return null;
}

/** A PDF by its type, else by its name: some browsers give one no type. */
export function isPdf(file: { type: string; name: string }): boolean {
  return file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
}

/** Whether this page's reader takes the file as held: a type it reads, up to 4 MB (a request's limit). */
export function readsHere(file: { type: string; size: number }): boolean {
  return file.size <= DOCUMENT_MAX_BYTES && (DOCUMENT_MEDIA_TYPES as readonly string[]).includes(file.type);
}

/**
 * What the reader does next: nothing while a document is being read, else
 * the first document waiting, while the form still needs values. Documents
 * left waiting once the form is filled are read on Source Documents.
 */
export function nextToRead(documents: readonly HeldDocument[], needsValues: boolean): HeldDocument | null {
  if (!needsValues || documents.some((document) => document.state.step === "reading")) return null;
  return documents.find((document) => document.state.step === "waiting") ?? null;
}

/** The form's fields a reading fills: only those with nothing chosen or typed yet. */
export function formFill(choices: NewInspectionChoices, form: DocumentFormFields): Partial<NewInspectionChoices> {
  const change: Partial<NewInspectionChoices> = {};
  if (form.clientId && choices.clientId === "") change.clientId = form.clientId;
  if (form.manufacturerId && choices.manufacturerId === "") change.manufacturerId = form.manufacturerId;
  if (form.productType && choices.productType === null) change.productType = form.productType;
  if (form.productName && choices.productName.trim() === "") change.productName = form.productName;
  return change;
}

const HEADER_FIELDS = ["poNo", "productCode", "factoryGloveCode", "inspectionDate", "mfgDate", "expiryDate"] as const;

/**
 * The header values and order lines of every document read, in the order
 * they are held: the first answer wins, field by field and size by size.
 * Null with none read. The file names go to the audit log.
 */
export function mergeFills(reads: readonly DocumentRead[]): DocumentFill | null {
  if (reads.length === 0) return null;
  const header: DocumentFill["header"] = {
    poNo: null,
    productCode: null,
    factoryGloveCode: null,
    inspectionDate: null,
    mfgDate: null,
    expiryDate: null,
  };
  const sizes: DocumentFill["sizes"] = {};
  for (const { fill } of reads) {
    for (const field of HEADER_FIELDS) header[field] ??= fill.header[field];
    for (const [size, line] of Object.entries(fill.sizes)) {
      const current = sizes[size];
      sizes[size] = current
        ? {
            qtyCases: current.qtyCases ?? line.qtyCases,
            lotNumbers: current.lotNumbers.length > 0 ? current.lotNumbers : line.lotNumbers,
          }
        : line;
    }
  }
  return { fileName: reads.map((read) => read.fileName).join(", ").slice(0, 255), header, sizes };
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function day(iso: string): string {
  return DAY.format(new Date(`${iso}T00:00:00Z`));
}

/** What goes into the new inspection on Create, in the header's words: "PO / SO Number: 0001", "Size M: 20 cases · Lot L1". */
export function createLines(fill: DocumentFill | null): { label: string; value: string }[] {
  if (!fill) return [];
  const { header } = fill;
  const lines: { label: string; value: string }[] = [];
  for (const field of HEADER_FIELDS) {
    const value = header[field];
    if (value === null) continue;
    const dated = field === "inspectionDate" || field === "mfgDate" || field === "expiryDate";
    lines.push({ label: HEADER_LABELS[field], value: dated ? day(value) : value });
  }
  for (const [size, line] of Object.entries(fill.sizes)) {
    const parts = [
      line.qtyCases !== null ? `${line.qtyCases} ${line.qtyCases === 1 ? "case" : "cases"}` : null,
      line.lotNumbers.length > 0 ? `${line.lotNumbers.length === 1 ? "Lot" : "Lots"} ${line.lotNumbers.join(", ")}` : null,
    ].filter((part) => part !== null);
    if (parts.length > 0) lines.push({ label: `Size ${size}`, value: parts.join(" · ") });
  }
  return lines;
}
