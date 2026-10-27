import { describe, expect, it } from "vitest";
import { MAX_PHOTO_MARKERS, photoSizeOf, readPhotoMarkers, type PhotoMarker } from "@/lib/schemas/photo-markers";
import {
  canGrow,
  canShrink,
  fitImage,
  grownMarker,
  handleSpot,
  MARKER_MAX_RADIUS,
  MARKER_MIN_RADIUS,
  MARKER_NEW_RADIUS,
  markerBox,
  markerKeyChange,
  movedMarker,
  newMarker,
  radiusAt,
  resizedMarker,
  sameMarkers,
  shrunkMarker,
} from "./markers";

// Defect marks on a photo (Kenneth, 27 October 2026): red circles placed in
// fractions of the image, so they stay on their defect at any size.

const LANDSCAPE = 4 / 3;
const PORTRAIT = 3 / 4;

describe("what is stored", () => {
  it("reads the circles kept with a photo, and none from anything else", () => {
    expect(readPhotoMarkers([{ x: 0.5, y: 0.25, r: 0.1 }])).toEqual([{ x: 0.5, y: 0.25, r: 0.1 }]);
    expect(readPhotoMarkers(undefined)).toEqual([]);
    expect(readPhotoMarkers({ x: 0.5, y: 0.5, r: 0.1 })).toEqual([]);
    expect(readPhotoMarkers([{ x: 2, y: 0.5, r: 0.1 }])).toEqual([]);
    expect(readPhotoMarkers(Array.from({ length: MAX_PHOTO_MARKERS + 1 }, () => ({ x: 0.5, y: 0.5, r: 0.1 })))).toEqual([]);
  });

  it("gives a photo a size only from two whole numbers above 0", () => {
    expect(photoSizeOf(2048, 1536)).toEqual({ width: 2048, height: 1536 });
    expect(photoSizeOf(null, 1536)).toBeNull();
    expect(photoSizeOf(0, 1536)).toBeNull();
    expect(photoSizeOf(2048.5, 1536)).toBeNull();
  });
});

describe("where a circle is drawn", () => {
  it("fills a square of the photo, its radius a fraction of the shorter side", () => {
    // 4:3, the height shorter: r 0.15 is 0.15 of the height and 0.1125 of the width.
    const box = markerBox({ x: 0.5, y: 0.5, r: 0.15 }, LANDSCAPE);
    expect(box.left).toBeCloseTo(0.3875);
    expect(box.width).toBeCloseTo(0.225);
    expect(box.top).toBeCloseTo(0.35);
    expect(box.height).toBeCloseTo(0.3);
    // In pixels on a 400 × 300 image: 90 × 90, a circle.
    expect(box.width * 400).toBeCloseTo(box.height * 300);
    // 3:4, the width shorter.
    const tall = markerBox({ x: 0.5, y: 0.5, r: 0.15 }, PORTRAIT);
    expect(tall.width * 300).toBeCloseTo(tall.height * 400);
    expect(tall.width).toBeCloseTo(0.3);
  });

  it("puts the resize handle on the edge, down to the right, or on a diagonal that stays on the photo", () => {
    const middle = handleSpot({ x: 0.5, y: 0.5, r: 0.2 }, 1);
    expect(middle.corner).toBe("bottom-right");
    expect(middle.x).toBeCloseTo(0.5 + 0.2 * Math.SQRT1_2);
    expect(middle.y).toBeCloseTo(0.5 + 0.2 * Math.SQRT1_2);
    expect(handleSpot({ x: 0.95, y: 0.5, r: 0.2 }, 1).corner).toBe("bottom-left");
    expect(handleSpot({ x: 0.5, y: 0.95, r: 0.2 }, 1).corner).toBe("top-right");
    expect(handleSpot({ x: 0.95, y: 0.95, r: 0.2 }, 1).corner).toBe("top-left");
  });
});

describe("Mark Defect", () => {
  it("starts in the middle of the photo, and never on a circle already there", () => {
    const first = newMarker([]);
    expect(first).toEqual({ x: 0.5, y: 0.5, r: MARKER_NEW_RADIUS });
    const second = newMarker([first!]);
    expect(second).toEqual({ x: 0.56, y: 0.56, r: MARKER_NEW_RADIUS });
    // A circle dragged away frees the middle again.
    expect(newMarker([{ x: 0.2, y: 0.7, r: 0.1 }, second!])).toEqual(first);
  });

  it("adds no circle past 20", () => {
    const full = Array.from({ length: MAX_PHOTO_MARKERS }, (_, index): PhotoMarker => ({ x: index / 20, y: 0.1, r: 0.05 }));
    expect(newMarker(full)).toBeNull();
    expect(newMarker(full.slice(1))).not.toBeNull();
  });
});

describe("dragging and resizing", () => {
  it("moves the centre by the drag, never off the photo", () => {
    expect(movedMarker({ x: 0.5, y: 0.5, r: 0.1 }, 0.1, -0.2)).toEqual({ x: 0.6, y: 0.3, r: 0.1 });
    expect(movedMarker({ x: 0.5, y: 0.5, r: 0.1 }, 0.9, -0.9)).toEqual({ x: 1, y: 0, r: 0.1 });
  });

  it("keeps four decimals", () => {
    expect(movedMarker({ x: 0.1, y: 0.2, r: 0.1 }, 0.123456789, 0)).toEqual({ x: 0.2235, y: 0.2, r: 0.1 });
  });

  it("sizes the circle to the handle's distance from the centre, in the shorter side's units, within the range", () => {
    // 4:3: a point 0.15 of the width to the right is 0.2 of the height away.
    expect(radiusAt({ x: 0.5, y: 0.5, r: 0.1 }, { x: 0.65, y: 0.5 }, LANDSCAPE)).toBeCloseTo(0.2);
    expect(radiusAt({ x: 0.5, y: 0.5, r: 0.1 }, { x: 0.5, y: 0.8 }, LANDSCAPE)).toBeCloseTo(0.3);
    // 3:4 (300 × 400): a point 0.15 of the height down is 60 px away, 0.2 of the width.
    expect(radiusAt({ x: 0.5, y: 0.5, r: 0.1 }, { x: 0.5, y: 0.65 }, PORTRAIT)).toBeCloseTo(0.2);
    expect(radiusAt({ x: 0.5, y: 0.5, r: 0.1 }, { x: 0.5, y: 0.5 }, 1)).toBe(MARKER_MIN_RADIUS);
    expect(radiusAt({ x: 0, y: 0, r: 0.1 }, { x: 1, y: 1 }, 1)).toBe(MARKER_MAX_RADIUS);
  });

  it("grows and shrinks by a quarter, held within the range", () => {
    expect(grownMarker({ x: 0.5, y: 0.5, r: 0.1 }).r).toBe(0.125);
    expect(shrunkMarker({ x: 0.5, y: 0.5, r: 0.125 }).r).toBe(0.1);
    expect(shrunkMarker({ x: 0.5, y: 0.5, r: 0.021 }).r).toBe(MARKER_MIN_RADIUS);
    expect(grownMarker({ x: 0.5, y: 0.5, r: 0.45 }).r).toBe(MARKER_MAX_RADIUS);
    expect(resizedMarker({ x: 0.5, y: 0.5, r: 0.1 }, 0.9).r).toBe(MARKER_MAX_RADIUS);
    expect(canShrink({ x: 0.5, y: 0.5, r: MARKER_MIN_RADIUS })).toBe(false);
    expect(canGrow({ x: 0.5, y: 0.5, r: MARKER_MAX_RADIUS })).toBe(false);
    expect(canShrink({ x: 0.5, y: 0.5, r: 0.1 }) && canGrow({ x: 0.5, y: 0.5, r: 0.1 })).toBe(true);
  });
});

describe("the keys", () => {
  const marker = { x: 0.5, y: 0.5, r: 0.1 };

  it("move the circle with the arrows, five times as far with Shift", () => {
    expect(markerKeyChange(marker, "ArrowLeft", false)).toEqual({ x: 0.49, y: 0.5, r: 0.1 });
    expect(markerKeyChange(marker, "ArrowRight", false)).toEqual({ x: 0.51, y: 0.5, r: 0.1 });
    expect(markerKeyChange(marker, "ArrowUp", true)).toEqual({ x: 0.5, y: 0.45, r: 0.1 });
    expect(markerKeyChange(marker, "ArrowDown", true)).toEqual({ x: 0.5, y: 0.55, r: 0.1 });
  });

  it("resize it with + and −, = and the number pad's too, and take it off with Delete or Backspace", () => {
    for (const key of ["+", "=", "Add"]) expect(markerKeyChange(marker, key, key === "+")).toEqual({ ...marker, r: 0.125 });
    for (const key of ["-", "_", "Subtract"]) expect(markerKeyChange(marker, key, false)).toEqual({ ...marker, r: 0.08 });
    expect(markerKeyChange(marker, "Delete", false)).toBe("remove");
    expect(markerKeyChange(marker, "Backspace", false)).toBe("remove");
  });

  it("leave every other key alone", () => {
    for (const key of ["Tab", "Enter", " ", "Escape", "a"]) expect(markerKeyChange(marker, key, false)).toBeNull();
  });
});

describe("the photo in its frame", () => {
  it("fits the photo whole, centred, as object-fit: contain does", () => {
    expect(fitImage({ width: 2048, height: 1536 }, { width: 1000, height: 600 })).toEqual({ width: 800, height: 600, left: 100, top: 0 });
    expect(fitImage({ width: 1536, height: 2048 }, { width: 600, height: 1000 })).toEqual({ width: 600, height: 800, left: 0, top: 100 });
    // A small photo grows to the frame, as the preview has always shown it.
    expect(fitImage({ width: 400, height: 300 }, { width: 800, height: 800 })).toEqual({ width: 800, height: 600, left: 0, top: 100 });
    expect(fitImage({ width: 400, height: 300 }, { width: 0, height: 800 })).toBeNull();
  });
});

describe("comparing", () => {
  it("compares circles value by value", () => {
    expect(sameMarkers([{ x: 0.5, y: 0.5, r: 0.1 }], [{ x: 0.5, y: 0.5, r: 0.1 }])).toBe(true);
    expect(sameMarkers([{ x: 0.5, y: 0.5, r: 0.1 }], [{ x: 0.5, y: 0.5, r: 0.11 }])).toBe(false);
    expect(sameMarkers([], [{ x: 0.5, y: 0.5, r: 0.1 }])).toBe(false);
  });
});
