import { listJpegMetadata, stripJpegMetadata, withExifOrientation } from "./jpeg";

/* ------------------------------------------------------------------ *
 * Originals the browser could not convert (BUILD_SPEC 8.1). They are
 * uploaded flagged, but still without GPS or any other metadata where the
 * bytes allow it: JPEG, PNG and WebP are cleaned without decoding, their
 * image data kept byte for byte. HEIC and HEIF cannot be cleaned without
 * decoding them, so they go up as they are (docs/OFFLINE.md, "Known
 * limits"). Never throws.
 * ------------------------------------------------------------------ */

/** Types whose metadata can be removed here. */
export const CLEANABLE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/**
 * The original without its metadata. A JPEG keeps a minimal Exif block
 * with its orientation (2 to 8), so it still shows upright. Null when the
 * bytes are cut short or malformed, or `type` is not cleanable here.
 */
export function cleanOriginal(bytes: Uint8Array, type: string, orientation: number | null = null): Uint8Array | null {
  switch (type) {
    case "image/jpeg": {
      const stripped = stripJpegMetadata(bytes);
      if (!stripped || listJpegMetadata(stripped).some((kind) => kind !== "icc")) return null;
      return orientation !== null && orientation >= 2 && orientation <= 8
        ? withExifOrientation(stripped, orientation)
        : stripped;
    }
    case "image/png":
      return stripPngMetadata(bytes);
    case "image/webp":
      return stripWebpMetadata(bytes);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * PNG: a signature, then chunks of length, type, data and CRC.
 * ------------------------------------------------------------------ */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Chunks that hold the pixels or say how to show them. Everything else is
 * dropped: eXIf (Exif, with any GPS), tEXt, zTXt and iTXt (XMP and
 * comments), tIME, and private chunks.
 */
const PNG_KEEP: ReadonlySet<string> = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "mDCv", "cLLi", "bKGD", "pHYs",
]);

/** The PNG with only the chunks in PNG_KEEP; null when the bytes are not a complete PNG. */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 8 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const end = offset + 12 + readU32(bytes, offset, false);
    if (end > bytes.length) return null;
    const type = latin1(bytes, offset + 4, offset + 8);
    if (PNG_KEEP.has(type)) kept.push(bytes.subarray(offset, end));
    // Anything after IEND is dropped too.
    if (type === "IEND") return concat(kept);
    offset = end;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * WebP: a RIFF container of chunks (FourCC, little-endian size, data,
 * padded to an even length).
 * ------------------------------------------------------------------ */

/** Chunks that hold the image; EXIF, XMP and unknown chunks are dropped. */
const WEBP_KEEP: ReadonlySet<string> = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"]);
/** The VP8X flags that announce EXIF and XMP chunks. */
const VP8X_METADATA = 0x08 | 0x04;

/** The WebP without EXIF and XMP; null when the bytes are not a complete WebP. */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12 || latin1(bytes, 0, 4) !== "RIFF" || latin1(bytes, 8, 12) !== "WEBP") return null;
  const riffEnd = 8 + readU32(bytes, 4, true);
  if (riffEnd < 12 || riffEnd > bytes.length) return null;
  const kept: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const size = readU32(bytes, offset + 4, true);
    const dataEnd = offset + 8 + size;
    if (dataEnd > riffEnd) return null;
    // Chunks are padded to an even length; some writers leave out the last pad byte, which is put back.
    const padded = dataEnd + (size % 2);
    const end = Math.min(padded, riffEnd);
    const type = latin1(bytes, offset, offset + 4);
    if (WEBP_KEEP.has(type)) {
      const chunk = new Uint8Array(padded - offset);
      chunk.set(bytes.subarray(offset, end));
      if (type === "VP8X" && size > 0) chunk[8] &= ~VP8X_METADATA;
      kept.push(chunk);
    }
    offset = end;
  }
  if (offset !== riffEnd || kept.length === 0) return null;
  const body = concat(kept);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  writeU32LE(out, 4, 4 + body.length);
  out.set(body, 12);
  return out;
}

/* ------------------------------------------------------------------ *
 * Bytes
 * ------------------------------------------------------------------ */

function readU32(bytes: Uint8Array, offset: number, little: boolean): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, little);
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value, true);
}

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let text = "";
  for (let index = from; index < to; index++) text += String.fromCharCode(bytes[index]);
  return text;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
