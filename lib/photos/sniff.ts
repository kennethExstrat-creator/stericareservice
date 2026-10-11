// What a file really is, from its first bytes. iPadOS sometimes hands over
// HEIC photos with an empty or generic type, and names lie, so the bytes
// decide where they can.

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
 * when none says anything.
 */
export function detectType(head: Uint8Array, declared: string | undefined, name: string | undefined): string | null {
  const sniffed = sniffType(head);
  if (sniffed) return sniffed;
  const type = declared?.trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const extension = name?.split(".").pop()?.toLowerCase();
  return (extension && EXTENSION_TYPES[extension]) || null;
}

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let text = "";
  for (let index = from; index < Math.min(to, bytes.length); index++) text += String.fromCharCode(bytes[index]);
  return text;
}
