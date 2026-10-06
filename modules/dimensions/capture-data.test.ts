import { describe, expect, it } from "vitest";
import { makeTestContext } from "@/modules/_framework/testing";
import { calcDimensions } from "./calc";
import { cellPath, gridColumns, sizeHeading, withGridColumns } from "./capture-data";
import { DIMENSIONS_DEFAULT_CONFIG, DIMENSIONS_LABELS, MEASURES } from "./config";
import { DimensionsDataSchema, emptyDimensions, emptyGlove, type DimensionsData } from "./schema";

const SAFEDON_MEASURES = ["length", "width", "fingerThickness", "palmThickness"] as const;

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
    expect(gridColumns(saved, "M", ["length", "width"], 3)).toEqual({ length: [245, 246, null], width: [95, null, null] });
    expect(gridColumns(saved, "S", ["length"], 2)).toEqual({ length: [null, null] });
  });

  it("writes one size's columns and hands back the whole data, other sizes untouched", () => {
    const next = withGridColumns(saved, "M", { length: [245, 247, 244], width: [95, 96, null] }, ["length", "width"], 3);
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
    const next = withGridColumns(thirteen, "M", { length: [240, 241] }, ["length"], 2);
    expect(next.sizes.M.gloves.map((glove) => glove.length)).toEqual([240, 241, ...Array.from({ length: 11 }, () => 245)]);
    const cuff = withGridColumns(saved, "M", gridColumns(saved, "M", SAFEDON_MEASURES, 13), SAFEDON_MEASURES, 13);
    expect(cuff.sizes.M.gloves[0].cuffThickness).toBe(0.04);
  });

  it("drops empty gloves at the end, and a cleared size keeps no readings", () => {
    const next = withGridColumns(saved, "M", { length: [245, null, null], width: [95, null, null] }, ["length", "width"], 3);
    expect(next.sizes.M.gloves).toHaveLength(1);
    const cleared = withGridColumns(
      saved,
      "M",
      Object.fromEntries(MEASURES.map((measure) => [measure, [null, null]])),
      MEASURES,
      2,
    );
    expect(cleared.sizes.M.gloves).toEqual([]);
  });

  it("starts a size that has nothing saved", () => {
    const next = withGridColumns(emptyDimensions(), "S", { length: [null, 243] }, ["length"], 2);
    expect(next).toEqual({ sizes: { S: { gloves: [emptyGlove(), { ...emptyGlove(), length: 243 }] } } });
  });

  it("marks each grid cell with the path calc's issues point at", () => {
    const list = Array.from({ length: 13 }, (_, row) => ({ ...emptyGlove(), length: 245, width: row === 3 ? 0 : 95 }));
    const output = calcDimensions({
      data: { sizes: { M: { gloves: list } } },
      config: { ...DIMENSIONS_DEFAULT_CONFIG, measures: ["length", "width"] },
      title: "Dimension",
      labels: DIMENSIONS_LABELS,
      context: makeTestContext({ sizes: ["M"] }),
      results: {},
      hasData: true,
    });
    // Glove 4's width is the 8th cell: row 3, column 1 of two.
    expect(output.issues.map((issue) => issue.path)).toEqual([cellPath("M", ["length", "width"], 3 * 2 + 1)]);
    expect(cellPath("M", MEASURES, 0)).toEqual(["sizes", "M", "gloves", 0, "length"]);
    expect(cellPath("M", MEASURES, 64)).toEqual(["sizes", "M", "gloves", 12, "cuffThickness"]);
  });

  it("fills the size into the template's heading", () => {
    expect(sizeHeading(DIMENSIONS_LABELS.sizeHeading, "M")).toBe("Dimension - Size M");
    expect(sizeHeading("Dimension", "M")).toBe("Dimension");
  });
});
