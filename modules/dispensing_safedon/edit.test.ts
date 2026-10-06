import { describe, expect, it } from "vitest";
import { boxesOf, columnsShown, setSafedonBoxNo, setSafedonCount, withoutTrailingBlanks } from "./edit";
import { DispensingSafedonDataSchema, emptySafedonBox, type DispensingSafedonData } from "./schema";

describe("dispensing_safedon editing", () => {
  it("shows the planned columns, more when more are saved or asked for, at most the cap", () => {
    expect(columnsShown(13, 0)).toBe(13);
    expect(columnsShown(5, 6)).toBe(6);
    expect(columnsShown(5, 5, 6)).toBe(6);
    expect(columnsShown(5, 7, 6)).toBe(7);
    expect(columnsShown(2000, 0)).toBe(500);
  });

  it("sets a box number and creates the columns before it blank", () => {
    const next = setSafedonBoxNo({ sizes: {} }, "XS", 1, 12);
    expect(boxesOf(next, "XS")).toEqual([emptySafedonBox(), { boxNo: 12, counts: {} }]);
    expect(DispensingSafedonDataSchema.parse(next)).toEqual(next);
  });

  it("counts by code, keeps counts sparse, and keeps the other columns and sizes", () => {
    const data: DispensingSafedonData = { sizes: { XS: { boxes: [{ boxNo: 1, counts: { sticky: 1 } }] }, XL: { boxes: [] } } };
    const two = setSafedonCount(data, "XS", 0, "no_cuff", 2);
    expect(two.sizes.XS.boxes).toEqual([{ boxNo: 1, counts: { sticky: 1, no_cuff: 2 } }]);
    expect(setSafedonCount(two, "XS", 0, "sticky", 0).sizes.XS.boxes).toEqual([{ boxNo: 1, counts: { no_cuff: 2 } }]);
    expect(two.sizes.XL).toBe(data.sizes.XL);
    expect(data.sizes.XS.boxes[0].counts).toEqual({ sticky: 1 });
  });

  it("drops blank columns at the end, so a column tapped back to nothing is not saved", () => {
    const data = setSafedonCount({ sizes: {} }, "XS", 2, "stuck", 1);
    expect(data.sizes.XS.boxes).toHaveLength(3);
    expect(setSafedonCount(data, "XS", 2, "stuck", 0).sizes.XS.boxes).toEqual([]);
    expect(setSafedonBoxNo(setSafedonBoxNo({ sizes: {} }, "XS", 0, 7), "XS", 0, null).sizes.XS.boxes).toEqual([]);
    expect(withoutTrailingBlanks([emptySafedonBox(), { boxNo: 3, counts: {} }, { boxNo: null, counts: { stuck: 0 } }])).toEqual([
      emptySafedonBox(),
      { boxNo: 3, counts: {} },
    ]);
  });
});
