import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { makeTestContext } from "@/modules/_framework/testing";
import { calcDimensions } from "./calc";
import { cellPath, gridChanges, gridColumns, sizeHeading, withReadings, type GridColumns } from "./capture-data";
import { DIMENSIONS_DEFAULT_CONFIG, DIMENSIONS_LABELS, MEASURES, type Measure } from "./config";
import { DimensionsDataSchema, emptyDimensions, emptyGlove, type DimensionsData } from "./schema";

const SAFEDON_MEASURES = ["length", "width", "fingerThickness", "palmThickness"] as const;
const SHOWN: Measure[] = ["length", "width"];

const saved: DimensionsData = {
  sizes: {
    M: {
      gloves: [
        { ...emptyGlove(), length: 245, width: 95, cuffThickness: 0.04 },
        { ...emptyGlove(), length: 246 },
      ],
    },
    // Saved before XL was taken out of the order: kept, not shown.
    XL: { gloves: [{ ...emptyGlove(), length: 250 }] },
  },
};

/** What MeasurementGrid hands back after one cell is set: every column, built from the columns it rendered. */
function edit(columns: GridColumns, measure: Measure, row: number, value: number | null): GridColumns {
  const column = [...(columns[measure] ?? [])];
  column[row] = value;
  return { ...columns, [measure]: column };
}

describe("dimensions capture data", () => {
  it("reads a size's readings as grid columns of n gloves", () => {
    expect(gridColumns(saved, "M", SHOWN, 3)).toEqual({ length: [245, 246, null], width: [95, null, null] });
    expect(gridColumns(saved, "S", ["length"], 2)).toEqual({ length: [null, null] });
  });

  it("finds the readings a grid change touched, nothing else", () => {
    const before = gridColumns(saved, "M", SHOWN, 3);
    expect(gridChanges(before, edit(before, "width", 2, 96), SHOWN, 3)).toEqual([{ row: 2, measure: "width", value: 96 }]);
    expect(gridChanges(before, edit(before, "length", 0, null), SHOWN, 3)).toEqual([
      { row: 0, measure: "length", value: null },
    ]);
    expect(gridChanges(before, before, SHOWN, 3)).toEqual([]);
    // A pasted column: every cell that differs, in grid order.
    expect(gridChanges(before, { ...before, length: [245, 247, 244] }, SHOWN, 3)).toEqual([
      { row: 1, measure: "length", value: 247 },
      { row: 2, measure: "length", value: 244 },
    ]);
  });

  it("writes the readings and hands back the whole data, other sizes untouched", () => {
    const next = withReadings(saved, "M", [
      { row: 1, measure: "length", value: 247 },
      { row: 1, measure: "width", value: 96 },
      { row: 2, measure: "length", value: 244 },
    ]);
    expect(next.sizes.M.gloves).toEqual([
      { ...emptyGlove(), length: 245, width: 95, cuffThickness: 0.04 },
      { ...emptyGlove(), length: 247, width: 96 },
      { ...emptyGlove(), length: 244 },
    ]);
    expect(next.sizes.XL).toBe(saved.sizes.XL);
    expect(DimensionsDataSchema.parse(next)).toEqual(next);
  });

  it("keeps the measures the template does not show and the gloves past the grid", () => {
    const thirteen = { sizes: { M: { gloves: Array.from({ length: 13 }, () => ({ ...emptyGlove(), length: 245 })) } } };
    const before = gridColumns(thirteen, "M", ["length"], 2);
    const next = withReadings(thirteen, "M", gridChanges(before, { length: [240, 241] }, ["length"], 2));
    expect(next.sizes.M.gloves.map((glove) => glove.length)).toEqual([240, 241, ...Array.from({ length: 11 }, () => 245)]);
    const columns = gridColumns(saved, "M", SAFEDON_MEASURES, 13);
    const cuff = withReadings(saved, "M", gridChanges(columns, edit(columns, "palmThickness", 0, 0.11), SAFEDON_MEASURES, 13));
    expect(cuff.sizes.M.gloves[0]).toEqual({ ...emptyGlove(), length: 245, width: 95, palmThickness: 0.11, cuffThickness: 0.04 });
  });

  it("drops empty gloves at the end, and a cleared size keeps no readings", () => {
    const next = withReadings(saved, "M", [{ row: 1, measure: "length", value: null }]);
    expect(next.sizes.M.gloves).toHaveLength(1);
    const cleared = withReadings(next, "M", [
      { row: 0, measure: "length", value: null },
      { row: 0, measure: "width", value: null },
      { row: 0, measure: "cuffThickness", value: null },
    ]);
    expect(cleared.sizes.M.gloves).toEqual([]);
  });

  it("starts a size that has nothing saved", () => {
    const next = withReadings(emptyDimensions(), "S", [{ row: 1, measure: "length", value: 243 }]);
    expect(next).toEqual({ sizes: { S: { gloves: [emptyGlove(), { ...emptyGlove(), length: 243 }] } } });
  });

  it("hands back the same data when nothing changes, so nothing is saved", () => {
    expect(withReadings(saved, "M", [])).toBe(saved);
    expect(withReadings(saved, "M", [{ row: 0, measure: "length", value: 245 }])).toBe(saved);
    expect(withReadings(saved, "S", [{ row: 4, measure: "width", value: null }])).toBe(saved);
  });

  describe("through useDataUpdater (docs/CAPTURE_KIT.md)", () => {
    // The screen replaces the data on every onChange; the grid keeps the columns it rendered until it renders again.
    function screen() {
      const changes: DimensionsData[] = [];
      const updater = createDataUpdater(saved, (next) => changes.push(next));
      const rendered = gridColumns(saved, "M", SHOWN, 3);
      const write = (next: GridColumns) =>
        updater.update((current) => withReadings(current, "M", gridChanges(rendered, next, SHOWN, 3)));
      return { changes, rendered, write };
    }

    it("keeps both of two grid changes made in one event", () => {
      const { changes, rendered, write } = screen();
      // A commit on blur as the size turns, then another, each built by the grid from the columns it rendered.
      write(edit(rendered, "length", 2, 244));
      write(edit(rendered, "width", 1, 96));
      expect(changes).toHaveLength(2);
      expect(gridColumns(changes[1], "M", SHOWN, 3)).toEqual({ length: [245, 246, 244], width: [95, 96, null] });
      expect(changes[1].sizes.XL).toBe(saved.sizes.XL);
    });

    it("hands a paste to the screen as one change", () => {
      const { changes, rendered, write } = screen();
      batchDataChanges(() => {
        write({ ...rendered, length: [240, 241, 242] });
        write(edit(rendered, "width", 2, 97));
      });
      expect(changes).toHaveLength(1);
      expect(gridColumns(changes[0], "M", SHOWN, 3)).toEqual({ length: [240, 241, 242], width: [95, null, 97] });
    });
  });

  it("marks each grid cell with the path calc's issues point at", () => {
    const list = Array.from({ length: 13 }, (_, row) => ({ ...emptyGlove(), length: 245, width: row === 3 ? 0 : 95 }));
    const output = calcDimensions({
      data: { sizes: { M: { gloves: list } } },
      config: { ...DIMENSIONS_DEFAULT_CONFIG, measures: SHOWN },
      title: "Dimension",
      labels: DIMENSIONS_LABELS,
      context: makeTestContext({ sizes: ["M"] }),
      results: {},
      hasData: true,
    });
    // Glove 4's width is the 8th cell: row 3, column 1 of two.
    expect(output.issues.map((issue) => issue.path)).toEqual([cellPath("M", SHOWN, 3 * 2 + 1)]);
    expect(cellPath("M", MEASURES, 0)).toEqual(["sizes", "M", "gloves", 0, "length"]);
    expect(cellPath("M", MEASURES, 64)).toEqual(["sizes", "M", "gloves", 12, "cuffThickness"]);
  });

  it("fills the size into the template's heading", () => {
    expect(sizeHeading(DIMENSIONS_LABELS.sizeHeading, "M")).toBe("Dimension - Size M");
    expect(sizeHeading("Dimension", "M")).toBe("Dimension");
  });
});
