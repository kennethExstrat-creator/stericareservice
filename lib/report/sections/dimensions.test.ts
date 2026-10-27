// Section 03, Dimensions & Weight (TG35 page 3), as its builder fills the
// slot from the export: the lead from the specs in force, each glove's
// length, the palm width against each size's tolerance, the statistics by
// size and the weight per glove, from the placeholder example reports and
// changed copies of them run through the real modules (STD_EG: size M, by
// median; SAFEDON_EG: sizes XS to L, by average, no cuff). The model is
// built whole, as the report builds it (the builder is registered in
// ./index, which it imports back).
import { describe, expect, it } from "vitest";
import type { InspectionExport } from "@/lib/schemas/export";
import { buildReportModel, type DimensionsSection, type ReportSectionPlanEntry } from "../model";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { failingSafedon, fourSizes, safedonWith, sizesOf, stdEgWith, withSizeXL } from "./__fixtures__/dimensions";
import { readingText, typedDecimals } from "./dimension-shared";

function dimensionsOf(doc: InspectionExport): DimensionsSection {
  const content = buildReportModel(doc).sections.dimensions;
  if (!content) throw new Error("Section 03 was not built.");
  return content;
}

const entryOf = (doc: InspectionExport) =>
  buildReportModel(doc).plan.find((entry): entry is ReportSectionPlanEntry => entry.kind === "section" && entry.key === "dimensions");

/** The page parts, page by page, as "block from-to" words. */
const layoutOf = (content: DimensionsSection) =>
  content.pages.map((page) => page.parts.map((part) => (part.block === "results" ? "results" : `${part.block} ${part.from}-${part.to}${part.continued ? " continued" : ""}`)));

const fourSize = stdEgWith(fourSizes);

describe("Section 03: the lead", () => {
  it("says what was measured and what each measure must meet, from the specs in force, as the design words it", () => {
    expect(dimensionsOf(fourSize).lead).toBe(
      "13 gloves measured per size. Length must reach 240 mm and palm width must sit inside each size's tolerance. Thickness and weight are recorded for information.",
    );
    expect(dimensionsOf(makeStdEgExport()).lead).toBe(
      "13 gloves measured per size. Length must reach 240 mm and palm width must sit within 95 ± 10 mm. Thickness and weight are recorded for information.",
    );
  });

  it("names each measure judged, and the sizes without a spec once", () => {
    expect(dimensionsOf(makeSafedonExport()).lead).toBe(
      "13 gloves measured per size. Length must reach 230 mm, palm width must sit inside each size's tolerance, finger thickness must sit within 0.18 ± 0.04 mm and palm thickness must sit within 0.14 ± 0.04 mm. Weight is recorded for information.",
    );
    expect(dimensionsOf(safedonWith(withSizeXL)).lead).toContain("0.14 ± 0.04 mm. Size XL has no spec. Weight is recorded for information.");
  });

  it("follows a spec set for this inspection, and leaves out the weight where its block is off", () => {
    expect(dimensionsOf(safedonWith(failingSafedon)).lead).toContain("Length must reach each size's minimum, palm width");
    const doc = makeStdEgExport();
    const off = withReportOptions(doc, {
      sections: { ...doc.report.sections, dimensions: { include: true, blocks: { ...doc.report.sections.dimensions.blocks, weightPerGlove: false } } },
    });
    expect(dimensionsOf(off).lead).toBe("13 gloves measured per size. Length must reach 240 mm and palm width must sit within 95 ± 10 mm. Thickness is recorded for information.");
  });
});

describe("Section 03: Glove Length (mm), Each Glove", () => {
  it("has each glove's length per size, the statistic, the minimum as the limit and the range", () => {
    const chart = dimensionsOf(fourSize).gloveLength;
    expect(chart).toMatchObject({ title: "Glove Length (mm), Each Glove", statisticLabel: "Median", limitText: "Below 240 mm minimum", step: 1 });
    expect(chart?.axis).toEqual({ min: 239, max: 247, ticks: [239, 240, 241, 242, 243, 244, 245, 246, 247] });
    expect(chart?.rows.map((row) => [row.label, row.values.length, row.statistic])).toEqual([
      ["S", 13, 243],
      ["M", 13, 244],
      ["L", 13, 244],
      ["XL", 13, 243],
    ]);
    expect(chart?.rows[0].limits).toEqual([{ value: 240, side: "below" }]);
    expect(chart?.rows[0].aside).toEqual([{ text: "Median", strong: "243 mm" }, { text: "Range 242 to 245" }]);
    expect(chart?.rows[1].aside[1]).toEqual({ text: "Range 242 to 246" });
  });

  it("takes the template's statistic and words: SAFEDON_EG averages", () => {
    const content = dimensionsOf(makeSafedonExport());
    expect(content.gloveLength?.statisticLabel).toBe("Average");
    expect(content.gloveLength?.limitText).toBe("Below 230 mm minimum");
    expect(content.gloveLength?.rows.map((row) => row.aside[0])).toEqual([
      { text: "Average", strong: "241 mm" },
      { text: "Average", strong: "243 mm" },
      { text: "Average", strong: "243 mm" },
      { text: "Average", strong: "243 mm" },
    ]);
  });

  it("draws a size's own spec in force, and its failing statistic in red", () => {
    const chart = dimensionsOf(safedonWith(failingSafedon)).gloveLength;
    expect(chart?.limitText).toBe("Below each size's minimum");
    expect(chart?.rows.map((row) => row.limits.map((limit) => limit.value))).toEqual([[230], [245], [230], [230]]);
    expect(chart?.rows[1].aside[0]).toEqual({ text: "Average", strong: "243 mm", tone: "fail" });
    expect(chart?.rows[0].aside[0]).not.toHaveProperty("tone");
    expect(chart?.axis.ticks).toContain(230);
  });

  it("says Not stated for a size not measured yet, and leaves the chart out with no length at all", () => {
    const unmeasured = dimensionsOf(
      safedonWith((modules) => {
        sizesOf(modules, "dimensions").L = { gloves: [] };
      }),
    );
    expect(unmeasured.gloveLength?.rows.find((row) => row.size === "L")).toMatchObject({ values: [], statistic: null, aside: [{ text: "Not stated" }] });
    const noLength = dimensionsOf(
      safedonWith((modules) => {
        for (const entry of Object.values(sizesOf(modules, "dimensions"))) {
          entry.gloves = (entry.gloves as Record<string, unknown>[]).map((glove) => ({ ...glove, length: null }));
        }
      }),
    );
    expect(noLength.gloveLength).toBeNull();
    expect(noLength.palmWidth).not.toBeNull();
  });
});

describe("Section 03: Palm Width (mm) against Size Tolerance", () => {
  it("bands each size's tolerance, a minimum open to the right, with the range measured and the statistic", () => {
    const chart = dimensionsOf(fourSize).palmWidth;
    expect(chart?.title).toBe("Palm Width (mm) against Size Tolerance");
    expect(chart?.axis).toMatchObject({ min: 60, max: 130 });
    expect(chart?.rows.map((row) => [row.label, row.band, row.range, row.statistic])).toEqual([
      ["S", { from: 70, to: 90 }, { min: 83, max: 85 }, 84],
      ["M", { from: 85, to: 105 }, { min: 94, max: 96 }, 95],
      ["L", { from: 100, to: 120 }, { min: 104, max: 106 }, 105],
      ["XL", { from: 110, to: 130 }, { min: 113, max: 115 }, 114],
    ]);
    expect(chart?.rows.map((row) => row.aside)).toEqual([
      [{ text: "Spec", strong: "80 ± 10" }, { text: "Median", strong: "84" }],
      [{ text: "Spec", strong: "95 ± 10" }, { text: "Median", strong: "95" }],
      [{ text: "Spec", strong: "110 ± 10" }, { text: "Median", strong: "105" }],
      [{ text: "Spec", strong: "≥ 110" }, { text: "Median", strong: "114" }],
    ]);
  });

  it("says NA without a spec and draws no band; a width failed by hand is red", () => {
    const five = dimensionsOf(safedonWith(withSizeXL)).palmWidth;
    expect(five?.rows.find((row) => row.size === "XL")).toMatchObject({ band: null, aside: [{ text: "Spec", strong: "NA" }, { text: "Average", strong: "113" }] });
    const failing = dimensionsOf(safedonWith(failingSafedon)).palmWidth;
    expect(failing?.rows.find((row) => row.size === "M")?.aside[1]).toEqual({ text: "Average", strong: "97", tone: "fail" });
  });
});

describe("Section 03: Median Results by Size", () => {
  it("lists each size's statistics under the statistic and the thickness, with its result", () => {
    const table = dimensionsOf(fourSize).medianResults;
    expect(table).toMatchObject({ title: "Median Results by Size", statisticGroup: "Median (mm)", note: null });
    expect(table?.columns).toEqual([
      { measure: "length", label: "Length", group: "statistic" },
      { measure: "width", label: "Width", group: "statistic" },
      { measure: "fingerThickness", label: "Finger", group: "thickness" },
      { measure: "palmThickness", label: "Palm", group: "thickness" },
      { measure: "cuffThickness", label: "Cuff", group: "thickness" },
    ]);
    expect(table?.rows.map((row) => [row.label, ...table.columns.map((column) => row.cells[column.measure].text), row.status])).toEqual([
      ["S", "243", "84", "0.10", "0.06", "0.05", "pass"],
      ["M", "244", "95", "0.10", "0.06", "0.05", "pass"],
      ["L", "244", "105", "0.10", "0.06", "0.05", "pass"],
      ["XL", "243", "114", "0.10", "0.06", "0.05", "pass"],
    ]);
  });

  it("takes the template's statistic and leaves out the measures it switches off", () => {
    const table = dimensionsOf(makeSafedonExport()).medianResults;
    expect(table).toMatchObject({ title: "Average Results by Size", statisticGroup: "Average (mm)" });
    expect(table?.columns.map((column) => column.label)).toEqual(["Length", "Width", "Finger", "Palm"]);
  });

  it("shows a failing statistic in red with its size failed, and marks a P/F set by hand", () => {
    const table = dimensionsOf(safedonWith(failingSafedon)).medianResults;
    const bySize = Object.fromEntries((table?.rows ?? []).map((row) => [row.size, row]));
    expect(bySize.S.cells.length).toEqual({ text: "243", failed: true });
    expect(bySize.S).toMatchObject({ status: "fail", byHand: false });
    expect(bySize.M.cells.width).toEqual({ text: "97", failed: true });
    expect(bySize.M).toMatchObject({ status: "fail", byHand: true });
    expect(bySize.XS).toMatchObject({ status: "pass", byHand: false });
    expect(table?.note).toBe("* Set by the inspector: size M Width.");
  });

  it("shows a size not measured yet as not done, its statistics a dash", () => {
    const table = dimensionsOf(
      safedonWith((modules) => {
        sizesOf(modules, "dimensions").L = { gloves: [] };
      }),
    ).medianResults;
    const row = table?.rows.find((entry) => entry.size === "L");
    expect(row?.status).toBe("not_done");
    expect(Object.values(row?.cells ?? {}).map((cell) => cell.text)).toEqual(["—", "—", "—", "—"]);
  });
});

describe("Section 03: Weight per Glove (g)", () => {
  it("bars each size's weight at the template's decimals, for information against the indicative weight", () => {
    const bars = dimensionsOf(fourSize).weightPerGlove;
    expect(bars?.title).toBe("Weight per Glove (g)");
    expect(bars?.rows.map((row) => [row.label, row.value, row.display, row.tone])).toEqual([
      ["S", 3.2, "3.20 g", null],
      ["M", 3.5, "3.50 g", null],
      ["L", 3.8, "3.80 g", null],
      ["XL", 4.2, "4.20 g", null],
    ]);
    expect(bars?.max).toBeCloseTo(4.2 * 1.04);
    expect(bars?.minimum).toBeNull();
    expect(bars?.note).toBe("Average of 13 gloves per size. For information only; indicative weight for size M is 3.5 g.");
  });

  it("shows a weight past the indicative weight's threshold as a warning, and says by how much", () => {
    const bars = dimensionsOf(makeStdEgExport()).weightPerGlove;
    expect(bars?.rows).toEqual([{ size: "M", label: "M", value: 2.9, display: "2.90 g", tone: "warn" }]);
    expect(bars?.note).toBe(
      "Average of 13 gloves per size. For information only; indicative weight for size M is 3.5 g. Size M is 17.1% below it, past the 10% threshold.",
    );
  });

  it("is left out without the Weight step, and the lead says nothing of weight", () => {
    const doc = makeStdEgExport();
    doc.modules = doc.modules.filter((module) => module.key !== "weight");
    const content = dimensionsOf(doc);
    expect(content.weightPerGlove).toBeNull();
    expect(content.lead).toContain("Thickness is recorded for information.");
    expect(layoutOf(content)).toEqual([["gloveLength 0-1", "palmWidth 0-1", "results"]]);
  });
});

describe("Section 03: the blocks and the pages", () => {
  it("leaves out the blocks switched off, and builds nothing with every one empty", () => {
    const doc = makeSafedonExport();
    const blocks = (on: Partial<Record<"gloveLength" | "palmWidth" | "medianResults" | "weightPerGlove", boolean>>) =>
      withReportOptions(doc, { sections: { ...doc.report.sections, dimensions: { include: true, blocks: { ...doc.report.sections.dimensions.blocks, ...on } } } });
    const noWidth = dimensionsOf(blocks({ palmWidth: false }));
    expect(noWidth.palmWidth).toBeNull();
    expect(layoutOf(noWidth)).toEqual([["gloveLength 0-4", "results"]]);
    const weightOnly = dimensionsOf(blocks({ gloveLength: false, palmWidth: false, medianResults: false }));
    expect(weightOnly).toMatchObject({ gloveLength: null, palmWidth: null, medianResults: null, lead: "Weight is recorded for information." });
    expect(layoutOf(weightOnly)).toEqual([["results"]]);
    // No readings and no weight: the page says "coming next".
    const empty = safedonWith((modules) => {
      modules.dimensions = { sizes: {} };
      modules.weight = { sizes: {} };
    });
    expect(buildReportModel(empty).sections.dimensions).toBeUndefined();
    expect(entryOf(empty)).toMatchObject({ built: false, pageCount: 1 });
  });

  it("fits the design's four sizes on one page, and puts the fifth's results on a second", () => {
    expect(layoutOf(dimensionsOf(fourSize))).toEqual([["gloveLength 0-4", "palmWidth 0-4", "results"]]);
    const five = dimensionsOf(safedonWith(withSizeXL));
    expect(layoutOf(five)).toEqual([["gloveLength 0-5", "palmWidth 0-5"], ["results"]]);
    expect(entryOf(safedonWith(withSizeXL))).toMatchObject({ built: true, pageCount: 2 });
  });

  it("holds less on Letter's shorter page", () => {
    expect(layoutOf(dimensionsOf(withReportOptions(fourSize, { pageSize: "letter" })))).toEqual([["gloveLength 0-4", "palmWidth 0-4"], ["results"]]);
  });

  it("runs a chart taller than what is left of the page on with its remaining sizes", () => {
    // Every glove of five sizes the same length: thirteen dots high, a row each.
    const tall = dimensionsOf(
      safedonWith((modules) => {
        withSizeXL(modules);
        for (const entry of Object.values(sizesOf(modules, "dimensions"))) {
          entry.gloves = (entry.gloves as Record<string, unknown>[]).map((glove) => ({ ...glove, length: 243 }));
        }
      }),
    );
    const runs = tall.pages.flatMap((page, index) => page.parts.flatMap((part) => (part.block === "gloveLength" ? [{ page: index, ...part }] : [])));
    expect(runs.length).toBe(2);
    expect(runs[0]).toMatchObject({ page: 0, from: 0, continued: false });
    expect(runs[1]).toMatchObject({ page: 1, from: runs[0].to, to: 5, continued: true });
    expect(tall.pageCount).toBe(tall.pages.length);
  });
});

describe("Section 03 and 04's readings as printed", () => {
  it("prints a reading at the template's decimals, never fewer than it was typed with", () => {
    expect(readingText(0.1, 2)).toBe("0.10");
    expect(readingText(242, 0)).toBe("242");
    expect(readingText(242.5, 0)).toBe("242.5");
    expect(typedDecimals(0.1 + 0.01)).toBe(2);
    expect(typedDecimals(1e-12)).toBe(10);
  });
});
