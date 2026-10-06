// Stepper keys: an ARIA spinbutton's keys, clamped to the count's limits; and
// when a held button becomes a drag.
import { describe, expect, it } from "vitest";
import { clampCount, isDrag, PRESS_SLOP, stepperKeyValue } from "./stepper-keys";

describe("isDrag", () => {
  const start = { x: 100, y: 200 };

  it("keeps a held finger that wobbles a press", () => {
    expect(isDrag(start, { x: 104, y: 203 })).toBe(false);
    expect(isDrag(start, { x: 100 + PRESS_SLOP, y: 200 })).toBe(false);
  });

  it("makes a finger that slides away a drag, in any direction", () => {
    expect(isDrag(start, { x: 100 - PRESS_SLOP - 1, y: 200 })).toBe(true);
    expect(isDrag(start, { x: 40, y: 200 })).toBe(true);
    expect(isDrag(start, { x: 108, y: 208 })).toBe(true);
  });
});

const count = { min: 0, max: 13, step: 1 };

describe("clampCount", () => {
  it("keeps a count inside its limits", () => {
    expect(clampCount(5, count)).toBe(5);
    expect(clampCount(-1, count)).toBe(0);
    expect(clampCount(14, count)).toBe(13);
  });

  it("has no ceiling without a max", () => {
    expect(clampCount(10_000, { min: 0 })).toBe(10_000);
    expect(clampCount(-3, { min: 0 })).toBe(0);
  });
});

describe("stepperKeyValue", () => {
  it("steps one with the arrow keys", () => {
    expect(stepperKeyValue("ArrowUp", 4, count)).toBe(5);
    expect(stepperKeyValue("ArrowDown", 4, count)).toBe(3);
  });

  it("steps ten with Page Up and Page Down, stopping at the limits", () => {
    expect(stepperKeyValue("PageUp", 2, count)).toBe(12);
    expect(stepperKeyValue("PageUp", 5, count)).toBe(13);
    expect(stepperKeyValue("PageDown", 12, count)).toBe(2);
    expect(stepperKeyValue("PageDown", 5, count)).toBe(0);
  });

  it("jumps to the limits with Home and End", () => {
    expect(stepperKeyValue("Home", 7, count)).toBe(0);
    expect(stepperKeyValue("End", 7, count)).toBe(13);
  });

  it("stays put at a limit, so the key is still taken but nothing changes", () => {
    expect(stepperKeyValue("ArrowUp", 13, count)).toBe(13);
    expect(stepperKeyValue("ArrowDown", 0, count)).toBe(0);
    expect(stepperKeyValue("Home", 0, count)).toBe(0);
  });

  it("leaves End where it is without a max", () => {
    expect(stepperKeyValue("End", 7, { min: 0, step: 1 })).toBe(7);
    expect(stepperKeyValue("ArrowUp", 7, { min: 0, step: 1 })).toBe(8);
  });

  it("uses the step size", () => {
    const pairs = { min: 0, max: 100, step: 2 };
    expect(stepperKeyValue("ArrowUp", 4, pairs)).toBe(6);
    expect(stepperKeyValue("PageUp", 4, pairs)).toBe(24);
    expect(stepperKeyValue("ArrowDown", 1, pairs)).toBe(0);
  });

  it("returns null for keys that belong to the browser", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowLeft", "ArrowRight", "Escape", "5"]) {
      expect(stepperKeyValue(key, 4, count), key).toBeNull();
    }
  });
});
