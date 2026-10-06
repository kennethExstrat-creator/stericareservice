import { describe, expect, it } from "vitest";
import { mean, median, roundTo, statistic } from "./statistics";

describe("median", () => {
  it("is null for no values", () => {
    expect(median([])).toBeNull();
  });

  it("takes the middle of an odd count, whatever the input order", () => {
    expect(median([243])).toBe(243);
    expect(median([245, 241, 243])).toBe(243);
  });

  it("averages the two middle values of an even count", () => {
    expect(median([94, 96, 95, 97])).toBe(95.5);
  });

  it("matches a 13-glove column", () => {
    const lengths = [243, 245, 242, 244, 246, 243, 241, 244, 245, 243, 242, 244, 243];
    expect(median(lengths)).toBe(243);
  });

  it("does not reorder the caller's array", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("rejects values that are not finite numbers", () => {
    expect(() => median([1, Number.NaN])).toThrow(RangeError);
    expect(() => median([Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});

describe("mean", () => {
  it("is null for no values", () => {
    expect(mean([])).toBeNull();
  });

  it("averages the values", () => {
    expect(mean([0.11, 0.12, 0.1])).toBeCloseTo(0.11, 10);
    expect(mean([98, 97, 99, 98])).toBe(98);
  });

  it("rejects values that are not finite numbers", () => {
    expect(() => mean([Number.NaN])).toThrow(RangeError);
  });
});

describe("statistic", () => {
  it("dispatches on the template's statistic", () => {
    expect(statistic("median", [1, 2, 10])).toBe(2);
    expect(statistic("average", [1, 2, 9])).toBe(4);
    expect(statistic("average", [])).toBeNull();
  });
});

describe("roundTo", () => {
  it("rounds half away from zero, like Excel's ROUND", () => {
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(0.125, 2)).toBe(0.13);
  });

  it("is not fooled by binary representation", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(0.15000000000000002, 1)).toBe(0.2);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundTo(-0.001, 2), 0)).toBe(true);
  });

  it("rejects a bad number of decimals", () => {
    expect(() => roundTo(1, -1)).toThrow(RangeError);
    expect(() => roundTo(1, 1.5)).toThrow(RangeError);
  });
});
