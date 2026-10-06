import { parseExif, type ExifInfo } from "./exif";
import type { Size } from "./sizing";

/* ------------------------------------------------------------------ *
 * JPEG structure, read without decoding: the marker segments, the
 * stored size, and the segments that carry metadata. Never throws.
 * ------------------------------------------------------------------ */

export interface JpegSegment {
  /** 0xE1 for APP1, 0xDA for a scan header, ... */
  marker: number;
  /** Offset of the 0xFF that starts the marker. */
  start: number;
  /** First payload byte, after the two length bytes. */
  dataStart: number;
  /** Offset just after the segment. */
  end: number;
}

export interface JpegLayout {
  segments: JpegSegment[];
  /** Offset just after the end-of-image marker; null when the bytes stop first (a partial read or a cut file). */
  end: number | null;
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;

const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;
/** SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range. */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

export function readJpegLayout(bytes: Uint8Array): JpegLayout | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  const segments: JpegSegment[] = [];
  let index = 2;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) break;
    const start = index;
    while (index < bytes.length && bytes[index] === 0xff) index++;
    if (index >= bytes.length) break;
    const marker = bytes[index++];
    if (marker === EOI) return { segments, end: index };
    if (marker === SOI || marker === 0x01 || isRestart(marker)) continue;
    if (index + 2 > bytes.length) break;
    const length = (bytes[index] << 8) | bytes[index + 1];
    if (length < 2 || index + length > bytes.length) break;
    segments.push({ marker, start, dataStart: index + 2, end: index + length });
    index += length;
    if (marker === SOS) index = endOfScan(bytes, index);
  }
  return { segments, end: null };
}

/** Entropy-coded data runs to the first 0xFF that is not stuffing (FF00) or a restart marker. */
function endOfScan(bytes: Uint8Array, from: number): number {
  let index = from;
  for (;;) {
    const ff = bytes.indexOf(0xff, index);
    if (ff === -1 || ff + 1 >= bytes.length) return bytes.length;
    const next = bytes[ff + 1];
    if (next === 0x00 || isRestart(next)) {
      index = ff + 2;
      continue;
    }
    return ff;
  }
}

export type JpegMetadataKind = "exif" | "xmp" | "iptc" | "icc" | "comment" | "other" | "trailer";

/**
 * What a segment carries, or null for the segments that only describe the
 * encoding (APP0 JFIF, tables, frame and scan headers).
 */
export function metadataKind(bytes: Uint8Array, segment: JpegSegment): JpegMetadataKind | null {
  const { marker } = segment;
  if (marker === COM) return "comment";
  if (marker < 0xe1 || marker > 0xef) return null;
  const head = latin1(bytes, segment.dataStart, Math.min(segment.end, segment.dataStart + 32));
  if (marker === 0xe1) {
    if (head.startsWith("Exif\0")) return "exif";
    return head.startsWith("http://ns.adobe.com/") ? "xmp" : "other";
  }
  if (marker === 0xe2 && head.startsWith("ICC_PROFILE\0")) return "icc";
  if (marker === 0xed) return "iptc";
  return "other";
}

/** Every metadata segment in a complete JPEG, plus "trailer" for data after the image. */
export function listJpegMetadata(bytes: Uint8Array): JpegMetadataKind[] {
  const layout = readJpegLayout(bytes);
  if (!layout) return [];
  const kinds = layout.segments.flatMap((segment) => metadataKind(bytes, segment) ?? []);
  if (layout.end !== null && layout.end < bytes.length) kinds.push("trailer");
  return kinds;
}

/**
 * The JPEG without metadata: drops APP1 to APP15 (Exif with GPS, XMP,
 * IPTC, maker data), comments, and anything after the image (iPad photos
 * append a gain-map image with its own Exif). Keeps APP0 (JFIF) and the
 * ICC colour profile, which describe how to show the pixels, not where or
 * when they were taken. Null when the bytes are not a complete JPEG.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  const layout = readJpegLayout(bytes);
  if (!layout || layout.end === null) return null;
  const dropped = layout.segments.filter((segment) => {
    const kind = metadataKind(bytes, segment);
    return kind !== null && kind !== "icc";
  });
  if (dropped.length === 0 && layout.end === bytes.length) return bytes;

  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const segment of dropped) {
    parts.push(bytes.subarray(cursor, segment.start));
    cursor = segment.end;
  }
  parts.push(bytes.subarray(cursor, layout.end));

  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface JpegInfo {
  exif: ExifInfo | null;
  /** As stored, before any Exif orientation. */
  size: Size | null;
}

/** Exif and stored size from the start of a JPEG; the first 256 KB is plenty. */
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  const layout = readJpegLayout(bytes);
  if (!layout) return null;
  let exif: ExifInfo | null = null;
  let size: Size | null = null;
  for (const segment of layout.segments) {
    if (exif === null && metadataKind(bytes, segment) === "exif") {
      exif = parseExif(bytes.subarray(segment.dataStart + 6, segment.end));
    }
    if (size === null && isStartOfFrame(segment.marker) && segment.end - segment.dataStart >= 5) {
      const height = (bytes[segment.dataStart + 1] << 8) | bytes[segment.dataStart + 2];
      const width = (bytes[segment.dataStart + 3] << 8) | bytes[segment.dataStart + 4];
      if (width > 0 && height > 0) size = { width, height };
    }
  }
  return { exif, size };
}

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let text = "";
  for (let index = from; index < to; index++) text += String.fromCharCode(bytes[index]);
  return text;
}
