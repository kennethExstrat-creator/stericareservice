import { describe, expect, it } from "vitest";
import {
  app0Jfif,
  app13Iptc,
  app1Exif,
  app1Xmp,
  app2Icc,
  app2Mpf,
  buildJpeg,
  buildTiff,
  cameraExif,
  comment,
  includesText,
  segment,
} from "./__fixtures__/jpeg";
import { exifInstant, exifTakenAt, parseExif } from "./exif";
import { listJpegMetadata, readJpegInfo, readJpegLayout, stripJpegMetadata } from "./jpeg";
import { detectType, sniffType } from "./sniff";

describe("parseExif", () => {
  it.each([
    ["big-endian (MM)", false],
    ["little-endian (II)", true],
  ])("reads orientation, capture time and GPS presence, %s", (_, little) => {
    expect(parseExif(cameraExif({ little }))).toEqual({
      orientation: 6,
      dateTimeOriginal: "2024:07:12 10:15:30",
      subSecTimeOriginal: "123",
      offsetTimeOriginal: "+08:00",
      dateTimeDigitized: null,
      subSecTimeDigitized: null,
      offsetTimeDigitized: null,
      hasGps: true,
    });
  });

  it("reads a file without an Exif IFD or GPS", () => {
    const info = parseExif(buildTiff({ ifd0: [{ tag: 0x0112, short: 1 }] }));
    expect(info).toMatchObject({ orientation: 1, dateTimeOriginal: null, hasGps: false });
  });

  it("ignores an orientation outside 1 to 8", () => {
    expect(parseExif(buildTiff({ ifd0: [{ tag: 0x0112, short: 9 }] }))?.orientation).toBeNull();
  });

  it("returns null for data that is not TIFF", () => {
    expect(parseExif(new Uint8Array([0x4d, 0x4d, 0x00, 0x2b, 0, 0, 0, 8]))).toBeNull();
    expect(parseExif(new Uint8Array([0x41, 0x41, 0x00, 0x2a, 0, 0, 0, 8]))).toBeNull();
    expect(parseExif(new Uint8Array(4))).toBeNull();
  });

  it("never throws on cut or corrupted bytes", () => {
    const valid = cameraExif();
    for (let length = 0; length < valid.length; length++) {
      expect(() => parseExif(valid.subarray(0, length))).not.toThrow();
    }
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 500; round++) {
      const bytes = valid.slice();
      for (let flips = 0; flips < 4; flips++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      expect(() => parseExif(bytes)).not.toThrow();
    }
  });

  it("does not follow a pointer outside the data", () => {
    const tiff = buildTiff({ ifd0: [{ tag: 0x8769, long: 60_000 }, { tag: 0x0112, short: 3 }] });
    expect(parseExif(tiff)).toMatchObject({ orientation: 3, dateTimeOriginal: null });
  });
});

describe("exifTakenAt", () => {
  const info = (fields: Partial<Parameters<typeof exifTakenAt>[0]>) => ({
    orientation: null,
    dateTimeOriginal: null,
    subSecTimeOriginal: null,
    offsetTimeOriginal: null,
    dateTimeDigitized: null,
    subSecTimeDigitized: null,
    offsetTimeDigitized: null,
    hasGps: false,
    ...fields,
  });

  it("uses DateTimeOriginal with its sub-seconds and UTC offset", () => {
    const parsed = parseExif(cameraExif());
    expect(parsed && exifTakenAt(parsed)).toBe("2024-07-12T02:15:30.123Z");
    expect(exifInstant("2024:07:12 10:15:30", "5", "-03:30")).toBe("2024-07-12T13:45:30.500Z");
  });

  it("reads a time without an offset in the device's zone", () => {
    expect(exifInstant("2024:07:12 10:15:30", null, null)).toBe(new Date(2024, 6, 12, 10, 15, 30).toISOString());
  });

  it("falls back to DateTimeDigitized", () => {
    expect(
      exifTakenAt(info({ dateTimeDigitized: "2024:07:12 11:00:00", offsetTimeDigitized: "+08:00" })),
    ).toBe("2024-07-12T03:00:00.000Z");
  });

  it("rejects unset clocks and impossible dates", () => {
    expect(exifTakenAt(info({ dateTimeOriginal: "0000:00:00 00:00:00" }))).toBeNull();
    expect(exifTakenAt(info({ dateTimeOriginal: "    :  :     :  :  " }))).toBeNull();
    expect(exifInstant("2024:02:30 10:00:00", null, "+08:00")).toBeNull();
    expect(exifInstant("2024:07:12 25:00:00", null, "+08:00")).toBeNull();
    expect(exifInstant("2024:07:12 10:00:00", "abc", "+08:00")).toBe("2024-07-12T02:00:00.000Z");
    expect(exifInstant(null, null, null)).toBeNull();
  });
});

describe("JPEG structure", () => {
  const photo = () =>
    buildJpeg({
      before: [app0Jfif(), app1Exif(cameraExif()), app1Xmp(), app2Icc(), app2Mpf(), app13Iptc(), comment("Taken at Factory 40")],
      width: 4032,
      height: 3024,
      trailer: [0xff, 0xd8, ...app1Exif(cameraExif()), 0xff, 0xd9],
    });

  it("finds Exif and the stored size", () => {
    expect(readJpegInfo(photo())).toEqual({
      exif: expect.objectContaining({ orientation: 6, dateTimeOriginal: "2024:07:12 10:15:30", hasGps: true }),
      size: { width: 4032, height: 3024 },
    });
  });

  it("finds Exif in the first bytes of a file read in part", () => {
    const head = photo().subarray(0, 300);
    expect(readJpegInfo(head)?.exif?.dateTimeOriginal).toBe("2024:07:12 10:15:30");
  });

  it("lists every kind of metadata, including data after the image", () => {
    expect(listJpegMetadata(photo())).toEqual(["exif", "xmp", "icc", "other", "iptc", "comment", "trailer"]);
  });

  it("strips everything but JFIF and the colour profile, and keeps the image data byte for byte", () => {
    const original = photo();
    const stripped = stripJpegMetadata(original);
    expect(stripped).not.toBeNull();
    if (!stripped) return;
    expect(listJpegMetadata(stripped)).toEqual(["icc"]);
    for (const text of ["Exif", "GPS", "xmpmeta", "8BIM", "Factory 40", "MPF"]) expect(includesText(stripped, text)).toBe(false);
    expect(includesText(stripped, "JFIF")).toBe(true);
    expect(readJpegInfo(stripped)).toEqual({ exif: null, size: { width: 4032, height: 3024 } });

    const scanStart = (bytes: Uint8Array) => readJpegLayout(bytes)!.segments.find((s) => s.marker === 0xda)!.start;
    expect(Buffer.from(stripped.subarray(scanStart(stripped)))).toEqual(
      Buffer.from(original.subarray(scanStart(original), readJpegLayout(original)!.end!)),
    );
  });

  it("handles progressive files with several scans", () => {
    const progressive = buildJpeg({ before: [app1Exif(cameraExif())], progressive: true });
    const layout = readJpegLayout(progressive);
    expect(layout?.segments.filter((s) => s.marker === 0xda)).toHaveLength(2);
    expect(layout?.end).toBe(progressive.length);
    expect(listJpegMetadata(stripJpegMetadata(progressive)!)).toEqual([]);
  });

  it("returns a clean file as it is, and refuses what is not a whole JPEG", () => {
    const clean = buildJpeg({ before: [app0Jfif()] });
    expect(stripJpegMetadata(clean)).toBe(clean);
    expect(stripJpegMetadata(clean.subarray(0, clean.length - 4))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readJpegLayout(new Uint8Array([0xff]))).toBeNull();
  });

  it("skips fill bytes before markers", () => {
    const filled = new Uint8Array([0xff, 0xd8, 0xff, 0xff, ...segment(0xe1, [...app1Exif(cameraExif())].slice(4)), 0xff, 0xd9]);
    expect(readJpegInfo(filled)?.exif?.orientation).toBe(6);
  });
});

describe("sniffType", () => {
  const ftyp = (major: string, ...compatible: string[]) => {
    const brands = [major, "\0\0\0\0", ...compatible].join("");
    const size = 8 + brands.length;
    return new Uint8Array([0, 0, 0, size, ...Buffer.from(`ftyp${brands}`, "latin1")]);
  };

  it("recognises images and PDFs by their first bytes", () => {
    expect(sniffType(buildJpeg())).toBe("image/jpeg");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffType(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(sniffType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffType(Buffer.from("II*\0"))).toBe("image/tiff");
    expect(sniffType(Buffer.from("BM\0\0\0\0\0\0\0\0\0\0\0\0"))).toBe("image/bmp");
    expect(sniffType(Buffer.from("hello"))).toBeNull();
  });

  it("tells HEIC, HEIF and AVIF apart by brand", () => {
    expect(sniffType(ftyp("heic", "mif1", "heic"))).toBe("image/heic");
    expect(sniffType(ftyp("mif1", "mif1", "heic"))).toBe("image/heic");
    expect(sniffType(ftyp("mif1", "mif1", "miaf"))).toBe("image/heif");
    expect(sniffType(ftyp("avif", "mif1", "miaf"))).toBe("image/avif");
    expect(sniffType(ftyp("isom", "isom", "mp41"))).toBeNull();
  });

  it("falls back to the declared type, then the extension", () => {
    const unknown = new Uint8Array([1, 2, 3]);
    expect(detectType(buildJpeg(), "image/heic", "IMG_0001.HEIC")).toBe("image/jpeg");
    expect(detectType(unknown, "image/heic", "photo")).toBe("image/heic");
    expect(detectType(unknown, "", "IMG_0001.HEIC")).toBe("image/heic");
    expect(detectType(unknown, "application/octet-stream", "Lab report.PDF")).toBe("application/pdf");
    expect(detectType(unknown, undefined, "notes")).toBeNull();
  });
});
