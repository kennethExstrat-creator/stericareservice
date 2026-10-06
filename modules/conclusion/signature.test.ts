import { describe, expect, it } from "vitest";
import {
  addStroke,
  canAddStroke,
  encodeStroke,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES,
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  SignatureSchema,
  simplify,
  strokePath,
  strokePoints,
  withoutLastStroke,
  type Point,
  type Signature,
} from "./signature";

const line = (from: Point, to: Point, steps: number): Point[] =>
  Array.from({ length: steps + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps,
  }));

/** A dense, wavy pen stroke, as pointer events deliver it: one point per pixel or so. */
const wave = (left: number, width: number, phase: number): Point[] =>
  Array.from({ length: width * 2 }, (_, index) => {
    const x = left + index / 2;
    return { x, y: 100 + 40 * Math.sin((x + phase) / 18) + 12 * Math.sin((x + phase) / 5) };
  });

describe("signature data", () => {
  const valid: Signature = { width: 600, height: 200, strokes: [[10, 20, 30, 40], [300, 100]] };

  it("holds whole-unit x, y pairs inside its box", () => {
    expect(SignatureSchema.parse(valid)).toEqual(valid);
    expect(SignatureSchema.safeParse({ ...valid, strokes: [[600, 200]] }).success).toBe(true);
  });

  it("rejects anything else: odd lists, fractions, negatives, points outside the box, no strokes, extra keys", () => {
    for (const signature of [
      { ...valid, strokes: [[10, 20, 30]] },
      { ...valid, strokes: [[10.5, 20]] },
      { ...valid, strokes: [[-1, 20]] },
      { ...valid, strokes: [[601, 20]] },
      { ...valid, strokes: [[20, 201]] },
      { ...valid, strokes: [["10", "20"]] },
      { ...valid, strokes: [[]] },
      { ...valid, strokes: [] },
      { ...valid, strokes: Array.from({ length: MAX_STROKES + 1 }, () => [1, 1]) },
      { ...valid, strokes: [Array.from({ length: MAX_POINTS_PER_STROKE * 2 + 2 }, () => 1)] },
      { ...valid, width: 0 },
      { ...valid, image: "data:image/png;base64,AAAA" },
      { strokes: valid.strokes },
    ]) {
      expect(SignatureSchema.safeParse(signature).success, JSON.stringify(signature).slice(0, 80)).toBe(false);
    }
  });
});

describe("simplify", () => {
  it("drops points on a straight run and keeps the ends", () => {
    expect(simplify(line({ x: 0, y: 0 }, { x: 100, y: 50 }, 100))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
  });

  it("keeps a corner and the far point of a stroke that doubles back", () => {
    const corner = [...line({ x: 0, y: 0 }, { x: 50, y: 0 }, 10), ...line({ x: 50, y: 0 }, { x: 50, y: 50 }, 10).slice(1)];
    expect(simplify(corner)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
    const back = [...line({ x: 0, y: 0 }, { x: 80, y: 0 }, 16), ...line({ x: 80, y: 0 }, { x: 10, y: 0 }, 14).slice(1)];
    expect(simplify(back)).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("keeps curves within the tolerance and copes with long strokes", () => {
    const points = wave(0, 600, 0);
    const kept = simplify(points);
    expect(kept.length).toBeLessThan(points.length / 4);
    expect(kept[0]).toEqual(points[0]);
    expect(kept.at(-1)).toEqual(points.at(-1));
    expect(simplify(wave(0, 50_000, 0)).length).toBeGreaterThan(2);
  });
});

describe("encodeStroke", () => {
  it("rounds to whole units, keeps points inside the box and drops repeats", () => {
    expect(
      encodeStroke([
        { x: 10.4, y: 20.6 },
        { x: 10.2, y: 20.9 },
        { x: -5, y: 250 },
      ]),
    ).toEqual([10, 21, 0, 200]);
  });

  it("stores a tap as one point and nothing as nothing", () => {
    expect(encodeStroke([{ x: 5, y: 5 }])).toEqual([5, 5]);
    expect(encodeStroke([{ x: 5, y: 5 }, { x: 5.2, y: 4.9 }])).toEqual([5, 5]);
    expect(encodeStroke([])).toEqual([]);
  });

  it("never stores more points than a stroke may hold", () => {
    const scribble = Array.from({ length: 20_000 }, (_, index) => ({
      x: (index * 7919) % SIGNATURE_WIDTH,
      y: (index * 104_729) % SIGNATURE_HEIGHT,
    }));
    const stroke = encodeStroke(scribble);
    expect(stroke.length).toBeLessThanOrEqual(MAX_POINTS_PER_STROKE * 2);
    expect(SignatureSchema.safeParse({ width: 600, height: 200, strokes: [stroke] }).success).toBe(true);
  });

  it("keeps a whole signature to a few kB of JSON", () => {
    let signature: Signature | null = null;
    for (let index = 0; index < 8; index += 1) signature = addStroke(signature, encodeStroke(wave(index * 70, 90, index * 13)));
    expect(SignatureSchema.safeParse(signature).success).toBe(true);
    expect(JSON.stringify(signature).length).toBeLessThan(8_000);
  });
});

describe("strokePath", () => {
  it("draws a dot, a line and a smooth curve through the midpoints", () => {
    expect(strokePath([5, 5])).toBe("M5 5h0.1");
    expect(strokePath([0, 0, 10, 10])).toBe("M0 0L10 10");
    expect(strokePath([0, 0, 10, 10, 20, 0, 30, 10])).toBe("M0 0Q10 10 15 5Q20 0 25 5L30 10");
    expect(strokePath([])).toBe("");
  });

  it("reads strokes back as points", () => {
    expect(strokePoints([1, 2, 3, 4])).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});

describe("strokes in and out", () => {
  it("starts a signature in the standard box, adds strokes and takes the last one back", () => {
    const one = addStroke(null, [1, 2, 3, 4]);
    expect(one).toEqual({ width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT, strokes: [[1, 2, 3, 4]] });
    const two = addStroke(one, [5, 6]);
    expect(two.strokes).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect(one.strokes).toHaveLength(1);
    expect(withoutLastStroke(two)).toEqual(one);
    expect(withoutLastStroke(one)).toBeNull();
  });

  it("stops taking strokes at the limit", () => {
    let signature: Signature | null = null;
    for (let index = 0; index < MAX_STROKES; index += 1) {
      expect(canAddStroke(signature)).toBe(true);
      signature = addStroke(signature, [index, index]);
    }
    expect(canAddStroke(signature)).toBe(false);
    expect(SignatureSchema.safeParse(signature).success).toBe(true);
  });
});
