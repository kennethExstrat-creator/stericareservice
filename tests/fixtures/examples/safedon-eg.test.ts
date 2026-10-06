// Proves the SAFEDON_EG transcription: every figure the report or the expected
// results state is recomputed from the fixture with lib/stats.
//
// The report prints thickness readings rounded to 2 decimals, and the
// expected 4-decimal thickness averages come from the unrounded readings in
// the source workbook. A printed reading is within 0.005 of the true one, so
// the printed readings' average is too: that bound, the report's own
// 2-decimal rounding and the pinned average of the printed readings are what
// this file can prove (docs/FIXTURES.md, "Printed precision").
import { describe, expect, it } from "vitest";
import { checkSpec, formatDecimal, mean, parseDecimal, roundTo, summarizeColumn } from "@/lib/stats";
import { SAFEDON_EG_EXPECTED as EXPECTED, type RejectedInput } from "./expected";
import {
  cartonList,
  dimensionColumn,
  intendedValue,
  isTextCell,
  SAFEDON_DEFECTS,
  safedonDefectsPerBox,
  spreadsheetValue,
} from "./helpers";
import { SAFEDON_EG_EXAMPLE as REPORT } from "./safedon-eg";
import type { DimensionMeasure, ReportSize, VisualClass } from "./types";

const SIZES = ["XS", "S", "M", "L"] as const satisfies readonly ReportSize[];
const CLASSES: readonly VisualClass[] = ["critical", "major", "minor"];
const LENGTH_WIDTH: readonly DimensionMeasure[] = ["length", "width"];
const THICKNESS: readonly DimensionMeasure[] = ["finger", "palm"];
/** Half the last printed decimal of a thickness reading. */
const PRINT_TOLERANCE = 0.005;

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const nonZero = (counts: Readonly<Record<string, number | undefined>>) =>
  Object.fromEntries(Object.entries(counts).filter(([, count]) => (count ?? 0) > 0));
const numbers = (values: readonly (number | null)[]) => values.filter((value): value is number => value !== null);
const columnAverage = (size: ReportSize, measure: DimensionMeasure) =>
  mean(dimensionColumn(REPORT.dimensions, size, measure).map(intendedValue))!;

describe("SAFEDON_EG fixture, page 1", () => {
  it("orders XS 60, S 850, M 560 and L 60 cases: 1,530 cartons, 3,060,000 gloves", () => {
    expect(Object.keys(REPORT.order.lines)).toEqual(SIZES);
    expect(REPORT.sizesOrdered).toEqual(SIZES);
    const quantities = Object.fromEntries(SIZES.map((size) => [size, REPORT.order.lines[size]!.qtyCases]));
    expect(quantities).toEqual({ XS: 60, S: 850, M: 560, L: 60 });

    const cartons = sum(Object.values(quantities));
    const gloves = cartons * REPORT.packing.printedGlovesPerCase;
    expect({ cartons, gloves }).toEqual({ cartons: EXPECTED.totals.cartons, gloves: EXPECTED.totals.gloves });
    expect(REPORT.order.printedTotalCartons).toBe(cartons);
    expect(REPORT.order.printedTotalGloves).toBe(gloves);
    for (const size of SIZES) expect(REPORT.order.lines[size]!.lots).toHaveLength(1);
  });

  it("packs 125 gloves x 16 plastic packs = 2,000 per case", () => {
    const { innerUnit, glovesPerInner, innersPerCase, printedGlovesPerCase } = REPORT.packing;
    expect(innerUnit).toBe("plastic pack");
    expect(glovesPerInner * innersPerCase).toBe(printedGlovesPerCase);
    expect(glovesPerInner).toBe(REPORT.dispensingSafedon.glovesPerPack);
  });

  it("indicates 3.2 g for size M", () => {
    expect(parseDecimal(REPORT.gloveInfo.indicativeWeightPrinted.replace(" g", ""))).toEqual({
      ok: true,
      value: REPORT.gloveInfo.indicativeWeightG,
    });
  });

  it.each(SIZES)("samples size %s consistently with the other pages", (size) => {
    const plan = REPORT.sampling[size]!;
    expect(plan.orderQtyCases).toBe(REPORT.order.lines[size]!.qtyCases);
    expect(cartonList(REPORT.cartons[size]!)).toHaveLength(plan.cases);
    expect(REPORT.cartons[size]!.printedSamplingQuantity).toBe(plan.cases);
    expect(plan.gloves).toBe(plan.watertightVisualGloves);
    expect(REPORT.dimensions.perSize[size]!.gloves).toHaveLength(plan.dimensionGloves);
    expect(REPORT.dispensingSafedon.perSize[size]!.boxes).toHaveLength(plan.dispensingInners);
    expect(REPORT.watertight.perSize[size]!.tested).toBe(plan.watertightVisualGloves);
    for (const visualClass of CLASSES) {
      expect(REPORT.visual[visualClass].perSize[size]!.inspected).toBe(plan.watertightVisualGloves);
    }
  });

  it("samples 80 / 200 / 200 / 80 gloves and 5 / 8 / 8 / 5 dispensing packs", () => {
    const by = <K extends "watertightVisualGloves" | "dispensingInners" | "dimensionGloves">(key: K) =>
      SIZES.map((size) => REPORT.sampling[size]![key]);
    expect(by("watertightVisualGloves")).toEqual([80, 200, 200, 80]);
    expect(by("dispensingInners")).toEqual([5, 8, 8, 5]);
    expect(by("dimensionGloves")).toEqual([13, 13, 13, 13]);
  });

  it.each(SIZES)("lists unique size %s cartons within the order quantity", (size) => {
    const list = cartonList(REPORT.cartons[size]!);
    expect(new Set(list).size).toBe(list.length);
    for (const carton of list) {
      expect(Number.isInteger(carton) && carton >= 1 && carton <= REPORT.order.lines[size]!.qtyCases).toBe(true);
    }
  });
});

describe("SAFEDON_EG fixture, page 2", () => {
  const section = REPORT.dimensions;

  it("measures 13 gloves on four measures per size", () => {
    expect(section.statistic).toBe("average");
    expect(section.columns).toEqual(["length", "width", "finger", "palm"]);
    for (const size of SIZES) {
      expect(section.perSize[size]!.gloves).toHaveLength(13);
      for (const row of section.perSize[size]!.gloves) expect(row).toHaveLength(4);
    }
  });

  it.each(SIZES)("recomputes the size %s length and width averages exactly", (size) => {
    const expected = EXPECTED.dimensions[size]!;
    for (const measure of LENGTH_WIDTH) {
      const average = roundTo(columnAverage(size, measure), 2);
      expect(average).toBe(expected.average[measure]);
      expect(average).toBe(expected.averageOfPrintedReadings[measure]);
    }
  });

  it.each(SIZES)("matches the size %s thickness averages within the printed precision", (size) => {
    const expected = EXPECTED.dimensions[size]!;
    for (const measure of THICKNESS) {
      const average = columnAverage(size, measure);
      expect(roundTo(average, 4)).toBe(expected.averageOfPrintedReadings[measure]);
      expect(Math.abs(average - expected.average[measure]!)).toBeLessThanOrEqual(PRINT_TOLERANCE);
      expect(roundTo(average, 2)).toBe(roundTo(expected.average[measure]!, 2));
    }
  });

  it.each(["XS", "M", "L"] as const)("rounds the size %s averages to the printed Average row", (size) => {
    const table = section.perSize[size]!;
    for (const measure of section.columns) {
      const decimals = LENGTH_WIDTH.includes(measure) ? 0 : 2;
      expect(formatDecimal(columnAverage(size, measure), decimals)).toBe(table.printedStatistic[measure]);
    }
  });

  it("reproduces the original size S averages by skipping the five text cells, as the spreadsheet did", () => {
    const table = section.perSize.S!;
    const original = EXPECTED.dimensions.S!.originalAverage!;
    const spreadsheet = (measure: DimensionMeasure) =>
      numbers(dimensionColumn(section, "S", measure).map(spreadsheetValue));

    expect(spreadsheet("length")).toHaveLength(12);
    expect(mean(spreadsheet("length"))).toBe(original.length);
    expect(spreadsheet("width")).toHaveLength(13);
    expect(roundTo(mean(spreadsheet("width"))!, 2)).toBe(original.width);
    for (const measure of THICKNESS) {
      expect(spreadsheet(measure)).toHaveLength(11);
      expect(Math.abs(mean(spreadsheet(measure))! - original[measure]!)).toBeLessThanOrEqual(PRINT_TOLERANCE);
    }
    for (const measure of section.columns) {
      const decimals = LENGTH_WIDTH.includes(measure) ? 0 : 2;
      expect(formatDecimal(mean(spreadsheet(measure)), decimals)).toBe(table.printedStatistic[measure]);
    }
    // Corrected, length averages 243.38: the printed 244 came from the skipped "2 42".
    expect(formatDecimal(columnAverage("S", "length"), 0)).toBe("243");
  });

  it("keeps the five text cells verbatim; lib/stats refuses each and the intended value is the digits", () => {
    const found: RejectedInput[] = [];
    for (const size of SIZES) {
      section.perSize[size]!.gloves.forEach((row, index) => {
        row.forEach((cell, column) => {
          if (!isTextCell(cell)) return;
          const measure = section.columns[column];
          found.push({ module: "dimensions", size, glove: index + 1, measure, raw: cell.raw, accepted: cell.intended });
        });
      });
    }
    expect(found).toEqual(EXPECTED.rejectedInputs);
    for (const input of found) {
      expect(parseDecimal(input.raw).ok).toBe(false);
      expect(parseDecimal(input.raw.replace(/\s+/g, ""))).toEqual({ ok: true, value: input.accepted });
    }
  });

  it.each(SIZES)("passes every size %s dimension spec", (size) => {
    const table = section.perSize[size]!;
    const expected = EXPECTED.dimensions[size]!;
    for (const measure of section.columns) {
      const values = dimensionColumn(section, size, measure).map(intendedValue);
      const { outcome } = summarizeColumn(values, 13, section.statistic, table.spec[measure], undefined);
      expect(outcome).toBe(expected.perMeasure[measure]);
      expect(checkSpec(expected.average[measure]!, table.spec[measure]!)).toBe("pass");
    }
    expect(Object.values(table.printedResult)).toEqual(["A", "A", "A", "A"]);
  });

  it("weighs one glove per size: 2.56 / 2.94 / 3.18 / 3.55 g", () => {
    for (const size of SIZES) {
      const weight = REPORT.weight[size]!;
      expect(weight.gloves).toBe(1);
      expect(weight.values).toEqual([weight.averageG]);
      expect(parseDecimal(weight.printed)).toEqual({ ok: true, value: weight.averageG });
    }
    expect(SIZES.map((size) => REPORT.weight[size]!.averageG)).toEqual([2.56, 2.94, 3.18, 3.55]);
  });

  it("states tensile strength and elongation averages that meet ASTM D6319 (≥ 14 MPa, ≥ 500%)", () => {
    for (const size of SIZES) {
      const entry = REPORT.tensile[size]!;
      const expected = EXPECTED.tensile[size]!;
      expect({ tensileMPa: entry.tensileMPa, elongationPct: entry.elongationPct }).toEqual({
        tensileMPa: expected.tensileMPa,
        elongationPct: expected.elongationPct,
      });
      expect(checkSpec(entry.tensileMPa, { kind: "min", min: expected.minTensileMPa })).toBe("pass");
      expect(checkSpec(entry.elongationPct, { kind: "min", min: expected.minElongationPct })).toBe("pass");
    }
  });
});

describe("SAFEDON_EG fixture, page 3", () => {
  const dispensing = REPORT.dispensingSafedon;

  it.each(SIZES)("takes the size %s boxes from that size's carton list, each once", (size) => {
    const boxes = dispensing.perSize[size]!.boxes;
    const listed = new Set(cartonList(REPORT.cartons[size]!));
    expect(new Set(boxes).size).toBe(boxes.length);
    for (const box of boxes) expect(listed.has(box)).toBe(true);
  });

  it.each(SIZES)("counts the size %s defects per box and in total, against the 5% maximum", (size) => {
    const entry = dispensing.perSize[size]!;
    const expected = EXPECTED.dispensing[size]!;
    expect(Object.keys(entry.counts)).toEqual(dispensing.rows.map((row) => row.code));
    expect(Object.keys(entry.counts)).toEqual(SAFEDON_DEFECTS);
    for (const code of SAFEDON_DEFECTS) expect(entry.counts[code]).toHaveLength(entry.boxes.length);

    const perBox = safedonDefectsPerBox(entry);
    const boxes = entry.boxes.map((box, index) => ({
      box,
      defects: perBox[index],
      rate: roundTo(perBox[index] / dispensing.glovesPerPack, 3),
    }));
    expect(boxes).toEqual(expected.boxes);

    const defects = sum(perBox);
    const gloves = entry.boxes.length * dispensing.glovesPerPack;
    const ratePct = (defects / gloves) * 100;
    expect({ defects, gloves, ratePct: roundTo(ratePct, 2) }).toEqual({
      defects: expected.defects,
      gloves: expected.gloves,
      ratePct: expected.ratePct,
    });
    expect(ratePct).toBeLessThanOrEqual(dispensing.maxRatePct);
    expect(entry.printedPerBox).toEqual(perBox.map((count) => `${count}/${dispensing.glovesPerPack}`));
  });

  it("finds 3 XS defects (1 sticky glove, 2 without cuff) and 11 M sticky gloves", () => {
    expect(nonZero(Object.fromEntries(SAFEDON_DEFECTS.map((code) => [code, sum(dispensing.perSize.XS!.counts[code])])))).toEqual({
      no_cuff: 2,
      sticky: 1,
    });
    expect(nonZero(Object.fromEntries(SAFEDON_DEFECTS.map((code) => [code, sum(dispensing.perSize.M!.counts[code])])))).toEqual({
      sticky: 11,
    });
  });

  it("prints a wrong rate under two XS boxes only: 0.8% for box 18, 0.0% for box 33", () => {
    const wrong = SIZES.flatMap((size) => {
      const entry = dispensing.perSize[size]!;
      const perBox = safedonDefectsPerBox(entry);
      return entry.boxes.flatMap((box, index) => {
        const computed = `${formatDecimal((perBox[index] / dispensing.glovesPerPack) * 100, 1)}%`;
        const printed = entry.printedRatePerBox[index];
        return printed === computed ? [] : [{ size, box, printed, computed }];
      });
    });
    expect(wrong).toEqual([
      { size: "XS", box: 18, printed: "0.8%", computed: "0.0%" },
      { size: "XS", box: 33, printed: "0.0%", computed: "1.6%" },
    ]);
  });

  it("prints a wrong size total for L only: 7 / 625 for none found", () => {
    const wrong = SIZES.flatMap((size) => {
      const entry = dispensing.perSize[size]!;
      const match = /^(\d+) \/ (\d+) \(([\d.]+) ?%\)$/.exec(entry.printedSizeTotal);
      expect(match).not.toBeNull();
      const [, defects, gloves, rate] = match!.map(Number);
      const expected = EXPECTED.dispensing[size]!;
      const right = defects === expected.defects && gloves === expected.gloves && rate === expected.ratePct;
      return right ? [] : [{ size, printed: entry.printedSizeTotal }];
    });
    expect(wrong).toEqual([{ size: "L", printed: "7 / 625 (1.12%)" }]);
  });
});

describe("SAFEDON_EG fixture, page 4", () => {
  it.each(SIZES)("finds the size %s holes and prints the limits the AQL engine gives", (size) => {
    const entry = REPORT.watertight.perSize[size]!;
    const expected = EXPECTED.watertight[size]!;
    expect(Object.keys(entry.holes)).toEqual(REPORT.watertight.rows.map((row) => row.code));
    const found = sum(Object.values(entry.holes).map((count) => count ?? 0));
    expect(found).toBe(expected.found);
    expect(nonZero(entry.holes)).toEqual(expected.byLocation);
    expect(entry.tested).toBe(expected.n);
    expect(entry.printedLimit).toEqual({ accept: expected.accept, reject: expected.reject });
  });

  it("prints the XS watertight total as a date; the other totals read found / tested", () => {
    const printed = Object.fromEntries(SIZES.map((size) => [size, REPORT.watertight.perSize[size]!.printedTotal]));
    expect(printed).toEqual({ XS: "Jan-80", S: "0 / 200", M: "0 / 200", L: "1 / 80" });
    const { found, n } = EXPECTED.watertight.XS!;
    expect(`${found}/${n}`).toBe("1/80");
  });

  it.each(CLASSES)("finds no %s defects in any size, under the printed limits", (visualClass) => {
    const block = REPORT.visual[visualClass];
    for (const size of SIZES) {
      const entry = block.perSize[size]!;
      const expected = EXPECTED.visual[visualClass][size]!;
      expect(Object.keys(entry.counts)).toEqual(block.rows.map((row) => row.code));
      expect(sum(Object.values(entry.counts).map((count) => count ?? 0))).toBe(expected.found);
      expect(entry.printedLimit).toEqual({ accept: expected.accept, reject: expected.reject });
      expect(entry.printedTotal).toBe(`0 / ${entry.inspected}`);
    }
  });

  it("labels the critical result line Visual Minor [sic]", () => {
    expect(REPORT.visual.critical.printedResultLabel).toBe("Disposition - Visual Minor (Passed / Failed)");
  });

  it("inspects 3 inner packs and 1 carton per size, expiry date included, with no defects", () => {
    for (const level of ["inner", "carton"] as const) {
      const block = REPORT.labeling[level];
      expect(block.rows.map((row) => row.code)).toContain("expiry_date");
      for (const size of SIZES) {
        const entry = block.perSize[size]!;
        const expected = EXPECTED.labeling[size]!;
        expect(Object.keys(entry.defects)).toEqual(block.rows.map((row) => row.code));
        expect(entry.inspected).toBe(expected[level].n);
        expect(sum(Object.values(entry.defects).map((count) => count ?? 0))).toBe(expected[level].defects);
      }
    }
  });

  it("concludes PASSED, signed by the inspector named in the header, on the inspection day", () => {
    expect(REPORT.conclusion).toMatchObject({ printedResult: "PASSED", remark: null, signed: true });
    expect(REPORT.conclusion.inspectedBy).toBe(REPORT.header.inspectedBy);
    expect(REPORT.conclusion.date.iso).toBe(REPORT.header.inspectionDate.iso);
    expect(EXPECTED.conclusion.result).toBe("pass");
  });

  it("leaves XL blank everywhere", () => {
    expect(REPORT.unorderedSizes).toEqual([]);
    expect(Object.keys(REPORT.cartons)).toEqual(SIZES);
  });
});

describe("SAFEDON_EG fixture, sampling against ISO 2859-1 level I", () => {
  // ISO 2859-1 Table 1, level I, the two bands these lots fall in (BUILD_SPEC
  // 7 tests 120,000 and 1,700,000): 35,001 to 150,000 is code L, n 200; over
  // 500,000 is code N, n 500.
  function levelI(lot: number): { codeLetter: string; n: number } | null {
    if (lot > 500_000) return { codeLetter: "N", n: 500 };
    if (lot > 35_000 && lot <= 150_000) return { codeLetter: "L", n: 200 };
    return null;
  }

  it.each(SIZES)("flags the size %s sample as below the level I plan", (size) => {
    const expected = EXPECTED.sampling[size]!;
    const lot = REPORT.order.lines[size]!.qtyCases * REPORT.packing.printedGlovesPerCase;
    expect(lot).toBe(expected.lotGloves);
    expect(levelI(lot)).toEqual({ codeLetter: expected.codeLetter, n: expected.required });
    expect(REPORT.sampling[size]!.watertightVisualGloves).toBe(expected.sampled);
    expect(expected.sampled < expected.required).toBe(expected.belowPlan);
  });
});
