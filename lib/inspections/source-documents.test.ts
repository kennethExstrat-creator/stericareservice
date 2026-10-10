import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import { applyProposals, countFilled, fillEmpty } from "./source-documents";

const OrderSchema = z.strictObject({
  sizes: z
    .record(z.string(), z.strictObject({ qtyCases: z.number().int().nullable().default(null), lotNumbers: z.array(z.string()).default([]) }))
    .default({}),
});
const HeaderSchema = z.strictObject({ poNo: z.string().nullable().default(null), productCode: z.string().nullable().default(null) });

const registry = {
  header: { dataSchema: HeaderSchema, emptyData: () => HeaderSchema.parse({}) },
  order_lots: { dataSchema: OrderSchema, emptyData: () => OrderSchema.parse({}) },
  conclusion: { dataSchema: z.object({ finalResult: z.string().nullable() }), emptyData: () => ({ finalResult: null }) },
} as unknown as ModuleRegistry;

describe("fillEmpty", () => {
  it("fills only what holds nothing", () => {
    expect(fillEmpty({ a: null, b: "kept", c: [null, 2] }, { a: "new", b: "other", c: [1, 3] })).toEqual({ a: "new", b: "kept", c: [1, 2] });
    expect(countFilled({ a: null, c: [null, 2] }, { a: "new", c: [1, 2] })).toBe(2);
  });
});

describe("applyProposals", () => {
  it("fills empty fields of included modules, size by size, and never the conclusion", () => {
    const data = {
      modules: { header: { poNo: null, productCode: "KEPT", comment: "note" }, order_lots: { sizes: {} }, conclusion: { finalResult: null } },
      custom: {},
    };
    const result = applyProposals(
      data,
      {
        header: { poNo: "PO-0001", productCode: "OTHER" },
        order_lots: { sizes: { M: { qtyCases: 120, lotNumbers: ["LOT-A01"] }, L: { qtyCases: "twelve" } } },
        conclusion: { finalResult: "pass" },
        glove_info: { colour: "Blue" },
      },
      registry,
      new Set(["header", "order_lots", "conclusion"]),
    );
    expect(result.data.modules.header).toEqual({ poNo: "PO-0001", productCode: "KEPT", comment: "note" });
    expect(result.data.modules.order_lots).toEqual({ sizes: { M: { qtyCases: 120, lotNumbers: ["LOT-A01"] } } });
    expect(result.data.modules.conclusion).toEqual({ finalResult: null });
    expect(result.filled).toBe(3);
    expect(result.modules).toEqual(["header", "order_lots"]);
  });
});
