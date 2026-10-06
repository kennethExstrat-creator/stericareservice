import { describe, expect, it } from "vitest";
import { TEST_REGISTRY } from "./__fixtures__/test-registry";
import { isHandSplit } from "./hands";
import { canonicalPathOf, findCanonicalPath, isMappableType, parseCanonicalPath, readPath, writePath } from "./paths";

describe("canonical paths (Field.mapsTo)", () => {
  it("parse modules.<key>.<path>", () => {
    expect(parseCanonicalPath("modules.glove_info.indicativeWeight")).toEqual({
      moduleKey: "glove_info",
      segments: ["indicativeWeight"],
    });
    expect(parseCanonicalPath("modules.weight.sizes.M")).toEqual({ moduleKey: "weight", segments: ["sizes", "M"] });
    for (const bad of ["glove_info.colour", "modules.gloves.colour", "modules.glove_info", "modules.glove_info.a-b"]) {
      expect(parseCanonicalPath(bad)).toBeNull();
    }
    expect(canonicalPathOf("glove_info", "colour")).toBe("modules.glove_info.colour");
  });

  it("find the path a module declares", () => {
    expect(findCanonicalPath(TEST_REGISTRY, "modules.glove_info.indicativeWeight")).toEqual({
      moduleKey: "glove_info",
      canonical: { path: "indicativeWeight", label: "Indicative weight", type: "number", unit: "g" },
    });
    expect(findCanonicalPath(TEST_REGISTRY, "modules.glove_info.texture")).toBeNull();
    expect(findCanonicalPath(TEST_REGISTRY, "modules.dimensions.length")).toBeNull();
  });

  it("let a field hold a value of the same kind", () => {
    expect(isMappableType("number", "number")).toBe(true);
    expect(isMappableType("textarea", "text")).toBe(true);
    expect(isMappableType("counter", "number")).toBe(true);
    expect(isMappableType("number", "counter")).toBe(false);
    expect(isMappableType("text", "date")).toBe(false);
  });
});

describe("readPath and writePath", () => {
  it("read nested values and miss safely", () => {
    const value = { sizes: { M: { values: [2.9, 3.1] } } };
    expect(readPath(value, ["sizes", "M", "values", 1])).toBe(3.1);
    expect(readPath(value, ["sizes", "L", "values"])).toBeUndefined();
    expect(readPath(null, ["a"])).toBeUndefined();
  });

  it("write a copy, creating what is missing and leaving the original alone", () => {
    const value = { header: { poNo: "PO-0001" }, list: [1, 2] };
    expect(writePath(value, ["header", "productName"], "Brand X")).toEqual({
      header: { poNo: "PO-0001", productName: "Brand X" },
      list: [1, 2],
    });
    expect(writePath(value, ["list", 1], 5)).toEqual({ header: { poNo: "PO-0001" }, list: [1, 5] });
    expect(writePath(undefined, ["sizes", "M"], 1)).toEqual({ sizes: { M: 1 } });
    expect(value).toEqual({ header: { poNo: "PO-0001" }, list: [1, 2] });
  });
});

describe("isHandSplit", () => {
  it("needs a module that supports it and a config that switches it on", () => {
    expect(isHandSplit(TEST_REGISTRY.visual, { handSplit: true })).toBe(true);
    expect(isHandSplit(TEST_REGISTRY.visual, { handSplit: false })).toBe(false);
    expect(isHandSplit(TEST_REGISTRY.weight, { handSplit: true })).toBe(false);
    expect(isHandSplit(TEST_REGISTRY.visual, null)).toBe(false);
  });
});
