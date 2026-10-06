import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonValueSchema } from "@/lib/schemas/common";
import { MODULE_REGISTRY } from "@/modules/registry";
import { stubModule } from "@/modules/_framework";
import { describeSchema, unitOf, type FormNode, type ObjectNode } from "./describe";
import {
  DimensionsLikeSchema,
  DispensingLikeSchema,
  MARKERS,
  SamplingLikeSchema,
  WatertightLikeSchema,
} from "./__fixtures__/schemas";

function property(node: FormNode, key: string): FormNode {
  if (node.kind !== "object") throw new Error(`Not an object: ${node.kind}`);
  const found = node.properties.find((entry) => entry.key === key);
  if (!found) throw new Error(`No property ${key}`);
  return found.node;
}

function asObject(node: FormNode): ObjectNode {
  if (node.kind !== "object") throw new Error(`Not an object: ${node.kind}`);
  return node;
}

describe("describeSchema", () => {
  it("reads glove_info's config, the worked example: switches and a size", () => {
    const node = asObject(describeSchema(MODULE_REGISTRY.glove_info.configSchema, { markers: MARKERS }));
    expect(node.properties.map((entry) => [entry.key, entry.node.kind, entry.required])).toEqual([
      ["fields", "object", true],
      ["indicativeWeightSize", "string", true],
    ]);
    const fields = asObject(property(node, "fields"));
    expect(fields.description).toBe("Fields shown on this template");
    expect(fields.properties.map((entry) => entry.node.kind)).toEqual(["boolean", "boolean", "boolean", "boolean"]);
    // CanonicalSizeSchema.describe(...) is a copy of the schema: still recognised as a size.
    expect(property(node, "indicativeWeightSize")).toMatchObject({ kind: "string", marker: "size" });
  });

  it("turns every registered module's config schema into a form, stubs included", () => {
    for (const [key, definition] of Object.entries(MODULE_REGISTRY)) {
      const node = describeSchema(definition.configSchema, { markers: MARKERS });
      expect(node.kind, key).not.toBe("json");
      if (definition.stub) {
        // A stub takes any settings until it is built: free keys, any JSON.
        expect(node, key).toMatchObject({ kind: "record", value: { kind: "json" } });
      }
    }
  });

  it("reads nullable options, enums of numbers and descriptions on the field", () => {
    const sampling = describeSchema(SamplingLikeSchema);
    expect(property(sampling, "inspectionLevel")).toMatchObject({
      kind: "nullable",
      description: "ISO 2859-1 inspection level. None: n as entered.",
      inner: { kind: "enum", options: expect.arrayContaining([{ value: "S-1" }, { value: "III" }]) },
    });
    const watertight = describeSchema(WatertightLikeSchema);
    const aql = property(watertight, "aql");
    expect(aql.kind).toBe("nullable");
    if (aql.kind !== "nullable" || aql.inner.kind !== "enum") throw new Error("expected a nullable enum");
    expect(aql.inner.options.slice(0, 3)).toEqual([{ value: 0 }, { value: 0.01 }, { value: 0.015 }]);
    // The description belongs to the field, not to the options inside.
    expect(aql.inner.description).toBeUndefined();
  });

  it("reads lists of objects with their limits", () => {
    const watertight = describeSchema(WatertightLikeSchema);
    const locations = property(watertight, "locations");
    expect(locations).toMatchObject({ kind: "array", items: { kind: "object" } });
    if (locations.kind !== "array") throw new Error("expected a list");
    expect(asObject(locations.items).properties).toEqual([
      expect.objectContaining({ key: "code", required: true, node: expect.objectContaining({ kind: "string", pattern: "^[a-z][a-z0-9_]*$" }) }),
      expect.objectContaining({ key: "label", node: expect.objectContaining({ kind: "string", minLength: 1, maxLength: 200 }) }),
    ]);
    const dispensing = describeSchema(DispensingLikeSchema);
    expect(property(dispensing, "stickinessCodes")).toMatchObject({ kind: "array", minItems: 1 });
  });

  it("reads numbers with limits and units from meta, the key or the description", () => {
    const dispensing = describeSchema(DispensingLikeSchema, { markers: MARKERS });
    expect(property(dispensing, "minLayeringPct")).toMatchObject({ kind: "number", integer: false, minimum: 0, maximum: 100, unit: "%" });
    const boxes = property(dispensing, "boxesPerSize");
    expect(property(boxes, "default")).toMatchObject({ kind: "number", integer: true, minimum: 1, maximum: 500 });
    expect(property(boxes, "bySize")).toMatchObject({ kind: "record", key: { marker: "size" }, value: { kind: "number" } });
    expect(asObject(boxes).properties.find((entry) => entry.key === "bySize")?.required).toBe(false);

    const dimensions = describeSchema(DimensionsLikeSchema, { markers: MARKERS });
    expect(property(dimensions, "width")).toMatchObject({ kind: "number", unit: "mm" });
    // positive(): an exclusive minimum; int(): no maximum shown for the safe-integer cap.
    expect(property(dimensions, "rows")).toMatchObject({
      kind: "nullable",
      title: "Gloves per size",
      inner: { kind: "number", integer: true, exclusiveMinimum: 0 },
    });
    const rows = property(dimensions, "rows");
    if (rows.kind !== "nullable" || rows.inner.kind !== "number") throw new Error("expected a nullable number");
    expect(rows.inner.maximum).toBeUndefined();
  });

  it("reads records keyed by an enum as objects, every key required or every key optional", () => {
    const dimensions = asObject(describeSchema(DimensionsLikeSchema, { markers: MARKERS }));
    const decimals = asObject(property(dimensions, "decimals"));
    expect(decimals.properties.map((entry) => [entry.key, entry.required])).toEqual([
      ["length", true],
      ["width", true],
      ["fingerThickness", true],
      ["palmThickness", true],
      ["cuffThickness", true],
    ]);
    const specs = property(dimensions, "specs");
    if (specs.kind !== "array") throw new Error("expected a list");
    const row = asObject(specs.items);
    expect(property(row, "size")).toMatchObject({ kind: "string", marker: "size" });
    const perMeasure = asObject(property(row, "specs"));
    expect(perMeasure.properties.every((entry) => !entry.required)).toBe(true);
    expect(perMeasure.properties[0].node).toMatchObject({ kind: "union", discriminator: "kind", marker: "spec" });
  });

  it("reads a tagged union, SpecSchema, variant by variant", () => {
    const dimensions = describeSchema(DimensionsLikeSchema, { markers: MARKERS });
    const specs = property(dimensions, "specs");
    if (specs.kind !== "array") throw new Error("expected a list");
    const spec = property(property(specs.items, "specs"), "length");
    if (spec.kind !== "union") throw new Error("expected a union");
    expect(spec.variants.map((variant) => variant.value)).toEqual(["min", "max", "range", "tolerance", "na"]);
    expect(spec.variants[3].node.properties.map((entry) => [entry.key, entry.node.kind])).toEqual([
      ["kind", "literal"],
      ["nominal", "number"],
      ["tolerance", "number"],
    ]);
  });

  it("reads an array of options as a set, and defaults in the input", () => {
    const schema = z.strictObject({
      measures: z.array(z.enum(["length", "width"])),
      statistic: z.enum(["median", "average"]).default("median"),
    });
    const node = asObject(describeSchema(schema));
    expect(property(node, "measures")).toMatchObject({ kind: "array", items: { kind: "enum" } });
    expect(node.properties[1]).toMatchObject({ key: "statistic", required: false, node: { kind: "enum", default: "median" } });
  });

  it("falls back to JSON for what a form cannot draw", () => {
    const node = asObject(
      describeSchema(
        z.strictObject({
          pair: z.tuple([z.number(), z.string()]),
          anything: z.unknown(),
          either: z.union([z.string(), z.number()]),
          json: JsonValueSchema,
        }),
      ),
    );
    expect(node.properties.map((entry) => entry.node.kind)).toEqual(["json", "json", "json", "json"]);
    expect(describeSchema(stubModule({ key: "loading", title: "Loading" }).configSchema)).toMatchObject({
      kind: "record",
      value: { kind: "json", reason: expect.any(String) },
    });
  });

  it("caches per schema and marker set", () => {
    const schema = z.strictObject({ a: z.boolean() });
    expect(describeSchema(schema)).toBe(describeSchema(schema));
    expect(describeSchema(schema, { markers: MARKERS })).not.toBe(describeSchema(schema));
  });
});

describe("unitOf", () => {
  it("prefers meta, then a Pct key, then the end of the description", () => {
    expect(unitOf("mm", "minLayeringPct", "in %")).toBe("mm");
    expect(unitOf(undefined, "maxRatePct", undefined)).toBe("%");
    expect(unitOf(undefined, "minDispensing", "Minimum average dispensing, in %")).toBe("%");
    expect(unitOf(undefined, "specMin", "Minimum force at break (N).")).toBe("N");
    expect(unitOf(undefined, "pct", undefined)).toBeUndefined();
    expect(unitOf(undefined, "n", "Gloves weighed per size")).toBeUndefined();
  });
});
