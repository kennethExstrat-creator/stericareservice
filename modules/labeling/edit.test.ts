import { describe, expect, it } from "vitest";
import { boxSlots, levelEntry, withBox, withDefectCount, withInspected, withLevel } from "./edit";
import { emptyLabeling, emptyLabelingSize, LabelingDataSchema, type LabelingData } from "./schema";

const KEPT: LabelingData = {
  sizes: { XL: { ...emptyLabelingSize(), inner: { inspected: 3, boxNos: [7], defects: { lot_no: 1 } } } },
};

describe("labeling edits", () => {
  it("write one size and level and keep everything else, sizes no longer ordered included", () => {
    const next = withLevel(KEPT, "M", "carton", { inspected: 1 });
    expect(next.sizes.XL).toBe(KEPT.sizes.XL);
    expect(next.sizes.M).toEqual({ ...emptyLabelingSize(), carton: { inspected: 1, boxNos: [], defects: {} } });
    expect(KEPT.sizes.M).toBeUndefined();
    expect(LabelingDataSchema.parse(next)).toEqual(next);
  });

  it("record the boxes inspected as a whole number from 0", () => {
    expect(levelEntry(withInspected(emptyLabeling(), "M", "inner", 3), "M", "inner").inspected).toBe(3);
    expect(levelEntry(withInspected(emptyLabeling(), "M", "inner", -1), "M", "inner").inspected).toBe(0);
  });

  it("keep box picks past a lower count, so a slip of the stepper loses nothing", () => {
    const picked = withBox(withBox(withInspected(emptyLabeling(), "M", "inner", 3), "M", "inner", 0, 13), "M", "inner", 1, 299);
    expect(levelEntry(withInspected(picked, "M", "inner", 1), "M", "inner").boxNos).toEqual([13, 299]);
  });

  it("count defects per check", () => {
    const once = withDefectCount(emptyLabeling(), "M", "carton", "carton_no", 1);
    const twice = withDefectCount(once, "M", "carton", "lot_no", 2);
    expect(levelEntry(twice, "M", "carton").defects).toEqual({ carton_no: 1, lot_no: 2 });
    expect(levelEntry(withDefectCount(twice, "M", "carton", "lot_no", 0), "M", "carton").defects).toEqual({
      carton_no: 1,
      lot_no: 0,
    });
  });

  it("append, replace and remove box numbers", () => {
    let data = withBox(emptyLabeling(), "M", "inner", 0, 13);
    data = withBox(data, "M", "inner", 1, 299);
    data = withBox(data, "M", "inner", 5, 337);
    expect(levelEntry(data, "M", "inner").boxNos).toEqual([13, 299, 337]);
    data = withBox(data, "M", "inner", 1, 1039);
    expect(levelEntry(data, "M", "inner").boxNos).toEqual([13, 1039, 337]);
    data = withBox(data, "M", "inner", 0, null);
    expect(levelEntry(data, "M", "inner").boxNos).toEqual([1039, 337]);
  });

  it("offer one box picker per box inspected, the plan until the count is recorded", () => {
    expect(boxSlots(emptyLabelingSize().inner, 3)).toBe(3);
    expect(boxSlots({ ...emptyLabelingSize().inner, inspected: 5 }, 3)).toBe(5);
    expect(boxSlots({ ...emptyLabelingSize().inner, inspected: 0 }, 3)).toBe(0);
  });
});
