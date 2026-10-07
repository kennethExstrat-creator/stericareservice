import { describe, expect, it } from "vitest";
import { formatRate, formatRatio, formatRatioDecimal, ratePercent, ratio } from "./rate";

describe("ratio", () => {
  it("divides, and is null without a positive whole", () => {
    expect(ratio(1, 125)).toBe(0.008);
    expect(ratio(0, 125)).toBe(0);
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, null)).toBeNull();
    expect(ratio(null, 125)).toBeNull();
  });
});

describe("formatRatio", () => {
  it("prints the per-box ratio unspaced, as the reports do", () => {
    expect(formatRatio(1, 125)).toBe("1/125");
    expect(formatRatio(0, 125)).toBe("0/125");
    expect(formatRatio(1, 500)).toBe("1/500");
  });

  it("can space it", () => {
    expect(formatRatio(1, 80, { spaced: true })).toBe("1 / 80");
  });

  it("marks a missing whole and blanks a missing part", () => {
    expect(formatRatio(2, null)).toBe("2/—");
    expect(formatRatio(null, 125)).toBe("");
  });
});

describe("formatRatioDecimal", () => {
  it("prints the per-box rate as a decimal", () => {
    expect(formatRatioDecimal(1, 125)).toBe("0.008");
    expect(formatRatioDecimal(3, 125)).toBe("0.024");
    expect(formatRatioDecimal(0, 125)).toBe("0.000");
    expect(formatRatioDecimal(1, 150)).toBe("0.007");
    expect(formatRatioDecimal(1, 125, { decimals: 4 })).toBe("0.0080");
    expect(formatRatioDecimal(1, 0)).toBe("");
  });
});

describe("formatRate", () => {
  it("prints the size totals of the Safedon dispensing check, as the expected results write them", () => {
    expect(formatRate(3, 625)).toBe("3 / 625 (0.48%)");
    expect(formatRate(11, 1000)).toBe("11 / 1,000 (1.1%)");
    expect(formatRate(0, 1000)).toBe("0 / 1,000 (0%)");
    expect(formatRate(7, 625)).toBe("7 / 625 (1.12%)");
  });

  it("can leave out the thousands separators, as the Safedon report printed them", () => {
    expect(formatRate(11, 1000, { grouping: false })).toBe("11 / 1000 (1.1%)");
    expect(formatRatio(1, 1000, { grouping: true })).toBe("1/1,000");
  });

  it("rounds the rate to at most two decimals by default", () => {
    expect(formatRate(2, 3)).toBe("2 / 3 (66.67%)");
    expect(formatRate(2, 3, { maxDecimals: 0 })).toBe("2 / 3 (67%)");
  });

  it("has no rate without a positive whole", () => {
    expect(formatRate(3, null)).toBe("3 / —");
    expect(formatRate(3, 0)).toBe("3 / 0");
    expect(formatRate(null, 625)).toBe("");
  });
});

describe("ratePercent", () => {
  it("is the rate as a rounded percentage", () => {
    expect(ratePercent(3, 625)).toBe(0.48);
    expect(ratePercent(2, 3)).toBe(66.67);
    expect(ratePercent(2, 3, 0)).toBe(67);
    expect(ratePercent(2, null)).toBeNull();
  });
});
