import { describe, expect, it } from "vitest";
import { roundTo, summarizeColumn } from "@/lib/stats";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import {
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  spreadsheetValue,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type DimensionMeasure,
} from "@/tests/fixtures/examples";
import { dimensionsData, exampleContext, FIXTURE_MEASURE, templateConfig, templateLabels } from "./__fixtures__/examples";
import { calcDimensions } from "./calc";
import {
  DIMENSIONS_DEFAULT_CONFIG,
  DIMENSIONS_LABELS,
  DIMENSIONS_TITLE,
  MAX_ROWS,
  type DimensionsConfig,
} from "./config";
import { definition } from "./index";
import { emptyDimensions, emptyGlove, type DimensionGlove, type DimensionsData } from "./schema";

const STD_GLOVE: DimensionGlove = { length: 245, width: 95, fingerThickness: 0.09, palmThickness: 0.05, cuffThickness: 0.04 };
const STD_EG = templateConfig("STD_EG");
const SAFEDON_EG = templateConfig("SAFEDON_EG");

function gloves(count: number, readings: Partial<DimensionGlove> = STD_GLOVE): DimensionGlove[] {
  return Array.from({ length: count }, () => ({ ...emptyGlove(), ...readings }));
}

function sizeM(list: DimensionGlove[]): DimensionsData {
  return { sizes: { M: { gloves: list } } };
}

function input(
  data: DimensionsData,
  config: DimensionsConfig = STD_EG,
  context: InspectionContext = makeTestContext({ sizes: ["M"] }),
  labels: Record<string, string> = DIMENSIONS_LABELS,
): CalcInput<DimensionsData, DimensionsConfig> {
  return { data, config, title: DIMENSIONS_TITLE, labels, context, results: {}, hasData: true };
}

/** Expected values per fixture column, keyed by the module's measure keys. */
function byMeasure<T>(values: Readonly<Partial<Record<DimensionMeasure, T>>>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).map(([column, value]) => [FIXTURE_MEASURE[column as DimensionMeasure], value]));
}

/** Decimals an expected value is written with: 241.38 has 2, 0.1769 has 4. */
function decimalsOf(value: number): number {
  return String(value).split(".")[1]?.length ?? 0;
}

describe("dimensions", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  describe("the STD_EG example (expected results B)", () => {
    const output = calcDimensions(input(dimensionsData(STD_EG_EXAMPLE.dimensions), STD_EG, exampleContext(STD_EG_EXAMPLE)));
    const expected = STD_EG_EXPECTED.dimensions.M!;

    it("computes the medians of size M: 245, 95, 0.09, 0.05, 0.04", () => {
      expect(output.computed.statisticKind).toBe("median");
      expect(output.computed.statistic.M).toEqual(byMeasure(expected.median));
      expect(output.computed.shown.M).toEqual(byMeasure(expected.median));
      expect(output.computed.rows).toEqual({ M: 13 });
    });

    it("passes length (≥ 240) and width (95 ± 10), and the thicknesses with no spec: Passed, as the report prints them", () => {
      // No spec means Passed once the readings are complete (Kenneth, 26 October 2026).
      expect(output.computed.measureResult.M).toEqual({
        ...byMeasure(expected.perMeasure),
        fingerThickness: "pass",
        palmThickness: "pass",
        cuffThickness: "pass",
      });
      expect(output.computed.spec.M).toEqual({
        ...byMeasure(expected.spec),
        fingerThickness: { kind: "na" },
        palmThickness: { kind: "na" },
        cuffThickness: { kind: "na" },
      });
      expect(output.result).toEqual({
        status: expected.status,
        summary: "Median within spec for size M.",
        perSize: {
          M: {
            status: "pass",
            summary:
              "Median: Length 245 Passed (≥ 240), Width 95 Passed (95 ± 10), Finger Thickness 0.09 Passed (NA), Palm Thickness 0.05 Passed (NA), Cuff Thickness 0.04 Passed (NA).",
          },
        },
      });
      expect(output.issues).toEqual([]);
    });

    it("shows no table and no result for the sizes not ordered (XS, S, L, XL)", () => {
      expect(STD_EG_EXPECTED.unorderedSizes.sizes).toEqual(["XS", "S", "L", "XL"]);
      expect(Object.keys(output.result.perSize ?? {})).toEqual(["M"]);
      for (const part of [output.computed.rows, output.computed.statistic, output.computed.measureResult]) {
        expect(Object.keys(part)).toEqual(["M"]);
      }
    });
  });

  describe("the SAFEDON_EG example (expected results A)", () => {
    const context = exampleContext(SAFEDON_EG_EXAMPLE);
    const output = calcDimensions(
      input(dimensionsData(SAFEDON_EG_EXAMPLE.dimensions), SAFEDON_EG, context, templateLabels("SAFEDON_EG")),
    );

    it.each(Object.entries(SAFEDON_EG_EXPECTED.dimensions))("averages size %s as the expected results do", (size, expected) => {
      const statistic = output.computed.statistic[size];
      for (const [measure, value] of Object.entries(byMeasure(expected.averageOfPrintedReadings))) {
        expect(statistic[measure], measure).toBeCloseTo(value, decimalsOf(value));
      }
      for (const [measure, value] of Object.entries(byMeasure(expected.average))) {
        const computed = statistic[measure] as number;
        if (measure === "length" || measure === "width") {
          expect(computed, measure).toBeCloseTo(value, 2);
        } else {
          // The print rounds thickness readings to 2 decimals (docs/FIXTURES.md): the
          // averages agree within 0.005, and exactly at the report's 2 decimals.
          expect(Math.abs(computed - value), measure).toBeLessThanOrEqual(0.005);
          expect(roundTo(computed, 2), measure).toBe(roundTo(value, 2));
        }
      }
      expect(output.computed.measureResult[size]).toEqual(byMeasure(expected.perMeasure));
      expect(output.result.perSize?.[size]?.status).toBe(expected.status);
    });

    it("averages XS to 241.38, 76.23, 0.1769 and 0.1208 and accepts every measure, in Safedon's wording", () => {
      expect(output.computed.statisticKind).toBe("average");
      expect(output.computed.measures).toEqual(["length", "width", "fingerThickness", "palmThickness"]);
      expect(output.computed.shown.XS).toEqual({ length: 241, width: 76, fingerThickness: 0.18, palmThickness: 0.12 });
      expect(output.result.perSize?.XS?.summary).toBe(
        "Average: Length 241 A (≥ 230), Width 76 A (76 ± 4), Finger Thickness 0.18 A (0.18 ± 0.04), Palm Thickness 0.12 A (0.14 ± 0.04).",
      );
      expect(output.result.status).toBe("pass");
      expect(output.result.summary).toBe("Average within spec for size XS, S, M, L.");
      expect(output.issues).toEqual([]);
    });

    it("counts the five size S cells the report skipped: 243.38, not 243.5", () => {
      const expected = SAFEDON_EG_EXPECTED.dimensions.S!;
      expect(output.computed.count.S).toEqual({ length: 13, width: 13, fingerThickness: 13, palmThickness: 13 });
      expect(output.computed.statistic.S.length).toBeCloseTo(expected.average.length!, 2);
      expect(output.computed.statistic.S.width).toBeCloseTo(expected.average.width!, 2);
      expect(expected.originalAverage?.length).toBe(243.5);
    });

    it("is not done, never passed, when the text cells are left out as the report's spreadsheet did (6.2 rules 1 and 5)", () => {
      const skipped = dimensionsData(SAFEDON_EG_EXAMPLE.dimensions, spreadsheetValue);
      const original = calcDimensions(input(skipped, SAFEDON_EG, context, templateLabels("SAFEDON_EG")));
      const expected = SAFEDON_EG_EXPECTED.dimensions.S!;
      expect(original.computed.count.S).toEqual({ length: 12, width: 13, fingerThickness: 11, palmThickness: 11 });
      // The partial average is the report's figure; the app shows it as 12 of 13, not as the result.
      expect(original.computed.statistic.S.length).toBeCloseTo(expected.originalAverage!.length!, 2);
      expect(original.computed.statistic.S.width).toBeCloseTo(expected.originalAverage!.width!, 2);
      expect(original.computed.measureResult.S).toEqual({
        length: "not_done",
        width: "pass",
        fingerThickness: "not_done",
        palmThickness: "not_done",
      });
      expect(original.result.perSize?.S).toEqual({
        status: "not_done",
        summary:
          "Average: Width 87 A (86 ± 4). Missing readings: Length 12 of 13, Finger Thickness 11 of 13, Palm Thickness 11 of 13.",
      });
      expect(original.result.status).toBe("not_done");
      expect(original.result.summary).toBe("Not done for size S. Average within spec for size XS, M, L.");
    });
  });

  describe("missing data is not done, never passed (6.2 rule 5)", () => {
    it("is not done with nothing entered, naming what is missing", () => {
      expect(calcDimensions(input(emptyDimensions())).result).toEqual({
        status: "not_done",
        summary: "Not done for size M.",
        perSize: {
          M: {
            status: "not_done",
            summary:
              "Missing readings: Length 0 of 13, Width 0 of 13, Finger Thickness 0 of 13, Palm Thickness 0 of 13, Cuff Thickness 0 of 13.",
          },
        },
      });
    });

    it("is not done until every glove has every reading", () => {
      expect(calcDimensions(input(sizeM(gloves(12)))).result.status).toBe("not_done");
      const lastCuffMissing = [...gloves(12), { ...STD_GLOVE, cuffThickness: null }];
      const output = calcDimensions(input(sizeM(lastCuffMissing)));
      expect(output.result.status).toBe("not_done");
      expect(output.result.perSize?.M?.summary).toBe(
        "Median: Length 245 Passed (≥ 240), Width 95 Passed (95 ± 10), Finger Thickness 0.09 Passed (NA), Palm Thickness 0.05 Passed (NA). Missing readings: Cuff Thickness 12 of 13.",
      );
      // No spec, readings short: not done, never Passed.
      expect(output.computed.measureResult.M.cuffThickness).toBe("not_done");
    });

    it("is not done for every size that has no readings, beside sizes that pass", () => {
      const context = makeTestContext({ sizes: ["S", "M"] });
      const output = calcDimensions(input(sizeM(gloves(13)), STD_EG, context));
      expect(output.result.status).toBe("not_done");
      expect(output.result.summary).toBe("Not done for size S. Median within spec for size M.");
    });

    it("is not done without ordered sizes", () => {
      const output = calcDimensions(input(sizeM(gloves(13)), STD_EG, makeTestContext()));
      expect(output.result).toEqual({ status: "not_done", summary: "No sizes ordered yet.", perSize: {} });
    });
  });

  describe("pass and fail on the printed statistic", () => {
    it("fails a size when one measure is out of spec, and the module with it", () => {
      const output = calcDimensions(input(sizeM(gloves(13, { ...STD_GLOVE, width: 106 }))));
      expect(output.computed.measureResult.M).toMatchObject({ length: "pass", width: "fail" });
      expect(output.result.status).toBe("fail");
      expect(output.result.summary).toBe("Out of spec: size M Width 106 (95 ± 10).");
      expect(output.result.perSize?.M?.summary).toContain("Width 106 Failed (95 ± 10)");
      // Out of spec is a result, not wrong data: no issue.
      expect(output.issues).toEqual([]);
    });

    it("fails on a complete measure even while another is still missing readings", () => {
      const list = gloves(13, { ...STD_GLOVE, length: 238 }).map((glove, index) =>
        index === 0 ? { ...glove, width: null } : glove,
      );
      expect(calcDimensions(input(sizeM(list))).result.perSize?.M?.status).toBe("fail");
    });

    it("judges the statistic as printed: width 105.4 is 105 and passes 95 ± 10, 105.5 is 106 and fails", () => {
      const average = { ...STD_EG, statistic: "average" as const };
      const widths = (last: number) => sizeM(gloves(13).map((glove, index) => ({ ...glove, width: index === 12 ? last : 105 })));
      const low = calcDimensions(input(widths(110.2), average));
      expect(low.computed.statistic.M.width).toBeCloseTo(105.4, 10);
      expect(low.computed.shown.M.width).toBe(105);
      expect(low.computed.measureResult.M.width).toBe("pass");
      const high = calcDimensions(input(widths(111.5), average));
      expect(high.computed.statistic.M.width).toBe(105.5);
      expect(high.computed.shown.M.width).toBe(106);
      expect(high.computed.measureResult.M.width).toBe("fail");
    });

    it("judges thickness at 2 decimals: 0.2249 passes 0.18 ± 0.04 as 0.22, 0.225 fails as 0.23", () => {
      const context = makeTestContext({ sizes: ["M"] });
      const thick = (finger: number) => sizeM(gloves(13, { length: 242, width: 97, fingerThickness: finger, palmThickness: 0.11 }));
      const median = { ...SAFEDON_EG, statistic: "median" as const };
      expect(calcDimensions(input(thick(0.2249), median, context)).computed.measureResult.M.fingerThickness).toBe("pass");
      const over = calcDimensions(input(thick(0.225), median, context));
      expect(over.computed.shown.M.fingerThickness).toBe(0.23);
      expect(over.computed.measureResult.M.fingerThickness).toBe("fail");
    });

    it("takes the median or the average, as the template says", () => {
      const list = gloves(13).map((glove, index) => ({ ...glove, length: index === 0 ? 300 : 240 }));
      const config = (statistic: DimensionsConfig["statistic"]): DimensionsConfig => ({
        ...STD_EG,
        statistic,
        specs: [{ size: "M", specs: { length: { kind: "min", min: 241 } } }],
      });
      const median = calcDimensions(input(sizeM(list), config("median")));
      expect(median.computed.statistic.M.length).toBe(240);
      expect(median.computed.measureResult.M.length).toBe("fail");
      const average = calcDimensions(input(sizeM(list), config("average")));
      expect(average.computed.statistic.M.length).toBeCloseTo(244.615, 3);
      expect(average.computed.measureResult.M.length).toBe("pass");
    });
  });

  describe("specs", () => {
    it("judges every kind of spec STD_EG prints: XS width ≤ 80, XL width ≥ 110", () => {
      const context = makeTestContext({ sizes: ["XS", "XL"] });
      const data = {
        sizes: { XS: { gloves: gloves(13, { ...STD_GLOVE, width: 81 }) }, XL: { gloves: gloves(13, { ...STD_GLOVE, width: 112 }) } },
      };
      const output = calcDimensions(input(data, STD_EG, context));
      expect(output.computed.spec.XS.width).toEqual({ kind: "max", max: 80 });
      expect(output.computed.measureResult.XS.width).toBe("fail");
      expect(output.computed.measureResult.XL.width).toBe("pass");
      expect(output.result.summary).toBe("Out of spec: size XS Width 81 (≤ 80). Median within spec for size XL.");
    });

    it("judges a range, limits included", () => {
      const range = (min: number, max: number): DimensionsConfig => ({
        ...STD_EG,
        specs: [{ size: "M", specs: { length: { kind: "range", min, max } } }],
      });
      expect(calcDimensions(input(sizeM(gloves(13)), range(240, 245))).computed.measureResult.M.length).toBe("pass");
      expect(calcDimensions(input(sizeM(gloves(13)), range(246, 250))).computed.measureResult.M.length).toBe("fail");
    });

    it("words its summaries in the template's labels", () => {
      const labels = { ...DIMENSIONS_LABELS, width: "Glove width", fail: "F" };
      const output = calcDimensions(input(sizeM(gloves(13, { ...STD_GLOVE, width: 106 })), STD_EG, undefined, labels));
      expect(output.result.summary).toBe("Out of spec: size M Glove width 106 (95 ± 10).");
      expect(output.result.perSize?.M?.summary).toContain("Glove width 106 F (95 ± 10)");
    });

    it("passes a size without a spec row once its readings are complete (Kenneth, 26 October 2026)", () => {
      const context = makeTestContext({ sizes: ["7.0"] });
      const output = calcDimensions(input({ sizes: { "7.0": { gloves: gloves(13) } } }, templateConfig("STD_SG"), context));
      expect(output.computed.measureResult["7.0"]).toEqual({
        length: "pass",
        width: "pass",
        fingerThickness: "pass",
        palmThickness: "pass",
        cuffThickness: "pass",
      });
      expect(output.computed.spec["7.0"].length).toBeNull();
      expect(output.result.status).toBe("pass");
      expect(output.result.summary).toBe("Median within spec for size 7.0.");
      expect(output.result.perSize?.["7.0"]?.summary).toBe(
        "Median: Length 245 Passed (no spec), Width 95 Passed (no spec), Finger Thickness 0.09 Passed (no spec), Palm Thickness 0.05 Passed (no spec), Cuff Thickness 0.04 Passed (no spec).",
      );
    });

    it("passes the sizes with a spec, and the size without one too (SAFEDON_EG has no XL row)", () => {
      const context = makeTestContext({ sizes: ["M", "XL"] });
      const glove = { length: 242, width: 97, fingerThickness: 0.17, palmThickness: 0.11 };
      const data = { sizes: { M: { gloves: gloves(13, glove) }, XL: { gloves: gloves(13, glove) } } };
      const output = calcDimensions(input(data, SAFEDON_EG, context, templateLabels("SAFEDON_EG")));
      expect(output.result.perSize).toMatchObject({ M: { status: "pass" }, XL: { status: "pass" } });
      expect(output.result.status).toBe("pass");
      expect(output.result.summary).toBe("Average within spec for size M, XL.");
    });
  });

  describe("measures and rows", () => {
    it("measures only what the template switches on: SAFEDON_EG has no cuff", () => {
      const context = makeTestContext({ sizes: ["M"] });
      const data = sizeM(gloves(13, { length: 242, width: 97, fingerThickness: 0.17, palmThickness: 0.11, cuffThickness: -1 }));
      const output = calcDimensions(input(data, SAFEDON_EG, context));
      expect(output.result.status).toBe("pass");
      expect(Object.keys(output.computed.statistic.M)).toEqual(["length", "width", "fingerThickness", "palmThickness"]);
      expect(output.issues).toEqual([]);
    });

    it("takes the number of gloves from the sampling plan, else from the template", () => {
      const planned = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions: 5 }) } });
      const five = calcDimensions(input(sizeM(gloves(5)), STD_EG, planned));
      expect(five.computed.rows).toEqual({ M: 5 });
      expect(five.result.status).toBe("pass");
      const fallback = calcDimensions(input(sizeM(gloves(5)), { ...STD_EG, rows: 5 }));
      expect(fallback.computed.rows).toEqual({ M: 5 });
      expect(fallback.result.status).toBe("pass");
    });

    it("counts only the planned gloves and warns about readings past them", () => {
      const planned = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions: 5 }) } });
      const list = [...gloves(5), ...gloves(2, { ...STD_GLOVE, width: 200 })];
      const output = calcDimensions(input(sizeM(list), STD_EG, planned));
      expect(output.computed.statistic.M.width).toBe(95);
      expect(output.result.status).toBe("pass");
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "dimension_beyond_sample",
          message: "Size M: readings for No. 6 to 7 are not counted; the sampling plan has 5 gloves for dimension.",
          size: "M",
          path: ["sizes", "M", "gloves", 5],
        },
      ]);
      const template = calcDimensions(input(sizeM(gloves(14)), STD_EG));
      expect(template.issues.map((issue) => issue.message)).toEqual([
        "Size M: readings for No. 14 are not counted; the template measures 13 gloves per size.",
      ]);
    });

    it("caps the gloves at MAX_ROWS and falls back to the template when the plan's n is not a count", () => {
      const plan = (dimensions: number) =>
        calcDimensions(input(sizeM(gloves(13)), STD_EG, makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions }) } })))
          .computed.rows.M;
      expect(plan(5000)).toBe(MAX_ROWS);
      expect(plan(-1)).toBe(13);
      expect(plan(2.5)).toBe(13);
    });

    it("is not done when the sampling plan has no gloves for dimension", () => {
      const none = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions: 0 }) } });
      expect(calcDimensions(input(sizeM(gloves(13)), STD_EG, none)).result.perSize?.M).toEqual({
        status: "not_done",
        summary: "The sampling plan has no gloves for dimension.",
      });
    });
  });

  describe("a reading of 0 or less", () => {
    it("is an error that blocks submit, with a link to the cell", () => {
      const list = gloves(13).map((glove, index) => (index === 3 ? { ...glove, width: 0 } : glove));
      const output = calcDimensions(input(sizeM(list)));
      expect(output.issues).toEqual([
        {
          level: "error",
          code: "dimension_not_positive",
          message: "Size M, Width No. 4: must be more than 0 mm.",
          size: "M",
          path: ["sizes", "M", "gloves", 3, "width"],
        },
      ]);
    });

    it("counts as the grid's footer counts it, so the size and the footer give one verdict", () => {
      // MeasurementGrid's footer is lib/stats summarizeColumn over the stored column.
      const footer = (list: DimensionGlove[], config: DimensionsConfig, measure: "length" | "width") =>
        summarizeColumn(
          list.map((glove) => glove[measure]),
          13,
          config.statistic,
          config.specs.find((row) => row.size === "M")?.specs[measure],
          config.decimals[measure],
        );

      // The median hardly moves: width still 95, passed, as the footer shows it.
      const median = gloves(13).map((glove, index) => (index === 3 ? { ...glove, width: 0 } : glove));
      const std = calcDimensions(input(sizeM(median)));
      expect(std.computed.count.M.width).toBe(13);
      expect(std.computed.shown.M.width).toBe(95);
      expect(std.computed.measureResult.M.width).toBe(footer(median, STD_EG, "width").outcome);
      expect(std.computed.measureResult.M.width).toBe("pass");
      expect(std.result.status).toBe("pass");

      // The average drops below the minimum: failed, in the footer as in the result.
      const average = gloves(13, { length: 242, width: 97, fingerThickness: 0.17, palmThickness: 0.11 }).map((glove, index) =>
        index === 0 ? { ...glove, length: 0 } : glove,
      );
      const safedon = calcDimensions(input(sizeM(average), SAFEDON_EG));
      expect(safedon.computed.shown.M.length).toBe(223);
      expect(safedon.computed.measureResult.M.length).toBe(footer(average, SAFEDON_EG, "length").outcome);
      expect(safedon.result.status).toBe("fail");
      expect(safedon.issues.map((issue) => issue.code)).toEqual(["dimension_not_positive"]);
    });
  });

  it("returns plain JSON", () => {
    const output = calcDimensions(input(dimensionsData(STD_EG_EXAMPLE.dimensions), STD_EG, exampleContext(STD_EG_EXAMPLE)));
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  describe("through the engine", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, [
      { key: "dimensions", config: SAFEDON_EG, labels: templateLabels("SAFEDON_EG") },
    ]);
    const context = exampleContext(SAFEDON_EG_EXAMPLE);
    const evaluate = (dimensions: unknown) =>
      evaluateInspection({ template, data: { modules: { dimensions }, custom: {} }, context }, MODULE_REGISTRY).modules.find(
        (module) => module.key === "dimensions",
      )!;

    it("passes the SAFEDON_EG example and leaves out a size that is not ordered (6.2 rule 4)", () => {
      const data = dimensionsData(SAFEDON_EG_EXAMPLE.dimensions);
      const evaluation = evaluate({ ...data, sizes: { ...data.sizes, XL: { gloves: gloves(13) } } });
      expect(evaluation.result.status).toBe("pass");
      expect(Object.keys(evaluation.result.perSize ?? {})).toEqual(["XS", "S", "M", "L"]);
      expect(Object.keys((evaluation.computed as { rows: object }).rows)).toEqual(["XS", "S", "M", "L"]);
      expect(evaluation.issues).toEqual([
        expect.objectContaining({ level: "warning", code: "size_not_ordered", size: "XL", path: ["sizes", "XL"] }),
      ]);
    });

    it("refuses the saved text cells with an error on each, and is not done until they are numbers (6.2 rule 1)", () => {
      const data = dimensionsData(SAFEDON_EG_EXAMPLE.dimensions) as {
        sizes: Record<string, { gloves: Record<string, unknown>[] }>;
      };
      for (const cell of SAFEDON_EG_EXPECTED.rejectedInputs) {
        data.sizes[cell.size].gloves[cell.glove - 1][FIXTURE_MEASURE[cell.measure]] = cell.raw;
      }
      const evaluation = evaluate(data);
      expect(evaluation.result.status).toBe("not_done");
      const errors = evaluation.issues.filter((issue) => issue.code === "invalid_data");
      expect(errors.map((issue) => issue.path)).toEqual(
        SAFEDON_EG_EXPECTED.rejectedInputs.map((cell) => [
          "sizes",
          cell.size,
          "gloves",
          cell.glove - 1,
          FIXTURE_MEASURE[cell.measure],
        ]),
      );
      expect(errors.every((issue) => issue.level === "error")).toBe(true);
    });

    it("is not done with nothing saved", () => {
      const evaluation = evaluateInspection(
        { template, data: { modules: {}, custom: {} }, context },
        MODULE_REGISTRY,
      ).modules.find((module) => module.key === "dimensions")!;
      expect(evaluation.result.status).toBe("not_done");
      expect(evaluation.issues).toEqual([expect.objectContaining({ code: "module_not_done", level: "warning" })]);
    });
  });

  it("starts from the module defaults when a template says nothing", () => {
    expect(definition.defaultConfig).toBe(DIMENSIONS_DEFAULT_CONFIG);
    const output = calcDimensions(input(sizeM(gloves(13)), DIMENSIONS_DEFAULT_CONFIG));
    // No specs by default: every complete column is Passed (Kenneth, 26 October 2026).
    expect(output.result.status).toBe("pass");
  });
});

describe("dimensions: a P/F set by hand (Kenneth, 26 October 2026)", () => {
  const outOfSpec = (manual?: DimensionsData["sizes"][string]["manualResults"]): DimensionsData => ({
    sizes: { M: { gloves: gloves(13, { ...STD_GLOVE, width: 106 }), ...(manual ? { manualResults: manual } : {}) } },
  });

  it("takes the place of the readings' verdict: Passed on a width out of spec, with a warning naming the comment", () => {
    const output = calcDimensions(input(outOfSpec({ width: { result: "pass", comment: "Measured again at the lab: 104." } }), STD_EG));
    expect(output.computed.calculated.M.width).toBe("fail");
    expect(output.computed.measureResult.M.width).toBe("pass");
    expect(output.computed.manual.M).toEqual({ width: { result: "pass", comment: "Measured again at the lab: 104." } });
    expect(output.result.perSize?.M?.status).toBe("pass");
    expect(output.result.perSize?.M?.summary).toContain("Width 106 Passed by the inspector (95 ± 10)");
    expect(output.issues).toEqual([
      expect.objectContaining({
        level: "warning",
        code: "pass_fail_changed",
        message: "Size M, Width: Passed set by the inspector; the readings give Failed. Comment: Measured again at the lab: 104.",
        path: ["sizes", "M", "manualResults", "width"],
      }),
    ]);
  });

  it("fails the size when set to Failed, though the readings pass", () => {
    const data = sizeM(gloves(13));
    data.sizes.M.manualResults = { palmThickness: { result: "fail", comment: "Holes at the palm." } };
    const output = calcDimensions(input(data, STD_EG));
    expect(output.computed.calculated.M.palmThickness).toBe("pass");
    expect(output.computed.measureResult.M.palmThickness).toBe("fail");
    expect(output.result.status).toBe("fail");
  });

  it("gives no warning when it agrees with the readings, and leaves a size short of readings not done", () => {
    const agree = calcDimensions(input(outOfSpec({ width: { result: "fail", comment: "Confirmed." } }), STD_EG));
    expect(agree.issues).toEqual([]);
    const short = sizeM(gloves(12));
    short.sizes.M.manualResults = { length: { result: "pass", comment: "Twelve gloves only." } };
    const output = calcDimensions(input(short, STD_EG));
    expect(output.result.perSize?.M?.status).toBe("not_done");
    expect(output.issues.filter((issue) => issue.code === "pass_fail_changed")).toEqual([]);
  });
});

describe("dimensions: a spec set for the inspection (Kenneth, 26 October 2026)", () => {
  // STD_EG v5 forms print SAFEDON_EG's specs: Spec ≥ 230 / 86 ± 4 / 0.18 ± 0.04 / 0.14 ± 0.04.
  const withSpecs = (specOverrides: DimensionsData["sizes"][string]["specOverrides"]): DimensionsData => ({
    sizes: { M: { gloves: gloves(13), specOverrides } },
  });

  it("judges by it in place of the template's, and keeps the template's beside it", () => {
    const output = calcDimensions(input(withSpecs({ width: { kind: "tolerance", nominal: 86, tolerance: 4 } }), STD_EG));
    expect(output.computed.spec.M.width).toEqual({ kind: "tolerance", nominal: 86, tolerance: 4 });
    expect(output.computed.templateSpec.M.width).toEqual({ kind: "tolerance", nominal: 95, tolerance: 10 });
    expect(output.computed.measureResult.M.width).toBe("fail");
    expect(output.result.status).toBe("fail");
    expect(output.result.summary).toContain("Out of spec: size M Width 95 (86 ± 4).");
  });

  it("fails a thickness the form gives a spec for, and passes it again once set to NA", () => {
    const strict = calcDimensions(input(withSpecs({ fingerThickness: { kind: "tolerance", nominal: 0.18, tolerance: 0.04 } }), STD_EG));
    expect(strict.computed.measureResult.M.fingerThickness).toBe("fail");
    const none = calcDimensions(input(withSpecs({ fingerThickness: { kind: "na" } }), STD_EG));
    expect(none.computed.spec.M.fingerThickness).toEqual({ kind: "na" });
    expect(none.computed.measureResult.M.fingerThickness).toBe("pass");
    expect(none.result.perSize?.M?.summary).toContain("Finger Thickness 0.09 Passed (NA)");
  });

  it("still gives way to a P/F set by hand", () => {
    const data = withSpecs({ width: { kind: "tolerance", nominal: 86, tolerance: 4 } });
    data.sizes.M = { ...data.sizes.M, manualResults: { width: { result: "pass", comment: "The PO's width is 95 ± 10." } } };
    const output = calcDimensions(input(data, STD_EG));
    expect(output.computed.calculated.M.width).toBe("fail");
    expect(output.computed.measureResult.M.width).toBe("pass");
    expect(output.result.status).toBe("pass");
  });
});
