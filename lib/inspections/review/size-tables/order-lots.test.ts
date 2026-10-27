import { describe, expect, it } from "vitest";
import type { OrderLotsData } from "@/modules/order_lots";
import { evaluate, evaluateSafedonEg, evaluateStdEg, inspectionMeta, seedTemplate, stdEgData } from "@/tests/acceptance/examples";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { orderLotsTable } from "./order-lots";

describe("orderLotsTable", () => {
  it("gives STD_EG's quantity, lot and lot size, in the template's wording and with thousands separators", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    expect(orderLotsTable(stdEg.module("order_lots"), stdEg.context)).toEqual({
      rows: [
        { key: "qtyCases", label: "Qty (Cases)", cells: [{ text: "2,900" }] },
        { key: "lotNumbers", label: "Lot Number", cells: [{ text: "LOT-A01" }] },
        { key: "lotSizeGloves", label: "Lot Size (Gloves)", cells: [{ text: "5,800,000" }] },
      ],
    });
  });

  it("adds the packing site where the template shows it (SAFEDON_EG, sizes XS to L)", () => {
    const safedon = evaluateSafedonEg();
    const table = orderLotsTable(safedon.module("order_lots"), safedon.context);
    expect(table?.rows.map((row) => [row.label, row.cells.map((cell) => cell.text)])).toEqual([
      ["Qty (Cases)", ["60", "850", "560", "60"]],
      ["Lot Number", ["LOT-B01", "LOT-B02", "LOT-B03", "LOT-B04"]],
      ["Packing Site", ["Packer C", "Manufacturer B", "Manufacturer B", "Packer C"]],
      ["Lot Size (Gloves)", ["120,000", "1,700,000", "1,120,000", "120,000"]],
    ]);
  });

  it("marks a lot number entered twice amber, and has no lot size until the gloves per case are known", () => {
    const data = stdEgData({ corrected: true });
    const order = data.modules.order_lots as OrderLotsData;
    const sizes = { ...order.sizes, M: { ...order.sizes.M, lotNumbers: ["LOT-A01", "LOT-A02", "LOT-A01"] } };
    const modules = { ...data.modules, order_lots: { ...order, sizes }, packing_config: {} };
    const stdEg = evaluate(seedTemplate("STD_EG"), { ...data, modules }, inspectionMeta(STD_EG_EXAMPLE));
    const table = orderLotsTable(stdEg.module("order_lots"), stdEg.context);
    expect(table?.rows[1]?.cells).toEqual([{ text: "LOT-A01, LOT-A02, LOT-A01", tone: "warn" }]);
    expect(table?.rows[2]?.cells).toEqual([{ text: null }]);
  });
});
