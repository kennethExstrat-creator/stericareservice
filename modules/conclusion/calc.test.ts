import { describe, expect, it } from "vitest";
import { TEMPLATES, type TemplateCode } from "@/lib/coverage";
import type { ModuleKey, ModuleResult, ModuleStatus } from "@/lib/schemas";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  buildInspectionContext,
  evaluateInspection,
  suggestionReasons,
  worstStatus,
  type CalcInput,
  type InspectionContext,
} from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import {
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
} from "@/tests/fixtures/examples";
import { calcConclusion, conclusionReasons, moduleName } from "./calc";
import { CONCLUSION_DEFAULT_CONFIG, CONCLUSION_LABELS } from "./config";
import { definition } from "./index";
import { emptyConclusion, type ConclusionData } from "./schema";
import { addStroke, encodeStroke } from "./signature";

type Results = Partial<Record<ModuleKey, ModuleResult>>;

/** A drawn signature: two strokes, as the pad stores them. */
const SIGNED = addStroke(
  addStroke(null, encodeStroke([{ x: 40, y: 150 }, { x: 90, y: 60 }, { x: 140, y: 150 }])),
  encodeStroke([{ x: 160, y: 120 }, { x: 260, y: 110 }]),
);

const FILLED: ConclusionData = { finalResult: "pass", remark: null, date: "2025-04-12", signature: SIGNED };

function results(statuses: Readonly<Partial<Record<ModuleKey, ModuleStatus>>>): Results {
  return Object.fromEntries(Object.entries(statuses).map(([key, status]) => [key, { status, summary: "" }]));
}

function input(
  data: Partial<ConclusionData>,
  {
    moduleResults = results({ watertight: "pass" }),
    labels = CONCLUSION_LABELS,
    context = makeTestContext(),
  }: { moduleResults?: Results; labels?: Readonly<Record<string, string>>; context?: InspectionContext } = {},
): CalcInput<ConclusionData, typeof CONCLUSION_DEFAULT_CONFIG> {
  return {
    data: { ...emptyConclusion(), ...data },
    config: CONCLUSION_DEFAULT_CONFIG,
    title: "Conclusion",
    labels,
    context,
    results: moduleResults,
    hasData: true,
  };
}

/** The example's conclusion block in the module's data shape: the printed result, remark, date, signature. */
function conclusionOf(example: ExampleReport): ConclusionData {
  const { conclusion } = example;
  return {
    finalResult: conclusion.printedResult === "PASSED" ? "pass" : "fail",
    remark: conclusion.remark,
    date: conclusion.date.iso,
    signature: conclusion.signed ? SIGNED : null,
  };
}

/** Every module of a seed template except the conclusion, in template order, with the given statuses. */
function templateResults(code: TemplateCode, statuses: Readonly<Partial<Record<ModuleKey, ModuleStatus>>>): Results {
  const keys = TEMPLATES[code].modules.map((entry) => entry.key).filter((key) => key !== "conclusion");
  const missing = keys.filter((key) => statuses[key] === undefined);
  if (missing.length > 0) throw new Error(`No status for ${missing.join(", ")}`);
  return results(Object.fromEntries(keys.map((key) => [key, statuses[key]])));
}

/** B. STD_EG: the module results docs/examples/expected-results.md gives, before or after the carton fixes. */
function stdEgResults({ cartonsFixed }: { cartonsFixed: boolean }): Results {
  const expected = STD_EG_EXPECTED;
  return templateResults("STD_EG", {
    // Records without a verdict (BUILD_SPEC 6.1).
    header: "info",
    glove_info: "info",
    order_lots: "info",
    packing_config: "info",
    sampling_plan: expected.sampling.M!.belowPlan ? "warn" : "pass",
    // Fails on the duplicate carton (6.2 rule 6) until it is corrected.
    carton_sampling: cartonsFixed ? "pass" : expected.cartonList.status,
    dimensions: expected.dimensions.M!.status,
    force_at_break: expected.forceAtBreak.M!.status,
    weight: expected.weight.M!.status,
    watertight: expected.watertight.M!.status,
    visual: worstStatus([expected.visual.critical.M!.status, expected.visual.major.M!.status, expected.visual.minor.M!.status]),
    dispensing_packing: expected.dispensing.M!.status,
    labeling: expected.labeling.M!.status,
  });
}

/** A. SAFEDON_EG: every size passes; the sampling plan warns with level I set (below plan). */
function safedonResults(): Results {
  const expected = SAFEDON_EG_EXPECTED;
  const sizes = SAFEDON_EG_EXAMPLE.sizesOrdered;
  const worst = (statusOf: (size: (typeof sizes)[number]) => ModuleStatus) => worstStatus(sizes.map(statusOf));
  return templateResults("SAFEDON_EG", {
    header: "info",
    glove_info: "info",
    order_lots: "info",
    packing_config: "info",
    sampling_plan: sizes.some((size) => expected.sampling[size]!.belowPlan) ? "warn" : "pass",
    carton_sampling: "pass",
    dimensions: worst((size) => expected.dimensions[size]!.status),
    tensile: worst((size) => expected.tensile[size]!.status),
    weight: "info",
    watertight: worst((size) => expected.watertight[size]!.status),
    visual: worst((size) =>
      worstStatus([expected.visual.critical[size]!.status, expected.visual.major[size]!.status, expected.visual.minor[size]!.status]),
    ),
    dispensing_safedon: worst((size) => expected.dispensing[size]!.status),
    labeling: worst((size) => expected.labeling[size]!.status),
  });
}

describe("conclusion", () => {
  it("satisfies the module contract, runs last and holds submit until it is done", () => {
    expect(checkModuleContract(definition)).toEqual([]);
    expect(definition.dependsOn).toBe("all");
    expect(definition.requiredForSubmit).toBe(true);
    expect(definition.perSize).toBe(false);
  });

  describe("example reports (docs/examples/expected-results.md)", () => {
    it("B. STD_EG: suggests fail while the carton list fails, and flags the PASSED the report printed", () => {
      const data = conclusionOf(STD_EG_EXAMPLE);
      const context = makeTestContext({
        header: { ...makeTestContext().header, inspectionDate: STD_EG_EXAMPLE.header.inspectionDate.iso },
      });
      const output = calcConclusion(input(data, { moduleResults: stdEgResults({ cartonsFixed: false }), context }));
      expect(output.computed).toEqual({ suggestedResult: "fail", failed: ["carton_sampling"], notDone: [], warned: ["weight"] });
      // The inspector decides: the result is the final result, with a warning for the reviewer.
      expect(output.result).toEqual({
        status: "pass",
        summary: "Conclusion: PASSED. Suggested Result: FAILED (failed: Carton sampling).",
      });
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "final_result_differs",
          message: "Conclusion PASSED differs from the suggestion, FAILED (failed: Carton sampling). Explain why under Remark.",
          // Its link lands in the remark, where the reason goes.
          path: ["remark"],
        },
      ]);
    });

    it("B. STD_EG: pass once the carton errors are fixed, with the weight warning listed", () => {
      const expected = STD_EG_EXPECTED.conclusion;
      expect(expected.condition).toBe("once the carton errors are fixed");
      const data = conclusionOf(STD_EG_EXAMPLE);
      const output = calcConclusion(input(data, { moduleResults: stdEgResults({ cartonsFixed: true }) }));
      expect(output.computed.suggestedResult).toBe(expected.result);
      expect(output.computed.warned).toEqual(["weight"]);
      expect(output.result).toEqual({
        status: expected.result,
        summary: "Conclusion: PASSED. Suggested Result: PASSED (warnings: Weight).",
      });
      expect(output.issues).toEqual([]);
    });

    it("A. SAFEDON_EG: pass, with the sampling notice listed as a warning", () => {
      const expected = SAFEDON_EG_EXPECTED.conclusion;
      const data = conclusionOf(SAFEDON_EG_EXAMPLE);
      const context = makeTestContext({
        header: { ...makeTestContext().header, inspectionDate: SAFEDON_EG_EXAMPLE.header.inspectionDate.iso },
      });
      const output = calcConclusion(input(data, { moduleResults: safedonResults(), context }));
      expect(output.computed).toEqual({ suggestedResult: expected.result, failed: [], notDone: [], warned: ["sampling_plan"] });
      expect(output.result).toEqual({
        status: expected.result,
        summary: "Conclusion: PASSED. Suggested Result: PASSED (warnings: Sampling plan).",
      });
      expect(output.issues).toEqual([]);
    });
  });

  describe("not done until the final result and the date are there", () => {
    it("is not done with nothing chosen, showing the suggestion", () => {
      expect(calcConclusion(input({})).result).toEqual({
        status: "not_done",
        summary: "Missing: Conclusion, Date. Suggested Result: PASSED.",
      });
    });

    it("is not done without a date, which the screen fills in when the result is chosen", () => {
      expect(calcConclusion(input({ finalResult: "pass" })).result).toEqual({
        status: "not_done",
        summary: "Missing: Date. Suggested Result: PASSED.",
      });
    });

    it("does not need the signature yet (BUILD_SPEC 13), but says it is missing", () => {
      expect(calcConclusion(input({ ...FILLED, signature: null })).result).toEqual({
        status: "pass",
        summary: "Conclusion: PASSED. Suggested Result: PASSED. Not signed.",
      });
    });
  });

  describe("the status is the final result as chosen", () => {
    it.each([
      ["pass", "pass", "PASSED"],
      ["fail", "fail", "FAILED"],
      ["hold", "warn", "HOLD"],
    ] as const)("%s gives %s", (finalResult, status, word) => {
      const output = calcConclusion(input({ ...FILLED, finalResult }, { moduleResults: results({ watertight: finalResult === "hold" ? "not_done" : finalResult }) }));
      expect(output.result.status).toBe(status);
      expect(output.result.summary.startsWith(`Conclusion: ${word}.`)).toBe(true);
      expect(output.issues).toEqual([]);
    });
  });

  describe("the suggested result, from every included module's result", () => {
    const suggestionOf = (statuses: Readonly<Partial<Record<ModuleKey, ModuleStatus>>>) =>
      calcConclusion(input({}, { moduleResults: results(statuses) })).computed;

    it("fails when any module failed", () => {
      expect(suggestionOf({ watertight: "pass", visual: "fail", weight: "not_done" })).toEqual({
        suggestedResult: "fail",
        failed: ["visual"],
        notDone: ["weight"],
        warned: [],
      });
    });

    it("holds while any module is not done (never a pass on missing data)", () => {
      expect(suggestionOf({ watertight: "pass", weight: "not_done" }).suggestedResult).toBe("hold");
    });

    it("holds when no module gave a verdict", () => {
      expect(suggestionOf({ header: "info", glove_info: "info" }).suggestedResult).toBe("hold");
      expect(suggestionOf({}).suggestedResult).toBe("hold");
      expect(calcConclusion(input({}, { moduleResults: {} })).result.summary).toBe(
        "Missing: Conclusion, Date. Suggested Result: HOLD (no module has a result yet).",
      );
    });

    it("passes with warnings listed", () => {
      expect(suggestionOf({ header: "info", weight: "warn", watertight: "pass" })).toEqual({
        suggestedResult: "pass",
        failed: [],
        notDone: [],
        warned: ["weight"],
      });
    });

    it("names modules by their titles in the template's wording (6.2 rule 11)", () => {
      const context = makeTestContext({
        modules: [
          { key: "carton_sampling", title: "Finished Goods Sampling Information (Carton Number)" },
          { key: "dispensing_packing", title: "Glove Packing Check" },
          { key: "conclusion", title: "Conclusion" },
        ],
      });
      const output = calcConclusion(
        input({}, { context, moduleResults: results({ carton_sampling: "fail", dispensing_packing: "warn" }) }),
      );
      expect(output.result.summary).toBe(
        "Missing: Conclusion, Date. Suggested Result: FAILED (failed: Finished Goods Sampling Information (Carton Number)).",
      );
      const warned = calcConclusion(input({ ...FILLED, finalResult: "fail" }, { context, moduleResults: results({ dispensing_packing: "warn" }) }));
      expect(warned.result.summary).toBe("Conclusion: FAILED. Suggested Result: PASSED (warnings: Glove Packing Check).");
    });

    it("names a module the context does not list by its key in words", () => {
      expect(moduleName("carton_sampling")).toBe("Carton sampling");
      expect(moduleName("force_at_break")).toBe("Force at break");
      expect(calcConclusion(input({}, { moduleResults: results({ visual: "fail" }) })).result.summary).toBe(
        "Missing: Conclusion, Date. Suggested Result: FAILED (failed: Visual).",
      );
    });
  });

  describe("a final result that differs from the suggestion: a warning, never an error", () => {
    it.each([
      ["pass", { visual: "fail" }, "Conclusion PASSED differs from the suggestion, FAILED (failed: Visual)."],
      ["pass", { weight: "not_done" }, "Conclusion PASSED differs from the suggestion, HOLD (not done: Weight)."],
      ["fail", { visual: "pass" }, "Conclusion FAILED differs from the suggestion, PASSED."],
      ["hold", { visual: "pass", weight: "warn" }, "Conclusion HOLD differs from the suggestion, PASSED."],
      ["hold", { visual: "fail" }, "Conclusion HOLD differs from the suggestion, FAILED (failed: Visual)."],
    ] as const)("%s against %j", (finalResult, statuses, message) => {
      const output = calcConclusion(
        input({ ...FILLED, finalResult, remark: "Agreed with the factory." }, { moduleResults: results(statuses) }),
      );
      expect(output.issues).toEqual([{ level: "warning", code: "final_result_differs", message, path: ["remark"] }]);
    });

    it("asks for the reason under the remark while the remark is blank", () => {
      const output = calcConclusion(input({ ...FILLED, remark: "  " }, { moduleResults: results({ visual: "fail" }) }));
      expect(output.issues[0].message).toBe(
        "Conclusion PASSED differs from the suggestion, FAILED (failed: Visual). Explain why under Remark.",
      );
    });

    it("says nothing when they agree, or before a final result is chosen", () => {
      expect(calcConclusion(input(FILLED)).issues).toEqual([]);
      expect(calcConclusion(input({}, { moduleResults: results({ visual: "fail" }) })).issues).toEqual([]);
    });
  });

  it("warns when the date is before the inspection date", () => {
    const context = makeTestContext({ header: { ...makeTestContext().header, inspectionDate: "2025-04-11" } });
    expect(calcConclusion(input({ ...FILLED, date: "2025-04-10" }, { context })).issues).toEqual([
      {
        level: "warning",
        code: "date_before_inspection",
        message: "Date 2025-04-10 is before the inspection date, 2025-04-11.",
        path: ["date"],
      },
    ]);
    expect(calcConclusion(input({ ...FILLED, date: "2025-04-11" }, { context })).issues).toEqual([]);
  });

  it("speaks the template's words for the results and fields (6.2 rule 11)", () => {
    const labels = { ...CONCLUSION_LABELS, finalResult: "Final result", pass: "ACCEPTED", fail: "REJECTED", date: "Report date" };
    expect(calcConclusion(input({ finalResult: "pass" }, { labels })).result.summary).toBe(
      "Missing: Report date. Suggested Result: ACCEPTED.",
    );
    const output = calcConclusion(input({ ...FILLED, remark: "x" }, { labels, moduleResults: results({ visual: "fail" }) }));
    expect(output.issues[0].message).toBe("Final result ACCEPTED differs from the suggestion, REJECTED (failed: Visual).");
  });

  describe("through the engine, with the labelling module", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "header", include: false }, "labeling"]);
    const context = makeTestContext({ sizes: ["M"] });
    const labeling = (defects: Record<string, number> = {}) => ({
      sizes: { M: { inner: { inspected: 3, defects }, carton: { inspected: 1 } } },
    });
    const evaluate = (modules: Record<string, unknown>) =>
      evaluateInspection({ template, data: { modules, custom: {} }, context }, MODULE_REGISTRY);
    const conclusionOfEvaluation = (evaluation: ReturnType<typeof evaluate>) =>
      evaluation.modules.find((entry) => entry.key === "conclusion")!;

    it("runs last and suggests what the inspection suggests", () => {
      const evaluation = evaluate({ labeling: labeling(), conclusion: FILLED });
      expect(evaluation.modules.map((entry) => entry.key)).toEqual(["labeling", "conclusion"]);
      const conclusion = conclusionOfEvaluation(evaluation);
      expect(conclusion.computed).toMatchObject({ suggestedResult: evaluation.suggested.result });
      expect(conclusion.result).toEqual({ status: "pass", summary: "Conclusion: PASSED. Suggested Result: PASSED." });
      expect(evaluation.issues).toEqual([]);
    });

    it("names the modules by the titles the context built from the template carries", () => {
      const titled = makeTestTemplate(MODULE_REGISTRY, [
        { key: "header", include: false },
        { key: "labeling", title: "Packaging Labeling Inspection (client wording)" },
      ]);
      const data = { modules: { labeling: labeling({ lot_no: 1 }) }, custom: {} };
      const built = buildInspectionContext({ template: titled, data, meta: { inspector: TEST_INSPECTOR } }, MODULE_REGISTRY);
      expect(built.modules).toEqual([
        { key: "labeling", title: "Packaging Labeling Inspection (client wording)" },
        { key: "conclusion", title: "Conclusion" },
      ]);
      // No order_lots in this template: size M as the other engine tests order it.
      const evaluation = evaluateInspection({ template: titled, data, context: { ...built, sizes: ["M"] } }, MODULE_REGISTRY);
      expect(conclusionOfEvaluation(evaluation).result.summary).toBe(
        "Missing: Conclusion, Date. Suggested Result: FAILED (failed: Packaging Labeling Inspection (client wording)).",
      );
    });

    it("blocks submit until the final result is chosen: its not done is an error that links to the choice", () => {
      const evaluation = evaluate({ labeling: labeling() });
      expect(conclusionOfEvaluation(evaluation).issues).toEqual([
        {
          moduleKey: "conclusion",
          level: "error",
          code: "module_not_done",
          message: "Conclusion must be complete before submit: Missing: Conclusion, Date. Suggested Result: PASSED.",
          path: ["finalResult"],
        },
      ]);
    });

    it("links the blocking issue to the date once the result is chosen", () => {
      const evaluation = evaluate({ labeling: labeling(), conclusion: { ...FILLED, date: null } });
      expect(conclusionOfEvaluation(evaluation).issues).toEqual([
        expect.objectContaining({ code: "module_not_done", level: "error", path: ["date"] }),
      ]);
    });

    it("follows a failing module into the suggestion, and lets the inspector's choice stand", () => {
      const evaluation = evaluate({ labeling: labeling({ lot_no: 1 }), conclusion: { ...FILLED, finalResult: "fail" } });
      const conclusion = conclusionOfEvaluation(evaluation);
      expect(evaluation.suggested.result).toBe("fail");
      expect(conclusion.computed).toEqual({ suggestedResult: "fail", failed: ["labeling"], notDone: [], warned: [] });
      expect(conclusion.result.status).toBe("fail");
      expect(conclusion.issues).toEqual([]);
    });

    it("never stores the inspector, who comes from the inspection (6.2 rule 11)", () => {
      expect(context.inspection.inspector).toEqual(TEST_INSPECTOR);
      const evaluation = evaluate({ labeling: labeling(), conclusion: { ...FILLED, inspector: "Someone else" } });
      expect(conclusionOfEvaluation(evaluation).issues.map((issue) => issue.code)).toContain("invalid_data");
    });
  });
});

describe("conclusionReasons (the Conclusion section's line under its suggestion)", () => {
  const TITLES: Partial<Record<ModuleKey, string>> = {
    visual: "Visual Inspection",
    labeling: "Packaging Labeling Inspection",
    weight: "Weight (g) - Average of 13 Gloves per Size",
    sampling_plan: "Sampling Plan",
    dimensions: "Dimension",
    // A colon in a title: the count keeps the reason's own words before it.
    watertight: "Freedom From Holes: Watertight Test",
  };
  const titleOf = (key: ModuleKey) => TITLES[key] ?? key;
  const MIXED: Parameters<typeof conclusionReasons>[0] = {
    result: "fail",
    failed: ["visual", "labeling"],
    notDone: ["weight"],
    warned: ["sampling_plan", "watertight", "dimensions"],
  };

  it("names a reason's one section", () => {
    expect(conclusionReasons({ result: "fail", failed: ["labeling"], notDone: [], warned: [] }, titleOf)).toEqual([
      { full: "Failed: Packaging Labeling Inspection.", brief: "Failed: Packaging Labeling Inspection.", counted: false },
    ]);
  });

  it("counts two or more sections, a reason at a time", () => {
    const reasons = conclusionReasons(MIXED, titleOf);
    expect(reasons.map((reason) => reason.brief)).toEqual([
      "Failed: 2 sections.",
      "Not done: Weight (g) - Average of 13 Gloves per Size.",
      "Warnings: 3 sections.",
    ]);
    expect(reasons.map((reason) => reason.counted)).toEqual([true, false, true]);
  });

  it("keeps every full line word for word as suggestionReasons, which the submit dialog and the review show", () => {
    expect(conclusionReasons(MIXED, titleOf).map((reason) => reason.full)).toEqual(suggestionReasons(MIXED, titleOf));
    expect(conclusionReasons(MIXED, titleOf)[2].full).toBe("Warnings: Sampling Plan, Freedom From Holes: Watertight Test, Dimension.");
  });

  it("gives nothing for a clean pass, and never counts that nothing has a result yet", () => {
    expect(conclusionReasons({ result: "pass", failed: [], notDone: [], warned: [] }, titleOf)).toEqual([]);
    expect(conclusionReasons({ result: "hold", failed: [], notDone: [], warned: [] }, titleOf)).toEqual([
      { full: "No module has a result yet.", brief: "No module has a result yet.", counted: false },
    ]);
  });
});
