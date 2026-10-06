import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { addLots, leftOutNotice, lineFor, removeKey, removeLot, setLine, splitLots, tidySite } from "./edit";
import {
  emptyOrderLine,
  LOT_NUMBER_MAX_LENGTH,
  OrderLotsDataSchema,
  TEXT_MAX_LENGTH,
  type OrderLotsData,
} from "./schema";

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
    expect(addLots(ORDER, "M", ["LOT-B03"])).toEqual({ data: ORDER, skipped: ["LOT-B03"], tooLong: [] });
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

// Saved data the schema rejects cannot be shown or edited (invalid_data), and
// without the order no size is ordered: every edit must return data it keeps.
describe("order table edits keep the data loadable", () => {
  const longest = "L".repeat(LOT_NUMBER_MAX_LENGTH);
  const tooLong = `${longest}9`;

  it("leaves out a lot too long to keep, adds the rest and says which", () => {
    const added = addLots(ORDER, "M", ["LOT-B05", tooLong, longest]);
    expect(added.data.sizes.M.lotNumbers).toEqual(["LOT-B03", "LOT-B05", longest]);
    expect(added.tooLong).toEqual([tooLong]);
    expect(OrderLotsDataSchema.safeParse(added.data).success).toBe(true);
    expect(addLots(ORDER, "M", [tooLong])).toEqual({ data: ORDER, skipped: [], tooLong: [tooLong] });
  });

  it("leaves out twenty lots pasted with slashes, which the split reads as one lot", () => {
    const pasted = Array.from({ length: 20 }, (_, index) => `LOT-${String(index + 1).padStart(6, "0")}`).join(" / ");
    expect(pasted.length).toBeGreaterThan(LOT_NUMBER_MAX_LENGTH);
    const added = addLots(ORDER, "M", splitLots(pasted));
    expect(added).toEqual({ data: ORDER, skipped: [], tooLong: [pasted] });
  });

  it("cuts a packing site to the schema's limit, never through a character", () => {
    const site = setLine(ORDER, "S", { packingSite: "P".repeat(TEXT_MAX_LENGTH + 40) }).sizes.S.packingSite;
    expect(site).toBe("P".repeat(TEXT_MAX_LENGTH));
    // An emoji is two UTF-16 units: one that would straddle the limit is left out whole.
    const straddling = `${"P".repeat(TEXT_MAX_LENGTH - 1)}\u{1F9E4}`;
    expect(setLine(ORDER, "S", { packingSite: straddling }).sizes.S.packingSite).toBe("P".repeat(TEXT_MAX_LENGTH - 1));
    const fits = `${"P".repeat(TEXT_MAX_LENGTH - 2)}\u{1F9E4}`;
    expect(setLine(ORDER, "S", { packingSite: fits }).sizes.S.packingSite).toBe(fits);
  });

  it("returns data the schema keeps from every edit, however long what is typed or pasted", () => {
    const longSite = "P".repeat(TEXT_MAX_LENGTH * 2);
    const edits: [string, OrderLotsData][] = [
      ["setLine", setLine(ORDER, "M", { qtyCases: 600, packingSite: longSite })],
      ["tidySite", tidySite(setLine(ORDER, "S", { packingSite: ` ${longSite}` }), "S")],
      ["addLots", addLots(ORDER, "L", [tooLong, "LOT-B04", tooLong.repeat(10)]).data],
      ["removeLot", removeLot(ORDER, "M", 0, "LOT-B03")],
      ["removeKey", removeKey({ sizes: { ...ORDER.sizes, Q: emptyOrderLine() } }, "Q")],
    ];
    for (const [name, data] of edits) expect([name, OrderLotsDataSchema.safeParse(data).success]).toEqual([name, true]);
  });

  it("says what was left out below the lot field", () => {
    expect(leftOutNotice({ skipped: [], tooLong: [] })).toBe("");
    expect(leftOutNotice({ skipped: ["LOT-B03", "LOT-B05"], tooLong: [] })).toBe("Already listed: LOT-B03, LOT-B05.");
    expect(leftOutNotice({ skipped: ["LOT-B03"], tooLong: [`LOT-000001 / LOT-000002 / ${longest}`] })).toBe(
      "Already listed: LOT-B03. Not added, over 200 characters: “LOT-000001 / LOT-000…”. " +
        "Separate lots with commas, semicolons or new lines.",
    );
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
