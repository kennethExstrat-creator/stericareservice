import { describe, expect, it } from "vitest";
import {
  CanonicalSizeSchema,
  compareSizes,
  isCanonicalSize,
  isValidSize,
  LETTER_SIZES,
  normaliseSize,
  NUMERIC_SIZES,
  orderSizes,
  parseSize,
  SizeInputSchema,
  sizeKind,
  sortSizes,
} from "./sizes";

describe("normaliseSize", () => {
  it.each([
    ["7", "7.0"],
    ["7.0", "7.0"],
    ["7,5", "7.5"],
    ["7.50", "7.5"],
    [" 6.5 ", "6.5"],
    ["5.5", "5.5"],
    ["9", "9.0"],
    ["09", "9.0"],
  ])("writes surgical size %j as %j", (raw, size) => {
    expect(normaliseSize(raw)).toBe(size);
  });

  it.each([
    ["m", "M"],
    [" xl ", "XL"],
    ["Medium", "M"],
    ["x-small", "XS"],
    ["Extra Large", "XL"],
    ["2XL", "XXL"],
    ["xxl", "XXL"],
  ])("writes letter size %j as %j", (raw, size) => {
    expect(normaliseSize(raw)).toBe(size);
  });

  it.each(["", "  ", "XXXL", "medium-ish", "5", "9.5", "7.25", "10", "7 0", "7.0.0", "-7", "M/L"])(
    "rejects %j",
    (raw) => {
      expect(normaliseSize(raw)).toBeNull();
      expect(isValidSize(raw)).toBe(false);
    },
  );

  it("explains why a size is rejected", () => {
    expect(parseSize("")).toEqual({ ok: false, error: "Enter a size." });
    expect(parseSize("9.5")).toEqual({ ok: false, error: expect.stringContaining("5.5 to 9.0") });
    expect(parseSize("XXXL")).toEqual({ ok: false, error: expect.stringContaining('Unknown size "XXXL"') });
  });

  it("knows the canonical lists", () => {
    for (const size of [...LETTER_SIZES, ...NUMERIC_SIZES]) expect(isCanonicalSize(size)).toBe(true);
    expect(NUMERIC_SIZES).toHaveLength(8);
  });
});

describe("isCanonicalSize and sizeKind", () => {
  it("accepts only the stored spelling", () => {
    expect(isCanonicalSize("7.0")).toBe(true);
    expect(isCanonicalSize("7")).toBe(false);
    expect(isCanonicalSize("m")).toBe(false);
    expect(isCanonicalSize("Q")).toBe(false);
  });

  it("tells letter sizes from surgical sizes", () => {
    expect(sizeKind("M")).toBe("letter");
    expect(sizeKind("7")).toBe("numeric");
    expect(sizeKind("Q")).toBeNull();
  });
});

describe("size order", () => {
  it("sorts letters XS to XXL, then surgical sizes ascending, then anything else", () => {
    expect(sortSizes(["XL", "7.5", "S", "zz", "M", "6.0", "XS", "XXL", "L"])).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "6.0",
      "7.5",
      "zz",
    ]);
    expect(compareSizes("7", "7.0")).not.toBe(0);
    expect(compareSizes("6.5", "7")).toBeLessThan(0);
  });

  it("orders by a template's list first, then canonically, normalised and without duplicates", () => {
    expect(orderSizes(["l", "XS", "M", "m", "XXL"], ["XS", "S", "M", "L", "XL"])).toEqual(["XS", "M", "L", "XXL"]);
    expect(orderSizes(["8", "6.5", "7"], ["7.0", "6.5"])).toEqual(["7.0", "6.5", "8.0"]);
    expect(orderSizes(["M", "nonsense", "S"])).toEqual(["S", "M"]);
  });
});

describe("size schemas", () => {
  it("accepts any spelling as input, only the canonical one when stored", () => {
    expect(SizeInputSchema.safeParse("m").success).toBe(true);
    expect(SizeInputSchema.safeParse("XXXL").success).toBe(false);
    expect(CanonicalSizeSchema.safeParse("M").success).toBe(true);
    expect(CanonicalSizeSchema.safeParse("7").success).toBe(false);
  });
});
