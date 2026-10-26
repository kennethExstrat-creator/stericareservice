// The order table's size switches (Kenneth, 26 October 2026: "for the toggle
// of on and off, give it to the size too"): a size switched off is not
// ordered for the inspection, whatever its line holds, which is kept.
import { describe, expect, it } from "vitest";
import { makeTestContext } from "@/modules/_framework/testing";
import { calcOrderLots, contributeOrderLots } from "./calc";
import { ORDER_LOTS_DEFAULT_CONFIG, ORDER_LOTS_LABELS } from "./config";
import { setLine, withSizeOff } from "./edit";
import { emptyOrderLine, emptyOrderLots, OrderLotsDataSchema, switchedOffSizes, type OrderLotsData } from "./schema";

const PACKED = { innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 };

const ORDER: OrderLotsData = {
  sizes: {
    S: { ...emptyOrderLine(), qtyCases: 1120, lotNumbers: ["LOT-S"] },
    M: { ...emptyOrderLine(), qtyCases: 2081, lotNumbers: ["LOT-M"] },
    // Ordered, but its lots are not entered: missing while it is switched on.
    L: { ...emptyOrderLine(), qtyCases: 1100 },
  },
};

const calc = (data: OrderLotsData) =>
  calcOrderLots({
    data,
    config: ORDER_LOTS_DEFAULT_CONFIG,
    title: "Order",
    labels: ORDER_LOTS_LABELS,
    context: makeTestContext({ packing: PACKED }),
    results: {},
    hasData: true,
  });

describe("the order table's size switches", () => {
  it("reads data saved before the switches as every size on, and keeps only sizes in the list", () => {
    const old = OrderLotsDataSchema.parse({ sizes: { M: { qtyCases: 10 } } });
    expect(old.sizesOff).toBeUndefined();
    expect(switchedOffSizes(old).size).toBe(0);
    expect(switchedOffSizes(emptyOrderLots()).size).toBe(0);
    expect(OrderLotsDataSchema.safeParse({ sizes: {}, sizesOff: ["XS"] }).success).toBe(true);
    expect(OrderLotsDataSchema.safeParse({ sizes: {}, sizesOff: [""] }).success).toBe(false);
    // Another spelling reads as its size.
    expect([...switchedOffSizes({ sizes: {}, sizesOff: ["xs"] })]).toEqual(["XS"]);
  });

  it("switches a size off and on, keeping its line, and gives the same data when nothing changes", () => {
    const off = withSizeOff(ORDER, "L", true);
    expect(off.sizesOff).toEqual(["L"]);
    expect(off.sizes).toBe(ORDER.sizes);
    expect(withSizeOff(off, "L", true)).toBe(off);
    expect(withSizeOff(off, "L", false).sizesOff).toEqual([]);
    expect(withSizeOff(ORDER, "L", false)).toBe(ORDER);
    // An edit of a line keeps the switches.
    expect(setLine(off, "S", { qtyCases: 1000 }).sizesOff).toEqual(["L"]);
  });

  it("orders no size switched off: not in the totals, the results or the missing values", () => {
    const on = calc(ORDER);
    expect(on.result.status).toBe("not_done");
    expect(on.result.summary).toContain("Lot Number for size L");
    expect(on.computed.totalCartons).toBe(1120 + 2081 + 1100);

    const off = calc(withSizeOff(ORDER, "L", true));
    expect(off.result.status).toBe("info");
    expect(Object.keys(off.result.perSize ?? {})).toEqual(["S", "M"]);
    expect(off.computed.totalCartons).toBe(1120 + 2081);
    expect(off.computed.lotSizeGloves).toEqual({ S: 1120 * 2000, M: 2081 * 2000 });
    expect(off.result.summary).not.toContain("size L");
  });

  it("leaves a size switched off out of the context, so no other step shows it, and brings it back switched on", () => {
    const data: OrderLotsData = { sizes: { S: ORDER.sizes.S, M: ORDER.sizes.M } };
    const off = withSizeOff(data, "M", true);
    expect(contributeOrderLots({ data: off, config: ORDER_LOTS_DEFAULT_CONFIG })).toEqual({
      sizes: ["S"],
      order: { S: { qtyCases: 1120, lotNumbers: ["LOT-S"] } },
    });
    expect(contributeOrderLots({ data: withSizeOff(off, "M", false), config: ORDER_LOTS_DEFAULT_CONFIG }).sizes).toEqual(["S", "M"]);
  });
});
