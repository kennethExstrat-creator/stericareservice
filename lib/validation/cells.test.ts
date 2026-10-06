import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CartonNumberCellSchema,
  CountCellSchema,
  DateCellSchema,
  DecimalCellSchema,
  isBlank,
  readCountCell,
  readDecimalCell,
  TextCellSchema,
  YesNoCellSchema,
} from "./cells";

describe("cell schemas (BUILD_SPEC 6.2 rules 1 to 3)", () => {
  it("store numbers as numbers: text in a numeric cell is rejected, never kept", () => {
    expect(DecimalCellSchema.parse(2.42)).toBe(2.42);
    expect(DecimalCellSchema.parse(undefined)).toBeNull();
    for (const text of ["2 42", "2.42", "243mm", ""]) expect(DecimalCellSchema.safeParse(text).success).toBe(false);
    expect(DecimalCellSchema.safeParse(Number.NaN).success).toBe(false);
    expect(DecimalCellSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it("keep counts whole and never let them turn into dates", () => {
    expect(CountCellSchema.parse(1)).toBe(1);
    for (const value of [1.5, -1, "1/80", "1980-01-01", new Date(1980, 0, 1)]) {
      expect(CountCellSchema.safeParse(value).success).toBe(false);
    }
    expect(CartonNumberCellSchema.safeParse(0).success).toBe(false);
    expect(CartonNumberCellSchema.parse(2389)).toBe(2389);
  });

  it("take dates from a picker as YYYY-MM-DD only", () => {
    expect(DateCellSchema.parse("2024-07-12")).toBe("2024-07-12");
    for (const value of ["12/07/2024", "2024-02-30", 45485]) expect(DateCellSchema.safeParse(value).success).toBe(false);
  });

  it("default every cell to null, so a draft parses with nothing entered", () => {
    const row = z.strictObject({
      count: CountCellSchema,
      reading: DecimalCellSchema,
      note: TextCellSchema,
      date: DateCellSchema,
      ok: YesNoCellSchema,
    });
    expect(row.parse({})).toEqual({ count: null, reading: null, note: null, date: null, ok: null });
  });
});

describe("cell readers", () => {
  it("read typed or pasted numbers with lib/stats' strict parser", () => {
    expect(readDecimalCell("2.42")).toEqual({ ok: true, value: 2.42 });
    expect(readDecimalCell("2 42")).toEqual({ ok: false, error: expect.stringContaining("space") });
    expect(readDecimalCell("401", { max: 400 })).toEqual({ ok: false, error: "Must be 400 or less." });
  });

  it("read counts as whole numbers from 0", () => {
    expect(readCountCell("13")).toEqual({ ok: true, value: 13 });
    expect(readCountCell("")).toEqual({ ok: true, value: null });
    expect(readCountCell("1.5")).toEqual({ ok: false, error: "Whole numbers only, e.g. 3." });
    expect(readCountCell("-1")).toEqual({ ok: false, error: "Must be 0 or more." });
    expect(readCountCell("1/80").ok).toBe(false);
    expect(readCountCell("1980-01-01").ok).toBe(false);
  });

  it("tell an empty cell", () => {
    for (const value of [null, undefined, "", "  ", []]) expect(isBlank(value)).toBe(true);
    for (const value of [0, false, "x", [1]]) expect(isBlank(value)).toBe(false);
  });
});
