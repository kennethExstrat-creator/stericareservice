import { describe, expect, it } from "vitest";
import { WATERTIGHT_DEFAULT_CONFIG } from "./config";
import {
  addOneOff,
  fillTested,
  labelKey,
  oneOffLabels,
  oneOffRowKey,
  readHoles,
  readOneOff,
  setHoles,
  setOneOff,
  setOtherDescription,
  setTested,
  unlistedCodes,
} from "./edit";
import { WatertightDataSchema, type WatertightData } from "./schema";

const LOCATIONS = WATERTIGHT_DEFAULT_CONFIG.locations;

function data(sizes: Record<string, unknown>): WatertightData {
  return WatertightDataSchema.parse({ sizes });
}

describe("watertight edits", () => {
  it("sets a location's count and removes it at 0, leaving the data it started from as it was", () => {
    const start = data({ M: { tested: 500 } });
    const one = setHoles(start, { size: "M" }, "hole_finger", 1);
    expect(one.sizes.M).toMatchObject({ tested: 500, holes: { hole_finger: 1 } });
    expect(readHoles(one, { size: "M" }, "hole_finger")).toBe(1);
    expect(setHoles(one, { size: "M" }, "hole_finger", 0).sizes.M.holes).toEqual({});
    expect(start.sizes.M.holes).toEqual({});
    expect(WatertightDataSchema.safeParse(one).success).toBe(true);
  });

  it("keeps every other size, ordered or not (6.2 rule 4: the data returns if the size is ordered again)", () => {
    const start = data({ XS: { tested: 80, holes: { hole_palm: 2 } }, M: {} });
    const next = setTested(start, "M", 500);
    expect(next.sizes.XS).toBe(start.sizes.XS);
    expect(next.sizes.M.tested).toBe(500);
    expect(setTested(next, "M", null).sizes.M.tested).toBeNull();
  });

  it("fills the sampling plan's n only into a size without gloves tested, keeping one entered", () => {
    const start = data({ S: { tested: 125 } });
    expect(fillTested(start, "M", 500).sizes).toMatchObject({ S: { tested: 125 }, M: { tested: 500 } });
    expect(fillTested(start, "S", 200)).toBe(start);
  });

  it("starts a size that has no entry yet", () => {
    expect(setHoles(data({}), { size: "L" }, "glove_burst", 1).sizes.L).toEqual({
      tested: null,
      holes: { glove_burst: 1 },
      otherDescription: null,
      unmapped: [],
    });
  });

  it("writes per hand under R and L with a hand split, the gloves tested staying on the size", () => {
    let next = setTested(data({}), "7.0", 125);
    next = setHoles(next, { size: "7.0", hand: "R" }, "hole_palm", 2);
    next = setHoles(next, { size: "7.0", hand: "L" }, "hole_cuff", 1);
    expect(next.sizes["7.0"]).toMatchObject({
      tested: 125,
      holes: {},
      R: { holes: { hole_palm: 2 } },
      L: { holes: { hole_cuff: 1 } },
    });
    expect(readHoles(next, { size: "7.0", hand: "L" }, "hole_cuff")).toBe(1);
    expect(readHoles(next, { size: "7.0" }, "hole_cuff")).toBe(0);
  });

  it("stores where the 'Other :' holes were, and nothing for a blank description", () => {
    const next = setOtherDescription(data({}), { size: "M" }, "Wrist");
    expect(next.sizes.M.otherDescription).toBe("Wrist");
    expect(setOtherDescription(next, { size: "M" }, "  ").sizes.M.otherDescription).toBeNull();
    expect(setOtherDescription(data({}), { size: "M", hand: "L" }, "Thumb").sizes.M.L?.otherDescription).toBe("Thumb");
  });

  it("adds a one-off label once, at 0, unless the list or another one-off already has it", () => {
    const sizes = ["S", "M"];
    const added = addOneOff(data({}), { size: "M" }, "  Near the thumb ", LOCATIONS, sizes, false);
    expect(added.sizes.M.unmapped).toEqual([{ label: "Near the thumb", count: 0 }]);
    expect(addOneOff(added, { size: "S" }, "near THE thumb", LOCATIONS, sizes, false)).toBe(added);
    expect(addOneOff(added, { size: "M" }, "palm", LOCATIONS, sizes, false)).toBe(added);
    expect(addOneOff(added, { size: "M" }, "Other", LOCATIONS, sizes, false)).toBe(added);
    expect(addOneOff(added, { size: "M" }, "   ", LOCATIONS, sizes, false)).toBe(added);
  });

  it("counts a one-off in any cell, adding it to that cell's list when needed", () => {
    let next = addOneOff(data({}), { size: "M" }, "Near the thumb", LOCATIONS, ["S", "M"], false);
    next = setOneOff(next, { size: "M" }, "near the thumb", 2);
    next = setOneOff(next, { size: "S" }, "Near the thumb", 1);
    expect(next.sizes.M.unmapped).toEqual([{ label: "Near the thumb", count: 2 }]);
    expect(next.sizes.S.unmapped).toEqual([{ label: "Near the thumb", count: 1 }]);
    expect(readOneOff(next, { size: "M" }, "NEAR the thumb")).toEqual({ index: 0, entry: { label: "Near the thumb", count: 2 } });
    expect(readOneOff(next, { size: "L" }, "Near the thumb")).toBeNull();
  });

  it("lists codes with holes that the template does not list, over the ordered sizes and hands", () => {
    const listed = new Set(LOCATIONS.map((location) => location.code));
    const saved = data({
      M: { holes: { hole_palm: 1, glove_burst: 2, hole_seam: 0 } },
      L: { R: { holes: { hole_thumb: 1 } } },
      XL: { holes: { not_ordered: 1 } },
    });
    expect(unlistedCodes(saved, ["M", "L"], false, listed)).toEqual(["glove_burst"]);
    expect(unlistedCodes(saved, ["M", "L"], true, listed)).toEqual(["hole_thumb"]);
  });

  it("lists the one-off rows of the ordered sizes and hands, first spelling kept", () => {
    const saved = data({
      S: { R: { unmapped: [{ label: "Near the thumb", count: 1 }] } },
      M: { L: { unmapped: [{ label: "near the thumb", count: 0 }, { label: "Seam", count: 1 }] } },
      XL: { R: { unmapped: [{ label: "Not ordered", count: 1 }] } },
    });
    expect(oneOffLabels(saved, ["S", "M"], true)).toEqual(["Near the thumb", "Seam"]);
    expect(oneOffLabels(saved, ["S", "M"], false)).toEqual([]);
    expect(oneOffRowKey(" Near  the thumb")).toBe("unmapped:near the thumb");
    expect(labelKey("A  B ")).toBe("a b");
  });
});
