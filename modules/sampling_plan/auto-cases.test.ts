import { describe, expect, it } from "vitest";
import { autoSampleCases } from "./auto-cases";

const orderOf = (cases: Record<string, number | null>) => (size: string) => cases[size] ?? null;

describe("autoSampleCases (Auto Calculate Sampling, Kenneth, 26 October 2026)", () => {
  it("gives each size its share of the square root of the order's cases, rounded up", () => {
    // The paper form's PO: 1,120 + 2,081 + 1,100 + 250 = 4,551 cases, √4,551 ≈ 67.46.
    const sizes = ["S", "M", "L", "XL"];
    expect(autoSampleCases(sizes, orderOf({ S: 1120, M: 2081, L: 1100, XL: 250 }))).toEqual({ S: 17, M: 31, L: 17, XL: 4 });
    // The same total split as on screen: 920 + 1,811 + 1,430 + 390.
    expect(autoSampleCases(sizes, orderOf({ S: 920, M: 1811, L: 1430, XL: 390 }))).toEqual({ S: 14, M: 27, L: 22, XL: 6 });
  });

  it("takes a share that comes out whole as it is, not one more", () => {
    // √100 = 10: 25 of 100 cases is 2.5, so 3; 50 of 100 is exactly 5.
    expect(autoSampleCases(["S", "M", "L"], orderOf({ S: 25, M: 25, L: 50 }))).toEqual({ S: 3, M: 3, L: 5 });
  });

  it("never asks for more cases than the size has", () => {
    // √3 ≈ 1.73: a size of 1 case could round up past it.
    expect(autoSampleCases(["S", "M"], orderOf({ S: 1, M: 2 }))).toEqual({ S: 1, M: 2 });
    expect(autoSampleCases(["M"], orderOf({ M: 2900 }))).toEqual({ M: 54 });
  });

  it("waits for every size's order quantity", () => {
    expect(autoSampleCases(["S", "M"], orderOf({ S: 100, M: null }))).toBeNull();
    expect(autoSampleCases(["S", "M"], orderOf({ S: 100, M: 0 }))).toBeNull();
    expect(autoSampleCases([], orderOf({}))).toBeNull();
    expect(autoSampleCases(["S", "M"], orderOf({ S: 100, M: null }), true)).toBeNull();
  });
});

describe("autoSampleCases rounded up to the nearest 5 or 10 (Sampling Settings, Kenneth, 27 October 2026)", () => {
  // "round up to nearest 5 or 10, which means 72 round to 75, 78 round to 80, not either 5 or 10".
  const sizes = ["S", "M", "L", "XL"];
  // The paper form's PO again: the formula gives 17, 31, 17 and 4.
  const order = orderOf({ S: 1120, M: 2081, L: 1100, XL: 250 });

  it("rounds each size's cases up to the next multiple of 5: 72 to 75, 78 to 80", () => {
    expect(autoSampleCases(sizes, order, true)).toEqual({ S: 20, M: 35, L: 20, XL: 5 });
    // √10,000 = 100: 72 and 78 of every 100 cases.
    expect(autoSampleCases(["S", "M"], orderOf({ S: 7200, M: 2800 }), true)).toEqual({ S: 75, M: 30 });
    expect(autoSampleCases(["S", "M"], orderOf({ S: 7800, M: 2200 }), true)).toEqual({ S: 80, M: 25 });
  });

  it("keeps a share that is already a multiple of 5 or 10, and takes a small one up to 5", () => {
    // √10,000 = 100: 75 and 80 of every 100 cases stay; 4 of them is 5.
    expect(autoSampleCases(["S", "M"], orderOf({ S: 7500, M: 2500 }), true)).toEqual({ S: 75, M: 25 });
    expect(autoSampleCases(["S", "M"], orderOf({ S: 8000, M: 2000 }), true)).toEqual({ S: 80, M: 20 });
    expect(autoSampleCases(["S", "M"], orderOf({ S: 400, M: 9600 }), true)).toEqual({ S: 5, M: 100 });
  });

  it("still never asks for more cases than the size has", () => {
    expect(autoSampleCases(["S", "M"], orderOf({ S: 1, M: 2 }), true)).toEqual({ S: 1, M: 2 });
    // √1,000 ≈ 31.6: S's share of its 3 cases is 1, rounded to 5 and back to its 3; M's 32 to 35.
    expect(autoSampleCases(["S", "M"], orderOf({ S: 3, M: 997 }), true)).toEqual({ S: 3, M: 35 });
  });

  it("gives today's numbers with the setting off", () => {
    expect(autoSampleCases(sizes, order, false)).toEqual({ S: 17, M: 31, L: 17, XL: 4 });
    expect(autoSampleCases(sizes, order, false)).toEqual(autoSampleCases(sizes, order));
  });
});
