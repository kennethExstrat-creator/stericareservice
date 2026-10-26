// Phase 2 acceptance (BUILD_SPEC 12), part B of docs/examples/expected-results.md:
// the STD_EG example entered as a whole inspection on the seed template STD_EG
// and evaluated by every module, as the capture screen, submit, the review
// and the export do. Every row of the expected results is checked against
// tests/fixtures/examples/expected.ts (placeholders for cartons and boxes):
// the per-size results, the computed values, the corrected values, the two
// validation errors the original report missed, and the suggested result.
import { describe, expect, it } from "vitest";
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import { stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import { captureSections, findSection } from "@/lib/inspections/capture/sections";
import { applyModuleOverrides } from "@/lib/templates";
import { labelFor, moduleTitle, suggestionReasons } from "@/modules/_framework";
import type { SamplingPlanData } from "@/modules/sampling_plan/schema";
import { STD_EG_EXAMPLE as REPORT, STD_EG_EXPECTED as EXPECTED, type VisualClass } from "@/tests/fixtures/examples";
import { FIXTURE_MEASURE } from "@/modules/dimensions/__fixtures__/examples";
import { computedAt, evaluate, evaluateStdEg, inspectionMeta, seedTemplate, stdEgData } from "./examples";

const original = evaluateStdEg();
const corrected = evaluateStdEg({ corrected: true });
const CLASSES: readonly VisualClass[] = ["critical", "major", "minor"];

/** Per-size modules of the template, and the sizes each one reports on. */
function reportedSizes(evaluation: ReturnType<typeof evaluateStdEg>) {
  return evaluation.report.modules
    .filter((entry) => entry.result.perSize !== undefined)
    .map((entry) => ({ key: entry.key, sizes: Object.keys(entry.result.perSize ?? {}) }));
}

describe("STD_EG example as a whole inspection (expected results B)", () => {
  it("runs on the seed template STD_EG with every module of the report, in report order", () => {
    expect(original.template.code).toBe("STD_EG");
    expect(original.report.modules.map((entry) => entry.key)).toEqual([
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "dimensions",
      "force_at_break",
      "weight",
      "watertight",
      "visual",
      "dispensing_packing",
      "labeling",
      "conclusion",
    ]);
    // Nothing is broken: every module read its data and config and calculated.
    const broken = ["invalid_data", "invalid_config", "calc_failed", "contribute_failed", "invalid_output"];
    expect(original.report.issues.filter((issue) => broken.includes(issue.code))).toEqual([]);
  });

  it("Totals: 2,900 cartons, 5,800,000 gloves", () => {
    const order = original.module("order_lots");
    expect(order.result.status).toBe("info");
    expect(computedAt(order, "totalCartons")).toBe(EXPECTED.totals.cartons);
    expect(computedAt(order, "totalGloves")).toBe(EXPECTED.totals.gloves);
    expect(original.context.sizes).toEqual(REPORT.sizesOrdered);
  });

  it("Carton list: the carton entered twice is an error that blocks submit until fixed", () => {
    const { size, entries, unique, duplicate, status } = EXPECTED.cartonList;
    const cartons = original.module("carton_sampling");
    expect(cartons.result.status).toBe(status);
    expect(cartons.result.perSize?.[size]?.status).toBe(status);
    expect(computedAt(cartons, "sizes", size)).toMatchObject({ samplingQuantity: entries, unique });

    const error = original.report.errors.find((issue) => issue.code === "carton_duplicate");
    const second = (duplicate.cells[1].row - 1) * 10 + (duplicate.cells[1].column - 1);
    expect(error).toMatchObject({ moduleKey: "carton_sampling", size, path: ["sizes", size, "cartonNumbers", second] });
    expect(error?.message).toContain(EXPECTED.errors.find((issue) => issue.code === "carton_duplicate")?.message);
    expect(original.report.canSubmit).toBe(false);

    // Fixed: 50 unique cartons, the module passes and the error is gone.
    const fixed = corrected.module("carton_sampling");
    expect(fixed.result.status).toBe("pass");
    expect(computedAt(fixed, "sizes", size)).toMatchObject({ samplingQuantity: entries, unique: entries });
    expect(corrected.report.errors.filter((issue) => issue.moduleKey === "carton_sampling")).toEqual([]);
  });

  it("Dispensing box 2336, in no carton list: stored as typed, a warning linked to its cell, the packing check passes (6.2 rule 7)", () => {
    const { size, item, box, validation } = EXPECTED.dispensingBox;
    expect(validation).toBe("warning");
    // Box # and carton # are one number (Kenneth, 13 October 2026): 2336 is not among size M's sampled ones.
    expect(original.context.cartons[size]).not.toContain(box);
    const packing = original.module("dispensing_packing");
    expect((packing.data as { sizes: Record<string, { boxes: { boxNo: number | null }[] }> }).sizes[size].boxes[item - 1].boxNo).toBe(box);
    const expected = EXPECTED.warnings.find((issue) => issue.module === "dispensing_packing");
    expect(original.report.issues.filter((issue) => issue.moduleKey === "dispensing_packing")).toEqual([
      {
        moduleKey: "dispensing_packing",
        level: "warning",
        code: expected?.code,
        message: expected?.message,
        size,
        path: ["sizes", size, "boxes", item - 1, "boxNo"],
      },
    ]);
    // A warning never blocks submit nor decides the result.
    expect(packing.result.status).toBe(EXPECTED.dispensing[size]?.status);
    expect(corrected.report.errors.filter((issue) => issue.moduleKey === "dispensing_packing")).toEqual([]);
  });

  it("Watertight M: n 500 is code N, limit 14 / 15, 1 hole (finger), pass", () => {
    const watertight = corrected.module("watertight");
    for (const [size, expected] of Object.entries(EXPECTED.watertight)) {
      expect(computedAt(watertight, "sizes", size)).toMatchObject({
        tested: expected.n,
        codeLetter: expected.codeLetter,
        usedLetter: expected.codeLetter,
        accept: expected.accept,
        reject: expected.reject,
        totalDefects: expected.found,
        result: expected.status,
      });
      const holes = computedAt(watertight, "sizes", size, "holes") as Record<string, number>;
      expect(Object.fromEntries(Object.entries(holes).filter(([, count]) => count > 0))).toEqual(expected.byLocation);
      expect(watertight.result.perSize?.[size]?.status).toBe(expected.status);
    }
    expect(computedAt(watertight, "aql")).toBe(1.5);
    // The heading names the sample's code letter, not the report's "K, L & M".
    expect(computedAt(watertight, "heading")).toBe("Freedom From Holes by Watertight Test (Single Sampling Code Letter N, AQL 1.5)");
  });

  it.each(CLASSES)("Visual %s M: the limits of code N at the class's AQL (minor follows the arrow up to M)", (cls) => {
    const visual = corrected.module("visual");
    for (const [size, expected] of Object.entries(EXPECTED.visual[cls])) {
      expect(computedAt(visual, "sizes", size, cls)).toMatchObject({
        inspected: expected.n,
        codeLetter: expected.codeLetter,
        usedLetter: expected.arrow?.codeLetter ?? expected.codeLetter,
        n: expected.arrow?.n ?? expected.n,
        arrow: expected.arrow?.direction ?? null,
        accept: expected.accept,
        reject: expected.reject,
        total: expected.found,
        result: expected.status,
      });
      const counts = computedAt(visual, "sizes", size, cls, "counts") as Record<string, number>;
      expect(Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0))).toEqual(expected.byDefect);
      expect(computedAt(visual, "classes", cls, "aql")).toBe(expected.aql);
    }
  });

  it("Visual M: the size passes, and the critical result is labelled as critical, not 'Visual Minor'", () => {
    const visual = corrected.module("visual");
    expect(visual.result.perSize?.M?.status).toBe("pass");
    expect(labelFor(visual.labels, "criticalResult")).toBe("Disposition - Visual Critical (Passed / Failed)");
    expect(computedAt(visual, "heading")).toBe("Visual Inspection (Single Sampling Code Letter N)");
  });

  it("Dimension medians M: 245, 95, 0.09, 0.05, 0.04; length and width pass, and thickness with no spec (NA) passes too", () => {
    const dimensions = corrected.module("dimensions");
    for (const [size, expected] of Object.entries(EXPECTED.dimensions)) {
      for (const [measure, median] of Object.entries(expected.median)) {
        const key = FIXTURE_MEASURE[measure as keyof typeof FIXTURE_MEASURE];
        expect(computedAt(dimensions, "statistic", size, key), `${size} ${measure}`).toBe(median);
        // No spec means Passed once the readings are complete, as the report prints it (Kenneth, 26 October 2026).
        const verdict = expected.perMeasure[measure as keyof typeof expected.perMeasure];
        expect(computedAt(dimensions, "measureResult", size, key), `${size} ${measure}`).toBe(verdict === "na" ? "pass" : verdict);
      }
      for (const [measure, spec] of Object.entries(expected.spec)) {
        const key = FIXTURE_MEASURE[measure as keyof typeof FIXTURE_MEASURE];
        expect(computedAt(dimensions, "spec", size, key)).toEqual(spec);
      }
      expect(dimensions.result.perSize?.[size]?.status).toBe(expected.status);
    }
    expect(computedAt(dimensions, "statisticKind")).toBe("median");
  });

  it("Force at break M: median 6.537 N, pass at 6 N or more", () => {
    const force = corrected.module("force_at_break");
    for (const [size, expected] of Object.entries(EXPECTED.forceAtBreak)) {
      expect(computedAt(force, "sizes", size)).toMatchObject({ n: 13, entered: 13, median: expected.medianN, result: expected.status });
      expect(force.result.perSize?.[size]?.status).toBe(expected.status);
    }
    expect(computedAt(force, "specMin")).toBe(EXPECTED.forceAtBreak.M?.minN);
  });

  it("Weight M: average 2.9 g against the indicative 3.5 g is a warning, 17.1% below (threshold 10%)", () => {
    const weight = corrected.module("weight");
    for (const [size, expected] of Object.entries(EXPECTED.weight)) {
      expect(computedAt(weight, "shown", size)).toBe(expected.averageG);
      expect(computedAt(weight, "deviationPct", size)).toBe(expected.deviationPct);
      expect(computedAt(weight, "indicative")).toEqual({ grams: expected.indicativeG, size });
      expect(computedAt(weight, "warnThresholdPct")).toBe(expected.thresholdPct);
      expect(weight.result.perSize?.[size]?.status).toBe(expected.status);
    }
    const warning = EXPECTED.warnings.find((issue) => issue.code === "weight_deviation");
    expect(corrected.report.warnings.find((issue) => issue.code === "weight_deviation")).toMatchObject({
      moduleKey: "weight",
      size: warning?.size,
      message: warning?.message,
    });
  });

  it("Dispensing M: layering 88.3%, dispensing 90.3%, stickiness A on all 13 boxes, pass (≥ 70%, ≥ 80%)", () => {
    const dispensing = corrected.module("dispensing_packing");
    for (const [size, expected] of Object.entries(EXPECTED.dispensing)) {
      const computed = computedAt(dispensing, "sizes", size) as Record<string, unknown>;
      expect(Number((computed.layeringAverage as number).toFixed(1))).toBe(expected.layeringAvgPct);
      expect(Number((computed.dispensingAverage as number).toFixed(1))).toBe(expected.dispensingAvgPct);
      expect(computed.stickinessCounts).toEqual(expected.stickiness);
      expect(computed).toMatchObject({
        boxesExpected: 13,
        boxesTested: 13,
        boxesComplete: 13,
        layeringResult: "pass",
        dispensingResult: "pass",
        stickinessResult: "pass",
      });
      expect(dispensing.result.perSize?.[size]?.status).toBe(expected.status);
      expect(dispensing.result.perSize?.[size]?.summary).toContain(`Layering ${expected.layeringAvgPct}% (min. ${expected.minLayeringPct}%)`);
      expect(dispensing.result.perSize?.[size]?.summary).toContain(`Dispensing ${expected.dispensingAvgPct}% (min. ${expected.minDispensingPct}%)`);
    }
  });

  it("Labelling M: 3 dispenser boxes and 1 carton inspected, 0 defects, Accept 0 / Reject 1, pass", () => {
    const labeling = corrected.module("labeling");
    const data = labeling.data as { sizes: Record<string, { inner: { inspected: number }; carton: { inspected: number } }> };
    for (const [size, expected] of Object.entries(EXPECTED.labeling)) {
      expect(data.sizes[size].inner.inspected).toBe(expected.inner.n);
      expect(data.sizes[size].carton.inspected).toBe(expected.carton.n);
      expect(computedAt(labeling, "sizes", size, "inner")).toEqual({ accept: 0, reject: 1, total: expected.inner.defects, result: "pass" });
      expect(computedAt(labeling, "sizes", size, "carton")).toEqual({ accept: 0, reject: 1, total: expected.carton.defects, result: "pass" });
      expect(labeling.result.perSize?.[size]?.status).toBe(expected.status);
    }
    // The report labels the carton result "Inner Box" [sic]: the app says Carton Box.
    expect(labelFor(labeling.labels, "cartonResult")).toBe("Disposition - Carton Box (Passed / Failed)");
  });

  it("Sizes not ordered (XS, S, L, XL): no tables, no results", () => {
    for (const { key, sizes } of reportedSizes(original)) expect(sizes, key).toEqual(["M"]);
    for (const size of EXPECTED.unorderedSizes.sizes) {
      expect(original.context.sizes).not.toContain(size);
      for (const entry of original.report.modules) {
        expect(computedAt(entry, "sizes", size), `${entry.key} ${size}`).toBeUndefined();
      }
    }
  });

  it("Inspector: recorded automatically from the inspection, never typed", () => {
    expect(original.context.inspection.inspector?.name).toBe("Inspector A");
    expect(computedAt(original.module("header"), "inspector")).toBe("Inspector A");
    expect(original.report.issues.filter((issue) => issue.code === "inspector_missing")).toEqual([]);
    // Without one the inspection cannot be submitted (6.2 rule 11).
    const nobody = evaluate(seedTemplate("STD_EG"), stdEgData({ corrected: true }), {
      ...inspectionMeta(REPORT),
      inspector: null,
    });
    expect(nobody.report.errors.map((issue) => issue.code)).toEqual(["inspector_missing"]);
  });

  it("Product code: one value, entered once and used everywhere", () => {
    expect(original.context.header.productCode).toBe(EXPECTED.productCode.code);
    expect((original.module("header").data as { productCode: string }).productCode).toBe(EXPECTED.productCode.code);
    expect(EXPECTED.productCode.code).not.toBe(REPORT.header.productCodeElsewhere?.code);
  });

  it("Sampling: the 500 gloves meet inspection level I (code N), so there is no notice", () => {
    const sampling = original.module("sampling_plan");
    for (const [size, expected] of Object.entries(EXPECTED.sampling)) {
      expect(computedAt(sampling, "sizes", size)).toMatchObject({
        lotSizeGloves: expected.lotGloves,
        codeLetter: expected.codeLetter,
        planSampleSize: expected.required,
        belowPlan: expected.belowPlan,
      });
    }
    expect(computedAt(sampling, "inspectionLevel")).toBe("I");
    // The lot check uses the AQLs the template's watertight and visual apply (AQL_SOURCES).
    expect(original.context.aql).toEqual({ watertight: 1.5, critical: 0, major: 2.5, minor: 4, inspectionLevel: "I" });
    expect(sampling.result.status).toBe("info");
    expect(original.report.issues.filter((issue) => issue.moduleKey === "sampling_plan")).toEqual([]);
  });

  it("finds exactly the error of the expected results, which blocks submit", () => {
    expect(original.report.errors.map((issue) => [issue.moduleKey, issue.code, issue.size])).toEqual(
      EXPECTED.errors.map((issue) => [issue.module, issue.code, issue.size]),
    );
    expect(original.report.canSubmit).toBe(false);
    // The weight warning, box 2336 not sampled for size M, and the inspector's PASSED against a suggestion of fail.
    expect(original.report.warnings.map((issue) => [issue.moduleKey, issue.code])).toEqual([
      ["weight", "weight_deviation"],
      ["dispensing_packing", "box_not_in_carton_list"],
      ["conclusion", "final_result_differs"],
    ]);
  });

  it("Conclusion: fail while the carton error stands; pass once the errors are fixed", () => {
    expect(original.report.suggested).toMatchObject({ result: "fail", failed: ["carton_sampling"], notDone: [] });
    expect(computedAt(original.module("conclusion"), "suggestedResult")).toBe("fail");

    expect(corrected.report.suggested).toMatchObject({ result: EXPECTED.conclusion.result, failed: [], notDone: [], warned: ["weight"] });
    expect(computedAt(corrected.module("conclusion"), "suggestedResult")).toBe(EXPECTED.conclusion.result);
    expect(corrected.report.errors).toEqual([]);
    expect(corrected.report.canSubmit).toBe(true);
    // Only the warning of the expected results is left, and it goes into the export.
    expect(corrected.report.warnings.map((issue) => [issue.moduleKey, issue.code, issue.size])).toEqual(
      EXPECTED.warnings.map((issue) => [issue.module, issue.code, issue.size]),
    );
    // Every module the suggestion counts gave a verdict or a record: nothing is left not done.
    expect(corrected.report.modules.filter((entry) => entry.result.status === "not_done")).toEqual([]);
  });

  it("drops a module switched off for this inspection from validation and the report", () => {
    const template = applyModuleOverrides(seedTemplate("STD_EG"), {
      dispensing_packing: { reason: "Dispensing check done at the warehouse", by: "00000000-0000-4000-8000-000000000102", at: "2026-10-07T08:00:00.000Z" },
    });
    const switchedOff = evaluate(template, stdEgData(), inspectionMeta(REPORT));
    expect(switchedOff.report.modules.map((entry) => entry.key)).not.toContain("dispensing_packing");
    expect(switchedOff.report.excluded).toEqual([
      { key: "dispensing_packing", title: original.module("dispensing_packing").title, reason: "Dispensing check done at the warehouse" },
    ]);
    expect(switchedOff.report.errors.map((issue) => issue.code)).toEqual(["carton_duplicate"]);
  });
});

describe("a count in a title follows the inspection: 12 gloves for weight (Kenneth, 12 October 2026)", () => {
  // The corrected example with the sampling plan's # Gloves for Weight at 12 for size M, and 11 gloves weighed.
  // Weight has its own count, never the dimension's: "each metrics and measurement should have their own number of glove count".
  const STORED = "Weight (g) - Average of 13 Gloves per Size";
  const SHOWN = "Weight (g) - Average of 12 Gloves per Size";
  const fixed = stdEgData({ corrected: true });
  const plan = fixed.modules.sampling_plan as SamplingPlanData;
  const withPlanM = (row: Partial<SamplingPlanData["sizes"][string]>) => ({
    ...fixed,
    modules: {
      ...fixed.modules,
      sampling_plan: { ...plan, sizes: { ...plan.sizes, M: { ...plan.sizes.M!, ...row } } },
      weight: { sizes: { M: { values: Array.from({ length: 11 }, () => REPORT.weight.M!.averageG) } } },
    },
  });
  const data = withPlanM({ glovesWeight: 12 });
  const twelve = evaluate(seedTemplate("STD_EG"), data, inspectionMeta(REPORT));

  it("keeps weight at its own 13 when only the gloves for dimension are 12", () => {
    const dimensionOnly = evaluate(seedTemplate("STD_EG"), withPlanM({ glovesDimensions: 12 }), inspectionMeta(REPORT));
    const weight = dimensionOnly.module("weight");
    expect(weight.title).toBe(STORED);
    expect(computedAt(weight, "n")).toEqual({ M: 13 });
    expect(computedAt(dimensionOnly.module("dimensions"), "rows")).toEqual({ M: 12 });
  });

  it("weighs the plan's 12 gloves and names weight by them, its section too; the seed's wording stays 13", () => {
    expect(seedTemplate("STD_EG").modules.find((entry) => entry.key === "weight")?.title).toBe(STORED);
    const weight = twelve.module("weight");
    expect(weight.title).toBe(SHOWN);
    expect(computedAt(weight, "n")).toEqual({ M: 12 });
    expect(weight.result.perSize?.M).toEqual({ status: "not_done", summary: "Weight (g): 11 of 12 gloves." });
    expect(findSection(captureSections(twelve.template, twelve.report, data), "weight")?.title).toBe(SHOWN);
  });

  it("names it so in the not-done warning and in the Conclusion's reasons", () => {
    expect(twelve.report.warnings).toContainEqual(
      expect.objectContaining({ moduleKey: "weight", code: "module_not_done", message: `${SHOWN} is not done: Not done for size M.` }),
    );
    expect(twelve.report.suggested).toMatchObject({ result: "hold", notDone: ["weight"] });
    // As the Conclusion lists them: moduleTitle reads the context's modules.
    expect(suggestionReasons(twelve.report.suggested, (key) => moduleTitle(twelve.context, key))).toContain(`Not done: ${SHOWN}.`);
    expect(twelve.module("conclusion").result.summary).toContain(`(not done: ${SHOWN})`);
  });

  it("exports the title as shown and the gloves weighed per size", () => {
    const record = stdEgRecord({ data });
    const result = evaluateRecord(record);
    if (!result.ok) throw new Error(result.message);
    const links = { photos: new Map(), files: new Map(), clientLogo: null, sourceFile: null };
    const doc = assembleExport({ record, evaluated: result.evaluated, links, exportedAt: "2025-04-12T09:15:00.000Z" });
    const weight = doc.modules.find((entry) => entry.key === "weight");
    expect(weight?.title).toBe(SHOWN);
    expect(weight?.computed.n).toEqual({ M: 12 });
    expect(weight?.config).toMatchObject({ n: 13 });
  });
});
