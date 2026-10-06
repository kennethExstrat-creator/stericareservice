import { describe, expect, it } from "vitest";
import { dataKeys } from "@/lib/coverage";
import { evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE, SAFEDON_EG_EXPECTED, type ReportSize } from "@/tests/fixtures/examples";
import { calcTensile, judgeAverage, specCaption, specText } from "./calc";
import { TENSILE_DEFAULT_CONFIG, TENSILE_LABELS, TENSILE_TITLE, type TensileConfig } from "./config";
import { definition } from "./index";
import { emptyTensile, type TensileData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000402";

function context(sizes: readonly string[]): InspectionContext {
  return makeTestContext({ sizes });
}

function input(
  sizes: TensileData["sizes"],
  {
    at = context(Object.keys(sizes)),
    config = TENSILE_DEFAULT_CONFIG,
    labels = TENSILE_LABELS,
    labReport = LAB_REPORT_ID,
  }: {
    at?: InspectionContext;
    config?: TensileConfig;
    labels?: Readonly<Record<string, string>>;
    labReport?: string | null;
  } = {},
): CalcInput<TensileData, TensileConfig> {
  return {
    data: { ...emptyTensile(), sizes, labReport },
    config,
    title: TENSILE_TITLE,
    labels,
    context: at,
    results: {},
    hasData: true,
  };
}

const PASSING = { tensileStrength: 34.18, elongationAtBreak: 536 };

describe("tensile", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  describe("the SAFEDON_EG example (expected results A)", () => {
    const report = SAFEDON_EG_EXAMPLE;
    const ordered: readonly ReportSize[] = report.sizesOrdered;
    const exampleContext = makeTestContext({
      sizes: ordered,
      sampling: Object.fromEntries(
        ordered.map((size) => [size, makeSampling({ physical: report.sampling[size]?.physicalTestGloves ?? null })]),
      ),
    });
    // The report prints the lab's averages: they are typed as printed.
    const exampleSizes = Object.fromEntries(
      ordered.map((size) => {
        const entry = report.tensile[size]!;
        return [size, { tensileStrength: entry.tensileMPa, elongationAtBreak: entry.elongationPct }];
      }),
    );

    it("passes XS 34.18 / 536, S 32.99 / 547, M 34.03 / 555 and L 33.17 / 543 at 14 MPa and 500% or more", () => {
      const output = calcTensile(input(exampleSizes, { at: exampleContext }));
      expect(ordered).toEqual(["XS", "S", "M", "L"]);
      for (const size of ordered) {
        const expected = SAFEDON_EG_EXPECTED.tensile[size]!;
        expect(exampleSizes[size]).toEqual({ tensileStrength: expected.tensileMPa, elongationAtBreak: expected.elongationPct });
        expect(output.result.perSize?.[size]?.status, size).toBe(expected.status);
        expect(output.computed.sizes[size]).toEqual({ tensileResult: "pass", elongationResult: "pass" });
        expect(output.computed).toMatchObject({ tensileMin: expected.minTensileMPa, elongationMin: expected.minElongationPct });
      }
      expect(output.result).toEqual({
        status: "pass",
        summary:
          "Size XS: 34.18 MPa / 536%; Size S: 32.99 MPa / 547%; Size M: 34.03 MPa / 555%; Size L: 33.17 MPa / 543%. " +
          "Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%.",
        perSize: {
          XS: { status: "pass", summary: "34.18 MPa / 536%" },
          S: { status: "pass", summary: "32.99 MPa / 547%" },
          M: { status: "pass", summary: "34.03 MPa / 555%" },
          L: { status: "pass", summary: "33.17 MPa / 543%" },
        },
      });
      expect(output.issues).toEqual([]);
      expect(output.computed.labReportAttached).toBe(true);
    });

    it("takes a kept lab report the inspection no longer holds as not attached, and says so", () => {
      const held = makeTestContext({ ...exampleContext, files: [{ id: LAB_REPORT_ID, moduleKey: "tensile", kind: "lab_report" }] });
      expect(calcTensile(input(exampleSizes, { at: held })).result.status).toBe("pass");
      const deleted = calcTensile(input(exampleSizes, { at: makeTestContext({ ...exampleContext, files: [] }) }));
      expect(deleted.result.status).toBe("not_done");
      expect(deleted.computed.labReportAttached).toBe(false);
      expect(deleted.issues).toEqual([
        {
          level: "warning",
          code: "lab_report_missing",
          message: "Lab report: the file attached here is no longer with this inspection. Attach it again.",
          path: ["labReport"],
        },
      ]);
      expect(deleted.notDonePath).toEqual(["labReport"]);
    });

    it("is not done until the lab report is attached: it is required (BUILD_SPEC 6.1)", () => {
      const output = calcTensile(input(exampleSizes, { at: exampleContext, labReport: null }));
      expect(output.result.status).toBe("not_done");
      expect(output.result.summary).toMatch(/≥ 14\.00 MPa \/ ≥ 500%\. Lab report not attached\.$/);
      // The averages themselves still pass.
      for (const size of ordered) expect(output.result.perSize?.[size]?.status).toBe("pass");
      expect(output.computed.labReportAttached).toBe(false);
      expect(output.issues).toEqual([]);
    });

    it("shows no result for XL, which was not ordered (6.2 rule 4)", () => {
      const output = calcTensile(input(exampleSizes, { at: exampleContext }));
      expect(Object.keys(output.result.perSize ?? {})).toEqual(["XS", "S", "M", "L"]);
      expect(Object.keys(output.computed.sizes)).toEqual(["XS", "S", "M", "L"]);
    });

    it("passes through the engine, which leaves a size saved but not ordered out with a warning", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["tensile"]);
      const data = {
        modules: { tensile: { sizes: { ...exampleSizes, XL: PASSING }, labReport: LAB_REPORT_ID } },
        custom: {},
      };
      const evaluated = evaluateInspection({ template, data, context: exampleContext }, MODULE_REGISTRY).modules.find(
        (entry) => entry.key === "tensile",
      );
      expect(evaluated?.result.status).toBe("pass");
      expect(Object.keys(evaluated?.result.perSize ?? {})).toEqual(["XS", "S", "M", "L"]);
      expect(evaluated?.issues.map((issue) => [issue.code, issue.size])).toEqual([["size_not_ordered", "XL"]]);
    });
  });

  it("fails a size when either average is below its minimum", () => {
    const output = calcTensile(
      input({
        S: { tensileStrength: 12.5, elongationAtBreak: 547 },
        M: { tensileStrength: 34.03, elongationAtBreak: 480 },
        L: { tensileStrength: 33.17, elongationAtBreak: 543 },
      }),
    );
    expect(output.result).toEqual({
      status: "fail",
      summary:
        "Size S: 12.50 MPa (below 14.00 MPa) / 547%; Size M: 34.03 MPa / 480% (below 500%); Size L: 33.17 MPa / 543%. " +
        "Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%.",
      perSize: {
        S: { status: "fail", summary: "12.50 MPa (below 14.00 MPa) / 547%" },
        M: { status: "fail", summary: "34.03 MPa / 480% (below 500%)" },
        L: { status: "pass", summary: "33.17 MPa / 543%" },
      },
    });
    expect(output.computed.sizes).toEqual({
      S: { tensileResult: "fail", elongationResult: "pass" },
      M: { tensileResult: "pass", elongationResult: "fail" },
      L: { tensileResult: "pass", elongationResult: "pass" },
    });
  });

  it("fails with a failing average even before the lab report is attached", () => {
    const output = calcTensile(input({ S: { tensileStrength: 12.5, elongationAtBreak: 547 } }, { labReport: null }));
    expect(output.result.status).toBe("fail");
    expect(output.result.summary).toBe(
      "Size S: 12.50 MPa (below 14.00 MPa) / 547%. Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%. Lab report not attached.",
    );
  });

  it("judges each average as printed: 13.995 MPa prints as 14.00, 499.5% as 500", () => {
    const config = TENSILE_DEFAULT_CONFIG;
    expect(judgeAverage(14, config, "tensileStrength")).toBe("pass");
    expect(judgeAverage(13.995, config, "tensileStrength")).toBe("pass");
    expect(judgeAverage(13.994, config, "tensileStrength")).toBe("fail");
    expect(judgeAverage(500, config, "elongationAtBreak")).toBe("pass");
    expect(judgeAverage(499.5, config, "elongationAtBreak")).toBe("pass");
    expect(judgeAverage(499.4, config, "elongationAtBreak")).toBe("fail");
    expect(judgeAverage(null, config, "elongationAtBreak")).toBe("not_done");
  });

  it("is not done while an ordered size misses an average (6.2 rule 5)", () => {
    const output = calcTensile(
      input({ XS: PASSING, S: { tensileStrength: 32.99, elongationAtBreak: null } }, { at: context(["XS", "S", "M"]) }),
    );
    expect(output.result).toEqual({
      status: "not_done",
      summary: "Size XS: 34.18 MPa / 536%; Size S: 32.99 MPa / not entered; Size M: not entered. Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%.",
      perSize: {
        XS: { status: "pass", summary: "34.18 MPa / 536%" },
        S: { status: "not_done", summary: "32.99 MPa / not entered" },
        M: { status: "not_done", summary: "not entered" },
      },
    });
    expect(output.computed.sizes.S).toEqual({ tensileResult: "pass", elongationResult: "not_done" });
  });

  it("names only what is missing when nothing is judged yet", () => {
    expect(calcTensile(input({}, { at: context(["M"]), labReport: null })).result).toEqual({
      status: "not_done",
      summary: "Size M: not entered. Lab report not attached.",
      perSize: { M: { status: "not_done", summary: "not entered" } },
    });
  });

  it("rejects an average of 0 or less, with a link to the field", () => {
    const output = calcTensile(input({ M: { tensileStrength: 0, elongationAtBreak: -5 } }));
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "tensile_strength_not_positive",
        message: "Size M: Tensile Strength (Average) (MPa) must be more than 0, not 0.",
        size: "M",
        path: ["sizes", "M", "tensileStrength"],
      },
      {
        level: "error",
        code: "elongation_not_positive",
        message: "Size M: Elongation at break, average (%) must be more than 0, not -5.",
        size: "M",
        path: ["sizes", "M", "elongationAtBreak"],
      },
    ]);
    expect(output.result.perSize?.M).toEqual({ status: "not_done", summary: "0.00 MPa (not valid) / -5% (not valid)" });
  });

  it("writes summaries and messages in the template's wording, with its sizes, specs and standard", () => {
    const at = makeTestContext({ sizes: ["M"], templateSizes: [{ value: "M", label: "Medium" }] });
    const labels = { ...TENSILE_LABELS, specRow: "Requirement ({standardLabel})", labReport: "Laboratory report" };
    const config: TensileConfig = {
      tensileMin: 18,
      elongationMin: 650,
      standardLabel: "ASTM D3578",
      decimals: { tensileStrength: 1, elongationAtBreak: 0 },
    };
    expect(calcTensile(input({ M: { tensileStrength: 24.04, elongationAtBreak: 720 } }, { at, labels, config, labReport: null })).result).toEqual({
      status: "not_done",
      summary: "Size Medium: 24.0 MPa / 720%. Requirement (ASTM D3578) ≥ 18.0 MPa / ≥ 650%. Laboratory report not attached.",
      perSize: { M: { status: "pass", summary: "24.0 MPa / 720%" } },
    });
    expect(specText({ ...TENSILE_DEFAULT_CONFIG, standardLabel: "" }, TENSILE_LABELS)).toBe("Spec. ≥ 14.00 MPa / ≥ 500%");
    expect(specCaption("Spec.", "ASTM D6319")).toBe("Spec. (ASTM D6319)");
  });

  it("computes the dictionary's computed keys per size, and keeps the specs with them for the export", () => {
    const output = calcTensile(input({ M: PASSING }));
    expect(Object.keys(output.computed.sizes.M).sort()).toEqual(dataKeys("tensile", "computed").sort());
    expect(output.computed).toMatchObject({
      tensileMin: 14,
      elongationMin: 500,
      standardLabel: "ASTM D6319",
      decimals: { tensileStrength: 2, elongationAtBreak: 0 },
    });
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  it("says no sizes are ordered when there are none", () => {
    expect(calcTensile(input({}, { at: context([]) })).result).toEqual({
      status: "not_done",
      summary: "No sizes ordered yet.",
      perSize: {},
    });
  });

  describe("through the engine", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["tensile"]);
    const evaluate = (entry: unknown) =>
      evaluateInspection(
        { template, data: { modules: { tensile: entry }, custom: {} }, context: context(["M"]) },
        MODULE_REGISTRY,
      ).modules.find((found) => found.key === "tensile");

    it("refuses an average saved as text: invalid data, not done (6.2 rule 1)", () => {
      const evaluated = evaluate({ sizes: { M: { tensileStrength: "34 18", elongationAtBreak: 536 } }, labReport: LAB_REPORT_ID });
      expect(evaluated?.result.status).toBe("not_done");
      expect(evaluated?.issues).toEqual([
        expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", "tensileStrength"] }),
      ]);
    });

    it("warns that the module is not done while the lab report is missing, linking to it", () => {
      const evaluated = evaluate({ sizes: { M: PASSING } });
      expect(evaluated).toMatchObject({
        result: { status: "not_done", perSize: { M: { status: "pass" } } },
        issues: [
          expect.objectContaining({
            level: "warning",
            code: "module_not_done",
            message: `${TENSILE_TITLE} is not done: Size M: 34.18 MPa / 536%. Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%. Lab report not attached.`,
            path: ["labReport"],
          }),
        ],
      });
    });

    it("links the not-done issue to the first average still to enter once the lab report is in", () => {
      const evaluated = evaluate({ sizes: { M: { tensileStrength: 34.18 } }, labReport: LAB_REPORT_ID });
      expect(evaluated?.issues).toEqual([
        expect.objectContaining({ code: "module_not_done", path: ["sizes", "M", "elongationAtBreak"] }),
      ]);
    });

    it("passes once the averages are in and the lab report is attached", () => {
      expect(evaluate({ sizes: { M: PASSING }, labReport: LAB_REPORT_ID })?.result).toEqual({
        status: "pass",
        summary: "Size M: 34.18 MPa / 536%. Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%.",
        perSize: { M: { status: "pass", summary: "34.18 MPa / 536%" } },
      });
    });
  });
});
