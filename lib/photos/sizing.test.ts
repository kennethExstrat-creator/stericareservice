import { describe, expect, it } from "vitest";
import {
  PHOTO_MAX_EDGE,
  THUMB_MAX_EDGE,
  downscaleSteps,
  fitWithin,
  needsManualOrientation,
  planDraw,
  type Matrix,
  type Size,
} from "./sizing";

describe("fitWithin", () => {
  it.each<[string, Size, number, Size]>([
    ["an iPad landscape photo", { width: 4032, height: 3024 }, PHOTO_MAX_EDGE, { width: 2048, height: 1536 }],
    ["an iPad portrait photo", { width: 3024, height: 4032 }, PHOTO_MAX_EDGE, { width: 1536, height: 2048 }],
    ["a square photo", { width: 5000, height: 5000 }, PHOTO_MAX_EDGE, { width: 2048, height: 2048 }],
    ["an odd ratio, rounded", { width: 3000, height: 2000 }, PHOTO_MAX_EDGE, { width: 2048, height: 1365 }],
    ["a thin strip, never below 1 px", { width: 9000, height: 2 }, PHOTO_MAX_EDGE, { width: 2048, height: 1 }],
    ["a thumbnail of a resized photo", { width: 2048, height: 1536 }, THUMB_MAX_EDGE, { width: 400, height: 300 }],
    ["a portrait thumbnail", { width: 1536, height: 2048 }, THUMB_MAX_EDGE, { width: 300, height: 400 }],
  ])("scales %s down to the long edge", (_, size, maxEdge, expected) => {
    expect(fitWithin(size, maxEdge)).toEqual(expected);
  });

  it("never upscales", () => {
    expect(fitWithin({ width: 1000, height: 800 }, PHOTO_MAX_EDGE)).toEqual({ width: 1000, height: 800 });
    expect(fitWithin({ width: 2048, height: 1000 }, PHOTO_MAX_EDGE)).toEqual({ width: 2048, height: 1000 });
    expect(fitWithin({ width: 320, height: 240 }, THUMB_MAX_EDGE)).toEqual({ width: 320, height: 240 });
  });
});

describe("downscaleSteps", () => {
  it("draws in one step when shrinking by half or less", () => {
    expect(downscaleSteps({ width: 4032, height: 3024 }, { width: 2048, height: 1536 })).toEqual([{ width: 2048, height: 1536 }]);
  });

  it("halves until the last step is at most half", () => {
    expect(downscaleSteps({ width: 2048, height: 1536 }, { width: 400, height: 300 })).toEqual([
      { width: 1024, height: 768 },
      { width: 512, height: 384 },
      { width: 400, height: 300 },
    ]);
    expect(downscaleSteps({ width: 8064, height: 6048 }, { width: 2048, height: 1536 })).toEqual([
      { width: 4032, height: 3024 },
      { width: 2048, height: 1536 },
    ]);
  });

  it("does nothing extra for a small image", () => {
    expect(downscaleSteps({ width: 300, height: 200 }, { width: 300, height: 200 })).toEqual([{ width: 300, height: 200 }]);
  });
});

describe("planDraw", () => {
  const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];

  // Where the stored image's top-left corner shows up once upright (Exif 2.32, Orientation tag).
  it.each<[number, string, number[]]>([
    [2, "mirrored", [400, 0]],
    [3, "turned half", [400, 300]],
    [4, "flipped", [0, 300]],
    [5, "transposed", [0, 0]],
    [6, "turned a quarter clockwise", [400, 0]],
    [7, "transversed", [400, 300]],
    [8, "turned a quarter anticlockwise", [0, 300]],
  ])("turns orientation %i (%s) upright inside the canvas", (orientation, _, topLeft) => {
    const upright = { width: 400, height: 300 };
    const plan = planDraw(upright, orientation);
    expect(plan.canvas).toEqual(upright);
    expect(plan.draw).toEqual(orientation >= 5 ? { width: 300, height: 400 } : upright);
    const matrix = plan.matrix!;
    expect(apply(matrix, 0, 0)).toEqual(topLeft);
    const corners = [
      [0, 0],
      [plan.draw.width, 0],
      [0, plan.draw.height],
      [plan.draw.width, plan.draw.height],
    ].map(([x, y]) => apply(matrix, x, y));
    expect(Math.min(...corners.map(([x]) => x))).toBe(0);
    expect(Math.max(...corners.map(([x]) => x))).toBe(400);
    expect(Math.min(...corners.map(([, y]) => y))).toBe(0);
    expect(Math.max(...corners.map(([, y]) => y))).toBe(300);
  });

  it("draws straight when the pixels are upright", () => {
    expect(planDraw({ width: 4, height: 3 }, null)).toEqual({ canvas: { width: 4, height: 3 }, draw: { width: 4, height: 3 }, matrix: null });
    expect(planDraw({ width: 4, height: 3 }, 1).matrix).toBeNull();
  });
});

describe("needsManualOrientation", () => {
  const stored = { width: 4032, height: 3024 };

  it("is false when the decoder already turned a quarter-turn photo", () => {
    expect(needsManualOrientation(6, { width: 3024, height: 4032 }, stored)).toBe(false);
  });

  it("is true when the decoder handed back the stored pixels of a quarter-turn photo", () => {
    expect(needsManualOrientation(6, stored, stored)).toBe(true);
    expect(needsManualOrientation(8, stored, stored)).toBe(true);
  });

  it("leaves flips, half turns, squares and unknown sizes to the decoder", () => {
    expect(needsManualOrientation(3, stored, stored)).toBe(false);
    expect(needsManualOrientation(1, stored, stored)).toBe(false);
    expect(needsManualOrientation(null, stored, stored)).toBe(false);
    expect(needsManualOrientation(6, { width: 100, height: 100 }, { width: 100, height: 100 })).toBe(false);
    expect(needsManualOrientation(6, stored, null)).toBe(false);
  });
});
