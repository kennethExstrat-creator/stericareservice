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
  | "application/pdf";

/** Major or compatible brands of HEVC-coded HEIF images. */
const HEIC_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
const AVIF_BRANDS: ReadonlySet<string> = new Set(["avif", "avis"]);
const HEIF_BRANDS: ReadonlySet<string> = new Set(["mif1", "msf1", "heif"]);

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
  return brands.some((brand) => HEIF_BRANDS.has(brand)) ? "image/heif" : null;
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
