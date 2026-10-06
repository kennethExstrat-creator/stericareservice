import { describe, expect, it } from "vitest";
import { codeLetterForLotSize, codeLetterForSampleSize, isStandardSampleSize, lookupPlan } from "./lookup";
import { CODE_LETTERS, SAMPLE_SIZES, type InspectionLevel, type TableAql } from "./tables";

describe("codeLetterForLotSize", () => {
  it("includes both ends of a range", () => {
    expect(codeLetterForLotSize(8, "II")).toBe("A");
    expect(codeLetterForLotSize(9, "II")).toBe("B");
    expect(codeLetterForLotSize(500_000, "II")).toBe("P");
    expect(codeLetterForLotSize(500_001, "II")).toBe("Q");
  });

  it("reads a column per inspection level", () => {
    const levels: InspectionLevel[] = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"];
    expect(levels.map((level) => codeLetterForLotSize(1_000, level)).join("")).toBe("CCEFGJK");
  });

  it("has no upper limit", () => {
    expect(codeLetterForLotSize(1_000_000_000, "I")).toBe("N");
  });

  it("rejects a lot below 2 or not a whole number", () => {
    for (const lotSize of [1, 0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => codeLetterForLotSize(lotSize, "I")).toThrow(RangeError);
    }
  });

  it("rejects an unknown inspection level", () => {
    expect(() => codeLetterForLotSize(100, "IV" as InspectionLevel)).toThrow(RangeError);
  });
});

describe("codeLetterForSampleSize", () => {
  it("maps each standard sample size to its code letter", () => {
    for (const letter of CODE_LETTERS) expect(codeLetterForSampleSize(SAMPLE_SIZES[letter])).toBe(letter);
  });

  it("reads a non-standard size as the largest standard size below it", () => {
    expect(codeLetterForSampleSize(4)).toBe("B");
    expect(codeLetterForSampleSize(79)).toBe("H");
    expect(codeLetterForSampleSize(81)).toBe("J");
    expect(codeLetterForSampleSize(1_999)).toBe("Q");
    expect(codeLetterForSampleSize(2_001)).toBe("R");
    expect(codeLetterForSampleSize(100_000)).toBe("R");
  });

  it("rejects a sample below 2 or not a whole number", () => {
    for (const sampleSize of [1, 0, -1, 80.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => codeLetterForSampleSize(sampleSize)).toThrow(RangeError);
    }
  });
});

describe("isStandardSampleSize", () => {
  it("is true only for the Table 2-A sample sizes", () => {
    expect([2, 13, 80, 500, 2000].every(isStandardSampleSize)).toBe(true);
    expect([1, 4, 100, 1000, 2001].some(isStandardSampleSize)).toBe(false);
  });
});

describe("lookupPlan", () => {
  it("returns the plan in the cell", () => {
    expect(lookupPlan("J", 1.5)).toEqual({ usedLetter: "J", n: 80, ac: 3, re: 4, arrow: null });
  });

  it("follows an arrow up to the first plan above it, with that plan's sample size", () => {
    expect(lookupPlan("B", 6.5)).toEqual({ usedLetter: "A", n: 2, ac: 0, re: 1, arrow: "up" });
    expect(lookupPlan("F", 1000)).toEqual({ usedLetter: "B", n: 3, ac: 44, re: 45, arrow: "up" });
  });

  it("follows an arrow down to the first plan below it, past further arrows", () => {
    expect(lookupPlan("A", 10)).toEqual({ usedLetter: "C", n: 5, ac: 1, re: 2, arrow: "down" });
    expect(lookupPlan("A", 0.01)).toEqual({ usedLetter: "Q", n: 1250, ac: 0, re: 1, arrow: "down" });
  });

  it("sends code letter R up at the two smallest AQLs", () => {
    expect(lookupPlan("R", 0.01)).toEqual({ usedLetter: "Q", n: 1250, ac: 0, re: 1, arrow: "up" });
    expect(lookupPlan("R", 0.015)).toEqual({ usedLetter: "P", n: 800, ac: 0, re: 1, arrow: "up" });
  });

  it("rejects an AQL that is not a Table 2-A column", () => {
    expect(() => lookupPlan("J", 3 as TableAql)).toThrow(RangeError);
    expect(() => lookupPlan("J", 0 as TableAql)).toThrow(RangeError);
  });
});
