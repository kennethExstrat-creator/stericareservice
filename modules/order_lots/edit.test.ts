import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { addLots, lineFor, removeKey, removeLot, setLine, splitLots, tidySite } from "./edit";
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

  it("removes the lot a chip shows, found by its text when the latest data has moved it", () => {
    const two = setLine(ORDER, "M", { lotNumbers: ["LOT-B03", "LOT-B07"] });
    expect(removeLot(two, "M", 0, "LOT-B03").sizes.M.lotNumbers).toEqual(["LOT-B07"]);
    expect(removeLot(two, "M", 0, "LOT-B07").sizes.M.lotNumbers).toEqual(["LOT-B03"]);
    expect(removeLot(two, "M", 1, "LOT-B09")).toBe(two);
  });

  it("trims the packing site once it is left, and leaves a tidy one as it was", () => {
    expect(tidySite(setLine(ORDER, "S", { packingSite: " Packer C " }), "S").sizes.S.packingSite).toBe("Packer C");
    expect(tidySite(setLine(ORDER, "S", { packingSite: "  " }), "S").sizes.S.packingSite).toBeNull();
    expect(tidySite(ORDER, "S")).toBe(ORDER);
    expect(tidySite(ORDER, "XL")).toBe(ORDER);
  });

  it("removes a line saved under a key the table does not show, once", () => {
    const stray: OrderLotsData = { sizes: { ...ORDER.sizes, Q: { ...emptyOrderLine(), qtyCases: 1 } } };
    expect(removeKey(stray, "Q")).toEqual(ORDER);
    expect(removeKey(ORDER, "Q")).toBe(ORDER);
  });
});

describe("order table edits through the kit's data updater (useDataUpdater)", () => {
  it("stores a pasted column of quantities in one change, every size kept", () => {
    const changes: OrderLotsData[] = [];
    const updater = createDataUpdater(ORDER, (next) => changes.push(next));
    // What a paste down the quantity column does: each field stores its value inside one batch.
    batchDataChanges(() => {
      for (const [size, qtyCases] of [["XS", 60], ["S", 850], ["M", 560], ["L", 60]] as const) {
        updater.update((current) => setLine(current, size, { qtyCases }));
      }
    });
    expect(changes).toHaveLength(1);
    expect(Object.fromEntries(Object.entries(changes[0].sizes).map(([size, line]) => [size, line.qtyCases]))).toEqual({
      S: 850,
      M: 560,
      XS: 60,
      L: 60,
    });
    expect(changes[0].sizes.S.lotNumbers).toEqual(["LOT-B02"]);
  });

  it("keeps both of two changes made in one event: a lot added on blur and a lot removed", () => {
    const changes: OrderLotsData[] = [];
    const updater = createDataUpdater(ORDER, (next) => changes.push(next));
    updater.update((current) => addLots(current, "M", ["LOT-B08"]).data);
    updater.update((current) => removeLot(current, "M", 0, "LOT-B03"));
    expect(changes.at(-1)?.sizes.M.lotNumbers).toEqual(["LOT-B08"]);
    expect(changes.at(-1)?.sizes.S).toBe(ORDER.sizes.S);
  });

  it("saves nothing for a lot the size already has", () => {
    const changes: OrderLotsData[] = [];
    const updater = createDataUpdater(ORDER, (next) => changes.push(next));
    updater.update((current) => addLots(current, "M", ["LOT-B03"]).data);
    expect(changes).toEqual([]);
  });
});
