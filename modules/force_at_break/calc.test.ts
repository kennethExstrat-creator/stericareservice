import { describe, expect, it } from "vitest";
import { dataKeys } from "@/lib/coverage";
import { roundTo } from "@/lib/stats";
import { evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { STD_EG_EXAMPLE, STD_EG_EXPECTED, type ReportSize } from "@/tests/fixtures/examples";
import { calcForceAtBreak, readingsFor, specCaption } from "./calc";
import { FORCE_AT_BREAK_DEFAULT_CONFIG, FORCE_AT_BREAK_LABELS, FORCE_AT_BREAK_TITLE, type ForceAtBreakConfig } from "./config";
import { definition } from "./index";
import { emptyForceAtBreak, type ForceAtBreakData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";

/**
 * n readings (n odd) whose median is exactly `value`, out of order: the
 * report prints only the median, so any readings with that median stand in
 * for the lab's (docs/FIXTURES.md, "How the acceptance tests use them" 6).
 */
function readingsWithMedian(value: number, n = 13): number[] {
  const middle = (n - 1) / 2;
  const sorted = Array.from({ length: n }, (_, index) => roundTo(value + (index - middle) * 0.05, 6));
  return [...sorted.filter((_, index) => index % 2 === 1), ...sorted.filter((_, index) => index % 2 === 0)];
}

function context(sizes: readonly string[], physical: Partial<Record<string, number | null>> = {}): InspectionContext {
  return makeTestContext({
    sizes,
    sampling: Object.fromEntries(sizes.map((size) => [size, makeSampling({ physical: physical[size] ?? null })])),
  });
}

function input(
  sizes: ForceAtBreakData["sizes"],
  {
    at = context(Object.keys(sizes)),
    config = FORCE_AT_BREAK_DEFAULT_CONFIG,
    labels = FORCE_AT_BREAK_LABELS,
    labReport = null,
  }: {
    at?: InspectionContext;
    config?: ForceAtBreakConfig;
    labels?: Readonly<Record<string, string>>;
    labReport?: string | null;
  } = {},
): CalcInput<ForceAtBreakData, ForceAtBreakConfig> {
  return {
    data: { ...emptyForceAtBreak(), sizes, labReport },
    config,
    title: FORCE_AT_BREAK_TITLE,
    labels,
    context: at,
    results: {},
    hasData: true,
  };
}

describe("force_at_break", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  describe("the STD_EG example (expected results B)", () => {
    const report = STD_EG_EXAMPLE;
    const ordered: readonly ReportSize[] = report.sizesOrdered;
    const exampleContext = context(
      ordered,
      Object.fromEntries(ordered.map((size) => [size, report.sampling[size]?.physicalTestGloves ?? null])),
    );
    // The fixture holds the printed median; n is the sampling plan's gloves for FAB.
    const exampleData = Object.fromEntries(
      ordered.map((size) => {
        const n = readingsFor(exampleContext, FORCE_AT_BREAK_DEFAULT_CONFIG, size);
        return [size, { values: readingsWithMedian(report.forceAtBreak[size]!.medianN, n) }];
      }),
    );

    it("computes size M's median of 6.537 N from 13 readings: pass at 6 N or more", () => {
      const expected = STD_EG_EXPECTED.forceAtBreak.M!;
      const output = calcForceAtBreak(input(exampleData, { at: exampleContext, labReport: LAB_REPORT_ID }));
      expect(exampleData.M.values).toHaveLength(13);
      expect(output.computed.specMin).toBe(expected.minN);
      expect(output.computed.sizes.M).toEqual({ n: 13, entered: 13, median: expected.medianN, result: expected.status });
      expect(output.result).toEqual({
        status: expected.status,
        summary: "Size M: Median 6.537 N. Spec. ≥ 6 N.",
        perSize: { M: { status: "pass", summary: "Median 6.537 N" } },
      });
      expect(output.issues).toEqual([]);
    });

    it("shows nothing for the sizes not ordered, where the report printed Passed with no data (6.2 rules 4, 5)", () => {
      const printedPassed = report.unorderedSizes
        .filter((cells) => cells.section === "forceAtBreak")
        .map((cells) => cells.size);
      expect(printedPassed).toEqual(["S", "L", "XL"]);
      expect(STD_EG_EXPECTED.unorderedSizes.sizes).toEqual(expect.arrayContaining(printedPassed));

      const output = calcForceAtBreak(input(exampleData, { at: exampleContext }));
      expect(Object.keys(output.result.perSize ?? {})).toEqual(["M"]);
      expect(Object.keys(output.computed.sizes)).toEqual(["M"]);

      // Ordered but without readings, a size is not done: never Passed.
      const empty = calcForceAtBreak(input({}, { at: context(printedPassed) }));
      expect(empty.result.status).toBe("not_done");
      for (const size of printedPassed) expect(empty.result.perSize?.[size]?.status).toBe("not_done");
    });

    it("leaves the unordered sizes out through the engine too, with a warning for data saved under them", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["force_at_break"]);
      const data = {
        modules: { force_at_break: { sizes: { ...exampleData, XL: { values: [6.2] } }, labReport: null } },
        custom: {},
      };
      const evaluation = evaluateInspection({ template, data, context: exampleContext }, MODULE_REGISTRY);
      const evaluated = evaluation.modules.find((entry) => entry.key === "force_at_break");
      expect(evaluated?.result.status).toBe("pass");
      expect(Object.keys(evaluated?.result.perSize ?? {})).toEqual(["M"]);
      expect(evaluated?.issues.map((issue) => [issue.code, issue.size])).toEqual([["size_not_ordered", "XL"]]);
    });
  });

  it("is not done until every reading of every ordered size is in (6.2 rule 5)", () => {
    const partial = calcForceAtBreak(input({ M: { values: [6.5, 6.6, null, 6.7, 6.4, 6.8, 6.9, 6.3, 6.2] } }));
    expect(partial.result).toEqual({
      status: "not_done",
      summary: "Size M: 8 of 13 readings.",
      perSize: { M: { status: "not_done", summary: "8 of 13 readings" } },
    });
    expect(partial.computed.sizes.M).toEqual({ n: 13, entered: 8, median: null, result: "not_done" });

    const oneDone = calcForceAtBreak(input({ S: { values: readingsWithMedian(6.8) } }, { at: context(["S", "M"]) }));
    expect(oneDone.result).toEqual({
      status: "not_done",
      summary: "Size S: Median 6.800 N; Size M: 0 of 13 readings. Spec. ≥ 6 N.",
      perSize: { S: { status: "pass", summary: "Median 6.800 N" }, M: { status: "not_done", summary: "0 of 13 readings" } },
    });
  });

  it("takes n from the sampling plan's gloves for the physical test, else from the template", () => {
    const planned = context(["M"], { M: 5 });
    expect(readingsFor(planned, FORCE_AT_BREAK_DEFAULT_CONFIG, "M")).toBe(5);
    expect(calcForceAtBreak(input({ M: { values: readingsWithMedian(6.4, 5) } }, { at: planned })).result.status).toBe("pass");

    expect(readingsFor(context(["M"]), FORCE_AT_BREAK_DEFAULT_CONFIG, "M")).toBe(13);
    const config = { ...FORCE_AT_BREAK_DEFAULT_CONFIG, n: 7 };
    expect(readingsFor(context(["M"]), config, "M")).toBe(7);
    expect(calcForceAtBreak(input({ M: { values: readingsWithMedian(6.4, 7) } }, { config })).computed.sizes.M).toEqual({
      n: 7,
      entered: 7,
      median: 6.4,
      result: "pass",
    });
  });

  it("fails a size whose median is below the minimum", () => {
    const output = calcForceAtBreak(input({ S: { values: readingsWithMedian(5.812) }, M: { values: readingsWithMedian(6.537) } }));
    expect(output.result).toEqual({
      status: "fail",
      summary: "Size S: Median 5.812 N (below 6 N); Size M: Median 6.537 N. Spec. ≥ 6 N.",
      perSize: {
        S: { status: "fail", summary: "Median 5.812 N (below 6 N)" },
        M: { status: "pass", summary: "Median 6.537 N" },
      },
    });
    expect(output.computed.sizes.S.result).toBe("fail");
  });

  it("judges the median as printed, at the template's decimals: 6 N is enough", () => {
    const judge = (value: number) => calcForceAtBreak(input({ M: { values: readingsWithMedian(value) } })).computed.sizes.M;
    expect(judge(6)).toMatchObject({ median: 6, result: "pass" });
    // Printed as 6.000 (rounded half away from zero, as the report's Excel does) and judged as printed.
    expect(judge(5.9995)).toMatchObject({ median: 6, result: "pass" });
    expect(judge(5.9994)).toMatchObject({ median: 5.999, result: "fail" });
  });

  it("takes the mean of the two middle readings for an even n", () => {
    const at = context(["M"], { M: 4 });
    const output = calcForceAtBreak(input({ M: { values: [6.9, 6.1, 6.6111, 6.2] } }, { at }));
    expect(output.computed.sizes.M.median).toBe(6.406);
  });

  it("rejects a reading of 0 N or less, with a link to the cell; the size waits for a valid one", () => {
    const values = readingsWithMedian(6.5);
    values[3] = 0;
    const output = calcForceAtBreak(input({ M: { values } }));
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "force_reading_not_positive",
        message: "Size M, glove 4: Force at break (N) must be more than 0, not 0.",
        size: "M",
        path: ["sizes", "M", "values", 3],
      },
    ]);
    expect(output.result.perSize?.M).toEqual({ status: "not_done", summary: "12 of 13 readings" });
  });

  it("raises an error for readings past the gloves tested, never dropping them silently", () => {
    const at = context(["M"], { M: 10 });
    const output = calcForceAtBreak(input({ M: { values: [...readingsWithMedian(6.5, 11).slice(0, 10), null, 6.1, 6.3] } }, { at }));
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "force_readings_beyond_plan",
        message: "Size M: 2 readings are entered beyond the 10 gloves tested. Clear them or correct the sampling plan.",
        size: "M",
        path: ["sizes", "M", "values", 11],
      },
    ]);
    // The 10 gloves tested are still judged.
    expect(output.computed.sizes.M).toMatchObject({ n: 10, entered: 10, result: "pass" });
  });

  it("is not done for a size the sampling plan gives no gloves to test", () => {
    const output = calcForceAtBreak(input({ M: { values: [] } }, { at: context(["M"], { M: 0 }) }));
    expect(output.result.perSize?.M).toEqual({ status: "not_done", summary: "No gloves to test in the sampling plan" });
    expect(output.computed.sizes.M).toEqual({ n: 0, entered: 0, median: null, result: "not_done" });
    expect(output.issues).toEqual([]);

    // Readings saved before the plan said 0 are never dropped silently.
    const saved = calcForceAtBreak(input({ M: { values: [6.5] } }, { at: context(["M"], { M: 0 }) }));
    expect(saved.issues).toEqual([
      {
        level: "error",
        code: "force_readings_beyond_plan",
        message: "Size M: 1 reading is entered, but the sampling plan gives no gloves to test. Clear it or correct the sampling plan.",
        size: "M",
        path: ["sizes", "M", "values", 0],
      },
    ]);
  });

  it("writes summaries in the template's wording, with its sizes and standard", () => {
    const at = makeTestContext({ sizes: ["M"], templateSizes: [{ value: "M", label: "Medium" }] });
    const labels = { ...FORCE_AT_BREAK_LABELS, median: "Median value", specRow: "Requirement" };
    const config = { ...FORCE_AT_BREAK_DEFAULT_CONFIG, standardLabel: "EN 455", decimals: 2 };
    expect(calcForceAtBreak(input({ M: { values: readingsWithMedian(6.537) } }, { at, labels, config })).result.summary).toBe(
      "Size Medium: Median value 6.54 N. Requirement (EN 455) ≥ 6 N.",
    );
  });

  it("puts the standard into the spec caption, or leaves it out", () => {
    expect(specCaption("Spec.", null)).toBe("Spec.");
    expect(specCaption("Spec.", "EN 455")).toBe("Spec. (EN 455)");
    expect(specCaption("Spec. ({standardLabel})", "EN 455")).toBe("Spec. (EN 455)");
    expect(specCaption("Spec. ({standardLabel})", null)).toBe("Spec.");
    expect(specCaption("Spec. {standardLabel}", " ")).toBe("Spec.");
  });

  it("records whether a lab report is attached, which does not change the result", () => {
    const values = readingsWithMedian(6.537);
    const without = calcForceAtBreak(input({ M: { values } }));
    const withReport = calcForceAtBreak(input({ M: { values } }, { labReport: LAB_REPORT_ID }));
    expect(without.computed.labReportAttached).toBe(false);
    expect(withReport.computed.labReportAttached).toBe(true);
    expect(withReport.result).toEqual(without.result);
  });

  it("computes the dictionary's computed keys per size, and keeps the spec with them for the export", () => {
    const output = calcForceAtBreak(input({ M: { values: readingsWithMedian(6.537) } }));
    expect(Object.keys(output.computed.sizes.M)).toEqual(expect.arrayContaining(dataKeys("force_at_break", "computed")));
    expect(output.computed).toMatchObject({ specMin: 6, standardLabel: null, decimals: 3 });
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  it("says no sizes are ordered when there are none", () => {
    expect(calcForceAtBreak(input({}, { at: context([]) })).result).toEqual({
      status: "not_done",
      summary: "No sizes ordered yet.",
      perSize: {},
    });
  });

  describe("through the engine", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["force_at_break"]);
    const evaluate = (entry: unknown) =>
      evaluateInspection(
        { template, data: { modules: { force_at_break: entry }, custom: {} }, context: context(["M"]) },
        MODULE_REGISTRY,
      ).modules.find((entry) => entry.key === "force_at_break");

    it("refuses a reading saved as text: invalid data, not done (6.2 rule 1)", () => {
      const evaluated = evaluate({ sizes: { M: { values: [6.5, "2 42"] } } });
      expect(evaluated?.result.status).toBe("not_done");
      expect(evaluated?.issues).toEqual([
        expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", "values", 1] }),
      ]);
    });

    it("lists a size still missing readings as not done, with the template's title", () => {
      const evaluated = evaluate({ sizes: { M: { values: [6.5, 6.6] } }, comment: "Lab report expected Monday." });
      expect(evaluated).toMatchObject({
        comment: "Lab report expected Monday.",
        result: { status: "not_done", summary: "Size M: 2 of 13 readings." },
        issues: [
          expect.objectContaining({
            level: "warning",
            code: "module_not_done",
            message: `${FORCE_AT_BREAK_TITLE} is not done: Size M: 2 of 13 readings.`,
          }),
        ],
      });
    });

    it("is not done with nothing saved, however many sizes are ordered", () => {
      expect(evaluate(undefined)?.result.status).toBe("not_done");
    });
  });
});
