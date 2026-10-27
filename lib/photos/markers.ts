// The geometry of defect marks (lib/schemas/photo-markers.ts) on a photo
// shown at any size: where a circle's element goes, where its resize handle
// sits, where a new circle starts, and what a drag, a resize, the − and +
// buttons and the keys do to it. Pure, so the rules are unit-tested without
// a browser; components/capture/photos/photo-markup.tsx draws them.
//
// Every position is a fraction of the image: x of its width, y of its
// height, r of its shorter side. `aspect` is the image's width over its
// height, which is all a circle needs to stay round.
import { MAX_PHOTO_MARKERS, type PhotoMarker } from "@/lib/schemas/photo-markers";

/** A new circle's radius: a tenth of the photo's shorter side, about a fingertip on an iPad. */
export const MARKER_NEW_RADIUS = 0.1;
/** The smallest and largest circle the tools draw. */
export const MARKER_MIN_RADIUS = 0.02;
export const MARKER_MAX_RADIUS = 0.5;
/** − and + (the buttons and the keys) take a quarter off or put a quarter on: as many taps from small to large as back. */
export const MARKER_RADIUS_FACTOR = 1.25;
/** An arrow key moves the circle this far, of the photo's width or height; with Shift, five times as far. */
export const MARKER_MOVE_STEP = 0.01;
export const MARKER_MOVE_STEP_LARGE = 0.05;

/** Four decimals: a fifth of a pixel on a 2048 px photo, and short JSON. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The radius in fractions of the width and of the height. */
function radii(marker: PhotoMarker, aspect: number): { rx: number; ry: number } {
  // r is a fraction of the shorter side: r·min(w, h) pixels.
  return aspect >= 1 ? { rx: marker.r / aspect, ry: marker.r } : { rx: marker.r, ry: marker.r * aspect };
}

/** The square a circle fills, in fractions of the image: where its element goes (left, top, width, height). */
export function markerBox(marker: PhotoMarker, aspect: number): { left: number; top: number; width: number; height: number } {
  const { rx, ry } = radii(marker, aspect);
  return { left: marker.x - rx, top: marker.y - ry, width: 2 * rx, height: 2 * ry };
}

/** Where on its edge a handle sits, as the corner it points to. */
export type HandleCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

const CORNERS: readonly { corner: HandleCorner; dx: 1 | -1; dy: 1 | -1 }[] = [
  { corner: "bottom-right", dx: 1, dy: 1 },
  { corner: "bottom-left", dx: -1, dy: 1 },
  { corner: "top-right", dx: 1, dy: -1 },
  { corner: "top-left", dx: -1, dy: -1 },
];

/**
 * The resize handle: on the circle's edge, down and to the right, or the
 * first other diagonal that keeps it on the photo, so a circle by an edge
 * still has a handle in reach.
 */
export function handleSpot(marker: PhotoMarker, aspect: number): { x: number; y: number; corner: HandleCorner } {
  const { rx, ry } = radii(marker, aspect);
  const spots = CORNERS.map(({ corner, dx, dy }) => ({ corner, x: marker.x + dx * rx * Math.SQRT1_2, y: marker.y + dy * ry * Math.SQRT1_2 }));
  return spots.find((spot) => spot.x >= 0 && spot.x <= 1 && spot.y >= 0 && spot.y <= 1) ?? spots[0];
}

/** Where new circles go, on the diagonal: the middle first, then down to the right, then up to the left. */
const NEW_SPOTS = [0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.44, 0.38, 0.32, 0.26, 0.2] as const;

/**
 * Where Mark Defect puts a circle: the middle of the photo, or, where a
 * circle already is, a step along the diagonal, so a new one does not land
 * on another. Null once the photo has its 20.
 */
export function newMarker(markers: readonly PhotoMarker[]): PhotoMarker | null {
  if (markers.length >= MAX_PHOTO_MARKERS) return null;
  const taken = (spot: number) => markers.some((marker) => Math.abs(marker.x - spot) < 0.02 && Math.abs(marker.y - spot) < 0.02);
  const spot = NEW_SPOTS.find((candidate) => !taken(candidate)) ?? 0.5;
  return { x: spot, y: spot, r: MARKER_NEW_RADIUS };
}

/** The circle moved by a drag: `dx` and `dy` in fractions of the width and height, from where the drag began. */
export function movedMarker(start: PhotoMarker, dx: number, dy: number): PhotoMarker {
  return { ...start, x: round(clamp(start.x + dx, 0, 1)), y: round(clamp(start.y + dy, 0, 1)) };
}

/** The radius a resize handle dragged to `point` (fractions of the image) gives: its distance from the centre. */
export function radiusAt(marker: PhotoMarker, point: { x: number; y: number }, aspect: number): number {
  const dx = point.x - marker.x;
  const dy = point.y - marker.y;
  // In units of the shorter side.
  const distance = aspect >= 1 ? Math.hypot(dx * aspect, dy) : Math.hypot(dx, dy / aspect);
  return round(clamp(distance, MARKER_MIN_RADIUS, MARKER_MAX_RADIUS));
}

/** The circle at radius `r`, within the tools' range. */
export function resizedMarker(marker: PhotoMarker, r: number): PhotoMarker {
  return { ...marker, r: round(clamp(r, MARKER_MIN_RADIUS, MARKER_MAX_RADIUS)) };
}

/** A little below and above the range's ends counts as at them: four decimals of rounding. */
const EPSILON = 0.000_05;

export function canShrink(marker: PhotoMarker): boolean {
  return marker.r > MARKER_MIN_RADIUS + EPSILON;
}

export function canGrow(marker: PhotoMarker): boolean {
  return marker.r < MARKER_MAX_RADIUS - EPSILON;
}

/** − : a quarter smaller (by MARKER_RADIUS_FACTOR), never below the smallest. */
export function shrunkMarker(marker: PhotoMarker): PhotoMarker {
  return resizedMarker(marker, marker.r / MARKER_RADIUS_FACTOR);
}

/** + : a quarter larger, never above the largest. */
export function grownMarker(marker: PhotoMarker): PhotoMarker {
  return resizedMarker(marker, marker.r * MARKER_RADIUS_FACTOR);
}

/** What a key does to the selected circle: a changed circle, "remove", or null for a key it leaves alone. */
export function markerKeyChange(marker: PhotoMarker, key: string, shiftKey: boolean): PhotoMarker | "remove" | null {
  const step = shiftKey ? MARKER_MOVE_STEP_LARGE : MARKER_MOVE_STEP;
  switch (key) {
    case "ArrowLeft":
      return movedMarker(marker, -step, 0);
    case "ArrowRight":
      return movedMarker(marker, step, 0);
    case "ArrowUp":
      return movedMarker(marker, 0, -step);
    case "ArrowDown":
      return movedMarker(marker, 0, step);
    // "+" is Shift and "=" on most keyboards; "=" alone grows too, as in a drawing app.
    case "+":
    case "=":
    case "Add":
      return grownMarker(marker);
    case "-":
    case "_":
    case "Subtract":
      return shrunkMarker(marker);
    case "Delete":
    case "Backspace":
      return "remove";
    default:
      return null;
  }
}

/**
 * Where the photo sits in a frame of `frame` pixels, as object-fit: contain
 * lays it out: its size and offset in pixels, the box the circles are drawn
 * over. Null until both sizes are known.
 */
export function fitImage(
  image: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
): { width: number; height: number; left: number; top: number } | null {
  if (image.width <= 0 || image.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, left: (frame.width - width) / 2, top: (frame.height - height) / 2 };
}

/** Two lists of circles alike, value by value. */
export function sameMarkers(a: readonly PhotoMarker[], b: readonly PhotoMarker[]): boolean {
  return a.length === b.length && a.every((marker, index) => marker.x === b[index].x && marker.y === b[index].y && marker.r === b[index].r);
}
