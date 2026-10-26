import type { Database } from "@/lib/supabase/database.types";
import { FILE_SIZE_LIMIT, FILE_TYPES, extensionFor } from "./paths";
import { detectType, isZip, zipEntries } from "./sniff";

/* ------------------------------------------------------------------ *
 * Lab reports and certificates (BUILD_SPEC 8.1): PDF or image, uploaded
 * as they are to inspection-files. Only checked, never converted: a
 * certificate must stay the document the lab issued. Source Documents
 * also take Excel and CSV files (Kenneth, 26 October 2026), stored as
 * they are with their own type, which the bucket must accept.
 * ------------------------------------------------------------------ */

export type InspectionFileKind = Database["public"]["Enums"]["inspection_file_kind"];

export interface PreparedFile {
  blob: Blob;
  /** Shown in lists (inspection_files.name). */
  name: string;
  mimeType: string;
  extension: string;
}

export type PrepareFileResult =
  | { ok: true; file: PreparedFile }
  | { ok: false; reason: "empty" | "unsupported" | "too_large"; message: string };

const MAX_NAME_LENGTH = 200;
/** A CSV is told by its first 64 kB being text. */
const HEAD_BYTES = 64 * 1024;
/** A zip lists its entries at its end (an .xlsx's: a few kilobytes). */
const TAIL_BYTES = 1024 * 1024;

export async function prepareFile(file: Blob & { readonly name?: string }): Promise<PrepareFileResult> {
  if (file.size === 0) return { ok: false, reason: "empty", message: "The file is empty." };
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const tailStart = Math.max(0, file.size - TAIL_BYTES);
  const entries = isZip(head) ? zipEntries(new Uint8Array(await file.slice(tailStart).arrayBuffer()), tailStart) : null;
  const type = detectType(head, file.type, file.name, entries);
  const extension = type && (FILE_TYPES as readonly string[]).includes(type) ? extensionFor(type) : null;
  if (!type || !extension) {
    return {
      ok: false,
      reason: "unsupported",
      message: "Files must be PDF, JPEG, PNG, WebP or HEIC, Excel (.xlsx or .xls) or CSV; videos MP4, MOV or WebM.",
    };
  }
  if (file.size > FILE_SIZE_LIMIT) {
    return { ok: false, reason: "too_large", message: "The file is larger than 50 MB." };
  }
  return {
    ok: true,
    file: { blob: new Blob([file], { type }), name: displayName(file.name, extension), mimeType: type, extension },
  };
}

/** The uploaded name without control characters, never blank (the column requires text). */
export function displayName(name: string | undefined, extension: string): string {
  const printable = Array.from(name ?? "")
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .join("")
    .trim();
  return (printable || `Document.${extension}`).slice(0, MAX_NAME_LENGTH);
}
