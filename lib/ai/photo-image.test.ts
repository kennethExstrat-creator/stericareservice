import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESCRIBE_LONG_EDGE, imageForClaude } from "./photo-image";

async function jpeg(width: number, height: number, orientation?: number): Promise<Uint8Array> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 30, b: 30 } } }).jpeg({ quality: 80 });
  return new Uint8Array(await (orientation ? image.withMetadata({ orientation }) : image).toBuffer());
}

async function sizeOf(base64: string) {
  const { width, height, format } = await sharp(Buffer.from(base64, "base64")).metadata();
  return { width, height, format };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("imageForClaude", () => {
  it("fits a stored 2,048 px photo inside 1,600 px, as a JPEG", async () => {
    const image = await imageForClaude(await jpeg(2048, 1536));
    expect(image?.mediaType).toBe("image/jpeg");
    expect(await sizeOf(image!.base64)).toEqual({ width: DESCRIBE_LONG_EDGE, height: 1200, format: "jpeg" });
  });

  it("sends a photo already upright and that small as it is stored", async () => {
    const bytes = await jpeg(1040, 585);
    const image = await imageForClaude(bytes);
    expect(image).toEqual({ mediaType: "image/jpeg", base64: Buffer.from(bytes).toString("base64") });
  });

  it("turns a photo upright by its EXIF orientation", async () => {
    // Orientation 6: stored landscape, shown portrait.
    const image = await imageForClaude(await jpeg(1200, 900, 6));
    expect(await sizeOf(image!.base64)).toEqual({ width: 900, height: 1200, format: "jpeg" });
  });

  it("makes a JPEG of a PNG too large to send as it is", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#222" } }).png().toBuffer());
    const image = await imageForClaude(png);
    expect(await sizeOf(image!.base64)).toEqual({ width: DESCRIBE_LONG_EDGE, height: 800, format: "jpeg" });
  });

  it("is null for what is no image Claude can read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await imageForClaude(new TextEncoder().encode("not a photo at all"))).toBeNull();
    // A JPEG's first bytes, but nothing a decoder can open.
    expect(await imageForClaude(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]))).toBeNull();
  });
});
