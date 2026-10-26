import { UUID_PATTERN } from "@/lib/offline/id";

/* ------------------------------------------------------------------ *
 * Storage object names (docs/DATABASE.md, "Storage"). The *_path columns
 * store these names, relative to the bucket. Photo and file names reuse
 * the row id, so a retry always targets the same object.
 * ------------------------------------------------------------------ */

export const PHOTO_BUCKET = "inspection-photos";
export const FILE_BUCKET = "inspection-files";
export type MediaBucket = typeof PHOTO_BUCKET | typeof FILE_BUCKET;

/** The buckets' size limits (supabase/migrations/*_storage.sql). */
export const PHOTO_SIZE_LIMIT = 25 * 1024 * 1024;
export const FILE_SIZE_LIMIT = 50 * 1024 * 1024;

/** Types the photo bucket accepts: JPEG from processing, and originals the browser could not convert. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
/** Videos from a phone (Source Documents, Media): MP4, an iPhone's QuickTime movie, WebM. */
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const XLS_TYPE = "application/vnd.ms-excel";
export const CSV_TYPE = "text/csv";
/** Spreadsheets for Source Documents' Files (Kenneth, 26 October 2026): Excel (.xlsx, .xls) and CSV, which Steri-AI reads as text. */
export const SPREADSHEET_TYPES = [XLSX_TYPE, XLS_TYPE, CSV_TYPE] as const;
export type SpreadsheetType = (typeof SPREADSHEET_TYPES)[number];

export function isSpreadsheetType(type: string | null | undefined): type is SpreadsheetType {
  return (SPREADSHEET_TYPES as readonly (string | null | undefined)[]).includes(type);
}

/** Types the file bucket accepts: lab reports, certificates, Source Documents (spreadsheets among them) and their videos. */
export const FILE_TYPES = ["application/pdf", ...PHOTO_TYPES, ...VIDEO_TYPES, ...SPREADSHEET_TYPES] as const;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  [XLSX_TYPE]: "xlsx",
  [XLS_TYPE]: "xls",
  [CSV_TYPE]: "csv",
};

/** File extension for a type either bucket accepts; null for any other type. */
export function extensionFor(mimeType: string): string | null {
  return EXTENSIONS[mimeType] ?? null;
}

/** `<inspection_id>/<photo_id>.jpg`, or the original's extension for a flagged photo. */
export function photoPath(inspectionId: string, photoId: string, extension = "jpg"): string {
  return objectName(inspectionId, photoId, extension);
}

/** `<inspection_id>/thumbs/<photo_id>.jpg`. */
export function thumbPath(inspectionId: string, photoId: string): string {
  return `${uuid(inspectionId, "inspection")}/thumbs/${uuid(photoId, "photo")}.jpg`;
}

/** `<inspection_id>/<file_id>.<ext>`. */
export function filePath(inspectionId: string, fileId: string, extension: string): string {
  return objectName(inspectionId, fileId, extension);
}

function objectName(inspectionId: string, id: string, extension: string): string {
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error(`Invalid file extension "${extension}".`);
  return `${uuid(inspectionId, "inspection")}/${uuid(id, "object")}.${extension}`;
}

function uuid(value: string, what: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`Invalid ${what} id "${value}": expected a lowercase UUID.`);
  return value;
}

/**
 * The inspection an object name belongs to, as public.storage_folder_uuid
 * reads it: a lowercase UUID folder, then plain segments, none made of dots
 * alone. Null for any other name, which the policies deny.
 */
export function storageInspectionId(name: string): string | null {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/[A-Za-z0-9_.-]+)+$/.exec(name);
  if (!match || /\/\.+(\/|$)/.test(name)) return null;
  return match[1];
}
