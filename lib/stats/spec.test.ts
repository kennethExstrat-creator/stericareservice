import { describe, expect, it } from "vitest";
import { checkSpec, formatSpec, type Spec } from "./spec";

describe("checkSpec", () => {
  it("checks a minimum, inclusive (Length ≥ 240)", () => {
    const spec: Spec = { kind: "min", min: 240 };
    expect(checkSpec(240, spec)).toBe("pass");
    expect(checkSpec(243, spec)).toBe("pass");
    expect(checkSpec(239.9, spec)).toBe("fail");
  });

  it("checks a maximum, inclusive (Width XS ≤ 80)", () => {
    const spec: Spec = { kind: "max", max: 80 };
    expect(checkSpec(80, spec)).toBe("pass");
    expect(checkSpec(80.5, spec)).toBe("fail");
  });

  it("checks a range, inclusive at both ends", () => {
    const spec: Spec = { kind: "range", min: 0.05, max: 0.1 };
    expect(checkSpec(0.05, spec)).toBe("pass");
    expect(checkSpec(0.1, spec)).toBe("pass");
    expect(checkSpec(0.11, spec)).toBe("fail");
    expect(checkSpec(0.04, spec)).toBe("fail");
  });

  it("checks a nominal with tolerance (Width M 95 ± 10)", () => {
    const spec: Spec = { kind: "tolerance", nominal: 95, tolerance: 10 };
    expect(checkSpec(85, spec)).toBe("pass");
    expect(checkSpec(105, spec)).toBe("pass");
    expect(checkSpec(105.1, spec)).toBe("fail");
    expect(checkSpec(84.9, spec)).toBe("fail");
  });

  it("does not fail a value on the limit because of binary noise", () => {
    // 0.18 + 0.04 is 0.22000000000000003 in floating point.
    const spec: Spec = { kind: "tolerance", nominal: 0.18, tolerance: 0.04 };
    expect(checkSpec(0.22, spec)).toBe("pass");
    expect(checkSpec(0.14, spec)).toBe("pass");
  });

  it("has no outcome without a spec (NA)", () => {
    expect(checkSpec(0.11, { kind: "na" })).toBe("na");
  });
});

describe("formatSpec", () => {
  it("prints specs the way the reports do", () => {
    expect(formatSpec({ kind: "min", min: 240 })).toBe("≥ 240");
    expect(formatSpec({ kind: "max", max: 80 })).toBe("≤ 80");
    expect(formatSpec({ kind: "range", min: 0.05, max: 0.1 })).toBe("0.05 – 0.1");
    expect(formatSpec({ kind: "tolerance", nominal: 0.18, tolerance: 0.04 })).toBe("0.18 ± 0.04");
    expect(formatSpec({ kind: "na" })).toBe("NA");
  });
});
