import { exifTakenAt } from "./exif";
import { listJpegMetadata, readJpegInfo, stripJpegMetadata, type JpegInfo } from "./jpeg";
import { PHOTO_SIZE_LIMIT, PHOTO_TYPES } from "./paths";
import {
  JPEG_QUALITY,
  PHOTO_MAX_EDGE,
  THUMB_MAX_EDGE,
  downscaleSteps,
  fitWithin,
  needsManualOrientation,
  planDraw,
  swapsSides,
  type DrawPlan,
  type Size,
} from "./sizing";
import { detectType } from "./sniff";

/* ------------------------------------------------------------------ *
 * Photo processing in the browser (BUILD_SPEC 8.1): JPEG, 2048 px on the
 * long edge, quality 0.8, a 400 px thumbnail, the capture time kept, GPS
 * and every other piece of metadata stripped. The DOM work (decode, draw,
 * encode) sits behind ImageCodec; everything else here is plain logic.
 * ------------------------------------------------------------------ */

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface Surface {
  readonly width: number;
  readonly height: number;
  release(): void;
}

export interface ImageCodec {
  /** Null when the browser cannot decode the file (some HEIC). Applies the Exif orientation where it can. */
  decode(file: Blob): Promise<DecodedImage | null>;
  /** A new surface of plan.canvas size, white, with `source` drawn at plan.draw size through plan.matrix. */
  draw(source: DecodedImage | Surface, plan: DrawPlan): Surface;
  encodeJpeg(surface: Surface, quality: number): Promise<Blob>;
}

export interface ProcessedPhoto {
  /** JPEG without metadata; the original bytes when flagged. */
  blob: Blob;
  /** 400 px JPEG; null when flagged. */
  thumbBlob: Blob | null;
  /** Of `blob`; null when flagged. */
  width: number | null;
  height: number | null;
  /** ISO 8601: Exif DateTimeOriginal, else the file's lastModified. */
  takenAt: string;
  /** The browser could not convert the file: it is the original and needs converting later. */
  flagged: boolean;
  mimeType: string;
}

export type ProcessPhotoFailure = "empty" | "unsupported" | "too_large";

export type ProcessPhotoResult =
  | { ok: true; photo: ProcessedPhoto }
  | { ok: false; reason: ProcessPhotoFailure; message: string };

/** A File, or any Blob with the File fields it may lack. */
export type PhotoInput = Blob & { readonly name?: string; readonly lastModified?: number };

/** Exif and the frame header come first in a JPEG; this leaves room for a large colour profile before them. */
const HEAD_BYTES = 256 * 1024;

export async function processPhoto(
  file: PhotoInput,
  { codec, now = Date.now }: { codec: ImageCodec; now?: () => number },
): Promise<ProcessPhotoResult> {
  if (file.size === 0) return { ok: false, reason: "empty", message: "The file is empty." };
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const type = detectType(head, file.type, file.name);
  const jpeg = type === "image/jpeg" ? readJpegInfo(head) : null;
  const takenAt = (jpeg?.exif && exifTakenAt(jpeg.exif)) || fileTime(file.lastModified) || new Date(now()).toISOString();

  const converted = await convert(file, jpeg, codec).catch(() => null);
  if (converted) return { ok: true, photo: { ...converted, takenAt, flagged: false, mimeType: "image/jpeg" } };

  // The browser could not convert it: keep the original, flagged, if the bucket takes it.
  if (!type || !(PHOTO_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: "unsupported", message: "This file is not a photo the app can store." };
  }
  if (file.size > PHOTO_SIZE_LIMIT) {
    return { ok: false, reason: "too_large", message: "The photo is larger than 25 MB and cannot be converted here." };
  }
  return {
    ok: true,
    photo: { blob: new Blob([file], { type }), thumbBlob: null, width: null, height: null, takenAt, flagged: true, mimeType: type },
  };
}

type Converted = Pick<ProcessedPhoto, "blob" | "thumbBlob" | "width" | "height">;

async function convert(file: Blob, jpeg: JpegInfo | null, codec: ImageCodec): Promise<Converted | null> {
  const decoded = await codec.decode(file);
  if (!decoded) return null;
  const surfaces: Surface[] = [];
  try {
    const orientation = jpeg?.exif?.orientation ?? null;
    const manual = needsManualOrientation(orientation, decoded, jpeg?.size ?? null);
    const upright =
      manual && swapsSides(orientation)
        ? { width: decoded.height, height: decoded.width }
        : { width: decoded.width, height: decoded.height };

    const size = fitWithin(upright, PHOTO_MAX_EDGE);
    const full = drawDown(codec, decoded, upright, size, manual ? orientation : null, surfaces);
    const blob = await encodeClean(codec, full);
    const thumb = drawDown(codec, full, size, fitWithin(size, THUMB_MAX_EDGE), null, surfaces);
    const thumbBlob = await encodeClean(codec, thumb);
    return { blob, thumbBlob, width: size.width, height: size.height };
  } finally {
    for (const surface of surfaces) surface.release();
    decoded.close();
  }
}

/** Draws through halving steps; the Exif turn, when needed, is applied on the first draw. */
function drawDown(
  codec: ImageCodec,
  source: DecodedImage | Surface,
  from: Size,
  to: Size,
  orientation: number | null,
  surfaces: Surface[],
): Surface {
  let current = source;
  let turn = orientation;
  for (const step of downscaleSteps(from, to)) {
    const next = codec.draw(current, planDraw(step, turn));
    surfaces.push(next);
    current = next;
    turn = null;
  }
  return current as Surface;
}

/**
 * Encodes and strips. A canvas encoder writes no Exif, but the strip makes
 * sure, and the check after it proves nothing but the colour profile is left.
 */
async function encodeClean(codec: ImageCodec, surface: Surface): Promise<Blob> {
  const encoded = new Uint8Array(await (await codec.encodeJpeg(surface, JPEG_QUALITY)).arrayBuffer());
  const clean = stripJpegMetadata(encoded);
  if (!clean || listJpegMetadata(clean).some((kind) => kind !== "icc")) {
    throw new Error("The encoder did not produce a clean JPEG.");
  }
  return new Blob([clean.slice()], { type: "image/jpeg" });
}

function fileTime(lastModified: number | undefined): string | null {
  return lastModified !== undefined && Number.isFinite(lastModified) && lastModified > 0
    ? new Date(lastModified).toISOString()
    : null;
}
