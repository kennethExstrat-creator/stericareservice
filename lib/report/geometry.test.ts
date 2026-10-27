// The charts' arithmetic (components/report): where marks sit, how dots
// stack, what a band and a track cover, and that nothing breaks on no data.
import { describe, expect, it } from "vitest";
import { bandEdges, median, niceAxis, niceStep, position, stackDots, stackHeight, ticksBetween, trackGeometry } from "./geometry";

describe("position", () => {
  it("places a value along the axis, 0 at its start and 1 at its end, clamped", () => {
    const axis = { min: 239, max: 247 };
    expect(position(239, axis)).toBe(0);
    expect(position(243, axis)).toBe(0.5);
    expect(position(247, axis)).toBe(1);
    expect(position(230, axis)).toBe(0);
    expect(position(250, axis)).toBe(1);
    // A flat axis or a value that is no number never divides by nothing.
    expect(position(5, { min: 5, max: 5 })).toBe(0);
    expect(position(Number.NaN, axis)).toBe(0);
  });
});

describe("niceAxis", () => {
  it("covers the values and what must show (a minimum), with tidy ticks and a step's room", () => {
    const lengths = niceAxis([242, 246], { include: [240], step: 1 });
    expect(lengths.min).toBeLessThanOrEqual(239);
    expect(lengths.max).toBeGreaterThanOrEqual(247);
    expect(lengths.ticks).toContain(240);
    expect(lengths.ticks.every((tick, index, all) => index === 0 || tick - all[index - 1] === 1)).toBe(true);
    const force = niceAxis([5.5, 7.3], { include: [6] });
    expect(force.ticks[0]).toBe(force.min);
    expect(force.ticks.at(-1)).toBe(force.max);
    expect(force.min).toBeLessThanOrEqual(5.5);
    expect(force.max).toBeGreaterThanOrEqual(7.3);
  });

  it("draws a frame for one value or none", () => {
    expect(niceAxis([])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
    const one = niceAxis([3.5]);
    expect(one.min).toBeLessThan(3.5);
    expect(one.max).toBeGreaterThan(3.5);
  });

  it("steps by 1, 2 or 5 times a power of ten, without binary noise", () => {
    expect(niceStep(8)).toBe(2);
    expect(niceStep(2)).toBe(0.5);
    expect(niceStep(100, 5)).toBe(20);
    expect(ticksBetween(0, 0.3, 0.1)).toEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe("stackDots", () => {
  it("stacks readings that repeat, in the order read, and leaves out what is no number", () => {
    const dots = stackDots([242, 243, 242, null, 242, 244]);
    expect(dots).toEqual([
      { value: 242, level: 0 },
      { value: 243, level: 0 },
      { value: 242, level: 1 },
      { value: 242, level: 2 },
      { value: 244, level: 0 },
    ]);
    expect(stackHeight(dots)).toBe(3);
  });

  it("stacks readings within the precision given", () => {
    expect(stackDots([6.01, 6.04, 6.4], 0.1).map((dot) => dot.level)).toEqual([0, 1, 0]);
  });

  it("draws nothing for no readings", () => {
    expect(stackDots([])).toEqual([]);
    expect(stackHeight([])).toBe(0);
  });
});

describe("median", () => {
  it("is the middle reading, or the mean of the two middle ones", () => {
    expect(median([243, 242, 245])).toBe(243);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([6.5])).toBe(6.5);
    expect(median([null, undefined])).toBeNull();
  });
});

describe("bandEdges", () => {
  const axis = { min: 60, max: 125 };

  it("covers nominal ± tolerance, a range, and a limit open to the axis's end", () => {
    expect(bandEdges({ kind: "tolerance", nominal: 95, tolerance: 10 }, axis)).toEqual({ from: 85, to: 105 });
    expect(bandEdges({ kind: "range", min: 0.05, max: 0.1 }, axis)).toEqual({ from: 0.05, to: 0.1 });
    expect(bandEdges({ kind: "min", min: 110 }, axis)).toEqual({ from: 110, to: 125 });
    expect(bandEdges({ kind: "max", max: 80 }, axis)).toEqual({ from: 60, to: 80 });
  });

  it("draws no band for NA or no spec", () => {
    expect(bandEdges({ kind: "na" }, axis)).toBeNull();
    expect(bandEdges(null, axis)).toBeNull();
  });
});

describe("trackGeometry", () => {
  it("ends the track at the reject number, fills it to the count found, and tints the last step", () => {
    expect(trackGeometry({ found: 2, accept: 7, reject: 8 })).toEqual({ end: 8, fill: 0.25, rejectFrom: 0.875, over: false });
    // No reject number given: accept + 1.
    expect(trackGeometry({ found: 0, accept: 14 })).toMatchObject({ end: 15, fill: 0 });
  });

  it("is over once the count reaches the reject number, the fill stopping at the end", () => {
    expect(trackGeometry({ found: 8, accept: 7, reject: 8 })).toMatchObject({ fill: 1, over: true });
    expect(trackGeometry({ found: 12, accept: 7, reject: 8 })).toMatchObject({ fill: 1, over: true });
  });

  it("handles a limit of none and a count that is no number", () => {
    expect(trackGeometry({ found: 0, accept: 0 })).toEqual({ end: 1, fill: 0, rejectFrom: 0, over: false });
    expect(trackGeometry({ found: Number.NaN, accept: 3 }).fill).toBe(0);
  });
});
