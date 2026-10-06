// Proves the STD_EG transcription: every figure the report or the expected
// results state is recomputed from the fixture with lib/stats.
import { describe, expect, it } from "vitest";
import { checkSpec, formatDecimal, mean, median, parseDecimal, roundTo, summarizeColumn } from "@/lib/stats";
import { STD_EG_EXPECTED as EXPECTED } from "./expected";
import { cartonList, dimensionColumn, intendedValue, isTextCell } from "./helpers";
import { STD_EG_EXAMPLE as REPORT } from "./std-eg";
import type { ReportSize, VisualClass } from "./types";

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const nonZero = (counts: Readonly<Record<string, number | undefined>>) =>
  Object.fromEntries(Object.entries(counts).filter(([, count]) => (count ?? 0) > 0));
const CLASSES: readonly VisualClass[] = ["critical", "major", "minor"];

describe("STD_EG fixture, page 1", () => {
  it("orders size M only: 2,900 cartons, 5,800,000 gloves", () => {
    expect(Object.keys(REPORT.order.lines)).toEqual(["M"]);
    expect(REPORT.sizesOrdered).toEqual(["M"]);
    const cartons = sum(Object.values(REPORT.order.lines).map((line) => line?.qtyCases ?? 0));
    const gloves = cartons * REPORT.packing.printedGlovesPerCase;
    expect({ cartons, gloves }).toEqual({ cartons: EXPECTED.totals.cartons, gloves: EXPECTED.totals.gloves });
    expect(REPORT.order.printedTotalCartons).toBe(cartons);
    expect(REPORT.order.printedTotalGloves).toBe(gloves);
    expect(REPORT.order.lines.M?.lots).toHaveLength(1);
  });

  it("packs 200 gloves x 10 inner boxes = 2,000 per case", () => {
    const { glovesPerInner, innersPerCase, printedGlovesPerCase } = REPORT.packing;
    expect(glovesPerInner * innersPerCase).toBe(printedGlovesPerCase);
    expect(printedGlovesPerCase).toBe(2000);
  });

  it("indicates 3.5 g for size M", () => {
    expect(parseDecimal(REPORT.gloveInfo.indicativeWeightPrinted.replace("g", ""))).toEqual({ ok: true, value: 3.5 });
    expect(REPORT.gloveInfo.indicativeWeightG).toBe(3.5);
  });

  it("samples 50 cases, 500 gloves, 13 for dimensions, force and dispensing, and the other pages agree", () => {
    const plan = REPORT.sampling.M!;
    expect(plan).toEqual({
      orderQtyCases: 2900,
      cases: 50,
      inners: 50,
      gloves: 500,
      watertightVisualGloves: 500,
      dimensionGloves: 13,
      physicalTestGloves: 13,
      dispensingInners: 13,
    });
    expect(plan.orderQtyCases).toBe(REPORT.order.lines.M?.qtyCases);
    expect(cartonList(REPORT.cartons.M!)).toHaveLength(plan.cases);
    expect(REPORT.cartons.M!.printedSamplingQuantity).toBe(plan.cases);
    expect(REPORT.dimensions.perSize.M!.gloves).toHaveLength(plan.dimensionGloves);
    expect(REPORT.forceAtBreak.M!.readingsN).toBeNull();
    expect(REPORT.dispensingPacking.perSize.M!.boxes).toHaveLength(plan.dispensingInners);
    expect(REPORT.watertight.perSize.M!.tested).toBe(plan.watertightVisualGloves);
    for (const visualClass of CLASSES) {
      expect(REPORT.visual[visualClass].perSize.M!.inspected).toBe(plan.watertightVisualGloves);
    }
  });

  it("lists 50 cartons in a full 5 x 10 grid, 49 unique: one carton twice", () => {
    const grid = REPORT.cartons.M!;
    expect(grid.rows.map((row) => row.length)).toEqual([10, 10, 10, 10, 10]);
    const list = cartonList(grid);
    expect(list).toHaveLength(EXPECTED.cartonList.entries);
    expect(new Set(list).size).toBe(EXPECTED.cartonList.unique);

    const counts = new Map<number, number>();
    for (const carton of list) counts.set(carton, (counts.get(carton) ?? 0) + 1);
    const repeated = [...counts].filter(([, count]) => count > 1);
    const { carton, cells } = EXPECTED.cartonList.duplicate;
    expect(repeated).toEqual([[carton, 2]]);
    for (const { row, column } of cells) expect(grid.rows[row - 1][column - 1]).toBe(carton);
  });

  it("keeps every carton number within the 2,900 cases ordered", () => {
    for (const carton of cartonList(REPORT.cartons.M!)) {
      expect(Number.isInteger(carton) && carton >= 1 && carton <= 2900).toBe(true);
    }
  });
});

describe("STD_EG fixture, page 2", () => {
  const section = REPORT.dimensions;
  const table = section.perSize.M!;

  it("measures 13 gloves on five measures, all numbers", () => {
    expect(section.columns).toEqual(["length", "width", "finger", "palm", "cuff"]);
    expect(table.gloves).toHaveLength(13);
    for (const row of table.gloves) {
      expect(row).toHaveLength(5);
      expect(row.some(isTextCell)).toBe(false);
    }
  });

  it("keeps the readings as transcribed, which a median alone would not show", () => {
    // Column sums of the 13 printed readings, as checked cell by cell against
    // the PDF's text layer. The report prints no average to recompute.
    const sums = Object.fromEntries(
      section.columns.map((measure) => [
        measure,
        roundTo(sum(dimensionColumn(section, "M", measure).map(intendedValue)), 2),
      ]),
    );
    expect(sums).toEqual({ length: 3192, width: 1240, finger: 1.21, palm: 0.67, cuff: 0.52 });
  });

  it("recomputes the medians 245 / 95 / 0.09 / 0.05 / 0.04, as printed", () => {
    for (const measure of section.columns) {
      const value = median(dimensionColumn(section, "M", measure).map(intendedValue));
      expect(value).toBe(EXPECTED.dimensions.M!.median[measure]);
      const decimals = measure === "length" || measure === "width" ? 0 : 2;
      expect(formatDecimal(value, decimals)).toBe(table.printedStatistic[measure]);
    }
  });

  it("passes length (≥ 240) and width (95 ± 10); the thickness specs are NA", () => {
    expect(EXPECTED.dimensions.M!.spec).toEqual({
      length: table.spec.length,
      width: table.spec.width,
    });
    for (const measure of section.columns) {
      const values = dimensionColumn(section, "M", measure).map(intendedValue);
      const { outcome } = summarizeColumn(values, 13, section.statistic, table.spec[measure], undefined);
      expect(outcome).toBe(EXPECTED.dimensions.M!.perMeasure[measure]);
    }
    expect(Object.values(table.printedResult)).toEqual(["Passed", "Passed", "Passed", "Passed", "Passed"]);
  });

  it("states a force at break median of 6.537 N, at least 6 N", () => {
    const force = REPORT.forceAtBreak.M!;
    expect(parseDecimal(force.printedMedian)).toEqual({ ok: true, value: force.medianN });
    expect(force.medianN).toBe(EXPECTED.forceAtBreak.M!.medianN);
    expect(checkSpec(force.medianN, { kind: "min", min: EXPECTED.forceAtBreak.M!.minN })).toBe("pass");
  });

  it("averages 2.9 g: 17.1% below the indicative 3.5 g, past the 10% threshold, but printed as Info", () => {
    const weight = REPORT.weight.M!;
    const expected = EXPECTED.weight.M!;
    expect(weight).toMatchObject({ gloves: 13, values: null, printedRemark: "Info" });
    expect(parseDecimal(weight.printed)).toEqual({ ok: true, value: weight.averageG });
    expect(weight.averageG).toBe(expected.averageG);
    expect(REPORT.gloveInfo.indicativeWeightG).toBe(expected.indicativeG);

    const deviation = ((weight.averageG - expected.indicativeG) / expected.indicativeG) * 100;
    expect(roundTo(deviation, 1)).toBe(expected.deviationPct);
    expect(roundTo(deviation, 0)).toBe(-17);
    expect(Math.abs(deviation)).toBeGreaterThan(expected.thresholdPct);
  });
});

describe("STD_EG fixture, page 3", () => {
  it("finds 1 hole in 500 gloves, in a finger", () => {
    const entry = REPORT.watertight.perSize.M!;
    const expected = EXPECTED.watertight.M!;
    expect(Object.keys(entry.holes)).toEqual(REPORT.watertight.rows.map((row) => row.code));
    const found = sum(Object.values(entry.holes).map((count) => count ?? 0));
    expect(found).toBe(expected.found);
    expect(nonZero(entry.holes)).toEqual(expected.byLocation);
    expect(entry.tested).toBe(expected.n);
    expect(entry.printedTotal).toBe(`${found}/${entry.tested}`);
  });

  it("finds 0 critical, 8 major (2 crotch thin areas, 1 body thin area, 5 thin spots) and 0 minor", () => {
    const printedTotals = { critical: "0", major: "8/500", minor: "0/500" };
    for (const visualClass of CLASSES) {
      const block = REPORT.visual[visualClass];
      const entry = block.perSize.M!;
      const expected = EXPECTED.visual[visualClass].M!;
      expect(Object.keys(entry.counts)).toEqual(block.rows.map((row) => row.code));
      const found = sum(Object.values(entry.counts).map((count) => count ?? 0));
      expect(found).toBe(expected.found);
      expect(nonZero(entry.counts)).toEqual(expected.byDefect);
      expect(entry.inspected).toBe(expected.n);
      expect(entry.printedTotal).toBe(printedTotals[visualClass]);
    }
  });

  it("prints code M limits for a code N sample: wrong for watertight and major, right for minor by the arrow", () => {
    const printed = {
      watertight: REPORT.watertight.perSize.M!.printedLimit,
      critical: REPORT.visual.critical.perSize.M!.printedLimit,
      major: REPORT.visual.major.perSize.M!.printedLimit,
      minor: REPORT.visual.minor.perSize.M!.printedLimit,
    };
    expect(printed).toEqual({
      watertight: { accept: 10, reject: 11 },
      critical: { accept: 0, reject: 1 },
      major: { accept: 14, reject: 15 },
      minor: { accept: 21, reject: 22 },
    });
    const limit = (check: { accept: number; reject: number }) => ({ accept: check.accept, reject: check.reject });
    expect(limit(EXPECTED.watertight.M!)).not.toEqual(printed.watertight);
    expect(limit(EXPECTED.visual.major.M!)).not.toEqual(printed.major);
    expect(limit(EXPECTED.visual.minor.M!)).toEqual(printed.minor);
    expect(limit(EXPECTED.visual.critical.M!)).toEqual(printed.critical);
    expect(REPORT.watertight.printedTitle).toContain("code letter k, L & M");
  });

  it("labels the critical result line Visual Minor [sic]", () => {
    expect(REPORT.visual.critical.printedResultLabel).toBe("Disposition - Visual Minor (Passed / Failed)");
  });
});

describe("STD_EG fixture, page 4", () => {
  const check = REPORT.dispensingPacking.perSize.M!;

  it("averages 88.3% layering and 90.3% dispensing, stickiness A on all 13 boxes", () => {
    const expected = EXPECTED.dispensing.M!;
    const layering = mean(check.boxes.map((box) => box.layeringPct))!;
    const dispensing = mean(check.boxes.map((box) => box.dispensingPct))!;
    expect(roundTo(layering, 1)).toBe(expected.layeringAvgPct);
    expect(roundTo(dispensing, 1)).toBe(expected.dispensingAvgPct);
    expect(check.printedAverage).toEqual({
      layering: `${formatDecimal(layering, 0)}%`,
      dispensing: `${formatDecimal(dispensing, 0)}%`,
      stickiness: "A",
    });

    const codes: Record<string, number> = {};
    for (const box of check.boxes) codes[box.stickiness] = (codes[box.stickiness] ?? 0) + 1;
    expect(codes).toEqual(expected.stickiness);
    expect(layering).toBeGreaterThanOrEqual(REPORT.dispensingPacking.minLayeringPct);
    expect(dispensing).toBeGreaterThanOrEqual(REPORT.dispensingPacking.minDispensingPct);
    expect(REPORT.dispensingPacking.minLayeringPct).toBe(expected.minLayeringPct);
    expect(REPORT.dispensingPacking.minDispensingPct).toBe(expected.minDispensingPct);
  });

  it("takes 13 distinct boxes, all from the carton list except item 12, one digit off a listed carton", () => {
    const boxes = check.boxes.map((box) => box.box);
    expect(new Set(boxes).size).toBe(13);
    const listed = new Set(cartonList(REPORT.cartons.M!));
    const strays = check.boxes.flatMap((box, index) => (listed.has(box.box) ? [] : [{ item: index + 1, box: box.box }]));
    expect(strays).toEqual([{ item: EXPECTED.dispensingBox.item, box: EXPECTED.dispensingBox.box }]);

    const intended = EXPECTED.dispensingBox.likelyIntended;
    expect(listed.has(intended)).toBe(true);
    expect(boxes).not.toContain(intended);
    const [a, b] = [String(EXPECTED.dispensingBox.box), String(intended)];
    expect(a).toHaveLength(b.length);
    expect([...a].filter((digit, index) => digit !== b[index])).toHaveLength(1);
  });

  it("inspects 3 dispenser boxes and 1 carton with no labelling defects", () => {
    const expected = EXPECTED.labeling.M!;
    for (const level of ["inner", "carton"] as const) {
      const block = REPORT.labeling[level];
      const entry = block.perSize.M!;
      expect(Object.keys(entry.defects)).toEqual(block.rows.map((row) => row.code));
      expect(entry.inspected).toBe(expected[level].n);
      expect(sum(Object.values(entry.defects).map((count) => count ?? 0))).toBe(expected[level].defects);
      expect(entry.printedLimit).toEqual({ accept: 0, reject: 1 });
      expect(entry.printedTotal).toBe("0");
    }
    expect(REPORT.labeling.carton.rows.map((row) => row.code)).toContain("carton_no");
    expect(REPORT.labeling.inner.rows.map((row) => row.code)).not.toContain("expiry_date");
  });

  it("concludes PASSED, signed, with no remark and no inspector name", () => {
    expect(REPORT.conclusion).toMatchObject({ printedResult: "PASSED", remark: null, signed: true });
    expect(REPORT.conclusion.inspectedBy).toBeUndefined();
    expect(REPORT.header.inspectedBy).toBeUndefined();
    expect(EXPECTED.conclusion.result).toBe("pass");
  });
});

describe("STD_EG fixture, sizes not ordered", () => {
  it("holds data for size M only, in every section", () => {
    const sections = [
      REPORT.order.lines,
      REPORT.sampling,
      REPORT.cartons,
      REPORT.dimensions.perSize,
      REPORT.forceAtBreak,
      REPORT.weight,
      REPORT.watertight.perSize,
      REPORT.visual.critical.perSize,
      REPORT.visual.major.perSize,
      REPORT.visual.minor.perSize,
      REPORT.dispensingPacking.perSize,
      REPORT.labeling.inner.perSize,
      REPORT.labeling.carton.perSize,
    ];
    for (const section of sections) expect(Object.keys(section)).toEqual(["M"]);
  });

  it("keeps what the report printed for XS, S, L and XL: results with no data", () => {
    const sizes = new Set(REPORT.unorderedSizes.map((cells) => cells.size));
    expect(new Set(EXPECTED.unorderedSizes.sizes)).toEqual(sizes);
    const passed = new Set<ReportSize>();
    for (const { size, cells } of REPORT.unorderedSizes) {
      if (Object.values(cells).flat().includes("Passed")) passed.add(size);
    }
    expect(passed).toEqual(new Set(["S", "L", "XL"]));
  });
});
