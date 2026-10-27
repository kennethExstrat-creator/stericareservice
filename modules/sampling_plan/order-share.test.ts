import { describe, expect, it } from "vitest";
import { orderShareText, orderShareTotalText } from "./order-share";

describe("the Order Qty row as weighted average % (Kenneth, 27 October 2026)", () => {
  it("gives each size's share of the cases ordered, one decimal", () => {
    // His screenshot: S 1,120, M 2,081, L 1,100 and XL 250 of 4,551 cases.
    expect([1120, 2081, 1100, 250].map((cases) => orderShareText(cases, 4551))).toEqual(["24.6%", "45.7%", "24.2%", "5.5%"]);
    expect(orderShareTotalText(4551)).toBe("100%");
  });

  it("shows nothing while a size has no cases or none are ordered", () => {
    expect(orderShareText(null, 4551)).toBeNull();
    expect(orderShareText(100, null)).toBeNull();
    expect(orderShareText(0, 0)).toBeNull();
    expect(orderShareTotalText(null)).toBeNull();
    expect(orderShareTotalText(0)).toBeNull();
  });
});
