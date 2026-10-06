import { afterEach, describe, expect, it, vi } from "vitest";
import { app0Jfif, app1Exif, app1Xmp, buildJpeg, cameraExif, comment, includesText } from "./__fixtures__/jpeg";
import { browserCodec } from "./browser-codec";
import { displayName, prepareFile } from "./files";
import { listJpegMetadata, readJpegInfo } from "./jpeg";
import { PHOTO_SIZE_LIMIT } from "./paths";
import { processPhoto, type DecodedImage, type ImageCodec, type PhotoInput, type Surface } from "./process";
import type { DrawPlan, Size } from "./sizing";

const LAST_MODIFIED = Date.UTC(2026, 9, 6, 1, 2, 3);
const HEIC_HEAD = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1")]);

/**
 * Records what processing asks of the browser. Its encoder, unlike a real
 * canvas, writes Exif with GPS, XMP and a comment, so the tests prove they
 * are stripped whatever the encoder does.
 */
class FakeCodec implements ImageCodec {
  readonly draws: { from: Size; plan: DrawPlan }[] = [];
  readonly qualities: number[] = [];
  released = 0;
  closed = 0;

  constructor(
    private readonly decoded: Size | null | "throws",
    private readonly encodeFails = false,
  ) {}

  async decode(): Promise<DecodedImage | null> {
    if (this.decoded === "throws") throw new Error("EncodingError");
    if (!this.decoded) return null;
    return { ...this.decoded, close: () => this.closed++ };
  }

  draw(source: DecodedImage | Surface, plan: DrawPlan): Surface {
    this.draws.push({ from: { width: source.width, height: source.height }, plan });
    return { width: plan.canvas.width, height: plan.canvas.height, release: () => this.released++ };
  }

  async encodeJpeg(surface: Surface, quality: number): Promise<Blob> {
    if (this.encodeFails) throw new Error("Canvas exceeds the memory limit.");
    this.qualities.push(quality);
    const bytes = buildJpeg({
      width: surface.width,
      height: surface.height,
      before: [app0Jfif(), app1Exif(cameraExif()), app1Xmp(), comment("encoder")],
    });
    return new Blob([bytes], { type: "image/jpeg" });
  }
}

function photoFile(bytes: Uint8Array, name = "IMG_0001.JPG", type = "image/jpeg", lastModified = LAST_MODIFIED) {
  return new File([bytes.slice()], name, { type, lastModified });
}

async function bytesOf(blob: Blob | null): Promise<Uint8Array> {
  return new Uint8Array(await blob!.arrayBuffer());
}

describe("processPhoto", () => {
  it("makes a clean 2048 px JPEG and a 400 px thumbnail, keeping the capture time", async () => {
    const codec = new FakeCodec({ width: 3024, height: 4032 });
    const camera = photoFile(buildJpeg({ before: [app1Exif(cameraExif({ orientation: 6 }))], width: 4032, height: 3024 }));
    const result = await processPhoto(camera, { codec });

    expect(result).toEqual({
      ok: true,
      photo: {
        blob: expect.any(Blob),
        thumbBlob: expect.any(Blob),
        width: 1536,
        height: 2048,
        takenAt: "2024-07-12T02:15:30.123Z",
        flagged: false,
        mimeType: "image/jpeg",
      },
    });
    if (!result.ok) return;
    const full = await bytesOf(result.photo.blob);
    const thumb = await bytesOf(result.photo.thumbBlob);
    expect(result.photo.blob.type).toBe("image/jpeg");
    expect(readJpegInfo(full)).toEqual({ exif: null, size: { width: 1536, height: 2048 } });
    expect(readJpegInfo(thumb)).toEqual({ exif: null, size: { width: 300, height: 400 } });
    for (const bytes of [full, thumb]) {
      expect(listJpegMetadata(bytes)).toEqual([]);
      expect(includesText(bytes, "GPS")).toBe(false);
      expect(includesText(bytes, "Exif")).toBe(false);
    }
    expect(codec.qualities).toEqual([0.8, 0.8]);
  });

  it("draws the thumbnail from the resized photo in halving steps, and frees every canvas", async () => {
    const codec = new FakeCodec({ width: 3024, height: 4032 });
    await processPhoto(photoFile(buildJpeg({ before: [app1Exif(cameraExif())] })), { codec });
    expect(codec.draws.map(({ from, plan }) => [from, plan.canvas])).toEqual([
      [{ width: 3024, height: 4032 }, { width: 1536, height: 2048 }],
      [{ width: 1536, height: 2048 }, { width: 768, height: 1024 }],
      [{ width: 768, height: 1024 }, { width: 384, height: 512 }],
      [{ width: 384, height: 512 }, { width: 300, height: 400 }],
    ]);
    expect(codec.draws.every(({ plan }) => plan.matrix === null)).toBe(true);
    expect(codec.released).toBe(4);
    expect(codec.closed).toBe(1);
  });

  it("turns the pixels itself when the browser ignored the Exif orientation", async () => {
    const codec = new FakeCodec({ width: 4032, height: 3024 });
    const result = await processPhoto(
      photoFile(buildJpeg({ before: [app1Exif(cameraExif({ orientation: 6 }))], width: 4032, height: 3024 })),
      { codec },
    );
    expect(result).toMatchObject({ ok: true, photo: { width: 1536, height: 2048 } });
    expect(codec.draws[0].plan).toEqual({
      canvas: { width: 1536, height: 2048 },
      draw: { width: 2048, height: 1536 },
      matrix: [0, 1, -1, 0, 1536, 0],
    });
  });

  it("never upscales, and takes the file's time when there is no Exif", async () => {
    const codec = new FakeCodec({ width: 1000, height: 750 });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], "scan.png", {
      type: "image/png",
      lastModified: LAST_MODIFIED,
    });
    const result = await processPhoto(png, { codec });
    expect(result).toMatchObject({
      ok: true,
      photo: { width: 1000, height: 750, takenAt: new Date(LAST_MODIFIED).toISOString(), mimeType: "image/jpeg" },
    });
    expect(codec.draws[0].plan.canvas).toEqual({ width: 1000, height: 750 });
  });

  it("uses the current time when the file has neither Exif nor a modification time", async () => {
    const blob: PhotoInput = new Blob([buildJpeg()], { type: "image/jpeg" });
    const result = await processPhoto(blob, { codec: new FakeCodec({ width: 40, height: 30 }), now: () => LAST_MODIFIED });
    expect(result).toMatchObject({ ok: true, photo: { takenAt: new Date(LAST_MODIFIED).toISOString() } });
  });

  it("keeps a HEIC the browser cannot decode as the original, flagged for conversion", async () => {
    const heic = photoFile(HEIC_HEAD, "IMG_0002.HEIC", "");
    const result = await processPhoto(heic, { codec: new FakeCodec(null) });
    expect(result).toEqual({
      ok: true,
      photo: {
        blob: expect.any(Blob),
        thumbBlob: null,
        width: null,
        height: null,
        takenAt: new Date(LAST_MODIFIED).toISOString(),
        flagged: true,
        mimeType: "image/heic",
      },
    });
    if (!result.ok) return;
    expect(result.photo.blob.type).toBe("image/heic");
    expect(Buffer.from(await bytesOf(result.photo.blob))).toEqual(Buffer.from(HEIC_HEAD));
  });

  it("keeps a JPEG it could not convert as the original, flagged, without GPS or other metadata", async () => {
    const camera = buildJpeg({ before: [app0Jfif(), app1Exif(cameraExif({ orientation: 6 })), app1Xmp(), comment("Shot on iPad")] });
    const jpeg = photoFile(camera);
    const decodeFails = await processPhoto(jpeg, { codec: new FakeCodec("throws") });
    expect(decodeFails).toMatchObject({
      ok: true,
      photo: { flagged: true, mimeType: "image/jpeg", takenAt: "2024-07-12T02:15:30.123Z", thumbBlob: null },
    });

    const codec = new FakeCodec({ width: 4032, height: 3024 }, true);
    const encodeFails = await processPhoto(jpeg, { codec });
    expect(encodeFails).toMatchObject({ ok: true, photo: { flagged: true } });
    expect(codec.released).toBeGreaterThan(0);
    expect(codec.closed).toBe(1);

    for (const result of [decodeFails, encodeFails]) {
      if (!result.ok) continue;
      const bytes = await bytesOf(result.photo.blob);
      expect(result.photo.blob.type).toBe("image/jpeg");
      expect(listJpegMetadata(bytes)).toEqual(["exif"]);
      expect(readJpegInfo(bytes)?.exif).toMatchObject({ orientation: 6, hasGps: false, dateTimeOriginal: null });
      expect(includesText(bytes, "GPS")).toBe(false);
      expect(includesText(bytes, "Shot on iPad")).toBe(false);
    }
  });

  it("keeps a PNG it could not convert without its text and Exif chunks", async () => {
    const chunk = (type: string, data: string) => {
      const bytes = Buffer.from(data, "latin1");
      return [0, 0, 0, bytes.length, ...Buffer.from(type, "latin1"), ...bytes, 0, 0, 0, 0];
    };
    const png = new Uint8Array([
      ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ...chunk("IHDR", "\0\0\0\x04\0\0\0\x03\x08\x02\0\0\0"),
      ...chunk("tEXt", "Location\0Somewhere"),
      ...chunk("IDAT", "pixels"),
      ...chunk("IEND", ""),
    ]);
    const result = await processPhoto(photoFile(png, "scan.png", "image/png"), { codec: new FakeCodec("throws") });
    expect(result).toMatchObject({ ok: true, photo: { flagged: true, mimeType: "image/png" } });
    if (result.ok) expect(includesText(await bytesOf(result.photo.blob), "Somewhere")).toBe(false);
  });

  it("refuses a photo it can neither convert nor read", async () => {
    const camera = buildJpeg({ before: [app1Exif(cameraExif())] });
    const cut = photoFile(camera.subarray(0, camera.length - 2));
    expect(await processPhoto(cut, { codec: new FakeCodec("throws") })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("refuses empty files, files the bucket would refuse, and originals over 25 MB", async () => {
    const codec = new FakeCodec(null);
    expect(await processPhoto(new File([], "empty.jpg"), { codec })).toMatchObject({ ok: false, reason: "empty" });
    expect(await processPhoto(photoFile(Buffer.from("GIF89a....."), "anim.gif", "image/gif"), { codec })).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
    const huge = { size: PHOTO_SIZE_LIMIT + 1, type: "image/heic", name: "big.heic", slice: () => new Blob([HEIC_HEAD]) };
    expect(await processPhoto(huge as unknown as PhotoInput, { codec })).toMatchObject({ ok: false, reason: "too_large" });
  });
});

describe("browserCodec", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes with createImageBitmap, applying the Exif orientation", async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 3024, height: 4032, close }));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const image = await browserCodec().decode(new Blob([buildJpeg()]));
    expect(image).toMatchObject({ width: 3024, height: 4032 });
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
    image?.close();
    expect(close).toHaveBeenCalled();
  });

  it("falls back to an image element, and gives null when neither can decode", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new DOMException("unsupported", "InvalidStateError"))));
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo");
    let decodes = true;
    class FakeImage {
      decoding = "";
      src = "";
      naturalWidth = 640;
      naturalHeight = 480;
      decode = async () => {
        if (!decodes) throw new DOMException("cannot decode", "EncodingError");
      };
    }
    vi.stubGlobal("Image", FakeImage);

    const image = await browserCodec().decode(new Blob([HEIC_HEAD]));
    expect(image).toMatchObject({ width: 640, height: 480 });
    image?.close();
    expect(revoke).toHaveBeenCalledWith("blob:photo");

    decodes = false;
    expect(await browserCodec().decode(new Blob([HEIC_HEAD]))).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("draws on a white canvas through the plan, and encodes JPEG at the given quality", async () => {
    const calls: unknown[][] = [];
    const context = {
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillRect: (...args: unknown[]) => calls.push(["fillRect", ...args]),
      setTransform: (...args: unknown[]) => calls.push(["setTransform", ...args]),
      drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
    };
    const convertToBlob = vi.fn(async () => new Blob([buildJpeg()], { type: "image/jpeg" }));
    class FakeOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext = () => context;
      convertToBlob = convertToBlob;
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4032, height: 3024, close: () => undefined })));

    const codec = browserCodec();
    const image = (await codec.decode(new Blob([buildJpeg()])))!;
    const surface = codec.draw(image, {
      canvas: { width: 1536, height: 2048 },
      draw: { width: 2048, height: 1536 },
      matrix: [0, 1, -1, 0, 1536, 0],
    });
    expect(context).toMatchObject({ fillStyle: "#ffffff", imageSmoothingEnabled: true, imageSmoothingQuality: "high" });
    expect(calls).toEqual([
      ["fillRect", 0, 0, 1536, 2048],
      ["setTransform", 0, 1, -1, 0, 1536, 0],
      ["drawImage", expect.objectContaining({ width: 4032 }), 0, 0, 2048, 1536],
    ]);

    await codec.encodeJpeg(surface, 0.8);
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.8 });
    surface.release();
    expect(surface).toMatchObject({ canvas: { width: 0, height: 0 } });
  });
});

describe("prepareFile", () => {
  it("accepts PDFs and images as they are", async () => {
    const pdf = new File([Buffer.from("%PDF-1.7 lab report")], "Lab report.pdf", { type: "application/pdf" });
    const prepared = await prepareFile(pdf);
    expect(prepared).toEqual({
      ok: true,
      file: { blob: expect.any(Blob), name: "Lab report.pdf", mimeType: "application/pdf", extension: "pdf" },
    });

    const certificate = new File([buildJpeg()], "certificate.jpeg", { type: "image/jpeg" });
    expect(await prepareFile(certificate)).toMatchObject({ ok: true, file: { mimeType: "image/jpeg", extension: "jpg" } });

    const heic = new File([HEIC_HEAD], "scan.heic", { type: "" });
    expect(await prepareFile(heic)).toMatchObject({ ok: true, file: { mimeType: "image/heic", extension: "heic" } });
  });

  it("refuses other documents, empty files and files over 50 MB", async () => {
    const docx = new File([Buffer.from("PK\u0003\u0004word/document.xml")], "report.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(await prepareFile(docx)).toMatchObject({ ok: false, reason: "unsupported" });
    expect(await prepareFile(new File([], "empty.pdf"))).toMatchObject({ ok: false, reason: "empty" });
    const huge = { size: 50 * 1024 * 1024 + 1, type: "application/pdf", name: "big.pdf", slice: () => new Blob(["%PDF-"]) };
    expect(await prepareFile(huge as unknown as File)).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("keeps a printable, never blank name", () => {
    expect(displayName("  Lab\u0000 report\n.pdf ", "pdf")).toBe("Lab report.pdf");
    expect(displayName("", "pdf")).toBe("Document.pdf");
    expect(displayName(undefined, "jpg")).toBe("Document.jpg");
    expect(displayName("x".repeat(300), "pdf")).toHaveLength(200);
  });
});
