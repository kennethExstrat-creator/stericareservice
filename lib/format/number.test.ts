import { describe, expect, it } from "vitest";
import { formatCount as aqlFormatCount } from "@/lib/aql";
import { formatCount, formatNumber, formatPercent, toPercent, withUnit } from "./number";

describe("formatNumber", () => {
  it("prints the value as stored without decimals options", () => {
    expect(formatNumber(243)).toBe("243");
    expect(formatNumber(0.105)).toBe("0.105");
    expect(formatNumber(-1.5)).toBe("-1.5");
    expect(formatNumber(-0)).toBe("0");
  });

  it("drops binary noise from a calculation, keeping every digit that was typed", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber((2.9 + 3.1 + 2.8) / 3)).toBe("2.93333333333");
    expect(formatNumber(-0.1 - 0.2)).toBe("-0.3");
    expect(formatNumber(1.1 * 3, { unit: "g" })).toBe("3.3 g");
    expect(formatNumber(13.996)).toBe("13.996");
    expect(formatNumber(0.000123)).toBe("0.000123");
    expect(formatNumber(123456.789012)).toBe("123456.789012");
    expect(formatNumber(5_800_000.000000001, { grouping: true })).toBe("5,800,000");
  });

  it("pads and rounds to fixed decimals like Excel's ROUND", () => {
    expect(formatNumber(2.9, { decimals: 2 })).toBe("2.90");
    expect(formatNumber(6.537, { decimals: 1 })).toBe("6.5");
    expect(formatNumber(1.005, { decimals: 2 })).toBe("1.01");
    expect(formatNumber(2.5, { decimals: 0 })).toBe("3");
    expect(formatNumber(-0.001, { decimals: 2 })).toBe("0.00");
  });

  it("drops trailing zeros with maxDecimals", () => {
    expect(formatNumber(0.48000000000000004, { maxDecimals: 2 })).toBe("0.48");
    expect(formatNumber(1.1, { maxDecimals: 2 })).toBe("1.1");
    expect(formatNumber(0, { maxDecimals: 2 })).toBe("0");
    expect(formatNumber(100, { maxDecimals: 2 })).toBe("100");
    expect(formatNumber(66.666666, { maxDecimals: 2 })).toBe("66.67");
  });

  it("lets fixed decimals win over maxDecimals", () => {
    expect(formatNumber(1.1, { decimals: 2, maxDecimals: 0 })).toBe("1.10");
  });

  it("groups thousands", () => {
    expect(formatNumber(5_800_000, { grouping: true })).toBe("5,800,000");
    expect(formatNumber(2900, { grouping: true })).toBe("2,900");
    expect(formatNumber(999, { grouping: true })).toBe("999");
    expect(formatNumber(-12345.678, { grouping: true, decimals: 1 })).toBe("-12,345.7");
  });

  it("adds a unit with a space, and % without one", () => {
    expect(formatNumber(6, { unit: "N" })).toBe("6 N");
    expect(formatNumber(2.9, { decimals: 2, unit: "g" })).toBe("2.90 g");
    expect(formatNumber(88, { unit: "%" })).toBe("88%");
  });

  it("prints a missing value as the empty text, without its unit", () => {
    expect(formatNumber(null)).toBe("");
    expect(formatNumber(undefined, { unit: "mm" })).toBe("");
    expect(formatNumber(Number.NaN, { empty: "—" })).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY, { empty: "—" })).toBe("—");
  });
});

describe("withUnit", () => {
  it("leaves blank text and missing units alone", () => {
    expect(withUnit("", "mm")).toBe("");
    expect(withUnit("12", undefined)).toBe("12");
    expect(withUnit("12", "")).toBe("12");
    expect(withUnit("240", "mm")).toBe("240 mm");
  });
});

describe("formatCount", () => {
  it("groups whole counts", () => {
    expect(formatCount(5_800_000)).toBe("5,800,000");
    expect(formatCount(13)).toBe("13");
    expect(formatCount(null, "—")).toBe("—");
  });

  it("prints every count as lib/aql's formatCount does, so either import gives the same text", () => {
    for (const count of [0, 7, 13, 999, 1000, 80_000, 120_000, 1_700_000, 5_800_000, 123_456_789]) {
      expect(formatCount(count)).toBe(aqlFormatCount(count));
    }
  });
});

describe("formatPercent", () => {
  it("prints a value already in percent", () => {
    expect(formatPercent(88)).toBe("88%");
    expect(formatPercent(0.48, { maxDecimals: 2 })).toBe("0.48%");
    expect(formatPercent(0.8, { decimals: 1 })).toBe("0.8%");
    expect(formatPercent(null, { empty: "—" })).toBe("—");
  });
});

describe("toPercent", () => {
  it("scales a fraction without binary noise", () => {
    expect(toPercent(3 / 625)).toBe(0.48);
    expect(toPercent(0.07)).toBe(7);
    expect(toPercent(1 / 125)).toBe(0.8);
  });
});
