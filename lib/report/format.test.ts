import { describe, expect, it } from "vitest";
import {
  AGEING_CONDITION,
  AGEING_HEADING,
  AGEING_LINE,
  AGEING_SENTENCE,
  andList,
  aqlText,
  counted,
  longDate,
  rangeText,
  shareText,
  sharesOf,
  weekdayDate,
} from "./format";

describe("the report's dates", () => {
  it("print a day in full, a month kept at month precision as month and year, the inspection day with its weekday", () => {
    expect(longDate("2026-10-23")).toBe("23 October 2026");
    expect(longDate("2025-02")).toBe("February 2025");
    expect(weekdayDate("2026-10-23")).toBe("Friday, 23 October 2026");
    // Calendar days: never shifted by a time zone.
    expect(longDate("2026-01-01")).toBe("1 January 2026");
    expect(longDate(null)).toBeNull();
    expect(longDate("soon")).toBe("soon");
    expect(weekdayDate(undefined)).toBeNull();
  });
});

describe("the report's words", () => {
  it("list sizes as a sentence does, and count with the right noun", () => {
    expect(andList([])).toBe("");
    expect(andList(["M"])).toBe("M");
    expect(andList(["S", "M"])).toBe("S and M");
    expect(andList(["S", "M", "L", "XL"])).toBe("S, M, L and XL");
    expect(counted(1, "carton")).toBe("1 carton");
    expect(counted(4551, "carton")).toBe("4,551 cartons");
    expect(counted(2, "box", "boxes")).toBe("2 boxes");
  });

  it("print one value, or the lowest to the highest, with the unit once", () => {
    expect(rangeText([6.4, 6.6, 6.5], { decimals: 1, unit: "N" })).toBe("6.4 to 6.6 N");
    expect(rangeText([243, 243], { unit: "mm" })).toBe("243 mm");
    expect(rangeText([87, 90], { unit: "%", dash: true })).toBe("87–90%");
    expect(rangeText([null, undefined, Number.NaN])).toBeNull();
    expect(rangeText([2.9], { decimals: 2, unit: "g" })).toBe("2.90 g");
  });

  it("state the aged gloves' ageing as TG35 does, 70 °C for 7 days: under the chart's label, in the table's heading, in a sentence", () => {
    expect(AGEING_CONDITION).toEqual({ celsius: 70, days: 7 });
    expect(AGEING_LINE).toBe("70 °C · 7 days");
    expect(AGEING_HEADING).toBe("70 °C, 7 Days");
    expect(AGEING_SENTENCE).toBe("Aged at 70 °C for 7 days");
  });

  it("head an AQL as the reports do, with at least one decimal", () => {
    expect(aqlText(1.5)).toBe("AQL 1.5");
    expect(aqlText(4)).toBe("AQL 4.0");
    expect(aqlText(0)).toBe("AQL 0.0");
    expect(aqlText(0.65)).toBe("AQL 0.65");
  });
});

describe("sharesOf", () => {
  it("gives each part's share to one decimal, adding up to exactly 100", () => {
    const shares = sharesOf([1120, 2081, 1100, 250]);
    expect(shares).toEqual([24.6, 45.7, 24.2, 5.5]);
    for (const parts of [[1, 1, 1], [60, 850, 560, 60], [7, 1, 1, 1, 1, 1, 1], [999, 1], [3]]) {
      const total = sharesOf(parts).reduce((sum, share) => sum + share, 0);
      expect(Math.round(total * 10)).toBe(1000);
    }
    expect(sharesOf([1, 1, 1])).toEqual([33.4, 33.3, 33.3]);
    expect(shareText(100)).toBe("100%");
    expect(shareText(5.5)).toBe("5.5%");
  });

  it("shares nothing of nothing", () => {
    expect(sharesOf([])).toEqual([]);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
  });
});
