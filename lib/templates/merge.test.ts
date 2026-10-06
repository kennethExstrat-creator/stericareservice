import { describe, expect, it } from "vitest";
import { isJsonObject, mergeConfig } from "./merge";

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
