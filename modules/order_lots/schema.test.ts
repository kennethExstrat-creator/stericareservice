import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dataKeys, defaultConfig, defaultLabels, labelOverrides, moduleConfig, moduleTitle, TEMPLATE_CODES } from "@/lib/coverage";
import { resolvedModule, resolveSeedTemplate } from "@/modules/header/__fixtures__/templates";
import { ORDER_LOTS_DEFAULT_CONFIG, ORDER_LOTS_LABELS, ORDER_LOTS_TITLE, OrderLotsConfigSchema } from "./config";
import { emptyOrderLine, emptyOrderLots, LOT_NUMBER_MAX_LENGTH, OrderLotsDataSchema, TEXT_MAX_LENGTH } from "./schema";

describe("order_lots data", () => {
  it("starts empty and accepts a draft line with anything missing", () => {
    expect(emptyOrderLots()).toEqual({ sizes: {} });
    expect(emptyOrderLine()).toEqual({ qtyCases: null, lotNumbers: [], packingSite: null });
    expect(OrderLotsDataSchema.parse({ sizes: { M: { qtyCases: 2900 } } })).toEqual({
      sizes: { M: { qtyCases: 2900, lotNumbers: [], packingSite: null } },
    });
  });

  it("keeps a line per size under the dictionary's keys", () => {
    expect(Object.keys(emptyOrderLine()).sort()).toEqual([...dataKeys("order_lots", "entered")].sort());
  });

  it("stores the quantity as a whole number of cases, never as text (6.2 rules 1 and 3)", () => {
    const line = (qtyCases: unknown) => OrderLotsDataSchema.safeParse({ sizes: { M: { qtyCases } } }).success;
    expect(line(2900)).toBe(true);
    expect(line(0)).toBe(true);
    for (const value of ["2900", "2 900", "2,900", 2.5, -1, "2025-04-01"]) expect(line(value)).toBe(false);
  });

  it("keeps several lot numbers per size as a list of text", () => {
    const data = OrderLotsDataSchema.parse({ sizes: { M: { qtyCases: 2900, lotNumbers: ["LOT-A01", "LOT-A02"] } } });
    expect(data.sizes.M.lotNumbers).toEqual(["LOT-A01", "LOT-A02"]);
    expect(OrderLotsDataSchema.safeParse({ sizes: { M: { lotNumbers: "LOT-A01" } } }).success).toBe(false);
    expect(OrderLotsDataSchema.safeParse({ sizes: { M: { lotNumbers: [101] } } }).success).toBe(false);
  });

  it("keeps a lot up to LOT_NUMBER_MAX_LENGTH and a packing site up to TEXT_MAX_LENGTH, the fields' limits", () => {
    const line = (entry: object) => OrderLotsDataSchema.safeParse({ sizes: { M: entry } }).success;
    expect(line({ lotNumbers: ["L".repeat(LOT_NUMBER_MAX_LENGTH)] })).toBe(true);
    expect(line({ lotNumbers: ["L".repeat(LOT_NUMBER_MAX_LENGTH + 1)] })).toBe(false);
    expect(line({ packingSite: "P".repeat(TEXT_MAX_LENGTH) })).toBe(true);
    expect(line({ packingSite: "P".repeat(TEXT_MAX_LENGTH + 1) })).toBe(false);
  });

  it("rejects keys it does not have, the reserved comment and the totals included (6.2 rule 2)", () => {
    expect(OrderLotsDataSchema.safeParse({ sizes: { M: { qty: 2900 } } }).success).toBe(false);
    expect(OrderLotsDataSchema.safeParse({ sizes: { M: { qtyCases: 2900, lotSizeGloves: 5_800_000 } } }).success).toBe(false);
    expect(OrderLotsDataSchema.safeParse({ sizes: {}, totalCartons: 2900 }).success).toBe(false);
    expect(OrderLotsDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
    expect(OrderLotsDataSchema.safeParse({ lots: [{ size: "M", qtyCases: 2900 }] }).success).toBe(false);
  });
});

describe("order_lots config", () => {
  it("leaves the packing site off by default: the dictionary's default", () => {
    expect(OrderLotsConfigSchema.parse(ORDER_LOTS_DEFAULT_CONFIG)).toEqual(ORDER_LOTS_DEFAULT_CONFIG);
    expect(ORDER_LOTS_DEFAULT_CONFIG).toEqual(defaultConfig("order_lots"));
  });

  it("accepts every seed template's config, and resolves to it from the seeds", () => {
    for (const code of TEMPLATE_CODES) {
      const config = moduleConfig(code, "order_lots");
      expect(OrderLotsConfigSchema.parse(config)).toEqual(config);
      const resolved = resolvedModule(resolveSeedTemplate(code, ["order_lots"]), "order_lots");
      expect(resolved.config).toEqual(config);
      expect(resolved.title).toBe(moduleTitle(code, "order_lots"));
      expect(resolved.labels).toEqual({ ...ORDER_LOTS_LABELS, ...labelOverrides(code, "order_lots") });
    }
    expect(moduleConfig("SAFEDON_EG", "order_lots")).toEqual({ fields: { packingSite: true } });
  });

  it("rejects a mistyped switch", () => {
    expect(OrderLotsConfigSchema.safeParse({ fields: { packingSites: true } }).success).toBe(false);
    expect(OrderLotsConfigSchema.safeParse({ fields: { packingSite: "yes" } }).success).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(OrderLotsConfigSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.fields.description).toContain("Packing Site");
  });
});

describe("order_lots wording", () => {
  it("defaults to STD_EG's wording, the size column's caption included", () => {
    expect(ORDER_LOTS_TITLE).toBe(moduleTitle("STD_EG", "order_lots"));
    expect({ ...ORDER_LOTS_LABELS }).toEqual(defaultLabels("order_lots"));
    expect(labelOverrides("STD_SG", "order_lots")).toEqual({ qtyCases: "Qty (case)" });
  });
});
