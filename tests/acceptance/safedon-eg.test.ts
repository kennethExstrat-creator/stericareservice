// Phase 2 acceptance (BUILD_SPEC 12), part A of docs/examples/expected-results.md:
// the SAFEDON_EG example entered as a whole inspection on the seed template
// SAFEDON_EG (extends STD_EG) and evaluated by every module, as the capture
// screen, submit, the review and the export do. Every row of the expected
// results is checked against tests/fixtures/examples/expected.ts: per-size
// results and computed values, the corrected values (the five dimension
// cells typed as text, the dispensing rates the report got wrong), the
// sampling notices at inspection level I, and the suggested result.
import { describe, expect, it } from "vitest";
import { roundTo } from "@/lib/stats";
import { readDecimalCell } from "@/lib/validation";
import { labelFor } from "@/modules/_framework";
import { FIXTURE_MEASURE } from "@/modules/dimensions/__fixtures__/examples";
import {
  SAFEDON_EG_EXAMPLE as REPORT,
  SAFEDON_EG_EXPECTED as EXPECTED,
  type DimensionMeasure,
  type VisualClass,
} from "@/tests/fixtures/examples";
import { computedAt, evaluate, evaluateSafedonEg, inspectionMeta, safedonEgData, safedonEgFiles, seedTemplate } from "./examples";

const evaluated = evaluateSafedonEg();
const CLASSES: readonly VisualClass[] = ["critical", "major", "minor"];

describe("SAFEDON_EG example as a whole inspection (expected results A)", () => {
  it("runs on the seed template SAFEDON_EG with every module of the report, in report order", () => {
    expect(evaluated.template.code).toBe("SAFEDON_EG");
    expect(evaluated.report.modules.map((entry) => entry.key)).toEqual([
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "dimensions",
      "tensile",
      "weight",
      "watertight",
      "visual",
      "dispensing_safedon",
      "labeling",
      "conclusion",
    ]);
    const broken = ["invalid_data", "invalid_config", "calc_failed", "contribute_failed", "invalid_output"];
    expect(evaluated.report.issues.filter((issue) => broken.includes(issue.code))).toEqual([]);
    expect(evaluated.context.sizes).toEqual(REPORT.sizesOrdered);
  });

  it("Totals: 1,530 cartons, 3,060,000 gloves", () => {
    const order = evaluated.module("order_lots");
    expect(computedAt(order, "totalCartons")).toBe(EXPECTED.totals.cartons);
    expect(computedAt(order, "totalGloves")).toBe(EXPECTED.totals.gloves);
  });

  it("Watertight: XS 1 / 80 and L 1 / 80 (glove burst) at 3 / 4, S and M 0 / 200 at 7 / 8, all pass", () => {
    const watertight = evaluated.module("watertight");
    for (const [size, expected] of Object.entries(EXPECTED.watertight)) {
      expect(computedAt(watertight, "sizes", size), size).toMatchObject({
        tested: expected.n,
        codeLetter: expected.codeLetter,
        accept: expected.accept,
        reject: expected.reject,
        totalDefects: expected.found,
        result: expected.status,
      });
      const holes = computedAt(watertight, "sizes", size, "holes") as Record<string, number>;
      expect(Object.fromEntries(Object.entries(holes).filter(([, count]) => count > 0)), size).toEqual(expected.byLocation);
      expect(watertight.result.perSize?.[size]?.status).toBe(expected.status);
    }
    // The XS total the report shows as a date (1 Jan 1980) is computed, a count over the gloves tested.
    expect(watertight.result.perSize?.XS?.summary).toContain("1 / 80");
    expect(computedAt(watertight, "codeLetters")).toBe("J & L");
  });

  it.each(CLASSES)("Visual %s: the limits of n 80 (J) and n 200 (L) at the class's AQL, nothing found, pass", (cls) => {
    const visual = evaluated.module("visual");
    for (const [size, expected] of Object.entries(EXPECTED.visual[cls])) {
      expect(computedAt(visual, "sizes", size, cls), `${size} ${cls}`).toMatchObject({
        inspected: expected.n,
        codeLetter: expected.codeLetter,
        accept: expected.accept,
        reject: expected.reject,
        total: expected.found,
        result: expected.status,
      });
      expect(computedAt(visual, "classes", cls, "aql")).toBe(expected.aql);
    }
  });

  it("Critical, all sizes: labelled as critical, not 'Visual Minor' as the report did", () => {
    const visual = evaluated.module("visual");
    expect(labelFor(visual.labels, "criticalResult")).toBe("Disposition - Visual Critical (Passed / Failed)");
    for (const size of REPORT.sizesOrdered) expect(visual.result.perSize?.[size]?.status).toBe("pass");
  });

  it("Dispensing: rates per box from the counts, size totals 3 / 625, 0 / 1,000, 11 / 1,000 and 0 / 625, all pass", () => {
    const dispensing = evaluated.module("dispensing_safedon");
    for (const [size, expected] of Object.entries(EXPECTED.dispensing)) {
      const computed = computedAt(dispensing, "sizes", size) as {
        boxes: { boxNo: number; boxDefects: number; boxRatePct: number }[];
        totalDefects: number;
        glovesInspected: number;
        ratePct: number;
        result: string;
      };
      // The report's per-box rate is a fraction of the pack (0.008); the module keeps it in % (0.8).
      expect(
        computed.boxes.map((box) => ({ box: box.boxNo, defects: box.boxDefects, rate: roundTo(box.boxRatePct / 100, 6) })),
        size,
      ).toEqual(expected.boxes);
      expect({ defects: computed.totalDefects, gloves: computed.glovesInspected, ratePct: computed.ratePct }, size).toEqual({
        defects: expected.defects,
        gloves: expected.gloves,
        ratePct: expected.ratePct,
      });
      expect(computed.result).toBe(expected.status);
      expect(dispensing.result.perSize?.[size]?.status).toBe(expected.status);
      expect(dispensing.result.perSize?.[size]?.summary, size).toContain(`max. ${expected.maxRatePct}%`);
    }
    // As the expected results write them, thousands grouped.
    const summary = dispensing.result.summary;
    for (const text of ["3 / 625 (0.48%)", "0 / 1,000 (0%)", "11 / 1,000 (1.1%)", "0 / 625 (0%)"]) expect(summary).toContain(text);
  });

  it("Dimension averages: length and width to 2 decimals; thickness to the print's precision", () => {
    const dimensions = evaluated.module("dimensions");
    for (const [size, expected] of Object.entries(EXPECTED.dimensions)) {
      for (const [measure, outcome] of Object.entries(expected.perMeasure)) {
        const key = FIXTURE_MEASURE[measure as DimensionMeasure];
        const average = computedAt(dimensions, "statistic", size, key) as number;
        const where = `${size} ${measure}`;
        // The expected results' averages, at the 2 decimals both agree on (docs/FIXTURES.md "Printed precision").
        expect(roundTo(average, 2), where).toBe(roundTo(expected.average[measure as DimensionMeasure] ?? NaN, 2));
        // What the printed readings give, to the decimals the expected results use: 2 for mm, 4 for thickness.
        const decimals = measure === "length" || measure === "width" ? 2 : 4;
        expect(roundTo(average, decimals), where).toBe(expected.averageOfPrintedReadings[measure as DimensionMeasure]);
        expect(computedAt(dimensions, "measureResult", size, key), where).toBe(outcome);
      }
      expect(dimensions.result.perSize?.[size]?.status).toBe(expected.status);
    }
    expect(computedAt(dimensions, "statisticKind")).toBe("average");
    // No cuff on this template.
    expect(computedAt(dimensions, "measures")).toEqual(["length", "width", "fingerThickness", "palmThickness"]);
  });

  it("Dimension averages S: the five cells typed with a space are refused, and the size waits for them", () => {
    for (const rejected of EXPECTED.rejectedInputs) {
      expect(readDecimalCell(rejected.raw).ok, rejected.raw).toBe(false);
      expect(readDecimalCell(String(rejected.accepted))).toEqual({ ok: true, value: rejected.accepted });
    }
    const refused = evaluateSafedonEg({ textCells: "refused" });
    const dimensions = refused.module("dimensions");
    // Never the report's average over the numeric cells only (243.5, 0.1748, 0.1197): not done until typed again.
    expect(dimensions.result.perSize?.S?.status).toBe("not_done");
    expect(computedAt(dimensions, "count", "S")).toEqual({ length: 12, width: 13, fingerThickness: 11, palmThickness: 11 });
    expect(computedAt(dimensions, "measureResult", "S")).toEqual({
      length: "not_done",
      width: "pass",
      fingerThickness: "not_done",
      palmThickness: "not_done",
    });
    expect(refused.report.suggested).toMatchObject({ result: "hold", notDone: ["dimensions"] });
    // Typed again correctly: 243.38 / 86.69 at 2 decimals, and the size passes.
    expect(evaluated.module("dimensions").result.perSize?.S?.status).toBe("pass");
  });

  it("Dimension cells saved as text never pass: each is an error with its path", () => {
    const data = safedonEgData();
    const dimensions = data.modules.dimensions as { sizes: Record<string, { gloves: Record<string, unknown>[] }> };
    for (const rejected of EXPECTED.rejectedInputs) {
      dimensions.sizes[rejected.size].gloves[rejected.glove - 1][FIXTURE_MEASURE[rejected.measure]] = rejected.raw;
    }
    const saved = evaluate(seedTemplate("SAFEDON_EG"), data, inspectionMeta(REPORT, safedonEgFiles()));
    const invalid = saved.report.errors.filter((issue) => issue.code === "invalid_data");
    expect(invalid.map((issue) => issue.path)).toEqual(
      EXPECTED.rejectedInputs.map((rejected) => ["sizes", rejected.size, "gloves", rejected.glove - 1, FIXTURE_MEASURE[rejected.measure]]),
    );
    expect(invalid.every((issue) => issue.moduleKey === "dimensions")).toBe(true);
    expect(saved.module("dimensions").result.status).toBe("not_done");
    expect(saved.report.canSubmit).toBe(false);
  });

  it("Tensile / elongation: XS 34.18 / 536, S 32.99 / 547, M 34.03 / 555, L 33.17 / 543, pass at ≥ 14 MPa and ≥ 500%", () => {
    const tensile = evaluated.module("tensile");
    const data = tensile.data as { sizes: Record<string, { tensileStrength: number; elongationAtBreak: number }> };
    for (const [size, expected] of Object.entries(EXPECTED.tensile)) {
      expect(data.sizes[size]).toEqual({ tensileStrength: expected.tensileMPa, elongationAtBreak: expected.elongationPct });
      expect(computedAt(tensile, "sizes", size)).toEqual({ tensileResult: "pass", elongationResult: "pass" });
      expect(tensile.result.perSize?.[size]?.status).toBe(expected.status);
    }
    expect(computedAt(tensile, "tensileMin")).toBe(EXPECTED.tensile.XS?.minTensileMPa);
    expect(computedAt(tensile, "elongationMin")).toBe(EXPECTED.tensile.XS?.minElongationPct);
    expect(computedAt(tensile, "labReportAttached")).toBe(true);
  });

  it("Tensile passes only with its lab report: without it the module is not done and the suggestion holds", () => {
    const without = evaluateSafedonEg({ labReport: false });
    const tensile = without.module("tensile");
    expect(tensile.result.status).toBe("not_done");
    expect(without.report.warnings.find((issue) => issue.moduleKey === "tensile")).toMatchObject({
      code: "module_not_done",
      path: ["labReport"],
    });
    expect(without.report.suggested).toMatchObject({ result: "hold", notDone: ["tensile"] });
    // A lab report kept by the module but no longer among the inspection's files is missing, not attached.
    const deleted = evaluate(seedTemplate("SAFEDON_EG"), safedonEgData(), inspectionMeta(REPORT, []));
    expect(deleted.module("tensile").result.status).toBe("not_done");
    expect(deleted.report.warnings.map((issue) => issue.code)).toContain("lab_report_missing");
  });

  it("Labelling: 3 inner packs and 1 carton per size, 0 defects, pass", () => {
    const labeling = evaluated.module("labeling");
    const data = labeling.data as { sizes: Record<string, { inner: { inspected: number }; carton: { inspected: number } }> };
    for (const [size, expected] of Object.entries(EXPECTED.labeling)) {
      expect(data.sizes[size].inner.inspected).toBe(expected.inner.n);
      expect(data.sizes[size].carton.inspected).toBe(expected.carton.n);
      expect(computedAt(labeling, "sizes", size, "inner")).toEqual({ accept: 0, reject: 1, total: expected.inner.defects, result: "pass" });
      expect(computedAt(labeling, "sizes", size, "carton")).toEqual({ accept: 0, reject: 1, total: expected.carton.defects, result: "pass" });
      expect(labeling.result.perSize?.[size]?.status).toBe(expected.status);
    }
  });

  it("Sampling at inspection level I: XS and L need 200, S and M need 500; 80 and 200 are below it, unflagged (Kenneth, 26 October 2026)", () => {
    const sampling = evaluated.module("sampling_plan");
    expect(computedAt(sampling, "inspectionLevel")).toBe("I");
    // The lot check uses the AQLs the template's watertight and visual apply (AQL_SOURCES).
    expect(evaluated.context.aql).toEqual({ watertight: 1.5, critical: 0, major: 2.5, minor: 4, inspectionLevel: "I" });
    for (const [size, expected] of Object.entries(EXPECTED.sampling)) {
      expect(computedAt(sampling, "sizes", size), size).toMatchObject({
        lotSizeGloves: expected.lotGloves,
        codeLetter: expected.codeLetter,
        planSampleSize: expected.required,
        belowPlan: expected.belowPlan,
      });
      expect(sampling.result.perSize?.[size]?.status).toBe("info");
    }
    // The paper's sample below the plan is no warning any more ("the warning is not needed").
    expect(evaluated.report.warnings.filter((issue) => issue.moduleKey === "sampling_plan")).toEqual([]);
  });

  it("Sampling notice only when the template sets the inspection level", () => {
    const template = seedTemplate("SAFEDON_EG");
    const noLevel = {
      ...template,
      modules: template.modules.map((entry) =>
        entry.key === "sampling_plan" ? { ...entry, config: { ...(entry.config as object), inspectionLevel: null } } : entry,
      ),
    };
    const unset = evaluate(noLevel, safedonEgData(), inspectionMeta(REPORT, safedonEgFiles()));
    expect(unset.report.warnings).toEqual([]);
    expect(unset.module("sampling_plan").result.status).toBe("info");
  });

  it("finds no errors or warnings, and suggests pass: the conclusion", () => {
    expect(evaluated.report.errors).toEqual(EXPECTED.errors);
    expect(evaluated.report.canSubmit).toBe(true);
    // Its only warnings were the samples below the plan, gone since 26 October 2026.
    expect(evaluated.report.warnings).toEqual([]);
    expect(evaluated.report.suggested).toMatchObject({
      result: EXPECTED.conclusion.result,
      failed: [],
      notDone: [],
      warned: [],
    });
    expect(computedAt(evaluated.module("conclusion"), "suggestedResult")).toBe(EXPECTED.conclusion.result);
    expect(evaluated.module("conclusion").result.status).toBe("pass");
  });

  it("weighs one glove per size against the indicative 3.2 g of size M without a warning (NA spec, a record)", () => {
    const weight = evaluated.module("weight");
    expect(computedAt(weight, "n")).toEqual(Object.fromEntries(Object.keys(REPORT.weight).map((size) => [size, 1])));
    expect(computedAt(weight, "shown")).toEqual(
      Object.fromEntries(Object.entries(REPORT.weight).map(([size, entry]) => [size, entry.averageG])),
    );
    expect(computedAt(weight, "deviationPct")).toEqual({ M: -0.6 });
    expect(weight.result.status).toBe("info");
  });
});
