// Size maths for photo processing (BUILD_SPEC 8.1): 2048 px on the long
// edge for the photo, 400 px for its thumbnail, JPEG at about 0.8.

export const PHOTO_MAX_EDGE = 2048;
export const THUMB_MAX_EDGE = 400;
export const JPEG_QUALITY = 0.8;

export interface Size {
  width: number;
  height: number;
}

/** Scales down to fit `maxEdge` on the long edge, keeping the aspect ratio. Never upscales; each side at least 1 px. */
export function fitWithin(size: Size, maxEdge: number): Size {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: width >= height ? maxEdge : Math.max(1, Math.round(width * scale)),
    height: height > width ? maxEdge : Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The sizes to draw through, halving, ending at `to`. One big jump skips
 * source pixels and aliases (fine texture on a glove turns to moiré), so
 * each step shrinks by at most half.
 */
export function downscaleSteps(from: Size, to: Size): Size[] {
  const steps: Size[] = [];
  let current = from;
  while (current.width > to.width * 2 && current.height > to.height * 2) {
    current = { width: Math.round(current.width / 2), height: Math.round(current.height / 2) };
    steps.push(current);
  }
  steps.push(to);
  return steps;
}

/** Canvas setTransform arguments: (x, y) maps to (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export interface DrawPlan {
  /** The canvas: the upright size. */
  canvas: Size;
  /** The size to draw the stored pixels at, before the transform turns them upright. */
  draw: Size;
  matrix: Matrix | null;
}

/** True for the Exif orientations that turn the picture a quarter (5 to 8): width and height swap. */
export function swapsSides(orientation: number | null): boolean {
  return orientation !== null && orientation >= 5 && orientation <= 8;
}

/**
 * How to draw stored pixels upright into a canvas of `upright` size, when
 * the decoder left the Exif orientation to us. Null orientation: the pixels
 * are upright already.
 */
export function planDraw(upright: Size, orientation: number | null): DrawPlan {
  if (orientation === null || orientation < 2 || orientation > 8) return { canvas: upright, draw: upright, matrix: null };
  const draw = swapsSides(orientation) ? { width: upright.height, height: upright.width } : upright;
  const { width: w, height: h } = draw;
  const matrices: Readonly<Record<number, Matrix>> = {
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  return { canvas: upright, draw, matrix: matrices[orientation] };
}

/**
 * Whether the decoder ignored the Exif orientation, so the pixels still
 * need turning. Current browsers apply it; an older one hands back the
 * stored size even for a quarter turn, which is what this detects. Flips
 * and half turns cannot be told apart and are left to the decoder.
 */
export function needsManualOrientation(orientation: number | null, decoded: Size, stored: Size | null): boolean {
  if (!stored || !swapsSides(orientation) || stored.width === stored.height) return false;
  return decoded.width === stored.width && decoded.height === stored.height;
}
