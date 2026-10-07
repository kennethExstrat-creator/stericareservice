// Which size a per-size Capture reports for photo tags (BUILD_SPEC 8.1): the
// size on screen, only while it is the only one. The hooks themselves run in
// the browser (e2e); these are the decisions they make.
import { describe, expect, it } from "vitest";
import { sizeOnTabs, sizeShownAlone } from "./shown-size";

describe("sizeOnTabs", () => {
  it("is the module's size while it is ordered", () => {
    expect(sizeOnTabs(["S", "M", "L"], "L")).toBe("L");
  });

  it("is the first size ordered for a size taken out of the order, as SizeTabs shows it", () => {
    expect(sizeOnTabs(["S", "M"], "XL")).toBe("S");
    expect(sizeOnTabs(["S", "M"], "")).toBe("S");
  });

  it("is empty while no size is ordered: nothing to report", () => {
    expect(sizeOnTabs([], "M")).toBe("");
  });
});

describe("sizeShownAlone", () => {
  it("is the size on the tabs while the sizes do not sit side by side (the iPad, below 1280 px)", () => {
    expect(sizeShownAlone(["S", "M", "L"], "M", false)).toBe("M");
  });

  it("is nothing while every size sits side by side: no one size is on screen", () => {
    expect(sizeShownAlone(["S", "M", "L"], "M", true)).toBeNull();
  });

  it("is the one size ordered, side by side or not", () => {
    expect(sizeShownAlone(["M"], "M", true)).toBe("M");
    expect(sizeShownAlone(["M"], "M", false)).toBe("M");
  });
});
