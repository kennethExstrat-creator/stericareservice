import { describe, expect, it } from "vitest";
import { formatHand, formatSize, formatSizeHand, formatSizeList } from "./size";

const sizes = [{ value: "XS" }, { value: "M", label: "Medium" }, { value: "7.0" }, { value: "L", label: "  " }];

describe("formatSize", () => {
  it("prints the canonical size, or the template's label", () => {
    expect(formatSize("XS")).toBe("XS");
    expect(formatSize("7.0")).toBe("7.0");
    expect(formatSize("M", { sizes })).toBe("Medium");
    expect(formatSize("XL", { sizes })).toBe("XL");
  });

  it("ignores a blank template label", () => {
    expect(formatSize("L", { sizes })).toBe("L");
  });

  it("can prefix the word Size", () => {
    expect(formatSize("M", { prefix: true })).toBe("Size M");
    expect(formatSize("M", { sizes, prefix: true })).toBe("Size Medium");
  });
});

describe("formatSizeList", () => {
  it("joins sizes in the order given", () => {
    expect(formatSizeList(["XS", "S", "M"])).toBe("XS, S, M");
    expect(formatSizeList(["M", "7.0"], { sizes })).toBe("Medium, 7.0");
    expect(formatSizeList([])).toBe("");
  });
});

describe("formatHand", () => {
  it("names the hand", () => {
    expect(formatHand("R")).toBe("Right hand");
    expect(formatHand("L", "short")).toBe("L");
  });
});

describe("formatSizeHand", () => {
  it("names a size and hand for accessible names", () => {
    expect(formatSizeHand("M", "R")).toBe("Size M, right hand");
    expect(formatSizeHand("7.0", "L")).toBe("Size 7.0, left hand");
    expect(formatSizeHand("M", null, { sizes })).toBe("Size Medium");
  });
});
