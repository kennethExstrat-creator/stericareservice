import { describe, expect, it } from "vitest";
import { formatDecimal, formatReading, parseDecimal, rangeError, readDecimal } from "./number";

describe("parseDecimal", () => {
  it.each([
    ["243", 243],
    ["2.42", 2.42],
    [" 0.11 ", 0.11],
    [".5", 0.5],
    ["5.", 5],
    ["-1.5", -1.5],
    ["0", 0],
  ])("reads %j as %d", (raw, value) => {
    expect(parseDecimal(raw)).toEqual({ ok: true, value });
  });

  it("treats blank as no value", () => {
    expect(parseDecimal("")).toEqual({ ok: true, value: null });
    expect(parseDecimal("   ")).toEqual({ ok: true, value: null });
  });

  it("reads a lone decimal comma", () => {
    expect(parseDecimal("2,42")).toEqual({ ok: true, value: 2.42 });
    expect(parseDecimal("0,1")).toEqual({ ok: true, value: 0.1 });
  });

  it("rejects a comma that could be a thousands separator", () => {
    const result = parseDecimal("1,234");
    expect(result.ok).toBe(false);
  });

  it("rejects a reading split by a space (BUILD_SPEC 6.2 rule 1)", () => {
    const result = parseDecimal("2 42");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("space") });
  });

  it.each(["abc", "2.4.2", "1e3", "12mm", "NaN", "Infinity", "--1", "1,2,3", "+", "-", "."])(
    "rejects %j",
    (raw) => {
      expect(parseDecimal(raw).ok).toBe(false);
    },
  );
});

describe("rangeError", () => {
  it("passes values inside the limits, inclusive", () => {
    expect(rangeError(0, { min: 0 })).toBeNull();
    expect(rangeError(400, { max: 400 })).toBeNull();
    expect(rangeError(5, {})).toBeNull();
  });

  it("explains values outside the limits", () => {
    expect(rangeError(-1, { min: 0 })).toBe("Must be 0 or more.");
    expect(rangeError(401, { min: 0, max: 400 })).toBe("Must be 400 or less.");
  });
});

describe("readDecimal", () => {
  it("accepts numbers inside the limits and blank", () => {
    expect(readDecimal("243", { min: 0, max: 400 })).toEqual({ ok: true, value: 243 });
    expect(readDecimal("", { min: 0 })).toEqual({ ok: true, value: null });
  });

  it("rejects text and out-of-range numbers alike", () => {
    expect(readDecimal("2 42", { min: 0 }).ok).toBe(false);
    expect(readDecimal("-1", { min: 0 })).toEqual({ ok: false, error: "Must be 0 or more." });
  });
});

describe("formatReading", () => {
  it("pads to the measure's decimals without rounding", () => {
    expect(formatReading(0.1, 2)).toBe("0.10");
    expect(formatReading(243, 1)).toBe("243.0");
    expect(formatReading(0.105, 2)).toBe("0.105");
    expect(formatReading(2.42, 0)).toBe("2.42");
  });

  it("is blank for no value", () => {
    expect(formatReading(null, 2)).toBe("");
  });
});

describe("formatDecimal", () => {
  it("is blank for no value", () => {
    expect(formatDecimal(null)).toBe("");
    expect(formatDecimal(null, 2)).toBe("");
  });

  it("prints the value as entered without fixed decimals", () => {
    expect(formatDecimal(243)).toBe("243");
    expect(formatDecimal(0.105)).toBe("0.105");
  });

  it("pads and rounds to fixed decimals", () => {
    expect(formatDecimal(243, 1)).toBe("243.0");
    expect(formatDecimal(1.005, 2)).toBe("1.01");
    expect(formatDecimal(0.1125, 3)).toBe("0.113");
  });
});
