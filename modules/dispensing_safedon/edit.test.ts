import { describe, expect, it } from "vitest";
import { CARTONS_PER_PAGE } from "@/modules/carton_sampling/edit";
import {
  activeAfterRemoval,
  boxDefects,
  BOXES_PER_PAGE,
  boxesOf,
  boxPageOf,
  canRemoveBox,
  columnsShown,
  removeSafedonBox,
  setSafedonBoxNo,
  setSafedonCount,
  withoutTrailingBlanks,
} from "./edit";
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

  it("deletes a box: the ones after it move up, blanks left at the end go, other sizes stay", () => {
    const data: DispensingSafedonData = {
      sizes: {
        XS: {
          boxes: [
            { boxNo: 3, counts: { sticky: 1 } },
            { boxNo: 12, counts: {} },
            emptySafedonBox(),
            { boxNo: 59, counts: { stuck: 2 } },
          ],
        },
        XL: { boxes: [{ boxNo: 1, counts: {} }] },
      },
    };
    const middle = removeSafedonBox(data, "XS", 1);
    expect(middle.sizes.XS.boxes).toEqual([{ boxNo: 3, counts: { sticky: 1 } }, emptySafedonBox(), { boxNo: 59, counts: { stuck: 2 } }]);
    expect(middle.sizes.XL).toBe(data.sizes.XL);
    expect(data.sizes.XS.boxes).toHaveLength(4);
    // The last box: the blank one before it is dropped with it.
    expect(removeSafedonBox(data, "XS", 3).sizes.XS.boxes).toEqual([
      { boxNo: 3, counts: { sticky: 1 } },
      { boxNo: 12, counts: {} },
    ]);
    // Past the saved boxes (a row added and never filled in) nothing changes: the same object, so nothing is saved.
    expect(removeSafedonBox(data, "XS", 4)).toBe(data);
    expect(removeSafedonBox(data, "M", 0)).toBe(data);
    expect(DispensingSafedonDataSchema.parse(middle)).toEqual(middle);
  });

  it("offers Delete on rows holding something and rows past the plan, never on the plan's blank rows", () => {
    // 13 planned: a box number, a count without one, a blank saved before box 59; rows 5 to 13
    // are the plan's blanks; row 14 was added with Add Box.
    const boxes = [{ boxNo: 3, counts: {} }, { boxNo: null, counts: { stuck: 1 } }, emptySafedonBox(), { boxNo: 59, counts: {} }];
    expect(canRemoveBox(0, boxes, 13)).toBe(true);
    expect(canRemoveBox(1, boxes, 13)).toBe(true);
    expect(canRemoveBox(2, boxes, 13)).toBe(false);
    expect(canRemoveBox(3, boxes, 13)).toBe(true);
    expect(canRemoveBox(4, boxes, 13)).toBe(false);
    expect(canRemoveBox(12, boxes, 13)).toBe(false);
    expect(canRemoveBox(13, boxes, 13)).toBe(true);
    // Past the plan, a blank saved between boxes goes too.
    expect(canRemoveBox(2, boxes, 2)).toBe(true);
  });

  it("keeps the chosen box chosen once another is deleted", () => {
    // Below the deleted one: one place up. Above it, or the deleted one itself: the same place.
    expect(activeAfterRemoval(5, 2, 13)).toBe(4);
    expect(activeAfterRemoval(1, 2, 13)).toBe(1);
    expect(activeAfterRemoval(2, 2, 13)).toBe(2);
    // The last row deleted while chosen: the row above it.
    expect(activeAfterRemoval(13, 13, 13)).toBe(12);
    expect(activeAfterRemoval(0, 0, 0)).toBe(0);
  });

  it("pages the box list 10 rows at a time, as the carton numbers", () => {
    expect(BOXES_PER_PAGE).toBe(CARTONS_PER_PAGE);
    expect(boxPageOf(0)).toBe(0);
    expect(boxPageOf(9)).toBe(0);
    expect(boxPageOf(10)).toBe(1);
    expect(boxPageOf(19)).toBe(1);
    expect(boxPageOf(20)).toBe(2);
    expect(boxPageOf(-1)).toBe(0);
  });

  it("totals a box's defects over the template's codes only, as calc does", () => {
    const box = { boxNo: 3, counts: { no_cuff: 2, sticky: 1, torn_pack: 4 } };
    expect(boxDefects(box, ["no_cuff", "finger_out", "sticky"])).toBe(3);
    expect(boxDefects(box, Object.keys(box.counts))).toBe(7);
    expect(boxDefects(emptySafedonBox(), ["no_cuff"])).toBe(0);
  });
});
