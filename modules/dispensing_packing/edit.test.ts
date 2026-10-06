import { describe, expect, it } from "vitest";
import { boxesOf, rowsShown, updatePackingBox, withoutTrailingBlanks } from "./edit";
import { DispensingPackingDataSchema, emptyPackingBox, type DispensingPackingData } from "./schema";

const A = { ...emptyPackingBox(), boxNo: 13, layeringPct: 90, dispensingPct: 92, stickiness: "A" };

describe("dispensing_packing editing", () => {
  it("shows the planned rows, more when more are saved or asked for, at most the cap", () => {
    expect(rowsShown(13, 0)).toBe(13);
    expect(rowsShown(13, 15)).toBe(15);
    expect(rowsShown(5, 3, 7)).toBe(7);
    expect(rowsShown(5, 7, 6)).toBe(7);
    expect(rowsShown(0, 0)).toBe(0);
    expect(rowsShown(2000, 0)).toBe(500);
  });

  it("changes one row and creates the rows before it blank", () => {
    const data: DispensingPackingData = { sizes: {} };
    const next = updatePackingBox(data, "M", 2, { layeringPct: 88 });
    expect(boxesOf(next, "M")).toEqual([emptyPackingBox(), emptyPackingBox(), { ...emptyPackingBox(), layeringPct: 88 }]);
    expect(data).toEqual({ sizes: {} });
    expect(DispensingPackingDataSchema.parse(next)).toEqual(next);
  });

  it("keeps the other rows and sizes, a size no longer ordered included", () => {
    const data: DispensingPackingData = { sizes: { M: { boxes: [A, A] }, XL: { boxes: [A] } } };
    const next = updatePackingBox(data, "M", 1, { stickiness: "D" });
    expect(next.sizes.M.boxes).toEqual([A, { ...A, stickiness: "D" }]);
    expect(next.sizes.XL).toBe(data.sizes.XL);
  });

  it("drops blank rows at the end, so an emptied row is not saved", () => {
    const data: DispensingPackingData = { sizes: { M: { boxes: [A, { ...emptyPackingBox(), note: "torn" }] } } };
    expect(updatePackingBox(data, "M", 1, { note: null }).sizes.M.boxes).toEqual([A]);
    expect(updatePackingBox(data, "M", 0, { boxNo: null, layeringPct: null, dispensingPct: null, stickiness: null }).sizes.M.boxes)
      .toEqual([emptyPackingBox(), { ...emptyPackingBox(), note: "torn" }]);
    expect(withoutTrailingBlanks([emptyPackingBox(), A, emptyPackingBox()])).toEqual([emptyPackingBox(), A]);
    expect(updatePackingBox({ sizes: {} }, "S", 4, {})).toEqual({ sizes: { S: { boxes: [] } } });
  });
});
