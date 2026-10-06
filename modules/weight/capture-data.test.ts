import { describe, expect, it } from "vitest";
import { firstValues, withFirstValues } from "./capture-data";
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

  it("writes one size's values and hands back the whole data, other sizes untouched", () => {
    const next = withFirstValues(saved, "M", [2.9, 3.1, 2.8], 3);
    expect(next.sizes.M.values).toEqual([2.9, 3.1, 2.8]);
    expect(next.sizes.XL).toBe(saved.sizes.XL);
    expect(WeightDataSchema.parse(next)).toEqual(next);
  });

  it("keeps values past n as saved, and drops empty values at the end", () => {
    expect(withFirstValues(saved, "M", [3.3], 1).sizes.M.values).toEqual([3.3, 3.0]);
    expect(withFirstValues(saved, "M", [2.9, null, null], 3).sizes.M.values).toEqual([2.9]);
    expect(withFirstValues(saved, "M", [null, null], 2).sizes.M.values).toEqual([]);
  });

  it("starts a size that has nothing saved", () => {
    expect(withFirstValues(emptyWeight(), "S", [null, 2.95], 13)).toEqual({ sizes: { S: { values: [null, 2.95] } } });
  });
});
