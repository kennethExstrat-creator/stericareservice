import type { DecodedImage, ImageCodec, Surface } from "./process";
import type { DrawPlan } from "./sizing";

/* ------------------------------------------------------------------ *
 * The DOM half of photo processing. Kept thin: everything that can be
 * decided without a browser lives in process.ts and sizing.ts.
 * ------------------------------------------------------------------ */

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface BrowserImage extends DecodedImage {
  readonly source: CanvasImageSource;
}

interface BrowserSurface extends Surface {
  readonly canvas: Canvas;
}

export function browserCodec(): ImageCodec {
  return { decode, draw, encodeJpeg };
}

/**
 * createImageBitmap applies the Exif orientation ("from-image") and skips
 * the DOM; an <img> is the fallback for browsers that reject the file or
 * the option. Null when neither can decode it.
 */
async function decode(file: Blob): Promise<BrowserImage | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
    } catch {
      // Fall through to the image element.
    }
  }
  return decodeWithImage(file);
}

async function decodeWithImage(file: Blob): Promise<BrowserImage | null> {
  if (typeof Image !== "function" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    URL.revokeObjectURL(url);
    return null;
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    source: image,
    close: () => URL.revokeObjectURL(url),
  };
}

function draw(source: DecodedImage | Surface, plan: DrawPlan): BrowserSurface {
  const { canvas, context } = createCanvas(plan.canvas.width, plan.canvas.height);
  // JPEG has no transparency: transparent PNG pixels would turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, plan.canvas.width, plan.canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (plan.matrix) context.setTransform(...plan.matrix);
  context.drawImage(drawable(source), 0, 0, plan.draw.width, plan.draw.height);
  return {
    width: plan.canvas.width,
    height: plan.canvas.height,
    canvas,
    // iPadOS frees canvas memory only when the canvas shrinks; photos are big.
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

function createCanvas(width: number, height: number): { canvas: Canvas; context: Context } {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context) return { canvas, context };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser has no 2D canvas.");
  return { canvas, context };
}

function drawable(source: DecodedImage | Surface): CanvasImageSource {
  if ("canvas" in source) return (source as BrowserSurface).canvas;
  if ("source" in source) return (source as BrowserImage).source;
  throw new Error("Not an image from browserCodec().");
}

async function encodeJpeg(surface: Surface, quality: number): Promise<Blob> {
  const { canvas } = surface as BrowserSurface;
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be encoded."))),
      "image/jpeg",
      quality,
    );
  });
}
