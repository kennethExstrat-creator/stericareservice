import { describe, expect, it } from "vitest";
import { formatSpec as statsFormatSpec, type Spec } from "@/lib/stats";
import { formatSpec, hasLimit } from "./spec";

describe("formatSpec", () => {
  it("prints the report specs", () => {
    expect(formatSpec({ kind: "min", min: 240 })).toBe("≥ 240");
    expect(formatSpec({ kind: "max", max: 80 })).toBe("≤ 80");
    expect(formatSpec({ kind: "tolerance", nominal: 80, tolerance: 10 })).toBe("80 ± 10");
    expect(formatSpec({ kind: "range", min: 0.05, max: 0.1 })).toBe("0.05 – 0.1");
    expect(formatSpec({ kind: "na" })).toBe("NA");
  });

  it("adds units, with % attached", () => {
    expect(formatSpec({ kind: "min", min: 6 }, { unit: "N" })).toBe("≥ 6 N");
    expect(formatSpec({ kind: "max", max: 5 }, { unit: "%" })).toBe("≤ 5%");
    expect(formatSpec({ kind: "min", min: 500 }, { unit: "%" })).toBe("≥ 500%");
    expect(formatSpec({ kind: "tolerance", nominal: 95, tolerance: 10 }, { unit: "mm" })).toBe("95 ± 10 mm");
  });

  it("prints every limit at the template's decimals", () => {
    expect(formatSpec({ kind: "min", min: 14 }, { decimals: 2, unit: "MPa" })).toBe("≥ 14.00 MPa");
    expect(formatSpec({ kind: "range", min: 0.05, max: 0.1 }, { decimals: 2 })).toBe("0.05 – 0.10");
    expect(formatSpec({ kind: "tolerance", nominal: 0.18, tolerance: 0.04 }, { decimals: 2 })).toBe("0.18 ± 0.04");
  });

  it("never puts a unit on NA, and treats no spec as NA", () => {
    expect(formatSpec({ kind: "na" }, { unit: "mm", decimals: 2 })).toBe("NA");
    expect(formatSpec(null)).toBe("NA");
    expect(formatSpec(undefined, { unit: "g" })).toBe("NA");
  });

  it("prints a computed limit without binary noise", () => {
    expect(formatSpec({ kind: "tolerance", nominal: 0.1 + 0.2, tolerance: 0.05 })).toBe("0.3 ± 0.05");
    expect(formatSpec({ kind: "max", max: 1.1 * 3 }, { unit: "mm" })).toBe("≤ 3.3 mm");
  });

  it("matches lib/stats without options", () => {
    const specs: Spec[] = [
      { kind: "min", min: 240 },
      { kind: "max", max: 80 },
      { kind: "range", min: 0.05, max: 0.1 },
      { kind: "tolerance", nominal: 0.18, tolerance: 0.04 },
      { kind: "na" },
    ];
    for (const spec of specs) expect(formatSpec(spec)).toBe(statsFormatSpec(spec));
  });
});

describe("hasLimit", () => {
  it("is false for NA and no spec", () => {
    expect(hasLimit({ kind: "min", min: 1 })).toBe(true);
    expect(hasLimit({ kind: "na" })).toBe(false);
    expect(hasLimit(null)).toBe(false);
    expect(hasLimit(undefined)).toBe(false);
  });
});
