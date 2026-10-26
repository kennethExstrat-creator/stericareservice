// What a file really is, from its first bytes. iPadOS sometimes hands over
// HEIC photos with an empty or generic type, and names lie, so the bytes
// decide where they can. Spreadsheets for Source Documents (Kenneth, 26
// October 2026) too: an Excel workbook by what its container holds, and a
// CSV, which has no first bytes of its own, by its name or type once its
// bytes are text.
import { CSV_TYPE, isSpreadsheetType, XLS_TYPE, XLSX_TYPE, type SpreadsheetType } from "./paths";

export type SniffedType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "image/avif"
  | "image/bmp"
  | "image/tiff"
  | "application/pdf"
  | "video/mp4"
  | "video/quicktime"
  | "video/webm";

/** Major or compatible brands of HEVC-coded HEIF images. */
const HEIC_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
const AVIF_BRANDS: ReadonlySet<string> = new Set(["avif", "avis"]);
const HEIF_BRANDS: ReadonlySet<string> = new Set(["mif1", "msf1", "heif"]);
/** Brands of MP4 video (phones and cameras): checked after the image brands. */
const MP4_BRANDS: ReadonlySet<string> = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VH", "dash", "3gp4", "3gp5", "MSNV"]);

export function sniffType(head: Uint8Array): SniffedType | null {
  const text = (from: number, to: number) => latin1(head, from, to);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (text(0, 6) === "GIF87a" || text(0, 6) === "GIF89a") return "image/gif";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  if (text(0, 5) === "%PDF-") return "application/pdf";
  if (text(0, 4) === "II*\0" || text(0, 4) === "MM\0*") return "image/tiff";
  if (text(0, 2) === "BM" && head.length >= 14) return "image/bmp";
  if (text(4, 8) === "ftyp") return isoBrand(head);
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  return null;
}

/** HEIF family: the major brand decides, then the compatible brands. */
function isoBrand(head: Uint8Array): SniffedType | null {
  const boxSize = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const end = Math.min(head.length, Math.max(16, boxSize));
  const brands = [latin1(head, 8, 12)];
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(latin1(head, offset, offset + 4));
  for (const brand of brands) {
    if (AVIF_BRANDS.has(brand)) return "image/avif";
    if (HEIC_BRANDS.has(brand)) return "image/heic";
  }
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "image/heif";
  // Videos (Source Documents, Media): an iPhone's QuickTime movie, or MP4.
  if (brands[0] === "qt  ") return "video/quicktime";
  return brands.some((brand) => MP4_BRANDS.has(brand)) ? "video/mp4" : null;
}

const EXTENSION_TYPES: Readonly<Record<string, SniffedType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * The bytes' type, else the declared one, else the name's extension. Null
 * when none says anything. A spreadsheet comes from its bytes alone
 * (sniffSpreadsheet: a zip's `entries` among them), never from a name or a
 * type that says so: a Word file named .xlsx, or a binary file named .csv,
 * is none.
 */
export function detectType(
  head: Uint8Array,
  declared: string | undefined,
  name: string | undefined,
  entries: readonly ZipEntry[] | null = null,
): string | null {
  const spreadsheet = sniffSpreadsheet(head, declared, name, entries);
  if (spreadsheet) return spreadsheet;
  const sniffed = sniffType(head);
  if (sniffed) return sniffed;
  const type = declared?.trim().toLowerCase();
  const extension = name?.split(".").pop()?.toLowerCase();
  const fallback = (type && type !== "application/octet-stream" ? type : null) ?? ((extension && EXTENSION_TYPES[extension]) || null);
  return isSpreadsheetType(fallback) ? null : fallback;
}

/* ------------------------------------------------------------------ *
 * Spreadsheets (Source Documents: Kenneth, 26 October 2026)
 * ------------------------------------------------------------------ */

/** A zip's first bytes: an .xlsx, a .docx and any zip archive alike. */
export function isZip(head: Uint8Array): boolean {
  return latin1(head, 0, 4) === "PK\x03\x04";
}

/** An OLE2 compound file's first bytes: an .xls (and a password-protected .xlsx), a .doc and an Outlook message alike. */
export function isOle2(head: Uint8Array): boolean {
  return latin1(head, 0, 8) === "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1";
}

/** An entry of a zip: its name, and the size it says it unpacks to. */
export type ZipEntry = { name: string; size: number };

/**
 * The entries a zip lists in its central directory, at its end: `bytes` is
 * the file from `start` on, so its last part will do. Null when the
 * directory is not all there, or for a ZIP64 archive (never a workbook's
 * size).
 */
export function zipEntries(bytes: Uint8Array, start = 0): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record: 22 bytes, then a comment of up to 65,535; the last one that holds together wins.
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 22 - 0xffff); end--) {
    if (view.getUint32(end, true) !== 0x06054b50) continue;
    const count = view.getUint16(end + 10, true);
    const size = view.getUint32(end + 12, true);
    const offset = view.getUint32(end + 16, true);
    if (count === 0xffff || offset === 0xffffffff) return null;
    const from = offset - start;
    if (from < 0 || from + size > end) continue;
    const entries: ZipEntry[] = [];
    let at = from;
    while (entries.length < count && at + 46 <= from + size && view.getUint32(at, true) === 0x02014b50) {
      const nameLength = view.getUint16(at + 28, true);
      const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
      if (next > from + size) break;
      entries.push({ name: latin1(bytes, at + 46, at + 46 + nameLength), size: view.getUint32(at + 24, true) });
      at = next;
    }
    if (entries.length === count) return entries;
  }
  return null;
}

/**
 * A zip holding an Excel workbook (SpreadsheetML): its content types and
 * its workbook part. A zip keeps its entries' names as they are and their
 * contents compressed, so the names decide.
 */
export function isWorkbookZip(entries: readonly ZipEntry[]): boolean {
  const names = new Set(entries.map((entry) => entry.name));
  return names.has("[Content_Types].xml") && names.has("xl/workbook.xml");
}

/** No NUL byte, or UTF-16 with its byte order mark: text, as a CSV is. */
export function isText(bytes: Uint8Array): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  return !bytes.includes(0);
}

/** What browsers and other apps call a CSV, besides its name. */
const CSV_DECLARED: ReadonlySet<string> = new Set([CSV_TYPE, "application/csv", "text/comma-separated-values", "text/x-csv"]);

/**
 * The spreadsheet the bytes are, or null. An .xlsx is a zip whose entries
 * (zipEntries, from the end of the file) are an Excel workbook's. An .xls is
 * an OLE2 compound file named or typed as Excel: a Word document is one too,
 * and so is a password-protected .xlsx, which Steri-AI then says it cannot
 * open. A CSV has no first bytes of its own: it is text named .csv or typed
 * as a CSV. Browsers type one text/csv, application/vnd.ms-excel (Windows
 * with Excel installed), text/plain or nothing, so its name wins.
 */
export function sniffSpreadsheet(
  bytes: Uint8Array,
  declared: string | undefined,
  name: string | undefined,
  entries: readonly ZipEntry[] | null = null,
): SpreadsheetType | null {
  if (isZip(bytes)) return entries && isWorkbookZip(entries) ? XLSX_TYPE : null;
  const type = declared?.trim().toLowerCase() ?? "";
  const extension = name?.split(".").pop()?.toLowerCase();
  if (isOle2(bytes)) return extension === "xls" || extension === "xlsx" || type === XLS_TYPE || type === XLSX_TYPE ? XLS_TYPE : null;
  // Text has no NUL byte, so it is no image or video; only a PDF can be plain text too.
  const csv = extension === "csv" || CSV_DECLARED.has(type);
  return csv && isText(bytes) && sniffType(bytes) !== "application/pdf" ? CSV_TYPE : null;
}

/**
 * A spreadsheet by its name, else its type, before its bytes are read: the
 * file rows' icon and Preview, and New Inspection's Files. A .csv is a CSV
 * whatever its type says. Null for anything else.
 */
export function spreadsheetTypeOf(file: { readonly name: string; readonly type?: string }): SpreadsheetType | null {
  const extension = /\.(csv|xlsx|xls)$/i.exec(file.name)?.[1].toLowerCase();
  if (extension === "csv") return CSV_TYPE;
  if (extension === "xlsx") return XLSX_TYPE;
  if (extension === "xls") return XLS_TYPE;
  const type = file.type?.trim().toLowerCase() ?? "";
  if (CSV_DECLARED.has(type)) return CSV_TYPE;
  return isSpreadsheetType(type) ? type : null;
}

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let text = "";
  for (let index = from; index < Math.min(to, bytes.length); index++) text += String.fromCharCode(bytes[index]);
  return text;
}
