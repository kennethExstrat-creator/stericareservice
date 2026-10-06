import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { firstValues, valueChanges, withoutValuesPast, withValues } from "./capture-data";
import { emptyWeight, WeightDataSchema, type WeightData } from "./schema";

const saved: WeightData = {
  sizes: {
    M: { values: [2.9, 3.0] },
    // Saved before XL was taken out of the order: kept, not shown.
    XL: { values: [3.9] },
  },
};

describe("weight capture data", () => {
  it("reads a size's first n values, null where nothing is entered", () => {
    expect(firstValues(saved, "M", 3)).toEqual([2.9, 3.0, null]);
    expect(firstValues(saved, "M", 1)).toEqual([2.9]);
    expect(firstValues(saved, "S", 2)).toEqual([null, null]);
  });

  it("finds the values a grid change touched, nothing else", () => {
    const before = firstValues(saved, "M", 3);
    expect(valueChanges(before, [2.9, 3.1, 2.8], 3)).toEqual([
      { index: 1, value: 3.1 },
      { index: 2, value: 2.8 },
    ]);
    expect(valueChanges(before, [null, 3.0, null], 3)).toEqual([{ index: 0, value: null }]);
    expect(valueChanges(before, before, 3)).toEqual([]);
  });

  it("writes the values and hands back the whole data, other sizes untouched", () => {
    const next = withValues(saved, "M", [
      { index: 1, value: 3.1 },
      { index: 2, value: 2.8 },
    ]);
    expect(next.sizes.M.values).toEqual([2.9, 3.1, 2.8]);
    expect(next.sizes.XL).toBe(saved.sizes.XL);
    expect(WeightDataSchema.parse(next)).toEqual(next);
  });

  it("keeps values past n as saved, and drops empty values at the end", () => {
    expect(withValues(saved, "M", [{ index: 0, value: 3.3 }]).sizes.M.values).toEqual([3.3, 3.0]);
    expect(withValues(saved, "M", [{ index: 1, value: null }]).sizes.M.values).toEqual([2.9]);
    expect(
      withValues(saved, "M", [
        { index: 0, value: null },
        { index: 1, value: null },
      ]).sizes.M.values,
    ).toEqual([]);
  });

  it("starts a size that has nothing saved", () => {
    expect(withValues(emptyWeight(), "S", [{ index: 1, value: 2.95 }])).toEqual({ sizes: { S: { values: [null, 2.95] } } });
  });

  it("hands back the same data when nothing changes, so nothing is saved", () => {
    expect(withValues(saved, "M", [])).toBe(saved);
    expect(withValues(saved, "M", [{ index: 0, value: 2.9 }])).toBe(saved);
    expect(withValues(saved, "S", [{ index: 0, value: null }])).toBe(saved);
  });

  it("removes the values past n, which have no cell, and nothing else", () => {
    const extra: WeightData = { sizes: { ...saved.sizes, M: { values: [3.18, 3.2, null, 3.1] } } };
    const cut = withoutValuesPast(extra, "M", 1);
    expect(cut.sizes.M.values).toEqual([3.18]);
    expect(cut.sizes.XL).toBe(saved.sizes.XL);
    expect(WeightDataSchema.parse(cut)).toEqual(cut);
    // Empty values left at the end go too; with nothing past n the data is the same object.
    expect(withoutValuesPast({ sizes: { M: { values: [null, 3.2] } } }, "M", 1).sizes.M.values).toEqual([]);
    expect(withoutValuesPast(extra, "M", 4)).toBe(extra);
    expect(withoutValuesPast(extra, "S", 1)).toBe(extra);
  });

  describe("through useDataUpdater (docs/CAPTURE_KIT.md)", () => {
    it("keeps every value of a column pasted down the sizes, in one change", () => {
      // One value per size (SAFEDON_EG): each size's field stores its own value, all in one paste.
      const changes: WeightData[] = [];
      const updater = createDataUpdater(emptyWeight(), (next) => changes.push(next));
      const pasted: [string, number][] = [
        ["XS", 2.56],
        ["S", 2.94],
        ["M", 3.18],
        ["L", 3.55],
      ];
      batchDataChanges(() => {
        for (const [size, value] of pasted) updater.update((current) => withValues(current, size, [{ index: 0, value }]));
      });
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        sizes: { XS: { values: [2.56] }, S: { values: [2.94] }, M: { values: [3.18] }, L: { values: [3.55] } },
      });
    });

    it("keeps both of two grid changes made in one event", () => {
      const changes: WeightData[] = [];
      const updater = createDataUpdater(saved, (next) => changes.push(next));
      // The grid builds each change from the values it rendered, here [2.9, 3.0, null].
      const rendered = firstValues(saved, "M", 3);
      const write = (next: (number | null)[]) =>
        updater.update((current) => withValues(current, "M", valueChanges(rendered, next, 3)));
      write([2.9, 3.0, 2.8]);
      write([2.95, 3.0, null]);
      expect(changes.at(-1)?.sizes.M.values).toEqual([2.95, 3.0, 2.8]);
      expect(changes.at(-1)?.sizes.XL).toBe(saved.sizes.XL);
    });
  });
});
