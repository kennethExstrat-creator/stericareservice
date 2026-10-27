import "server-only";
import { sniffType } from "@/lib/photos/sniff";

/*
 * The copy of a stored photo Steri-AI sees when it describes it (docs/AI.md,
 * "Describing photos"). Photos are stored as 2,048 px JPEGs: Claude would read
 * one at about 4,200 image tokens, where 1,600 px (about 2,600 for a 4:3
 * photo) is plenty to tell a pinhole's place. sharp (Next.js's own image
 * library, listed in package.json for this) makes the copy: turned upright by
 * its EXIF orientation, fitted inside 1,600 px, JPEG. A JPEG, PNG or WebP
 * already upright and that small goes as stored. Should sharp not load on a
 * server, a photo small enough to send goes as stored; one sharp cannot open
 * is no image Claude could read either.
 */

/** The copy's long edge, in pixels. */
export const DESCRIBE_LONG_EDGE = 1600;
/** A photo sent as stored stays under the Messages API's 5 MB an image once in base64. */
const MAX_STORED_BYTES = 3_750_000;

export type ClaudeImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

const SENT_AS_STORED: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The photo as Claude takes it, or null when it is no image Claude can read. Never throws. */
export async function imageForClaude(bytes: Uint8Array): Promise<ClaudeImage | null> {
  const stored = asStored(bytes);
  const sharp = await loadSharp();
  if (!sharp) return stored;
  try {
    const { width = 0, height = 0, orientation = 1 } = await sharp(bytes, { failOn: "error" }).metadata();
    if (stored && orientation === 1 && Math.max(width, height) <= DESCRIBE_LONG_EDGE) return stored;
    const jpeg = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: DESCRIBE_LONG_EDGE, height: DESCRIBE_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mediaType: "image/jpeg", base64: jpeg.toString("base64") };
  } catch (error) {
    console.warn("[photo descriptions] a photo could not be opened", error instanceof Error ? error.message : error);
    return null;
  }
}

/** sharp, loaded when first needed: a server without its native build still describes photos small enough to send. */
async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch (error) {
    console.warn("[photo descriptions] sharp did not load; photos go as stored", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The stored photo, when it is a type Claude reads and small enough to send; else null. */
function asStored(bytes: Uint8Array): ClaudeImage | null {
  const type = sniffType(bytes.subarray(0, 32));
  if (!type || !SENT_AS_STORED.has(type) || bytes.byteLength > MAX_STORED_BYTES) return null;
  return { mediaType: type as ClaudeImage["mediaType"], base64: Buffer.from(bytes).toString("base64") };
}
