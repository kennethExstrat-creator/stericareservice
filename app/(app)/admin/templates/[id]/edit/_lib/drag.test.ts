import { describe, expect, it } from "vitest";
import { dropIndex, edgeScroll, stepAside, type RowBox } from "./drag";

// Five rows of 50 px with 8 px between them: tops 0, 58, 116, 174, 232.
const rows: RowBox[] = [0, 1, 2, 3, 4].map((index) => ({ top: index * 58, height: 50 }));

describe("dropIndex", () => {
  it("stays put for a small nudge", () => {
    expect(dropIndex(rows, 2, 10, 1, 3)).toBe(2);
    expect(dropIndex(rows, 2, -10, 1, 3)).toBe(2);
  });

  it("lands past every row whose middle it crosses", () => {
    expect(dropIndex(rows, 1, 60, 1, 3)).toBe(2);
    expect(dropIndex(rows, 1, 120, 1, 3)).toBe(3);
    expect(dropIndex(rows, 3, -60, 1, 3)).toBe(2);
  });

  it("never passes the pinned first and last rows", () => {
    expect(dropIndex(rows, 2, -500, 1, 3)).toBe(1);
    expect(dropIndex(rows, 2, 500, 1, 3)).toBe(3);
  });
});

describe("stepAside", () => {
  it("moves the rows between start and drop by one place", () => {
    expect([0, 1, 2, 3, 4].map((index) => stepAside(index, 1, 3, 58))).toEqual([0, 0, -58, -58, 0]);
    expect([0, 1, 2, 3, 4].map((index) => stepAside(index, 3, 1, 58))).toEqual([0, 58, 58, 0, 0]);
    expect([0, 1, 2, 3, 4].map((index) => stepAside(index, 2, 2, 58))).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("edgeScroll", () => {
  it("scrolls faster the closer the pointer is to an edge", () => {
    expect(edgeScroll(400, 100, 800)).toBe(0);
    expect(edgeScroll(100, 100, 800)).toBe(-14);
    expect(edgeScroll(136, 100, 800)).toBe(-7);
    expect(edgeScroll(800, 100, 800)).toBe(14);
  });
});
