import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { boxSlots, levelEntry, withAddedBox, withBox, withDefectCount, withInspected, withLevel } from "./edit";
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

  it("append a box after the boxes already picked", () => {
    let data = withAddedBox(emptyLabeling(), "M", "carton", 337);
    data = withAddedBox(data, "M", "carton", 13);
    expect(levelEntry(data, "M", "carton").boxNos).toEqual([337, 13]);
  });

  it("build on each other through the kit's updater, so edits in one event all survive", () => {
    // Capture writes every edit as update((current) => ...) (docs/CAPTURE_KIT.md). Two
    // edits before the screen renders again both land; built from the rendered data,
    // the second would undo the first.
    const changes: LabelingData[] = [];
    const updater = createDataUpdater(KEPT, (next) => changes.push(next));
    updater.update((current) => withInspected(current, "M", "inner", 3));
    updater.update((current) => withAddedBox(current, "M", "inner", 13));
    updater.update((current) => withAddedBox(current, "M", "inner", 299));
    updater.update((current) => withDefectCount(current, "M", "carton", "carton_no", 1));
    expect(changes).toHaveLength(4);
    const latest = changes[3];
    expect(latest.sizes.M).toEqual({
      inner: { inspected: 3, boxNos: [13, 299], defects: {} },
      carton: { inspected: null, boxNos: [], defects: { carton_no: 1 } },
    });
    expect(latest.sizes.XL).toBe(KEPT.sizes.XL);
    expect(KEPT.sizes.M).toBeUndefined();
  });

  it("reach the screen as one change when the kit batches them", () => {
    const changes: LabelingData[] = [];
    const updater = createDataUpdater(emptyLabeling(), (next) => changes.push(next));
    batchDataChanges(() => {
      updater.update((current) => withDefectCount(current, "M", "inner", "lot_no", 1));
      updater.update((current) => withDefectCount(current, "M", "inner", "artwork", 2));
    });
    expect(changes).toHaveLength(1);
    expect(levelEntry(changes[0], "M", "inner").defects).toEqual({ lot_no: 1, artwork: 2 });
  });

  it("offer one box picker per box inspected, the plan until the count is recorded", () => {
    expect(boxSlots(emptyLabelingSize().inner, 3)).toBe(3);
    expect(boxSlots({ ...emptyLabelingSize().inner, inspected: 5 }, 3)).toBe(5);
    expect(boxSlots({ ...emptyLabelingSize().inner, inspected: 0 }, 3)).toBe(0);
  });
});
