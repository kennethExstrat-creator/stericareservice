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
    expect(autoSampleCases(["S", "M"], orderOf({ S: 100, M: null }), 10)).toBeNull();
  });
});

describe("autoSampleCases rounded up (Sampling Settings, Kenneth, 27 October 2026: \"round up to nearest tenth or five\")", () => {
  // The paper form's PO again: the formula gives 17, 31, 17 and 4.
  const sizes = ["S", "M", "L", "XL"];
  const order = orderOf({ S: 1120, M: 2081, L: 1100, XL: 250 });

  it("rounds each size's cases up to the next multiple of 5, or of 10", () => {
    expect(autoSampleCases(sizes, order, 5)).toEqual({ S: 20, M: 35, L: 20, XL: 5 });
    expect(autoSampleCases(sizes, order, 10)).toEqual({ S: 20, M: 40, L: 20, XL: 10 });
  });

  it("keeps a share that is already a multiple", () => {
    // √100 = 10: 50 of 100 cases is exactly 5; the sizes of 25 take 3, rounded to 5.
    expect(autoSampleCases(["S", "M", "L"], orderOf({ S: 25, M: 25, L: 50 }), 5)).toEqual({ S: 5, M: 5, L: 5 });
    // √400 = 20: a multiple of 5 and of 10.
    expect(autoSampleCases(["M"], orderOf({ M: 400 }), 5)).toEqual({ M: 20 });
    expect(autoSampleCases(["M"], orderOf({ M: 400 }), 10)).toEqual({ M: 20 });
  });

  it("still never asks for more cases than the size has", () => {
    expect(autoSampleCases(["S", "M"], orderOf({ S: 1, M: 2 }), 10)).toEqual({ S: 1, M: 2 });
    // √1,000 ≈ 31.6: S's share of 7 cases is 1, rounded to 5, or to 10 and back to its 7; M's 32 to 35 or 40.
    expect(autoSampleCases(["S", "M"], orderOf({ S: 7, M: 993 }), 5)).toEqual({ S: 5, M: 35 });
    expect(autoSampleCases(["S", "M"], orderOf({ S: 7, M: 993 }), 10)).toEqual({ S: 7, M: 40 });
  });

  it("gives today's numbers with the setting off", () => {
    expect(autoSampleCases(sizes, order, null)).toEqual({ S: 17, M: 31, L: 17, XL: 4 });
    expect(autoSampleCases(sizes, order, null)).toEqual(autoSampleCases(sizes, order));
  });
});
