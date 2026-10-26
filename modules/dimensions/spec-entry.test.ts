import { describe, expect, it } from "vitest";
import { fieldsOf, figuresOf, SPEC_KINDS, specFromFigures } from "./spec-entry";

describe("the Change the Spec dialog's form (Kenneth, 26 October 2026)", () => {
  it("offers every kind of spec the template takes, NA included, in Title Case", () => {
    expect(SPEC_KINDS.map((entry) => entry.kind)).toEqual(["min", "max", "tolerance", "range", "na"]);
    expect(SPEC_KINDS.map((entry) => entry.label)).toEqual([
      "At Least (≥)",
      "At Most (≤)",
      "Nominal ± Tolerance",
      "Range (From – To)",
      "NA (No Spec)",
    ]);
    expect(fieldsOf("tolerance")).toEqual(["Nominal", "Tolerance"]);
    expect(fieldsOf("na")).toEqual([]);
  });

  it("makes each kind of spec from the figures typed, a decimal comma included", () => {
    expect(specFromFigures("min", { first: "240", second: "" })).toEqual({ spec: { kind: "min", min: 240 } });
    expect(specFromFigures("max", { first: "80", second: "" })).toEqual({ spec: { kind: "max", max: 80 } });
    expect(specFromFigures("tolerance", { first: "0,18", second: "0.04" })).toEqual({
      spec: { kind: "tolerance", nominal: 0.18, tolerance: 0.04 },
    });
    expect(specFromFigures("range", { first: "230", second: "250" })).toEqual({ spec: { kind: "range", min: 230, max: 250 } });
    expect(specFromFigures("na", { first: "240", second: "" })).toEqual({ spec: { kind: "na" } });
  });

  it("says what is wrong with the figures, in a sentence", () => {
    expect(specFromFigures("min", { first: "", second: "" })).toEqual({ error: "Enter a figure for At Least, in mm." });
    expect(specFromFigures("tolerance", { first: "0.18", second: "" })).toEqual({ error: "Enter a figure for Tolerance, in mm." });
    expect(specFromFigures("max", { first: "eighty", second: "" })).toEqual({ error: "At Most: Numbers only, e.g. 2.42." });
    expect(specFromFigures("tolerance", { first: "80", second: "-10" })).toEqual({ error: "The tolerance cannot be below 0." });
    expect(specFromFigures("range", { first: "250", second: "230" })).toEqual({ error: "From must not be more than To." });
  });

  it("starts from the spec in force, figure by figure", () => {
    expect(figuresOf({ kind: "tolerance", nominal: 95, tolerance: 10 })).toEqual({ first: "95", second: "10" });
    expect(figuresOf({ kind: "range", min: 230, max: 250 })).toEqual({ first: "230", second: "250" });
    expect(figuresOf({ kind: "na" })).toEqual({ first: "", second: "" });
    expect(figuresOf(null)).toEqual({ first: "", second: "" });
  });
});
