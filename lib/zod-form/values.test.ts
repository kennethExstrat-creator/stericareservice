import { describe, expect, it } from "vitest";
import { describeSchema, type FormNode } from "./describe";
import { z } from "zod";
import { humanize, numberRange, optionText } from "./labels";
import { deepEqual, emptyValue, emptyVariant, getAt, moveItem, setAt, variantOf } from "./values";
import { DimensionsLikeSchema, DispensingLikeSchema, MARKERS, WatertightLikeSchema } from "./__fixtures__/schemas";

describe("getAt and setAt", () => {
  const value = { a: { b: [1, { c: "x" }] }, d: true };

  it("reads by path, and gives undefined past the end", () => {
    expect(getAt(value, ["a", "b", 1, "c"])).toBe("x");
    expect(getAt(value, ["a", "z", 0])).toBeUndefined();
    expect(getAt(value, [])).toBe(value);
  });

  it("replaces without changing the original", () => {
    const next = setAt(value, ["a", "b", 1, "c"], "y");
    expect(getAt(next, ["a", "b", 1, "c"])).toBe("y");
    expect(getAt(value, ["a", "b", 1, "c"])).toBe("x");
    expect(getAt(next, ["d"])).toBe(true);
  });

  it("removes a key or a list item with undefined, and builds what is missing", () => {
    expect(setAt(value, ["d"], undefined)).toEqual({ a: { b: [1, { c: "x" }] } });
    expect(setAt(value, ["a", "b", 0], undefined)).toEqual({ a: { b: [{ c: "x" }] }, d: true });
    expect(setAt({}, ["x", "y"], 1)).toEqual({ x: { y: 1 } });
  });
});

describe("deepEqual and moveItem", () => {
  it("compares JSON by content, ignoring key order and missing keys", () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ kind: "min", min: 1 }, { kind: "min", min: 2 })).toBe(false);
  });

  it("moves list items, and leaves impossible moves alone", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});

describe("emptyValue", () => {
  const nodeOf = (schema: Parameters<typeof describeSchema>[0]) => describeSchema(schema, { markers: MARKERS });

  it("fills in what a new list item needs, and leaves numbers to be entered", () => {
    const watertight = nodeOf(WatertightLikeSchema);
    if (watertight.kind !== "object") throw new Error("expected an object");
    const locations = watertight.properties.find((entry) => entry.key === "locations")?.node as FormNode;
    if (locations.kind !== "array") throw new Error("expected a list");
    expect(emptyValue(locations.items)).toEqual({ code: "", label: "" });

    const dispensing = nodeOf(DispensingLikeSchema);
    expect(emptyValue(dispensing)).toEqual({ stickinessCodes: [], boxesPerSize: {} });
  });

  it("starts nullable values at none, options at the first, and a default as given", () => {
    const dimensions = nodeOf(DimensionsLikeSchema);
    expect(emptyValue(dimensions)).toEqual({
      measures: [],
      statistic: "median",
      specs: [],
      decimals: {},
      rows: null,
    });
  });

  it("switches a union's variant and keeps the values both share", () => {
    const dimensions = nodeOf(DimensionsLikeSchema);
    if (dimensions.kind !== "object") throw new Error("expected an object");
    const specs = dimensions.properties.find((entry) => entry.key === "specs")?.node as FormNode;
    if (specs.kind !== "array" || specs.items.kind !== "object") throw new Error("expected a list of rows");
    const perMeasure = specs.items.properties.find((entry) => entry.key === "specs")?.node as FormNode;
    if (perMeasure.kind !== "object") throw new Error("expected an object");
    const spec = perMeasure.properties[0].node;
    if (spec.kind !== "union") throw new Error("expected a union");

    expect(emptyVariant(spec, "range", { kind: "min", min: 240 })).toEqual({ kind: "range", min: 240 });
    expect(emptyVariant(spec, "na", { kind: "min", min: 240 })).toEqual({ kind: "na" });
    expect(emptyVariant(spec, "tolerance")).toEqual({ kind: "tolerance" });
    expect(variantOf(spec, { kind: "max", max: 80 })).toBe("max");
    expect(variantOf(spec, { kind: "weird" })).toBeUndefined();
    expect(emptyValue(spec)).toEqual({ kind: "min" });
  });
});

describe("labels", () => {
  it("humanizes keys", () => {
    expect(humanize("minLayeringPct")).toBe("Min layering %");
    expect(humanize("indicativeWeightSize")).toBe("Indicative weight size");
    expect(humanize("hole_crotch")).toBe("Hole crotch");
    expect(humanize("aql")).toBe("AQL");
    expect(humanize("n")).toBe("n");
    expect(humanize("EN455")).toBe("EN455");
  });

  it("shows options as written when they are codes", () => {
    expect(optionText("S-1")).toBe("S-1");
    expect(optionText("II")).toBe("II");
    expect(optionText("7.0")).toBe("7.0");
    expect(optionText("median")).toBe("Median");
    expect(optionText(1.5)).toBe("1.5");
    expect(optionText(null)).toBe("None");
  });

  it("says what a number accepts, from the schema's own limits", () => {
    const range = (schema: z.ZodType) => {
      const node = describeSchema(schema);
      return node.kind === "number" ? numberRange(node) : `not a number: ${node.kind}`;
    };
    expect(range(z.number().min(0).max(100))).toBe("0 to 100.");
    expect(range(z.number().int().min(1).max(10_000))).toBe("Whole number, 1 to 10,000.");
    expect(range(z.number().positive())).toBe("More than 0.");
    expect(range(z.number().int().positive())).toBe("Whole number, more than 0.");
    expect(range(z.number().max(5))).toBe("5 or less.");
    expect(range(z.number().gt(0).lte(1.5))).toBe("More than 0 and 1.5 or less.");
    expect(range(z.number().int())).toBe("Whole number.");
    expect(range(z.number())).toBeUndefined();
  });
});
