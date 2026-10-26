import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { isSpreadsheetType, type SpreadsheetType } from "@/lib/photos/paths";
import { isZip, sniffSpreadsheet, sniffType, zipEntries } from "@/lib/photos/sniff";
import { DOCUMENT_MEDIA_TYPES, type DocumentMediaType } from "@/lib/schemas/document-fill";
import { MAX_SPREADSHEET_BYTES, spreadsheetText } from "@/lib/spreadsheets/read";

/*
 * A document as Claude reads it, for both readers (docs/AI.md, "Reading
 * order documents" and "Source Documents"): a PDF or a photo as it is; an
 * Excel or CSV file as text (lib/spreadsheets/read.ts), since the Messages
 * API takes no spreadsheet: a plain-text document titled with the file's
 * name (Kenneth, 26 October 2026). The bytes decide what a file is, never
 * its name, but for a CSV, which has no first bytes of its own.
 */

/** A file as the readers send it: a PDF or a photo as base64, a spreadsheet as its text. */
export type DocumentFile =
  | { mediaType: Exclude<DocumentMediaType, SpreadsheetType>; base64: string; name: string }
  | { mediaType: "text/plain"; text: string; name: string };

/** A request holds at most 32 MB, and an image goes as at most 5 MB of base64. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3.75 * 1024 * 1024;

export const UNSUPPORTED_DOCUMENT = "Steri-AI reads PDFs, photos (JPEG or PNG), Excel and CSV files. Save this file as a PDF and upload it again.";

/**
 * What a document is, from its bytes (DOCUMENT_MEDIA_TYPES): a PDF, a photo,
 * an Excel workbook; a CSV by its text and its `name` or `declared` type (a
 * stored file's object name ends in .csv, the type it was uploaded as).
 * Null for anything else.
 */
export function documentTypeOf(bytes: Uint8Array, name: string, declared?: string): DocumentMediaType | null {
  const type = sniffSpreadsheet(bytes, declared, name, isZip(bytes) ? zipEntries(bytes) : null) ?? sniffType(bytes);
  return DOCUMENT_MEDIA_TYPES.find((media) => media === type) ?? null;
}

export type ReadableDocument = { ok: true; file: DocumentFile } | { ok: false; message: string };

/**
 * A document's bytes as Claude takes them, or why it cannot read them: a
 * type it reads (documentTypeOf, by `storedAs` for a stored file), within
 * its size for that type (a spreadsheet up to MAX_SPREADSHEET_BYTES, as a PDF
 * up to 20 MB), a spreadsheet as its text, titled `name`.
 */
export function readableDocument(
  bytes: Buffer,
  { name, storedAs = name, declared }: { name: string; storedAs?: string; declared?: string },
): ReadableDocument {
  const mediaType = documentTypeOf(bytes, storedAs, declared);
  if (!mediaType) return { ok: false, message: UNSUPPORTED_DOCUMENT };
  if (isSpreadsheetType(mediaType)) {
    if (bytes.length > MAX_SPREADSHEET_BYTES) {
      return { ok: false, message: "The file is too large for Steri-AI to read. Upload it in parts, a few sheets at a time." };
    }
    const text = spreadsheetText(bytes, mediaType);
    return text.ok ? { ok: true, file: { mediaType: "text/plain", text: text.value, name } } : text;
  }
  if (bytes.length > (mediaType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
    return { ok: false, message: "The file is too large for Steri-AI to read. Upload it in parts, a few pages at a time." };
  }
  return { ok: true, file: { mediaType, base64: bytes.toString("base64"), name } };
}

/** The file as Claude reads it: a PDF as a document, a photo as an image, a spreadsheet's text as a plain-text document named after the file. */
export function documentBlock(file: DocumentFile): BetaContentBlockParam {
  if (file.mediaType === "text/plain") {
    return { type: "document", source: { type: "text", media_type: "text/plain", data: file.text }, title: file.name };
  }
  return file.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } }
    : { type: "image", source: { type: "base64", media_type: file.mediaType, data: file.base64 } };
}
