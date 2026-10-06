import { describe, expect, it } from "vitest";
import { VISUAL_DEFAULT_CONFIG } from "./config";
import {
  addOneOff,
  fillInspected,
  oneOffLabels,
  oneOffRowKey,
  readCount,
  readOneOff,
  removeOneOff,
  setCount,
  setInspected,
  setOneOff,
  unlistedCodes,
} from "./edit";
import { VisualDataSchema, type VisualData } from "./schema";

const MINOR = VISUAL_DEFAULT_CONFIG.classes.minor.defects;

function data(sizes: Record<string, unknown>): VisualData {
  return VisualDataSchema.parse({ sizes });
}

describe("visual edits", () => {
  it("sets a defect's count in its class and removes it at 0, leaving the data it started from as it was", () => {
    const start = data({ M: { major: { inspected: 500 } } });
    const next = setCount(start, { size: "M", cls: "major" }, "thin_spot", 5);
    expect(next.sizes.M.major).toEqual({ inspected: 500, counts: { thin_spot: 5 }, unmapped: [] });
    expect(readCount(next, { size: "M", cls: "major" }, "thin_spot")).toBe(5);
    expect(readCount(next, { size: "M", cls: "minor" }, "thin_spot")).toBe(0);
    expect(setCount(next, { size: "M", cls: "major" }, "thin_spot", 0).sizes.M.major.counts).toEqual({});
    expect(start.sizes.M.major.counts).toEqual({});
    expect(VisualDataSchema.safeParse(next).success).toBe(true);
  });

  it("keeps a code apart per class: severity is the class", () => {
    let next = setCount(data({}), { size: "M", cls: "major" }, "bead_defective", 1);
    next = setCount(next, { size: "M", cls: "minor" }, "bead_defective", 3);
    expect([next.sizes.M.major.counts.bead_defective, next.sizes.M.minor.counts.bead_defective]).toEqual([1, 3]);
  });

  it("keeps every other size, ordered or not", () => {
    const start = data({ XL: { critical: { inspected: 200 } }, M: {} });
    const next = setInspected(start, "M", "critical", 500);
    expect(next.sizes.XL).toBe(start.sizes.XL);
    expect(next.sizes.M.critical.inspected).toBe(500);
  });

  it("writes per hand and class with a hand split, the gloves inspected staying on the size", () => {
    let next = setInspected(data({}), "7.0", "major", 125);
    next = setCount(next, { size: "7.0", cls: "major", hand: "R" }, "stain", 2);
    next = setCount(next, { size: "7.0", cls: "minor", hand: "L" }, "dirt_small", 1);
    expect(next.sizes["7.0"].major).toEqual({ inspected: 125, counts: {}, unmapped: [] });
    expect(next.sizes["7.0"].R?.major.counts).toEqual({ stain: 2 });
    expect(next.sizes["7.0"].L?.minor.counts).toEqual({ dirt_small: 1 });
    expect(readCount(next, { size: "7.0", cls: "major", hand: "R" }, "stain")).toBe(2);
  });

  it("fills the sampling plan's n into the given classes that have none, keeping any entered", () => {
    const start = data({ M: { major: { inspected: 315 } } });
    const next = fillInspected(start, "M", ["critical", "major", "minor"], 500);
    expect([next.sizes.M.critical.inspected, next.sizes.M.major.inspected, next.sizes.M.minor.inspected]).toEqual([
      500, 315, 500,
    ]);
    expect(fillInspected(data({}), "S", ["major"], 200).sizes.S.critical.inspected).toBeNull();
  });

  it("adds a one-off label to its class once, at 0, unless the class's list or a one-off already has it", () => {
    const cell = { size: "M", cls: "minor" } as const;
    const added = addOneOff(data({}), cell, "Faint print", MINOR, ["M"], false);
    expect(added.sizes.M.minor.unmapped).toEqual([{ label: "Faint print", count: 0 }]);
    expect(addOneOff(added, cell, "faint PRINT", MINOR, ["M"], false)).toBe(added);
    expect(addOneOff(added, cell, "rolled bead", MINOR, ["M"], false)).toBe(added);
    // Another class has its own one-off rows.
    expect(addOneOff(added, { size: "M", cls: "major" }, "Faint print", [], ["M"], false).sizes.M.major.unmapped).toHaveLength(1);
  });

  it("lists codes with defects that a class does not list, over the ordered sizes and hands", () => {
    const listed = new Set(VISUAL_DEFAULT_CONFIG.classes.major.defects.map((defect) => defect.code));
    const saved = data({
      M: { major: { counts: { thin_spot: 2, powder_mark: 1, bead_blister: 0 } }, minor: { counts: { powder_mark: 4 } } },
      L: { R: { major: { counts: { seam_mark: 1 } } } },
      XL: { major: { counts: { not_ordered: 1 } } },
    });
    expect(unlistedCodes(saved, ["M", "L"], "major", false, listed)).toEqual(["powder_mark"]);
    expect(unlistedCodes(saved, ["M", "L"], "major", true, listed)).toEqual(["seam_mark"]);
  });

  it("counts a one-off in any cell and lists a class's one-off rows over the ordered sizes and hands", () => {
    let next = setOneOff(data({}), { size: "S", cls: "major", hand: "R" }, "Seam mark", 1);
    next = setOneOff(next, { size: "M", cls: "major", hand: "L" }, "seam mark", 2);
    next = setOneOff(next, { size: "M", cls: "major", hand: "L" }, "Seam mark", 3);
    expect(next.sizes.M.L?.major.unmapped).toEqual([{ label: "seam mark", count: 3 }]);
    expect(readOneOff(next, { size: "M", cls: "major", hand: "L" }, "SEAM MARK")?.index).toBe(0);
    expect(oneOffLabels(next, ["S", "M"], "major", true)).toEqual(["Seam mark"]);
    expect(oneOffLabels(next, ["S", "M"], "minor", true)).toEqual([]);
    expect(oneOffLabels(next, ["M"], "major", false)).toEqual([]);
    expect(oneOffRowKey("Seam  mark")).toBe("unmapped:seam mark");
  });

  it("takes a class's one-off row added by mistake off the ordered sizes, never one that counts defects", () => {
    const saved = data({
      M: {
        major: { unmapped: [{ label: "Faint print", count: 0 }, { label: "Seam mark", count: 2 }] },
        minor: { unmapped: [{ label: "Faint print", count: 0 }] },
      },
      XL: { major: { unmapped: [{ label: "Faint print", count: 0 }] } },
    });
    const next = removeOneOff(saved, "major", "faint  print", ["M"], false);
    expect(next.sizes.M.major.unmapped).toEqual([{ label: "Seam mark", count: 2 }]);
    // Another class's row of the same words is its own.
    expect(next.sizes.M.minor.unmapped).toEqual([{ label: "Faint print", count: 0 }]);
    expect(next.sizes.XL).toBe(saved.sizes.XL);
    expect(removeOneOff(saved, "major", "Seam mark", ["M"], false)).toBe(saved);
    const split = data({ "7.0": { L: { major: { unmapped: [{ label: "Faint print", count: 0 }] } } } });
    expect(removeOneOff(split, "major", "Faint print", ["7.0"], true).sizes["7.0"].L?.major.unmapped).toEqual([]);
    expect(VisualDataSchema.safeParse(next).success).toBe(true);
  });
});
