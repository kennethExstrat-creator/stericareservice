import { describe, expect, it } from "vitest";
import type { MeasurementChange } from "@/components/qc";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { calcDimensions } from "./calc";
import {
  cellPath,
  gridColumns,
  measureSummary,
  readingChanges,
  sizeHeading,
  withoutGlovesPast,
  withReadings,
} from "./capture-data";
import { DIMENSIONS_DEFAULT_CONFIG, DIMENSIONS_LABELS, type Measure } from "./config";
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

describe("dimensions capture data", () => {
  it("reads a size's readings as grid columns of n gloves", () => {
    expect(gridColumns(saved, "M", SHOWN, 3)).toEqual({ length: [245, 246, null], width: [95, null, null] });
    expect(gridColumns(saved, "S", ["length"], 2)).toEqual({ length: [null, null] });
  });

  it("reads the grid's changed cells as readings of the measures on screen, nothing else", () => {
    expect(
      readingChanges(
        [
          { row: 2, measure: "width", value: 96 },
          { row: 0, measure: "length", value: null },
          { row: 0, measure: "cuffThickness", value: 0.05 },
          { row: 1, measure: "colour", value: 3 },
        ],
        SHOWN,
      ),
    ).toEqual([
      { row: 2, measure: "width", value: 96 },
      { row: 0, measure: "length", value: null },
    ]);
    expect(readingChanges([], SHOWN)).toEqual([]);
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
    const pasted = [
      { row: 0, measure: "length", value: 240 },
      { row: 1, measure: "length", value: 241 },
    ];
    const next = withReadings(thirteen, "M", readingChanges(pasted, ["length"]));
    expect(next.sizes.M.gloves.map((glove) => glove.length)).toEqual([240, 241, ...Array.from({ length: 11 }, () => 245)]);
    const palm = readingChanges([{ row: 0, measure: "palmThickness", value: 0.11 }], SAFEDON_MEASURES);
    const cuff = withReadings(saved, "M", palm);
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

  it("removes the gloves past the grid's rows, every measure of them, and nothing else", () => {
    const thirteen: DimensionsData = {
      sizes: {
        ...saved.sizes,
        M: { gloves: Array.from({ length: 13 }, (_, row) => ({ ...emptyGlove(), length: 240 + row, cuffThickness: 0.04 })) },
      },
    };
    const cut = withoutGlovesPast(thirteen, "M", 10);
    expect(cut.sizes.M.gloves).toEqual(thirteen.sizes.M.gloves.slice(0, 10));
    expect(cut.sizes.XL).toBe(saved.sizes.XL);
    expect(DimensionsDataSchema.parse(cut)).toEqual(cut);
    // calc's warning about them goes with them.
    const planned = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions: 10 }) } });
    const codes = (data: DimensionsData) =>
      calcDimensions({
        data,
        config: DIMENSIONS_DEFAULT_CONFIG,
        title: "Dimension",
        labels: DIMENSIONS_LABELS,
        context: planned,
        results: {},
        hasData: true,
      }).issues.map((issue) => issue.code);
    expect(codes(thirteen)).toEqual(["dimension_beyond_sample"]);
    expect(codes(cut)).toEqual([]);
    // Empty gloves left at the end go too; with nothing past the rows the data is the same object.
    const gap = { sizes: { M: { gloves: [{ ...emptyGlove(), length: 245 }, emptyGlove(), { ...emptyGlove(), length: 250 }] } } };
    expect(withoutGlovesPast(gap, "M", 2).sizes.M.gloves).toEqual([{ ...emptyGlove(), length: 245 }]);
    expect(withoutGlovesPast(thirteen, "M", 13)).toBe(thirteen);
    expect(withoutGlovesPast(thirteen, "S", 0)).toBe(thirteen);
  });

  describe("through useDataUpdater (docs/CAPTURE_KIT.md)", () => {
    // The screen replaces the data on every onChange; the grid hands over only the cells each change touched.
    function screen() {
      const changes: DimensionsData[] = [];
      const updater = createDataUpdater(saved, (next) => changes.push(next));
      const write = (cells: readonly MeasurementChange[]) =>
        updater.update((current) => withReadings(current, "M", readingChanges(cells, SHOWN)));
      return { changes, write };
    }

    it("keeps both of two grid changes made in one event", () => {
      const { changes, write } = screen();
      // A commit on blur as the size turns, then another, before the screen renders again.
      write([{ row: 2, measure: "length", value: 244 }]);
      write([{ row: 1, measure: "width", value: 96 }]);
      expect(changes).toHaveLength(2);
      expect(gridColumns(changes[1], "M", SHOWN, 3)).toEqual({ length: [245, 246, 244], width: [95, 96, null] });
      expect(changes[1].sizes.XL).toBe(saved.sizes.XL);
    });

    it("hands a paste to the screen as one change", () => {
      const { changes, write } = screen();
      batchDataChanges(() => {
        write([
          { row: 0, measure: "length", value: 240 },
          { row: 1, measure: "length", value: 241 },
          { row: 2, measure: "length", value: 242 },
        ]);
        write([{ row: 2, measure: "width", value: 97 }]);
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
    // Glove 4's width.
    expect(output.issues.map((issue) => issue.path)).toEqual([cellPath("M", { row: 3, measure: "width" })]);
    expect(cellPath("M", { row: 12, measure: "cuffThickness" })).toEqual(["sizes", "M", "gloves", 12, "cuffThickness"]);
  });

  it("gives the grid's footer calc's figures, or nothing while calc has none", () => {
    const list = Array.from({ length: 13 }, (_, row) => ({ ...emptyGlove(), length: row < 9 ? 245 : null, width: 95 }));
    const { computed } = calcDimensions({
      data: { sizes: { M: { gloves: list } } },
      config: { ...DIMENSIONS_DEFAULT_CONFIG, measures: SHOWN, specs: [{ size: "M", specs: { width: { kind: "min", min: 90 } } }] },
      title: "Dimension",
      labels: DIMENSIONS_LABELS,
      context: makeTestContext({ sizes: ["M"] }),
      results: {},
      hasData: true,
    });
    // Length has no spec here: recorded, not judged.
    expect(measureSummary(computed, "M", "length")).toEqual({ statistic: 245, outcome: "na", count: 9 });
    expect(measureSummary(computed, "M", "width")).toEqual({ statistic: 95, outcome: "pass", count: 13 });
    // A size calc did not evaluate, or no evaluation at all: the grid summarises its cells.
    expect(measureSummary(computed, "S", "length")).toBeUndefined();
    expect(measureSummary({}, "M", "length")).toBeUndefined();
    expect(measureSummary(undefined, "M", "length")).toBeUndefined();
  });

  it("fills the size into the template's heading", () => {
    expect(sizeHeading(DIMENSIONS_LABELS.sizeHeading, "M")).toBe("Dimension - Size M");
    expect(sizeHeading("Dimension", "M")).toBe("Dimension");
  });
});
