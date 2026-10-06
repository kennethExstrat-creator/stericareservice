import { describe, expect, it } from "vitest";
import {
  EOI,
  app0Jfif,
  app13Iptc,
  app1Exif,
  app1Xmp,
  app2Icc,
  buildJpeg,
  cameraExif,
  comment,
  includesText,
  quantTable,
} from "./__fixtures__/jpeg";
import { orientationExif, parseExif } from "./exif";
import { listJpegMetadata, readJpegInfo, readJpegLayout, withExifOrientation } from "./jpeg";
import { cleanOriginal, stripPngMetadata, stripWebpMetadata } from "./originals";

const text = (value: string) => Array.from(value, (char) => char.charCodeAt(0));

/** A PNG chunk: length, type, data, and a CRC the strip never checks. */
function pngChunk(type: string, data: number[] = []): number[] {
  const length = data.length;
  return [(length >>> 24) & 255, (length >> 16) & 255, (length >> 8) & 255, length & 255, ...text(type), ...data, 1, 2, 3, 4];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = pngChunk("IHDR", [0, 0, 0, 4, 0, 0, 0, 3, 8, 2, 0, 0, 0]);
const IDAT = pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00]);
const IEND = pngChunk("IEND");

/** A WebP chunk: FourCC, little-endian size, data, a pad byte when the size is odd. */
function webpChunk(type: string, data: number[]): number[] {
  const size = data.length;
  return [...text(type), size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, ...data, ...(size % 2 ? [0] : [])];
}

function riff(chunks: number[][], trailer: number[] = []): Uint8Array {
  const body = chunks.flat();
  const size = 4 + body.length;
  return new Uint8Array([...text("RIFF"), size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, ...text("WEBP"), ...body, ...trailer]);
}

/** VP8X: flags (ICC 0x20, alpha 0x10, EXIF 0x08, XMP 0x04), three reserved bytes, canvas size minus one. */
const vp8x = (flags: number) => webpChunk("VP8X", [flags, 0, 0, 0, 3, 0, 0, 2, 0, 0]);
const VP8 = webpChunk("VP8 ", [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x04, 0x00, 0x03]);

describe("orientationExif and withExifOrientation", () => {
  it("builds Exif that says the orientation and nothing else", () => {
    expect(parseExif(orientationExif(6))).toEqual({
      orientation: 6,
      dateTimeOriginal: null,
      subSecTimeOriginal: null,
      offsetTimeOriginal: null,
      dateTimeDigitized: null,
      subSecTimeDigitized: null,
      offsetTimeDigitized: null,
      hasGps: false,
    });
    expect(() => orientationExif(9)).toThrow(RangeError);
    expect(() => orientationExif(0)).toThrow(RangeError);
  });

  it("puts it after SOI and JFIF, leaving the rest as it was", () => {
    const plain = buildJpeg({ before: [app0Jfif()] });
    const turned = withExifOrientation(plain, 8);
    expect(turned).not.toBeNull();
    const markers = readJpegLayout(turned!)?.segments.map((segment) => segment.marker);
    expect(markers?.slice(0, 2)).toEqual([0xe0, 0xe1]);
    expect(readJpegInfo(turned!)?.exif?.orientation).toBe(8);
    expect(Buffer.from(turned!.subarray(turned!.length - (plain.length - 20)))).toEqual(Buffer.from(plain.subarray(20)));

    const bare = withExifOrientation(buildJpeg(), 3);
    expect(readJpegLayout(bare!)?.segments[0].marker).toBe(0xe1);
    expect(withExifOrientation(new Uint8Array([1, 2, 3]), 3)).toBeNull();
  });
});

describe("cleanOriginal: JPEG", () => {
  const image = [...quantTable()];

  it("drops every piece of metadata but the colour profile, and keeps the orientation", () => {
    const camera = buildJpeg({
      before: [app0Jfif(), app1Exif(cameraExif({ orientation: 6 })), app1Xmp(), app2Icc(), app13Iptc(), comment("Shot on iPad")],
      trailer: [...text("gain map"), ...EOI],
    });
    expect(readJpegInfo(camera)?.exif?.hasGps).toBe(true);

    const clean = cleanOriginal(camera, "image/jpeg", 6)!;
    expect(listJpegMetadata(clean)).toEqual(["exif", "icc"]);
    expect(readJpegInfo(clean)).toEqual({
      exif: expect.objectContaining({ orientation: 6, hasGps: false, dateTimeOriginal: null }),
      size: { width: 4032, height: 3024 },
    });
    for (const leak of ["GPS", "Apple", "xmpmeta", "Shot on iPad", "8BIM", "gain map"]) {
      expect(includesText(clean, leak)).toBe(false);
    }
    // The image data itself is untouched, byte for byte.
    const from = (bytes: Uint8Array) => bytes.subarray(Buffer.from(bytes).indexOf(Buffer.from(image)));
    const end = camera.length - (text("gain map").length + 2);
    expect(Buffer.from(from(clean))).toEqual(Buffer.from(from(camera.subarray(0, end))));
  });

  it("adds no Exif at all for an upright photo", () => {
    const camera = buildJpeg({ before: [app1Exif(cameraExif({ orientation: 1 }))] });
    expect(listJpegMetadata(cleanOriginal(camera, "image/jpeg", 1)!)).toEqual([]);
    expect(listJpegMetadata(cleanOriginal(camera, "image/jpeg", null)!)).toEqual([]);
  });

  it("refuses bytes cut short, and types it cannot clean", () => {
    const camera = buildJpeg({ before: [app1Exif(cameraExif())] });
    expect(cleanOriginal(camera.subarray(0, camera.length - 2), "image/jpeg", 6)).toBeNull();
    expect(cleanOriginal(camera, "image/heic")).toBeNull();
  });
});

describe("cleanOriginal: PNG", () => {
  it("keeps the image chunks and drops Exif, text, time and private chunks", () => {
    const png = new Uint8Array([
      ...PNG_SIGNATURE,
      ...IHDR,
      ...pngChunk("eXIf", [...text("MM"), 0, 42, ...text("GPS")]),
      ...pngChunk("iCCP", text("sRGB\0\0profile")),
      ...pngChunk("tEXt", text("Comment\0Somewhere")),
      ...pngChunk("iTXt", text("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>")),
      ...pngChunk("tIME", [7, 232, 10, 6, 9, 0, 0]),
      ...pngChunk("prVt", [1, 2]),
      ...IDAT,
      ...IEND,
      ...text("trailing"),
    ]);
    const clean = cleanOriginal(png, "image/png")!;
    expect(Buffer.from(clean)).toEqual(
      Buffer.from([...PNG_SIGNATURE, ...IHDR, ...pngChunk("iCCP", text("sRGB\0\0profile")), ...IDAT, ...IEND]),
    );
    expect(stripPngMetadata(new Uint8Array([...PNG_SIGNATURE, ...IHDR, ...IDAT]))).toBeNull();
    expect(stripPngMetadata(new Uint8Array([...PNG_SIGNATURE, ...IHDR.slice(0, 10)]))).toBeNull();
    expect(stripPngMetadata(new Uint8Array(text("not a png")))).toBeNull();
  });
});

describe("cleanOriginal: WebP", () => {
  it("drops EXIF and XMP, clears their flags and fixes the RIFF size", () => {
    const webp = riff(
      [vp8x(0x20 | 0x08 | 0x04), webpChunk("ICCP", text("profile")), VP8, webpChunk("EXIF", [...text("MM"), 0, 42, ...text("GPS")]), webpChunk("XMP ", text("<x:xmpmeta/>"))],
      text("junk"),
    );
    const clean = cleanOriginal(webp, "image/webp")!;
    expect(Buffer.from(clean)).toEqual(Buffer.from(riff([vp8x(0x20), webpChunk("ICCP", text("profile")), VP8])));
    expect(includesText(clean, "GPS")).toBe(false);
  });

  it("keeps a simple WebP as it is, and puts back a missing last pad byte", () => {
    const simple = riff([VP8]);
    expect(Buffer.from(stripWebpMetadata(simple)!)).toEqual(Buffer.from(simple));

    const odd = webpChunk("VP8L", [0x2f, 1, 2]);
    const unpadded = riff([odd.slice(0, -1)]);
    expect(Buffer.from(stripWebpMetadata(unpadded)!)).toEqual(Buffer.from(riff([odd])));
  });

  it("refuses bytes that are not a complete WebP", () => {
    const webp = riff([vp8x(0), VP8]);
    expect(stripWebpMetadata(webp.subarray(0, webp.length - 4))).toBeNull();
    expect(stripWebpMetadata(riff([webpChunk("EXIF", [1, 2])]))).toBeNull();
    expect(stripWebpMetadata(new Uint8Array(text("RIFF\0\0\0\0WAVE")))).toBeNull();
  });
});
