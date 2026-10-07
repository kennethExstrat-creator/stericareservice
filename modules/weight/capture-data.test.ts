import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { makeTestContext } from "@/modules/_framework/testing";
import { calcWeight } from "./calc";
import { firstValues, gridSummary, valueChanges, withoutValuesPast, withValues } from "./capture-data";
import { WEIGHT_DEFAULT_CONFIG, WEIGHT_LABELS, type WeightConfig } from "./config";
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

  it("reads the grid's changed cells as values, nothing else", () => {
    expect(
      valueChanges([
        { row: 1, measure: "values", value: 3.1 },
        { row: 2, measure: "values", value: null },
        { row: 0, measure: "other", value: 4 },
      ]),
    ).toEqual([
      { index: 1, value: 3.1 },
      { index: 2, value: null },
    ]);
    expect(valueChanges([])).toEqual([]);
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
      // The grid hands over only the cell each change touched.
      const write = (row: number, value: number | null) =>
        updater.update((current) => withValues(current, "M", valueChanges([{ row, measure: "values", value }])));
      write(2, 2.8);
      write(0, 2.95);
      expect(changes.at(-1)?.sizes.M.values).toEqual([2.95, 3.0, 2.8]);
      expect(changes.at(-1)?.sizes.XL).toBe(saved.sizes.XL);
    });
  });

  describe("calc's figures for the grid's footer", () => {
    const thirteen = (value: number): WeightData => ({ sizes: { M: { values: Array.from({ length: 13 }, () => value) } } });
    const computed = (data: WeightData, config: Partial<WeightConfig> = {}) =>
      calcWeight({
        data,
        config: { ...WEIGHT_DEFAULT_CONFIG, ...config },
        title: "Weight",
        labels: WEIGHT_LABELS,
        context: makeTestContext({ sizes: ["M"], indicativeWeight: { grams: 3.5, size: "M" } }),
        results: {},
        hasData: true,
      }).computed;
    const spec = { specs: [{ size: "M", spec: { kind: "range" as const, min: 2.5, max: 3.5 } }] };

    it("judges only the spec: NA without one, even when the size warns", () => {
      // 2.9 g is 17.1% below the indicative 3.5 g: the size warns, the spec says nothing.
      const summary = gridSummary(computed(thirteen(2.9)), "M");
      expect(summary).toMatchObject({ outcome: "na", count: 13 });
      // Unrounded, as calc keeps it; the grid prints it at the template's decimals.
      expect(summary?.statistic).toBeCloseTo(2.9, 10);
    });

    it("passes on the spec when the size only warns, and fails when the spec fails", () => {
      expect(gridSummary(computed(thirteen(2.9), spec), "M")?.outcome).toBe("pass");
      expect(gridSummary(computed(thirteen(3.9), spec), "M")?.outcome).toBe("fail");
    });

    it("is not done while gloves are missing, with the count", () => {
      const partial = { sizes: { M: { values: [2.9, 3.0] } } };
      expect(gridSummary(computed(partial, spec), "M")).toEqual({ statistic: 2.95, outcome: "not_done", count: 2 });
    });

    it("gives nothing while calc has no figures, so the grid summarises its cells", () => {
      expect(gridSummary(computed(thirteen(2.9)), "S")).toBeUndefined();
      expect(gridSummary({}, "M")).toBeUndefined();
      expect(gridSummary(undefined, "M")).toBeUndefined();
    });
  });
});
