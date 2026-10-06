import { describe, expect, it } from "vitest";
import { checkSpec, type Spec } from "@/lib/stats";
import { isJsonObject, isTagged, mergeConfig } from "./merge";

describe("mergeConfig", () => {
  it("merges objects key by key, recursively", () => {
    const base = { handSplit: false, classes: { major: { aql: 2.5, defects: ["thin_spot"] }, minor: { aql: 4 } } };
    expect(mergeConfig(base, { classes: { major: { aql: 1.5 } } })).toEqual({
      handSplit: false,
      classes: { major: { aql: 1.5, defects: ["thin_spot"] }, minor: { aql: 4 } },
    });
  });

  it("replaces lists whole: a defect list is never half merged", () => {
    expect(mergeConfig({ defects: ["a", "b", "c"] }, { defects: ["d"] })).toEqual({ defects: ["d"] });
  });

  it("replaces numbers, strings, booleans and null, and an object with a non-object", () => {
    expect(mergeConfig({ n: 13, unit: "inner box", on: true, spec: { min: 6 } }, { n: 1, unit: "pouch", on: false, spec: null })).toEqual({
      n: 1,
      unit: "pouch",
      on: false,
      spec: null,
    });
    expect(mergeConfig({ spec: null }, { spec: { min: 6 } })).toEqual({ spec: { min: 6 } });
  });

  it("replaces a tagged object whole: a spec that changes kind keeps no old limit", () => {
    const xsWidth: Spec = { kind: "max", max: 80 };
    const safedon: Spec = { kind: "tolerance", nominal: 76, tolerance: 4 };
    const base = { statistic: "median", specs: { XS: { width: xsWidth, length: { kind: "min", min: 240 } } } };
    const merged = mergeConfig(base, { statistic: "average", specs: { XS: { width: safedon } } });
    expect(merged).toEqual({
      statistic: "average",
      specs: { XS: { width: { kind: "tolerance", nominal: 76, tolerance: 4 }, length: { kind: "min", min: 240 } } },
    });
    const width = (merged.specs as { XS: { width: Spec } }).XS.width;
    expect(checkSpec(81, width)).toBe("fail");
    expect(checkSpec(79, width)).toBe("pass");
  });

  it("replaces a tagged object even with the same kind, and an untagged object over a tagged one", () => {
    expect(mergeConfig({ spec: { kind: "tolerance", nominal: 95, tolerance: 10 } }, { spec: { kind: "tolerance", nominal: 98, tolerance: 4 } })).toEqual({
      spec: { kind: "tolerance", nominal: 98, tolerance: 4 },
    });
    // Not merged into a hybrid: the module's schema then reports the missing kind.
    expect(mergeConfig({ spec: { kind: "max", max: 80 } }, { spec: { max: 75 } })).toEqual({ spec: { max: 75 } });
    expect(isTagged({ kind: "na" })).toBe(true);
    expect(isTagged({ min: 6 })).toBe(false);
  });

  it("adds keys the base lacks and keeps keys the override leaves out", () => {
    expect(mergeConfig({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("changes neither input", () => {
    const base = { classes: { major: { aql: 2.5 } } };
    const override = { classes: { major: { aql: 1.5 } } };
    mergeConfig(base, override);
    expect(base).toEqual({ classes: { major: { aql: 2.5 } } });
    expect(override).toEqual({ classes: { major: { aql: 1.5 } } });
  });

  it("knows a JSON object from a list or null", () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject("x")).toBe(false);
  });
});
