// Tiny JPEG and Exif byte builders for tests: real structure, no pixels
// worth decoding. Enough to exercise the parsers in Node.

export type ExifField =
  | { tag: number; ascii: string }
  | { tag: number; short: number }
  | { tag: number; long: number };

const ASCII = 2;
const SHORT = 3;
const LONG = 4;

interface Encoded {
  tag: number;
  type: number;
  count: number;
  data: number[];
}

function bytesOf(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

/**
 * A TIFF structure as found after "Exif\0\0": IFD0, then the Exif IFD and
 * the GPS IFD when given (their pointers are added to IFD0).
 */
export function buildTiff({
  little = false,
  ifd0 = [],
  exif,
  gps,
}: {
  little?: boolean;
  ifd0?: ExifField[];
  exif?: ExifField[];
  gps?: ExifField[];
}): Uint8Array<ArrayBuffer> {
  const u16 = (n: number) => (little ? [n & 255, (n >> 8) & 255] : [(n >> 8) & 255, n & 255]);
  const u32 = (n: number) =>
    little
      ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
      : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const encode = (field: ExifField): Encoded => {
    if ("ascii" in field) return { tag: field.tag, type: ASCII, count: field.ascii.length + 1, data: [...bytesOf(field.ascii), 0] };
    if ("short" in field) return { tag: field.tag, type: SHORT, count: 1, data: u16(field.short) };
    return { tag: field.tag, type: LONG, count: 1, data: u32(field.long) };
  };
  const extraSize = (fields: Encoded[]) => fields.reduce((sum, f) => sum + (f.data.length > 4 ? f.data.length : 0), 0);
  const ifdSize = (fields: Encoded[]) => 2 + fields.length * 12 + 4;

  const exifFields = exif?.map(encode) ?? [];
  const gpsFields = gps?.map(encode) ?? [];
  const firstFields = ifd0.map(encode);
  if (exif) firstFields.push({ tag: 0x8769, type: LONG, count: 1, data: [0, 0, 0, 0] });
  if (gps) firstFields.push({ tag: 0x8825, type: LONG, count: 1, data: [0, 0, 0, 0] });

  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(firstFields) + extraSize(firstFields);
  const gpsAt = exifAt + (exif ? ifdSize(exifFields) + extraSize(exifFields) : 0);
  for (const field of firstFields) {
    if (field.tag === 0x8769) field.data = u32(exifAt);
    if (field.tag === 0x8825) field.data = u32(gpsAt);
  }

  const out: number[] = [...bytesOf(little ? "II" : "MM"), ...u16(42), ...u32(ifd0At)];
  const writeIfd = (fields: Encoded[], at: number) => {
    let extraAt = at + ifdSize(fields);
    const extra: number[] = [];
    out.push(...u16(fields.length));
    for (const field of fields) {
      out.push(...u16(field.tag), ...u16(field.type), ...u32(field.count));
      if (field.data.length <= 4) {
        out.push(...field.data, ...Array(4 - field.data.length).fill(0));
      } else {
        out.push(...u32(extraAt));
        extra.push(...field.data);
        extraAt += field.data.length;
      }
    }
    out.push(...u32(0), ...extra);
  };
  writeIfd(firstFields, ifd0At);
  if (exif) writeIfd(exifFields, exifAt);
  if (gps) writeIfd(gpsFields, gpsAt);
  return new Uint8Array(out);
}

/** A marker segment: FF, marker, two length bytes (payload + 2), payload. */
export function segment(marker: number, payload: number[] | Uint8Array): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 255, length & 255, ...payload];
}

export const app0Jfif = () => segment(0xe0, [...bytesOf("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const app1Exif = (tiff: Uint8Array) => segment(0xe1, [...bytesOf("Exif\0\0"), ...tiff]);
export const app1Xmp = () =>
  segment(0xe1, bytesOf('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><exif:GPSLatitude>3,8.1N</exif:GPSLatitude></x:xmpmeta>'));
export const app2Icc = () => segment(0xe2, [...bytesOf("ICC_PROFILE\0"), 1, 1, ...bytesOf("sRGB profile bytes")]);
export const app2Mpf = () => segment(0xe2, [...bytesOf("MPF\0"), 1, 2, 3, 4]);
export const app13Iptc = () => segment(0xed, bytesOf("Photoshop 3.0\0 8BIM city=Somewhere"));
export const comment = (text: string) => segment(0xfe, bytesOf(text));
export const quantTable = () => segment(0xdb, [0, ...Array(64).fill(1)]);

/** Baseline frame header: precision, height, width, three components. */
export const sof0 = (width: number, height: number) =>
  segment(0xc0, [8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

/** A scan header and entropy-coded bytes, including a stuffed FF00 and a restart marker. */
export const scan = (fill = 0x5a) => [
  ...segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
  fill,
  0x12,
  0xff,
  0x00,
  0x34,
  0xff,
  0xd3,
  0x56,
  fill,
];

export const EOI = [0xff, 0xd9];

/** SOI, the given segments, a frame and a scan, EOI. */
export function buildJpeg({
  before = [],
  width = 4032,
  height = 3024,
  progressive = false,
  trailer = [],
}: {
  before?: number[][];
  width?: number;
  height?: number;
  /** Two scans with a table between them, as progressive JPEGs have. */
  progressive?: boolean;
  trailer?: number[];
} = {}): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8,
    ...before.flat(),
    ...quantTable(),
    ...sof0(width, height),
    ...scan(),
    ...(progressive ? [...quantTable(), ...scan(0x6b)] : []),
    ...EOI,
    ...trailer,
  ]);
}

/** Exif as an iPad camera writes it: orientation, capture time with sub-seconds and offset, GPS. */
export function cameraExif({
  little = false,
  orientation = 6,
  dateTimeOriginal = "2024:07:12 10:15:30",
  subSec = "123",
  offset = "+08:00",
  gps = true,
}: {
  little?: boolean;
  orientation?: number;
  dateTimeOriginal?: string | null;
  subSec?: string | null;
  offset?: string | null;
  gps?: boolean;
} = {}): Uint8Array<ArrayBuffer> {
  const exif: ExifField[] = [];
  if (dateTimeOriginal !== null) exif.push({ tag: 0x9003, ascii: dateTimeOriginal });
  if (offset !== null) exif.push({ tag: 0x9011, ascii: offset });
  if (subSec !== null) exif.push({ tag: 0x9291, ascii: subSec });
  return buildTiff({
    little,
    ifd0: [{ tag: 0x0112, short: orientation }, { tag: 0x010f, ascii: "Apple" }],
    exif,
    gps: gps ? [{ tag: 0x0001, ascii: "N" }, { tag: 0x0003, ascii: "E" }] : undefined,
  });
}

export function includesText(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, "latin1"));
}
