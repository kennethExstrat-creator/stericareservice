// The signature drawn on the iPad (BUILD_SPEC 6.1 conclusion), kept as
// vector strokes in the module's data instead of an uploaded image: small,
// plain JSON, saved with every autosave and exported as it is. A stroke is a
// flat list of whole-unit x, y pairs inside a 600 x 200 box, which is also
// the SVG viewBox that draws it. Pure functions only, shared by the pad,
// the read-only view and the tests.
import { z } from "zod";

/** The drawing box, in signature units: a 3:1 pad. */
export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;

/** Bounds that keep a saved signature to a few kB (and never past ~160 kB). */
export const MAX_STROKES = 50;
export const MAX_POINTS_PER_STROKE = 400;

/** Pointer moves closer than this to the last kept point are dropped while drawing. */
export const MIN_STEP = 1.5;
/** How far, in units, simplification may move the line: under a pixel on an iPad. */
export const SIMPLIFY_TOLERANCE = 0.75;
/**
 * Most points a stroke is simplified from. Simplifying costs up to points x
 * points kept, so a longer stroke (a scribble across the pad, several
 * times) is first thinned evenly to this many.
 */
export const MAX_RAW_POINTS = 2000;

const StrokeSchema = z
  .array(z.number().int().min(0))
  .min(2)
  .max(MAX_POINTS_PER_STROKE * 2)
  .refine((stroke) => stroke.length % 2 === 0, { message: "A stroke is a list of x, y pairs." });

export const SignatureSchema = z
  .strictObject({
    /** The box the points are in, kept with them so a later pad size still draws old signatures. */
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
    /** In drawing order; each `[x0, y0, x1, y1, ...]`. */
    strokes: z.array(StrokeSchema).min(1).max(MAX_STROKES),
  })
  .superRefine((signature, context) => {
    signature.strokes.forEach((stroke, index) => {
      const outside = stroke.some((value, at) => value > (at % 2 === 0 ? signature.width : signature.height));
      if (outside) {
        context.addIssue({ code: "custom", path: ["strokes", index], message: "A point lies outside the signature box." });
      }
    });
  });
export type Signature = z.infer<typeof SignatureSchema>;

export type Point = { readonly x: number; readonly y: number };

/**
 * Ramer–Douglas–Peucker: keeps the end points and every point further than
 * `tolerance` from the segment its neighbours span, so straight runs shrink
 * to their ends and curves keep their shape.
 */
export function simplify(points: readonly Point[], tolerance = SIMPLIFY_TOLERANCE): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  // A stack, not recursion: a long stroke must not run out of call stack.
  const spans: [number, number][] = [[0, points.length - 1]];
  while (spans.length > 0) {
    const [first, last] = spans.pop()!;
    let furthest = -1;
    let distance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const away = distanceToSegment(points[index], points[first], points[last]);
      if (away > distance) {
        distance = away;
        furthest = index;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = true;
      spans.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * A drawn stroke as stored: thinned, simplified, rounded to whole units,
 * kept inside the box, repeats dropped, and at most MAX_POINTS_PER_STROKE
 * points (the tolerance doubles until it fits). Empty when nothing was drawn.
 */
export function encodeStroke(
  points: readonly Point[],
  box: { width: number; height: number } = { width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT },
): number[] {
  const thinned = thin(points);
  let tolerance = SIMPLIFY_TOLERANCE;
  for (;;) {
    const encoded = roundPoints(simplify(thinned, tolerance), box);
    if (encoded.length <= MAX_POINTS_PER_STROKE * 2) return encoded;
    tolerance *= 2;
  }
}

/**
 * Points at least MIN_STEP apart, the stroke's last point kept, then at most
 * MAX_RAW_POINTS of them, evenly spread. Linear time, whatever the input.
 */
export function thin(points: readonly Point[]): Point[] {
  const spaced: Point[] = [];
  for (const point of points) {
    const last = spaced[spaced.length - 1];
    if (last === undefined || Math.hypot(point.x - last.x, point.y - last.y) >= MIN_STEP) spaced.push(point);
  }
  const end = points[points.length - 1];
  if (end !== undefined && spaced[spaced.length - 1] !== end) spaced.push(end);
  if (spaced.length <= MAX_RAW_POINTS) return spaced;
  const step = (spaced.length - 1) / (MAX_RAW_POINTS - 1);
  return Array.from({ length: MAX_RAW_POINTS }, (_, index) => spaced[Math.round(index * step)]);
}

/** The points of a stored stroke. */
export function strokePoints(stroke: readonly number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < stroke.length; index += 2) points.push({ x: stroke[index], y: stroke[index + 1] });
  return points;
}

/**
 * SVG path data for one stroke: a dot for a tap, a line for two points, and
 * otherwise a smooth curve through the midpoints, with each point as the
 * control, so the simplified line does not look faceted.
 */
export function strokePath(stroke: readonly number[]): string {
  const points = strokePoints(stroke);
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const start = `M${num(first.x)} ${num(first.y)}`;
  // A zero-length line with round caps draws a dot.
  if (rest.length === 0) return `${start}h0.1`;
  if (rest.length === 1) return `${start}L${num(rest[0].x)} ${num(rest[0].y)}`;
  let path = start;
  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const next = points[index + 1];
    path += `Q${num(control.x)} ${num(control.y)} ${num((control.x + next.x) / 2)} ${num((control.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${path}L${num(last.x)} ${num(last.y)}`;
}

/** A signature with one more stroke; a new signature in the standard box when there was none. */
export function addStroke(signature: Signature | null, stroke: readonly number[]): Signature {
  if (signature === null) return { width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT, strokes: [[...stroke]] };
  return { ...signature, strokes: [...signature.strokes, [...stroke]] };
}

/** The signature without its last stroke; null once no stroke is left. */
export function withoutLastStroke(signature: Signature): Signature | null {
  const strokes = signature.strokes.slice(0, -1);
  return strokes.length === 0 ? null : { ...signature, strokes };
}

/** Whether another stroke may be added. */
export function canAddStroke(signature: Signature | null): boolean {
  return signature === null || signature.strokes.length < MAX_STROKES;
}

function roundPoints(points: readonly Point[], box: { width: number; height: number }): number[] {
  const encoded: number[] = [];
  for (const point of points) {
    const x = clamp(Math.round(point.x), box.width);
    const y = clamp(Math.round(point.y), box.height);
    const count = encoded.length;
    if (count >= 2 && encoded[count - 2] === x && encoded[count - 1] === y) continue;
    encoded.push(x, y);
  }
  return encoded;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), max);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const along = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + along * dx), point.y - (start.y + along * dy));
}

/** Whole units print as integers, midpoints with their half. */
function num(value: number): string {
  return String(Math.round(value * 10) / 10);
}
