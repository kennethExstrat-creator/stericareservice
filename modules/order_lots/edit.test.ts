import { describe, expect, it } from "vitest";
import { addLots, lineFor, removeKey, removeLot, setLine, splitLots } from "./edit";
import { emptyOrderLine, OrderLotsDataSchema, type OrderLotsData } from "./schema";

const ORDER: OrderLotsData = {
  sizes: {
    S: { qtyCases: 850, lotNumbers: ["LOT-B02"], packingSite: "Manufacturer B" },
    M: { qtyCases: 560, lotNumbers: ["LOT-B03"], packingSite: null },
  },
};

describe("order table edits", () => {
  it("sets one size's line and keeps every other line as it was", () => {
    const next = setLine(ORDER, "M", { qtyCases: 600 });
    expect(next.sizes.M).toEqual({ qtyCases: 600, lotNumbers: ["LOT-B03"], packingSite: null });
    expect(next.sizes.S).toBe(ORDER.sizes.S);
    expect(OrderLotsDataSchema.parse(next)).toEqual(next);
  });

  it("starts a size that has no line yet, and removes a line once it is emptied", () => {
    expect(setLine(ORDER, "XL", { qtyCases: 5 }).sizes.XL).toEqual({ ...emptyOrderLine(), qtyCases: 5 });
    const cleared = setLine(ORDER, "M", { qtyCases: null, lotNumbers: [] });
    expect(Object.keys(cleared.sizes)).toEqual(["S"]);
  });

  it("writes under the canonical key and drops another spelling of the size", () => {
    const old: OrderLotsData = { sizes: { m: { qtyCases: 5, lotNumbers: ["LOT-m"], packingSite: null } } };
    expect(lineFor(old, "M")).toEqual(old.sizes.m);
    expect(setLine(old, "M", { qtyCases: 6 })).toEqual({
      sizes: { M: { qtyCases: 6, lotNumbers: ["LOT-m"], packingSite: null } },
    });
    const both: OrderLotsData = { sizes: { m: old.sizes.m, M: ORDER.sizes.M } };
    expect(setLine(both, "M", { qtyCases: 561 })).toEqual({ sizes: { M: { ...ORDER.sizes.M, qtyCases: 561 } } });
  });

  it("splits typed or pasted lots on lines, commas, semicolons and tabs", () => {
    expect(splitLots("LOT-A01")).toEqual(["LOT-A01"]);
    expect(splitLots(" LOT-A01, LOT-A02;LOT-A03\r\nLOT-A04\tLOT 5 \n\n")).toEqual([
      "LOT-A01",
      "LOT-A02",
      "LOT-A03",
      "LOT-A04",
      "LOT 5",
    ]);
    expect(splitLots(" , \n")).toEqual([]);
  });

  it("adds lots after the saved ones and skips one the size already has", () => {
    const { data, skipped } = addLots(ORDER, "M", ["LOT-B05", "LOT-B03", " LOT-B06 ", "LOT-B05"]);
    expect(data.sizes.M.lotNumbers).toEqual(["LOT-B03", "LOT-B05", "LOT-B06"]);
    expect(skipped).toEqual(["LOT-B03", "LOT-B05"]);
    expect(addLots(ORDER, "M", ["LOT-B03"])).toEqual({ data: ORDER, skipped: ["LOT-B03"] });
    expect(addLots(ORDER, "L", ["LOT-B04"]).data.sizes.L).toEqual({ ...emptyOrderLine(), lotNumbers: ["LOT-B04"] });
  });

  it("removes one lot by its place in the list", () => {
    const two = setLine(ORDER, "M", { lotNumbers: ["LOT-B03", "LOT-B07"] });
    expect(removeLot(two, "M", 0).sizes.M.lotNumbers).toEqual(["LOT-B07"]);
  });

  it("removes a line saved under a key the table does not show", () => {
    const stray: OrderLotsData = { sizes: { ...ORDER.sizes, Q: { ...emptyOrderLine(), qtyCases: 1 } } };
    expect(removeKey(stray, "Q")).toEqual(ORDER);
  });
});
