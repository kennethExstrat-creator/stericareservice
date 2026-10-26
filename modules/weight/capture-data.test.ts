import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { makeTestContext } from "@/modules/_framework/testing";
import { calcWeight } from "./calc";
import { sizeValue, withValue } from "./capture-data";
import { WEIGHT_DEFAULT_CONFIG, WEIGHT_LABELS } from "./config";
import { emptyWeight, WeightDataSchema, type WeightData } from "./schema";

const saved: WeightData = {
  sizes: {
    M: { values: [2.9] },
    // Saved before XL was taken out of the order: kept, not shown.
    XL: { values: [3.9] },
  },
};

/** An inspection saved before 26 October 2026: size M's gloves weighed one by one. */
const older: WeightData = { sizes: { ...saved.sizes, M: { values: [2.85, null, 2.96, 2.9] } } };

describe("weight capture data", () => {
  it("reads the size's one value as entered, never rounded; null while nothing is entered", () => {
    expect(sizeValue(saved, "M", 2)).toBe(2.9);
    expect(sizeValue({ sizes: { M: { values: [2.8949] } } }, "M", 2)).toBe(2.8949);
    expect(sizeValue(saved, "S", 2)).toBeNull();
    expect(sizeValue({ sizes: { M: { values: [null] } } }, "M", 2)).toBeNull();
  });

  it("reads an older inspection's gloves weighed one by one as their average, as calc prints and judges it", () => {
    expect(sizeValue(older, "M", 2)).toBe(2.9);
    const computed = calcWeight({
      data: older,
      config: WEIGHT_DEFAULT_CONFIG,
      title: "Weight",
      labels: WEIGHT_LABELS,
      context: makeTestContext({ sizes: ["M"] }),
      results: {},
      hasData: true,
    }).computed;
    expect(computed.shown.M).toBe(sizeValue(older, "M", WEIGHT_DEFAULT_CONFIG.decimals));
    expect(computed.count.M).toBe(3);
  });

  it("writes the value and hands back the whole data, other sizes untouched", () => {
    const next = withValue(saved, "M", 3.1);
    expect(next.sizes.M.values).toEqual([3.1]);
    expect(next.sizes.XL).toBe(saved.sizes.XL);
    expect(WeightDataSchema.parse(next)).toEqual(next);
    expect(withValue(emptyWeight(), "S", 2.95)).toEqual({ sizes: { S: { values: [2.95] } } });
  });

  it("replaces an older inspection's gloves with the value typed, and empties the size when it is cleared", () => {
    expect(withValue(older, "M", 3.05).sizes.M.values).toEqual([3.05]);
    expect(withValue(older, "M", null).sizes.M.values).toEqual([]);
    expect(withValue(saved, "M", null).sizes.M.values).toEqual([]);
  });

  it("hands back the same data when nothing changes, so nothing is saved", () => {
    expect(withValue(saved, "M", 2.9)).toBe(saved);
    expect(withValue(saved, "S", null)).toBe(saved);
    const blank: WeightData = { sizes: { M: { values: [null] } } };
    expect(withValue(blank, "M", null)).toBe(blank);
  });

  describe("through useDataUpdater (docs/CAPTURE_KIT.md)", () => {
    it("keeps every value of a column pasted down the sizes, in one change", () => {
      // Each size's field stores its own value, all in one paste.
      const changes: WeightData[] = [];
      const updater = createDataUpdater(emptyWeight(), (next) => changes.push(next));
      const pasted: [string, number][] = [
        ["XS", 2.56],
        ["S", 2.94],
        ["M", 3.18],
        ["L", 3.55],
      ];
      batchDataChanges(() => {
        for (const [size, value] of pasted) updater.update((current) => withValue(current, size, value));
      });
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        sizes: { XS: { values: [2.56] }, S: { values: [2.94] }, M: { values: [3.18] }, L: { values: [3.55] } },
      });
    });

    it("keeps both of two values written in one event", () => {
      const changes: WeightData[] = [];
      const updater = createDataUpdater(saved, (next) => changes.push(next));
      updater.update((current) => withValue(current, "M", 2.95));
      updater.update((current) => withValue(current, "S", 2.8));
      expect(changes.at(-1)?.sizes).toEqual({ M: { values: [2.95] }, S: { values: [2.8] }, XL: saved.sizes.XL });
    });
  });
});
