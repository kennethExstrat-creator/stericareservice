/* ------------------------------------------------------------------ *
 * A tiny Exif reader: the TIFF structure inside a JPEG's APP1 segment,
 * for the capture time and the orientation. Bounds-checked throughout;
 * malformed input gives null, never an exception.
 * ------------------------------------------------------------------ */

export interface ExifInfo {
  /** 1 (upright) to 8. */
  orientation: number | null;
  /** "YYYY:MM:DD HH:MM:SS" in the camera's local time. */
  dateTimeOriginal: string | null;
  subSecTimeOriginal: string | null;
  /** "+08:00": the camera's UTC offset when the photo was taken. */
  offsetTimeOriginal: string | null;
  dateTimeDigitized: string | null;
  subSecTimeDigitized: string | null;
  offsetTimeDigitized: string | null;
  /** The file says where it was taken. */
  hasGps: boolean;
}

const TAG = {
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  offsetTimeOriginal: 0x9011,
  offsetTimeDigitized: 0x9012,
  subSecTimeOriginal: 0x9291,
  subSecTimeDigitized: 0x9292,
} as const;

/** Bytes per value for each TIFF field type; 13 is IFD (a pointer). */
const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const IFD = 13;
const MAX_ENTRIES = 1024;

interface Entry {
  type: number;
  count: number;
  /** Absolute offset of the value: inline in the entry, or where the entry points. */
  at: number;
}

type Ifd = Map<number, Entry>;

/** Reads the TIFF structure that follows "Exif\0\0" in an APP1 segment. */
export function parseExif(tiff: Uint8Array): ExifInfo | null {
  if (tiff.length < 8) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const mark = view.getUint16(0);
  const little = mark === 0x4949 ? true : mark === 0x4d4d ? false : null;
  if (little === null || view.getUint16(2, little) !== 42) return null;

  const ifd0 = readIfd(view, view.getUint32(4, little), little);
  if (!ifd0) return null;
  const exifPointer = pointer(view, ifd0.get(TAG.exifIfd), little);
  const exif = exifPointer === null ? null : readIfd(view, exifPointer, little);
  const gpsPointer = pointer(view, ifd0.get(TAG.gpsIfd), little);
  const gps = gpsPointer === null ? null : readIfd(view, gpsPointer, little);

  const text = (tag: number) => (exif ? ascii(view, exif.get(tag)) : null);
  const orientation = short(view, ifd0.get(TAG.orientation), little);
  return {
    orientation: orientation !== null && orientation >= 1 && orientation <= 8 ? orientation : null,
    dateTimeOriginal: text(TAG.dateTimeOriginal),
    subSecTimeOriginal: text(TAG.subSecTimeOriginal),
    offsetTimeOriginal: text(TAG.offsetTimeOriginal),
    dateTimeDigitized: text(TAG.dateTimeDigitized),
    subSecTimeDigitized: text(TAG.subSecTimeDigitized),
    offsetTimeDigitized: text(TAG.offsetTimeDigitized),
    hasGps: gps !== null && gps.size > 0,
  };
}

function readIfd(view: DataView, offset: number, little: boolean): Ifd | null {
  if (offset < 8 || offset + 2 > view.byteLength) return null;
  const count = view.getUint16(offset, little);
  if (count > MAX_ENTRIES || offset + 2 + count * 12 > view.byteLength) return null;

  const entries: Ifd = new Map();
  for (let index = 0; index < count; index++) {
    const start = offset + 2 + index * 12;
    const type = view.getUint16(start + 2, little);
    const valueCount = view.getUint32(start + 4, little);
    const size = (TYPE_SIZE[type] ?? 0) * valueCount;
    if (size === 0) continue;
    const at = size <= 4 ? start + 8 : view.getUint32(start + 8, little);
    if (at + size > view.byteLength) continue;
    entries.set(view.getUint16(start, little), { type, count: valueCount, at });
  }
  return entries;
}

function ascii(view: DataView, entry: Entry | undefined): string | null {
  if (!entry || entry.type !== ASCII) return null;
  let text = "";
  for (let offset = entry.at; offset < entry.at + entry.count; offset++) {
    const code = view.getUint8(offset);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.trim() || null;
}

function short(view: DataView, entry: Entry | undefined, little: boolean): number | null {
  if (!entry) return null;
  if (entry.type === SHORT) return view.getUint16(entry.at, little);
  if (entry.type === LONG) return view.getUint32(entry.at, little);
  return null;
}

function pointer(view: DataView, entry: Entry | undefined, little: boolean): number | null {
  if (!entry || (entry.type !== LONG && entry.type !== IFD)) return null;
  return view.getUint32(entry.at, little);
}

/* ------------------------------------------------------------------ *
 * Capture time
 * ------------------------------------------------------------------ */

const EXIF_DATE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/**
 * When the photo was taken, as an ISO timestamp: DateTimeOriginal (else
 * DateTimeDigitized) with its sub-seconds and UTC offset. Without an
 * offset the time is read in the device's zone, which is where an iPad
 * photo was taken. Null when absent or malformed (cameras write
 * "0000:00:00 00:00:00" when their clock is unset).
 */
export function exifTakenAt(info: ExifInfo): string | null {
  return (
    exifInstant(info.dateTimeOriginal, info.subSecTimeOriginal, info.offsetTimeOriginal) ??
    exifInstant(info.dateTimeDigitized, info.subSecTimeDigitized, info.offsetTimeDigitized)
  );
}

export function exifInstant(dateTime: string | null, subSec: string | null, offset: string | null): string | null {
  const match = dateTime ? EXIF_DATE.exec(dateTime.trim()) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;

  const fraction = subSec?.trim() ?? "";
  const ms = /^\d+$/.test(fraction) ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  const zone = offset ? EXIF_OFFSET.exec(offset.trim()) : null;
  const time = zone
    ? Date.UTC(year, month - 1, day, hour, minute, second, ms) -
      (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) * 60_000
    : new Date(year, month - 1, day, hour, minute, second, ms).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
