import { describe, expect, it } from "vitest";
import type { InspectionLevel } from "@/lib/aql";
import { moduleConfig } from "@/lib/coverage";
import {
  buildInspectionContext,
  evaluateInspection,
  type AqlDefaults,
  type CalcInput,
  type InspectionContext,
} from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import type { VisualComputed } from "@/modules/visual/calc";
import { VISUAL_DEFAULT_CONFIG } from "@/modules/visual/config";
import { WATERTIGHT_DEFAULT_CONFIG } from "@/modules/watertight/config";
import {
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
} from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "./__fixtures__/examples";
import { resolveSeed } from "./__fixtures__/seeds";
import {
  calcSamplingPlan,
  contributeSamplingPlan,
  DEFAULT_SPECIAL_INSPECTION_LEVEL,
  defaultInspectionLevel,
  defaultSpecialInspectionLevel,
  lotPlan,
  resolveInspectionLevel,
  resolveSpecialInspectionLevel,
  samplingValues,
  type SamplingPlanComputed,
} from "./calc";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingPlanConfig } from "./config";
import { definition } from "./index";
import { emptySamplingPlan, emptySamplingSize, type SamplingPlanData, type SamplingSize } from "./schema";

const LEVEL_I: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "I" };
/** STD_EG's columns as its template stores them: # Gloves for Weight on, a row no template shows any more. */
const WEIGHT_ROW: SamplingPlanConfig = {
  ...SAMPLING_PLAN_DEFAULT_CONFIG,
  columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, glovesWeight: true },
};

/** STD_EG size M as printed: 50 cases, 500 gloves for watertight and visual. */
const ROW_M: SamplingSize = {
  ...emptySamplingSize(),
  cases: 50,
  innerUnits: 50,
  gloves: 500,
  glovesWatertightVisual: 500,
  glovesDimensions: 13,
  glovesPhysical: 13,
  innerUnitsDispensing: 13,
};

/** ROW_M's summary once complete: 500 gloves from 50 inner boxes is 10 a box, none put back. */
const DONE_M = "# of Case: 50; # Gloves for Watertight & Visual: 500; Gloves Taken per Inner Box: 10; Put Back: 0.";

/** Size M ordered: 2,900 cases of 2,000 gloves (STD_EG). */
function contextM(overrides: Partial<InspectionContext> = {}): InspectionContext {
  return makeTestContext({
    sizes: ["M"],
    order: { M: { qtyCases: 2900, lotNumbers: ["LOT-A01"] } },
    packing: { innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 },
    ...overrides,
  });
}

function input(
  sizes: Record<string, Partial<SamplingSize>>,
  config: SamplingPlanConfig = SAMPLING_PLAN_DEFAULT_CONFIG,
  context: InspectionContext = contextM(),
): CalcInput<SamplingPlanData, SamplingPlanConfig> {
  return {
    data: { sizes: Object.fromEntries(Object.entries(sizes).map(([size, row]) => [size, { ...emptySamplingSize(), ...row }])) },
    config,
    title: "Sampling Plan",
    labels: SAMPLING_PLAN_LABELS,
    context,
    results: {},
    hasData: true,
  };
}

/** Through the engine: the example's order, packing and sampling plan, with the template's sampling plan config. */
function evaluate(example: ExampleReport, config: SamplingPlanConfig, data = exampleData(example)) {
  const template = makeTestTemplate(ENGINE_REGISTRY, ["order_lots", "packing_config", { key: "sampling_plan", config }]);
  const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
  const evaluation = evaluateInspection({ template, data, context }, ENGINE_REGISTRY);
  const found = evaluation.modules.find((entry) => entry.key === "sampling_plan");
  if (!found) throw new Error("sampling_plan was not evaluated");
  return { context, evaluation: { ...found, computed: found.computed as SamplingPlanComputed } };
}

function templateConfig(code: "STD_EG" | "SAFEDON_EG"): SamplingPlanConfig {
  const config = moduleConfig(code, "sampling_plan");
  if (!config) throw new Error(`${code} has no sampling plan`);
  return {
    columns: { ...config.columns },
    inspectionLevel: config.inspectionLevel,
    specialInspectionLevel: config.specialInspectionLevel,
  };
}

describe("sampling_plan", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("is info once every shown column is entered for every ordered size; with no level set anywhere, the plans are at I", () => {
    expect(calcSamplingPlan(input({ M: ROW_M }))).toEqual({
      result: {
        status: "info",
        summary: `Size M: ${DONE_M}`,
        perSize: { M: { status: "info", summary: DONE_M } },
      },
      computed: {
        // Neither the inspection, the template nor the client sets a level: I, and S-2 for the special one (Kenneth,
        // 27 October 2026).
        inspectionLevel: "I",
        specialInspectionLevel: "S-2",
        sizes: {
          M: {
            lotSizeGloves: 5_800_000,
            codeLetter: "N",
            planSampleSize: 500,
            planCodeLetter: "N",
            sampleCodeLetter: "N",
            belowPlan: false,
            glovesPerInnerBox: 10,
            putBack: 0,
            codeLetterReduced: false,
            reducedFrom: null,
            belowLetter: false,
          },
        },
        totals: {
          cases: 50,
          innerUnits: 50,
          gloves: 500,
          glovesWatertightVisual: 500,
          glovesDimensions: 13,
          glovesPhysical: 13,
          innerUnitsDispensing: 13,
          putBack: 0,
        },
      },
      issues: [],
    });
  });

  it("is not done while a shown column is empty, naming it in the template's wording (6.2 rule 5)", () => {
    const labels = { ...SAMPLING_PLAN_LABELS, glovesPhysical: "# Gloves for Tensile" };
    const output = calcSamplingPlan({ ...input({ M: { ...ROW_M, innerUnits: null, glovesPhysical: null } }), labels });
    expect(output.result).toMatchObject({
      status: "not_done",
      perSize: { M: { status: "not_done", summary: "Missing: Total # of Inner Box, # Gloves for Tensile." } },
    });
    expect(output.issues).toEqual([]);
    // The inner boxes per case are never asked for: the total is, typed or worked out.
    expect(calcSamplingPlan(input({ M: { cases: 50 } })).result.perSize?.M.summary).toBe(
      "Missing: Total # of Inner Box, # of Gloves Sample, # Gloves for Watertight & Visual, # Gloves for Dimension, # Gloves for FAB, # Inner Box for Packaging & Dispensing Inspection.",
    );
  });

  it("says a size with nothing entered is not started, rather than listing every column (MODULES.md section 8)", () => {
    expect(calcSamplingPlan(input({})).result).toEqual({
      status: "not_done",
      summary: "Size M: Not started.",
      perSize: { M: { status: "not_done", summary: "Not started." } },
    });
    expect(calcSamplingPlan(input({ M: {} })).result.perSize?.M.summary).toBe("Not started.");
    // A value in a column the template switches off does not start the size.
    const noPouches = calcSamplingPlan(input({ M: { pouches: 4 } }));
    expect(noPouches.result.perSize?.M.summary).toBe("Not started.");
  });

  it("names the sizes that share a summary together, in the order's order", () => {
    const context = contextM({
      sizes: ["XS", "S", "M", "L"],
      order: {
        XS: { qtyCases: 60, lotNumbers: [] },
        S: { qtyCases: 850, lotNumbers: [] },
        M: { qtyCases: 560, lotNumbers: [] },
        L: { qtyCases: 60, lotNumbers: [] },
      },
    });
    expect(calcSamplingPlan(input({}, SAMPLING_PLAN_DEFAULT_CONFIG, context)).result.summary).toBe(
      "Size XS, S, M, L: Not started.",
    );
    const some = calcSamplingPlan(input({ XS: ROW_M, M: { ...ROW_M, gloves: null } }, SAMPLING_PLAN_DEFAULT_CONFIG, context));
    expect(some.result.summary).toBe("Size S, L: Not started. Size M: Missing: # of Gloves Sample.");
  });

  it("never asks for the gloves for weight, even where the template switches the row on (Kenneth, 26 October 2026)", () => {
    const empty = calcSamplingPlan(input({ M: ROW_M }, WEIGHT_ROW));
    expect(empty.result.perSize?.M).toEqual({ status: "info", summary: DONE_M });
    expect(empty.computed.totals).not.toHaveProperty("glovesWeight");
    // A count an older inspection saved there is kept in the data, never totalled.
    const saved = calcSamplingPlan(input({ M: { ...ROW_M, glovesWeight: 13 } }, WEIGHT_ROW));
    expect(saved.result.status).toBe("info");
    expect(saved.computed.totals).toMatchObject({ glovesDimensions: 13, glovesPhysical: 13 });
    expect(saved.computed.totals).not.toHaveProperty("glovesWeight");
  });

  it("asks only for the columns the template shows: the surgical pouches, or no gloves column (STD_SG)", () => {
    const surgical: SamplingPlanConfig = {
      ...SAMPLING_PLAN_DEFAULT_CONFIG,
      columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, gloves: false, innerUnitsDispensing: false, pouches: true, pouchesDyeLeak: true },
    };
    const row = { ...ROW_M, gloves: null, innerUnitsDispensing: null };
    expect(calcSamplingPlan(input({ M: row }, surgical)).result.perSize?.M).toEqual({
      status: "not_done",
      summary: "Missing: Pouches, # Pouches (Dye Leak Test).",
    });
    const done = calcSamplingPlan(input({ M: { ...row, pouches: 25, pouchesDyeLeak: 13 } }, surgical));
    expect(done.result.status).toBe("info");
    expect(Object.keys(done.computed.totals)).toEqual([
      "cases",
      "innerUnits",
      "glovesWatertightVisual",
      "glovesDimensions",
      "glovesPhysical",
      "pouches",
      "pouchesDyeLeak",
    ]);
  });

  it("totals each shown column over the ordered sizes only (6.2 rules 2 and 4)", () => {
    const context = contextM({ sizes: ["S", "M"], order: { S: { qtyCases: 850, lotNumbers: [] }, M: { qtyCases: 560, lotNumbers: [] } } });
    const output = calcSamplingPlan(
      input({ XS: { cases: 5 }, S: { cases: 20, glovesWatertightVisual: 200 }, M: { cases: 15 } }, SAMPLING_PLAN_DEFAULT_CONFIG, context),
    );
    expect(output.computed.totals).toMatchObject({ cases: 35, glovesWatertightVisual: 200, gloves: null });
    expect(Object.keys(output.result.perSize ?? {})).toEqual(["S", "M"]);
    expect(Object.keys(output.computed.sizes)).toEqual(["S", "M"]);
  });

  it("computes the inspection level's plan from the lot in gloves, naming no level: STD_EG M at level I is code N, n 500, met", () => {
    const output = calcSamplingPlan(input({ M: ROW_M }, LEVEL_I));
    expect(output.result).toEqual({
      status: "info",
      summary: `Size M: ${DONE_M}`,
      perSize: {
        M: { status: "info", summary: DONE_M },
      },
    });
    expect(output.computed.sizes.M).toEqual({
      lotSizeGloves: 5_800_000,
      codeLetter: "N",
      planSampleSize: 500,
      planCodeLetter: "N",
      sampleCodeLetter: "N",
      belowPlan: false,
      glovesPerInnerBox: 10,
      putBack: 0,
      codeLetterReduced: false,
      reducedFrom: null,
      belowLetter: false,
    });
    expect(output.issues).toEqual([]);
  });

  it("does not warn when the watertight and visual sample is below the plan (Kenneth, 26 October 2026: \"the warning is not needed\")", () => {
    const output = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 315 } }, LEVEL_I));
    expect(output.result).toMatchObject({
      status: "info",
      perSize: {
        M: { status: "info", summary: "# of Case: 50; # Gloves for Watertight & Visual: 315; Gloves Taken per Inner Box: 10; Put Back: 0." },
      },
    });
    // The plan is still worked out, and says the sample is below it.
    expect(output.computed.sizes.M).toMatchObject({ planSampleSize: 500, sampleCodeLetter: "M", belowPlan: true });
    expect(output.issues).toEqual([]);
    // A larger sample than the plan sets its own, stricter code letter: nothing to flag.
    const larger = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 800 } }, LEVEL_I));
    expect(larger.issues).toEqual([]);
    expect(larger.computed.sizes.M).toMatchObject({ sampleCodeLetter: "P", belowPlan: false });
  });

  it("works out the largest n the AQLs need, with no warning below it (docs/AQL.md, BUILD_SPEC 7 lot 100)", () => {
    // Lot 100 at level I is code D (n 8): AQL 1.5 takes 8, 2.5 points up to 5, 4.0 points down to E (n 13).
    const context = contextM({ order: { M: { qtyCases: 1, lotNumbers: [] } }, packing: { ...contextM().packing, glovesPerCase: 100 } });
    expect(lotPlan(100, "I", context.aql)).toMatchObject({ codeLetter: "D", usedLetter: "E", n: 13, aql: 4 });
    const output = calcSamplingPlan(input({ M: { ...ROW_M, cases: 1, glovesWatertightVisual: 8 } }, LEVEL_I, context));
    expect(output.computed.sizes.M).toMatchObject({
      lotSizeGloves: 100,
      codeLetter: "D",
      planSampleSize: 13,
      planCodeLetter: "E",
      belowPlan: true,
    });
    expect(output.issues).toEqual([]);
    // A client's AQLs: watertight 1.0 on lot 1,000 at level I needs H (n 50) where Table 1 gives G (n 32).
    expect(lotPlan(1_000, "I", { ...context.aql, watertight: 1.0 })).toMatchObject({ codeLetter: "G", usedLetter: "H", n: 50 });
    // An AQL Table 2-A does not have is left out; none left means no plan.
    expect(lotPlan(1_000, "I", { ...context.aql, watertight: 3, critical: 3, major: 3, minor: 3 })).toBeNull();
  });

  it("asks only for the AQLs of the checks the inspection runs; with none, Table 1's n", () => {
    const aql = makeTestContext().aql;
    // Lot 100 at level I: minor's 4.0 points down to E (n 13); without the minor class, D (n 8) is enough.
    expect(lotPlan(100, "I", { ...aql, minor: null })).toMatchObject({ codeLetter: "D", usedLetter: "D", n: 8 });
    // Only major's 2.5 run: its arrow up to C (n 5).
    expect(lotPlan(100, "I", { ...aql, watertight: null, critical: null, minor: null })).toMatchObject({ usedLetter: "C", n: 5 });
    // No check on the sample: the inspection level's Table 1 plan, as AQL 0 gives it.
    const none = { ...aql, watertight: null, critical: null, major: null, minor: null };
    expect(lotPlan(100, "I", none)).toMatchObject({ codeLetter: "D", usedLetter: "D", n: 8, aql: 0 });
    expect(lotPlan(5_800_000, "I", none)).toMatchObject({ codeLetter: "N", n: 500 });
  });

  it("works out every glove when the plan's n is not smaller than the lot, with no warning below it", () => {
    // Lot 8 at level III, watertight AQL 0.65: the arrow down needs more than the lot holds.
    const context = contextM({
      order: { M: { qtyCases: 1, lotNumbers: [] } },
      packing: { ...contextM().packing, glovesPerCase: 8 },
      aql: { ...makeTestContext().aql, watertight: 0.65 },
    });
    const output = calcSamplingPlan(
      input({ M: { ...ROW_M, cases: 1, glovesWatertightVisual: 5 } }, { ...LEVEL_I, inspectionLevel: "III" }, context),
    );
    // Code B, where AQL 0.65's arrow points down to F (n 20): more than the 8 gloves the lot holds.
    expect(output.computed.sizes.M).toMatchObject({
      lotSizeGloves: 8,
      codeLetter: "B",
      planSampleSize: 20,
      planCodeLetter: "F",
      belowPlan: true,
    });
    expect(output.issues).toEqual([]);
    const whole = calcSamplingPlan(
      input({ M: { ...ROW_M, cases: 1, glovesWatertightVisual: 8 } }, { ...LEVEL_I, inspectionLevel: "III" }, context),
    );
    expect(whole.issues).toEqual([]);
    expect(whole.computed.sizes.M.belowPlan).toBe(false);
  });

  it("flags a sample size Table 2-A does not have: it is read as the standard size below it (6.2 rule 8, BUILD_SPEC 7)", () => {
    const output = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 100 } }));
    expect(output.result.status).toBe("warn");
    expect(output.computed.sizes.M.sampleCodeLetter).toBe("J");
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "nonstandard_sample",
        message:
          "Size M, # Gloves for Watertight & Visual: 100 is not a standard sample size, so it is read as code letter J (n 80), the largest standard sample size below it.",
        size: "M",
        path: ["sizes", "M", "glovesWatertightVisual"],
      },
    ]);
    // Below a level's plan too: only the sample size is flagged (Kenneth, 26 October 2026).
    const both = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 400 } }, LEVEL_I));
    expect(both.issues.map((issue) => issue.code)).toEqual(["nonstandard_sample"]);
    expect(calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 2500 } })).computed.sizes.M.sampleCodeLetter).toBe("R");
  });

  it("rejects impossible samples with errors that block submit: no case, more cases than ordered, fewer than 2 gloves", () => {
    const zero = calcSamplingPlan(input({ M: { ...ROW_M, cases: 0, glovesWatertightVisual: 1 } }, LEVEL_I));
    expect(zero.result.perSize?.M).toEqual({
      status: "not_done",
      summary: "# of Case is 0; # Gloves for Watertight & Visual 1 is below 2.",
    });
    expect(zero.issues).toEqual([
      {
        level: "error",
        code: "cases_zero",
        message: "Size M, # of Case: 0 cases sampled; every ordered size needs at least 1.",
        size: "M",
        path: ["sizes", "M", "cases"],
      },
      {
        level: "error",
        code: "invalid_sample_size",
        message: "Size M, # Gloves for Watertight & Visual: 1 glove sampled; an ISO 2859-1 sample has at least 2.",
        size: "M",
        path: ["sizes", "M", "glovesWatertightVisual"],
      },
    ]);
    expect(zero.computed.sizes.M.belowPlan).toBe(true);

    const above = calcSamplingPlan(input({ M: { ...ROW_M, cases: 3000 } }));
    expect(above.result.perSize?.M).toEqual({ status: "not_done", summary: "# of Case 3,000 is more than the 2,900 ordered." });
    expect(above.issues).toEqual([
      {
        level: "error",
        code: "cases_above_order",
        message: "Size M, # of Case: 3,000 cases sampled, more than the 2,900 cases ordered.",
        size: "M",
        path: ["sizes", "M", "cases"],
      },
    ]);
    // Exactly the order is possible; a column switched off is never checked.
    expect(calcSamplingPlan(input({ M: { ...ROW_M, cases: 2900 } })).issues).toEqual([]);
    const noCases = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, cases: false } };
    expect(calcSamplingPlan(input({ M: { ...ROW_M, cases: 0 } }, noCases)).issues).toEqual([]);
  });

  it("does not wait on the lot size with a level set: nothing checks the plan (Kenneth, 26 October 2026)", () => {
    const context = contextM({ packing: { ...contextM().packing, glovesPerCase: null } });
    const output = calcSamplingPlan(input({ M: ROW_M }, LEVEL_I, context));
    expect(output.result.perSize?.M).toEqual({ status: "info", summary: DONE_M });
    expect(output.computed.sizes.M).toMatchObject({ lotSizeGloves: null, codeLetter: null, belowPlan: null });
    // Nor at the default level, with none set.
    expect(calcSamplingPlan(input({ M: ROW_M }, SAMPLING_PLAN_DEFAULT_CONFIG, context)).result.status).toBe("info");
  });

  it("takes the client's inspection level when the template sets none; the template's wins", () => {
    const context = contextM({ aql: { ...makeTestContext().aql, inspectionLevel: "II" } });
    // Lot 5,800,000 at level II is code Q (n 1,250).
    const client = calcSamplingPlan(input({ M: ROW_M }, SAMPLING_PLAN_DEFAULT_CONFIG, context));
    expect(client.computed).toMatchObject({ inspectionLevel: "II", sizes: { M: { codeLetter: "Q", planSampleSize: 1250 } } });
    expect(client.issues).toEqual([]);
    const template = calcSamplingPlan(input({ M: ROW_M }, LEVEL_I, context));
    expect(template.computed).toMatchObject({ inspectionLevel: "I", sizes: { M: { codeLetter: "N", planSampleSize: 500 } } });
  });

  it("passes the samples forward under the context's keys, and the template's level (BUILD_SPEC 8)", () => {
    expect(contributeSamplingPlan({ data: { sizes: { M: ROW_M } }, config: LEVEL_I })).toEqual({
      sampling: {
        M: {
          cases: 50,
          innerUnits: 50,
          gloves: 500,
          watertightVisual: 500,
          dimensions: 13,
          physical: 13,
          packagingDispensing: 13,
          pouches: null,
          pouchesDyeLeak: null,
        },
      },
      aql: { inspectionLevel: "I" },
    });
    expect(contributeSamplingPlan({ data: emptySamplingPlan(), config: SAMPLING_PLAN_DEFAULT_CONFIG })).toEqual({ sampling: {} });
    // A column the template switches off passes nothing, even when a value is saved.
    const off = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, glovesPhysical: false } };
    expect(samplingValues({ ...ROW_M, pouches: 4 }, off)).toMatchObject({ physical: null, pouches: null, dimensions: 13 });
  });

  it("passes no gloves for weight forward, even one saved where the template switches the row on: weight records its own value", () => {
    const row = { ...ROW_M, glovesWeight: 12 };
    expect(samplingValues(row, WEIGHT_ROW)).toEqual(samplingValues(ROW_M, SAMPLING_PLAN_DEFAULT_CONFIG));
    expect(samplingValues(row, WEIGHT_ROW)).not.toHaveProperty("weight");
    expect(samplingValues(row, WEIGHT_ROW)).toMatchObject({ dimensions: 13, physical: 13 });
  });
});

describe("sampling_plan's inspection level, set for the inspection in Sampling Settings (Kenneth, 27 October 2026)", () => {
  const CLIENT_II = { aql: { ...makeTestContext().aql, inspectionLevel: "II" as const } };
  const NONE = { aql: makeTestContext().aql };

  it("resolves the inspection's own first, then the template's, then the client's, then I, saying which", () => {
    expect(resolveInspectionLevel({ inspectionLevel: "III" }, LEVEL_I, CLIENT_II)).toEqual({ level: "III", source: "inspection" });
    expect(resolveInspectionLevel({}, LEVEL_I, CLIENT_II)).toEqual({ level: "I", source: "template" });
    expect(resolveInspectionLevel({}, SAMPLING_PLAN_DEFAULT_CONFIG, CLIENT_II)).toEqual({ level: "II", source: "client" });
    expect(resolveInspectionLevel({}, SAMPLING_PLAN_DEFAULT_CONFIG, NONE)).toEqual({ level: "I", source: "default" });
  });

  it("reads a special level saved as the one level, before the special level had its own, as no general level of the inspection's", () => {
    // Data saved while Sampling Settings had one level for everything (27 October 2026) may hold S-3: the default stands in.
    expect(resolveInspectionLevel({ inspectionLevel: "S-3" }, LEVEL_I, CLIENT_II)).toEqual({ level: "I", source: "template" });
    expect(resolveInspectionLevel({ inspectionLevel: "S-3" }, SAMPLING_PLAN_DEFAULT_CONFIG, CLIENT_II)).toEqual({
      level: "II",
      source: "client",
    });
    expect(resolveInspectionLevel({ inspectionLevel: "S-3" }, SAMPLING_PLAN_DEFAULT_CONFIG, NONE)).toEqual({ level: "I", source: "default" });
    // Nor is it the special level: that is the inspection's own specialInspectionLevel, else the template's, else S-2.
    expect(resolveSpecialInspectionLevel({}, SAMPLING_PLAN_DEFAULT_CONFIG)).toEqual({ level: "S-2", source: "default" });
    // A template's special level in its general setting is none either: the client's, else I.
    const templateS4 = { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "S-4" as const };
    expect(resolveInspectionLevel({}, templateS4, CLIENT_II)).toEqual({ level: "II", source: "client" });
    expect(resolveInspectionLevel({}, templateS4, NONE)).toEqual({ level: "I", source: "default" });
    // The plans are worked out at that default: lot 5,800,000 at I is code N, as with nothing saved.
    const base = input({ M: ROW_M }, LEVEL_I);
    const old = calcSamplingPlan({ ...base, data: { ...base.data, inspectionLevel: "S-3" } });
    expect(old.computed).toMatchObject({ inspectionLevel: "I", specialInspectionLevel: "S-2", sizes: { M: { codeLetter: "N" } } });
    expect(old.computed).toEqual(calcSamplingPlan(base).computed);
  });

  it("knows the level Use Default goes back to: the template's, else the client's while the context still holds it, else I", () => {
    expect(defaultInspectionLevel({ inspectionLevel: "III" }, LEVEL_I, CLIENT_II)).toEqual({ level: "I", source: "template" });
    expect(defaultInspectionLevel({}, SAMPLING_PLAN_DEFAULT_CONFIG, CLIENT_II)).toEqual({ level: "II", source: "client" });
    // With the inspection's own level the context holds that one (contributeSamplingPlan), not a client's: I stands in.
    const own = { aql: { ...NONE.aql, inspectionLevel: "III" as const } };
    expect(defaultInspectionLevel({ inspectionLevel: "III" }, SAMPLING_PLAN_DEFAULT_CONFIG, own)).toEqual({ level: "I", source: "default" });
  });

  it("works the plans out at the inspection's own level, over the template's and the client's", () => {
    const context = contextM({ aql: { ...makeTestContext().aql, inspectionLevel: "II" } });
    const at = (inspectionLevel: InspectionLevel) => {
      const base = input({ M: ROW_M }, LEVEL_I, context);
      return calcSamplingPlan({ ...base, data: { ...base.data, inspectionLevel } }).computed;
    };
    // Lot 5,800,000: III is code R, where AQL 1.5 and the critical class need all 2,000; II is code Q.
    expect(at("III")).toMatchObject({ inspectionLevel: "III", sizes: { M: { codeLetter: "R", planSampleSize: 2000, belowPlan: true } } });
    expect(at("II")).toMatchObject({ inspectionLevel: "II", sizes: { M: { codeLetter: "Q" } } });
    // Nothing in the table changes with it: the result and the totals are the counts', not the level's.
    const plain = calcSamplingPlan(input({ M: ROW_M }, LEVEL_I, context));
    const base = input({ M: ROW_M }, LEVEL_I, context);
    const own = calcSamplingPlan({ ...base, data: { ...base.data, inspectionLevel: "III" } });
    expect(own.result).toEqual(plain.result);
    expect(own.computed.totals).toEqual(plain.computed.totals);
    expect(own.issues).toEqual([]);
  });

  it("passes the inspection's own level forward over the template's; neither leaves the client's in place", () => {
    expect(contributeSamplingPlan({ data: { sizes: {}, inspectionLevel: "II" }, config: LEVEL_I })).toEqual({
      sampling: {},
      aql: { inspectionLevel: "II" },
    });
    expect(contributeSamplingPlan({ data: { sizes: {}, inspectionLevel: "III" }, config: SAMPLING_PLAN_DEFAULT_CONFIG }).aql).toEqual({
      inspectionLevel: "III",
    });
    expect(contributeSamplingPlan({ data: { sizes: {}, roundCasesTo: 10 }, config: SAMPLING_PLAN_DEFAULT_CONFIG })).toEqual({ sampling: {} });
    // A special level saved as the one level is no general level: the template's goes forward, else nothing.
    expect(contributeSamplingPlan({ data: { sizes: {}, inspectionLevel: "S-2" }, config: LEVEL_I }).aql).toEqual({ inspectionLevel: "I" });
    expect(contributeSamplingPlan({ data: { sizes: {}, inspectionLevel: "S-2" }, config: SAMPLING_PLAN_DEFAULT_CONFIG })).toEqual({
      sampling: {},
    });
    // The special level is the sampling plan's own: nothing reads it from the context.
    expect(contributeSamplingPlan({ data: { sizes: {}, specialInspectionLevel: "S-4" }, config: LEVEL_I })).toEqual({
      sampling: {},
      aql: { inspectionLevel: "I" },
    });
  });

  it("reaches the context and the plans through the engine; visual's code letter stays its sample's (BUILD_SPEC 6.2 rule 8)", () => {
    const template = makeTestTemplate(ENGINE_REGISTRY, [
      "order_lots",
      "packing_config",
      { key: "sampling_plan", config: templateConfig("STD_EG") },
      "visual",
    ]);
    const run = (inspectionLevel?: InspectionLevel) => {
      const sampling = samplingPlanData(STD_EG_EXAMPLE);
      const data = exampleData(STD_EG_EXAMPLE, {
        sampling_plan: inspectionLevel ? { ...sampling, inspectionLevel } : sampling,
        visual: { sizes: { M: { critical: { inspected: 500 }, major: { inspected: 500 }, minor: { inspected: 500 } } } },
      });
      const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
      const modules = evaluateInspection({ template, data, context }, ENGINE_REGISTRY).modules;
      const computed = (key: string) => modules.find((entry) => entry.key === key)?.computed;
      return { context, plan: computed("sampling_plan") as SamplingPlanComputed, visual: computed("visual") as VisualComputed };
    };
    // STD_EG's template sets I: lot 5,800,000 is code N, n 500.
    const fromTemplate = run();
    expect(fromTemplate.context.aql.inspectionLevel).toBe("I");
    expect(fromTemplate.plan).toMatchObject({ inspectionLevel: "I", sizes: { M: { codeLetter: "N", planSampleSize: 500 } } });
    // Set to II for the inspection: every reader of the context gets II, and the plan is code Q, n 1,250.
    const own = run("II");
    expect(own.context.aql.inspectionLevel).toBe("II");
    expect(own.plan).toMatchObject({ inspectionLevel: "II", sizes: { M: { codeLetter: "Q", planSampleSize: 1250, belowPlan: true } } });
    // Visual judges the 500 gloves it inspected: code N at either level.
    expect(fromTemplate.visual.codeLetters).toBe("N");
    expect(own.visual.codeLetters).toBe("N");
  });
});

describe("sampling_plan's special inspection level (Kenneth, 27 October 2026: \"for dimension and FAB, use Special Inspection Level S2\")", () => {
  const TEMPLATE_S3: SamplingPlanConfig = { ...LEVEL_I, specialInspectionLevel: "S-3" };

  it("resolves the inspection's own first, then the template's, then S-2, saying which; no client sets one", () => {
    expect(DEFAULT_SPECIAL_INSPECTION_LEVEL).toBe("S-2");
    expect(resolveSpecialInspectionLevel({}, LEVEL_I)).toEqual({ level: "S-2", source: "default" });
    expect(resolveSpecialInspectionLevel({}, TEMPLATE_S3)).toEqual({ level: "S-3", source: "template" });
    expect(resolveSpecialInspectionLevel({ specialInspectionLevel: "S-1" }, TEMPLATE_S3)).toEqual({ level: "S-1", source: "inspection" });
    expect(resolveSpecialInspectionLevel({ specialInspectionLevel: "S-4" }, LEVEL_I)).toEqual({ level: "S-4", source: "inspection" });
    // A template version saved before the setting has none, parsed or not: S-2.
    expect(resolveSpecialInspectionLevel({}, { columns: LEVEL_I.columns, inspectionLevel: "I" } as SamplingPlanConfig)).toEqual({
      level: "S-2",
      source: "default",
    });
  });

  it("knows the special level Use Default goes back to: the template's, else S-2", () => {
    expect(defaultSpecialInspectionLevel(TEMPLATE_S3)).toEqual({ level: "S-3", source: "template" });
    expect(defaultSpecialInspectionLevel(LEVEL_I)).toEqual({ level: "S-2", source: "default" });
  });

  it("keeps the two levels apart: the general one sets nothing special, the special one nothing general", () => {
    const data = { inspectionLevel: "III" as const, specialInspectionLevel: "S-1" as const };
    expect(resolveInspectionLevel(data, TEMPLATE_S3, { aql: makeTestContext().aql })).toEqual({ level: "III", source: "inspection" });
    expect(resolveSpecialInspectionLevel(data, TEMPLATE_S3)).toEqual({ level: "S-1", source: "inspection" });
  });

  it("puts the special level in force in the computed values beside the general one, checking nothing at it", () => {
    const base = input({ M: ROW_M }, LEVEL_I);
    const plain = calcSamplingPlan(base);
    expect(plain.computed).toMatchObject({ inspectionLevel: "I", specialInspectionLevel: "S-2" });
    expect(calcSamplingPlan({ ...base, config: TEMPLATE_S3 }).computed.specialInspectionLevel).toBe("S-3");
    const own = calcSamplingPlan({ ...base, config: TEMPLATE_S3, data: { ...base.data, specialInspectionLevel: "S-4" } });
    expect(own.computed.specialInspectionLevel).toBe("S-4");
    // The plans, the result, the totals and the issues are the general level's and the counts'.
    expect(own.result).toEqual(plain.result);
    expect(own.computed.sizes).toEqual(plain.computed.sizes);
    expect(own.computed.totals).toEqual(plain.computed.totals);
    expect(own.issues).toEqual(plain.issues);
  });
});

describe("sampling_plan's Sampling Quantity, worked out (Kenneth, 27 October 2026)", () => {
  /** Kenneth's example: 25 inner boxes sampled, one from each of 25 cases, and code M's 315 gloves. */
  const KENNETH: Partial<SamplingSize> = { ...ROW_M, cases: 25, innerUnitsPerCase: 1, innerUnits: 25, gloves: 315 };

  it("takes 13 gloves from each of 25 inner boxes for a sample of 315, never fewer: 325 taken, 10 put back", () => {
    const output = calcSamplingPlan(input({ M: KENNETH }));
    expect(output.computed.sizes.M).toMatchObject({ glovesPerInnerBox: 13, putBack: 10 });
    // No gloves taken in all any more (Kenneth, 27 October 2026: "remove this row"): # of Gloves Sample's sum shows them.
    expect(output.computed.sizes.M).not.toHaveProperty("totalGlovesTaken");
    expect(output.computed.totals).not.toHaveProperty("totalGlovesTaken");
    expect(output.result.perSize?.M).toEqual({
      status: "info",
      summary: "# of Case: 25; # Gloves for Watertight & Visual: 500; Gloves Taken per Inner Box: 13; Put Back: 10.",
    });
    expect(output.issues).toEqual([]);
  });

  it("puts none back when the gloves divide among the inner boxes exactly, whether typed or filled by Auto Calculate", () => {
    expect(calcSamplingPlan(input({ M: { ...KENNETH, gloves: 300 } })).computed.sizes.M).toMatchObject({
      glovesPerInnerBox: 12,
      putBack: 0,
    });
    // A total typed without the inner boxes per case works the same way.
    expect(calcSamplingPlan(input({ M: { ...KENNETH, innerUnitsPerCase: null, innerUnits: 8, gloves: 80 } })).computed.sizes.M).toMatchObject(
      { glovesPerInnerBox: 10, putBack: 0 },
    );
  });

  it("works out nothing while the gloves or the inner boxes are missing, or with no inner box", () => {
    for (const row of [{ ...KENNETH, gloves: null }, { ...KENNETH, innerUnits: null }, { ...KENNETH, innerUnits: 0 }]) {
      expect(calcSamplingPlan(input({ M: row })).computed.sizes.M).toMatchObject({ glovesPerInnerBox: null, putBack: null });
    }
    // Where the template shows no gloves (STD_SG), there is nothing to take per inner box and no put back total.
    const surgical: SamplingPlanConfig = {
      ...SAMPLING_PLAN_DEFAULT_CONFIG,
      columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, gloves: false },
    };
    const sg = calcSamplingPlan(input({ M: KENNETH }, surgical));
    expect(sg.computed.sizes.M).toMatchObject({ glovesPerInnerBox: null, putBack: null });
    expect(sg.computed.totals).not.toHaveProperty("putBack");
  });

  it("totals the gloves put back over the sizes, and neither the inner boxes per case nor the gloves per inner box", () => {
    const context = contextM({ sizes: ["S", "M"], order: { S: { qtyCases: 850, lotNumbers: [] }, M: { qtyCases: 560, lotNumbers: [] } } });
    // S: 315 from 25 inner boxes is 13 a box, 10 back; M: 315 from 20 is 16 a box, 5 back.
    const output = calcSamplingPlan(
      input({ S: KENNETH, M: { ...KENNETH, cases: 20, innerUnits: 20 } }, SAMPLING_PLAN_DEFAULT_CONFIG, context),
    );
    expect(output.computed.sizes.M).toMatchObject({ glovesPerInnerBox: 16, putBack: 5 });
    expect(output.computed.totals).toMatchObject({ cases: 45, innerUnits: 45, gloves: 630, putBack: 15 });
    expect(output.computed.totals).not.toHaveProperty("innerUnitsPerCase");
    expect(output.computed.totals).not.toHaveProperty("glovesPerInnerBox");
    // No size worked out yet: no total either.
    expect(calcSamplingPlan(input({ M: { cases: 25 } })).computed.totals.putBack).toBeNull();
  });

  it("never asks for the inner boxes per case: a size with its total typed is complete", () => {
    expect(calcSamplingPlan(input({ M: { ...KENNETH, innerUnitsPerCase: null } })).result.status).toBe("info");
  });

  it("warns on the total when it is not # of Case × the inner boxes per case, as data saved another way may hold", () => {
    const output = calcSamplingPlan(input({ M: { ...KENNETH, cases: 16, innerUnitsPerCase: 2, innerUnits: 30 } }));
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "inner_units_mismatch",
        message:
          "Size M, Total # of Inner Box: 30 is not 16 × 2 = 32 (# of Case × Inner Box Taken per Case). Enter either again to work it out.",
        size: "M",
        path: ["sizes", "M", "innerUnits"],
      },
    ]);
    expect(output.result.perSize?.M).toEqual({ status: "warn", summary: "Total # of Inner Box 30 is not 16 × 2." });
    // Agreeing, or with no inner boxes per case, or no cases yet: nothing to say.
    expect(calcSamplingPlan(input({ M: { ...KENNETH, cases: 16, innerUnitsPerCase: 2, innerUnits: 32 } })).issues).toEqual([]);
    expect(calcSamplingPlan(input({ M: { ...KENNETH, cases: 16, innerUnitsPerCase: null, innerUnits: 30 } })).issues).toEqual([]);
    const noCases = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, cases: false } };
    expect(calcSamplingPlan(input({ M: { ...KENNETH, innerUnitsPerCase: 2, innerUnits: 30 } }, noCases)).issues).toEqual([]);
  });
});

describe("sampling_plan's code letter (Kenneth, 27 October 2026)", () => {
  /** STD_EG's M (lot 5,800,000: code N at level I) from 25 inner boxes, with `letter` and the gloves it takes. */
  const lettered = (letter: SamplingSize["codeLetter"], gloves: number, reason: string | null = null): Partial<SamplingSize> => ({
    ...ROW_M,
    cases: 25,
    innerUnitsPerCase: 1,
    innerUnits: 25,
    gloves,
    codeLetter: letter,
    codeLetterReason: reason,
  });

  it("says a letter below its lot's was reduced, and from what, for the review and the export", () => {
    const output = calcSamplingPlan(input({ M: lettered("M", 315, "Consistent high-quality factory") }));
    expect(output.computed.sizes.M).toMatchObject({ codeLetter: "N", codeLetterReduced: true, reducedFrom: "N", glovesPerInnerBox: 13, putBack: 10 });
    expect(output.issues).toEqual([]);
    // At the lot's letter, or with none of its own, it was not.
    expect(calcSamplingPlan(input({ M: lettered("N", 500) })).computed.sizes.M).toMatchObject({ codeLetterReduced: false, reducedFrom: null });
    expect(calcSamplingPlan(input({ M: lettered(null, 500) })).computed.sizes.M).toMatchObject({ codeLetterReduced: false, reducedFrom: null });
    // Nor while the lot is not known.
    const unknown = contextM({ packing: { innerUnit: "inner box", glovesPerInner: null, innersPerCase: null, glovesPerCase: null } });
    expect(calcSamplingPlan(input({ M: lettered("M", 315) }, SAMPLING_PLAN_DEFAULT_CONFIG, unknown)).computed.sizes.M).toMatchObject({
      codeLetter: null,
      codeLetterReduced: false,
      reducedFrom: null,
    });
  });

  it("adds the code letter to a complete size's summary, and the lot's while it is lowered", () => {
    expect(calcSamplingPlan(input({ M: lettered("N", 500) })).result.perSize?.M).toEqual({
      status: "info",
      summary: "# of Case: 25; # Gloves for Watertight & Visual: 500; Gloves Taken per Inner Box: 20; Put Back: 0; Code Letter: N.",
    });
    expect(calcSamplingPlan(input({ M: lettered("M", 315) })).result.perSize?.M).toEqual({
      status: "info",
      summary: "# of Case: 25; # Gloves for Watertight & Visual: 500; Gloves Taken per Inner Box: 13; Put Back: 10; Code Letter: M (reduced from N).",
    });
  });

  it("never asks for a code letter: a size without one is complete", () => {
    expect(calcSamplingPlan(input({ M: lettered(null, 315) })).result.status).toBe("info");
  });

  it("never warns on gloves typed apart from the letter's sample; fewer than it is reduced sampling (Kenneth, 29 October 2026)", () => {
    // "the warning is not needed": the size completes, and belowLetter tells the report.
    const output = calcSamplingPlan(input({ M: lettered("M", 300) }));
    expect(output.issues).toEqual([]);
    expect(output.result.perSize?.M.status).toBe("info");
    expect(output.computed.sizes.M).toMatchObject({ belowLetter: true, codeLetterReduced: true });
    // The letter's sample, more than it, or no letter: not reduced by the gloves.
    expect(calcSamplingPlan(input({ M: lettered("M", 315) })).computed.sizes.M.belowLetter).toBe(false);
    expect(calcSamplingPlan(input({ M: lettered("M", 400) })).computed.sizes.M.belowLetter).toBe(false);
    expect(calcSamplingPlan(input({ M: lettered(null, 300) })).computed.sizes.M.belowLetter).toBe(false);
  });

  it("takes every glove of a lot smaller than the letter's sample as its sample", () => {
    // 1 case of 200 gloves: code M's 315 is more than the lot holds.
    const small = contextM({ order: { M: { qtyCases: 1, lotNumbers: [] } }, packing: { innerUnit: "inner box", glovesPerInner: 20, innersPerCase: 10, glovesPerCase: 200 } });
    const whole = { ...lettered("M", 200), cases: 1, innerUnits: 1 };
    expect(calcSamplingPlan(input({ M: whole }, SAMPLING_PLAN_DEFAULT_CONFIG, small)).issues).toEqual([]);
    expect(calcSamplingPlan(input({ M: whole }, SAMPLING_PLAN_DEFAULT_CONFIG, small)).computed.sizes.M.belowLetter).toBe(false);
    // Fewer than every glove of the lot: reduced sampling, no warning.
    const fewer = calcSamplingPlan(input({ M: { ...whole, gloves: 150 } }, SAMPLING_PLAN_DEFAULT_CONFIG, small));
    expect(fewer.issues).toEqual([]);
    expect(fewer.computed.sizes.M.belowLetter).toBe(true);
  });

  it("checks and shows no letter where the template shows no gloves (STD_SG)", () => {
    const surgical: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, gloves: false } };
    const output = calcSamplingPlan(input({ M: lettered("M", 300) }, surgical));
    expect(output.issues).toEqual([]);
    expect(output.computed.sizes.M).toMatchObject({ codeLetterReduced: false, reducedFrom: null });
    expect(output.result.perSize?.M.summary).not.toContain("Code Letter");
  });

  it("totals no code letter", () => {
    expect(calcSamplingPlan(input({ M: lettered("M", 315) })).computed.totals).not.toHaveProperty("codeLetter");
  });
});

describe("sampling_plan with the example reports (docs/examples/expected-results.md)", () => {
  it("A. SAFEDON_EG at level I: XS and L (120,000 gloves) need 200, S and M (over 500,000) need 500; 80 and 200 are below, unflagged", () => {
    const config = templateConfig("SAFEDON_EG");
    expect(config.inspectionLevel).toBe("I");
    const { context, evaluation } = evaluate(SAFEDON_EG_EXAMPLE, config);

    // No warning below the plan (Kenneth, 26 October 2026): the counts stand as entered.
    expect(evaluation.result.status).toBe("info");
    expect(evaluation.result.summary).toBe("Sampling plan entered for size XS, S, M, L.");
    expect(Object.values(evaluation.result.perSize ?? {}).every((entry) => entry.status === "info")).toBe(true);
    for (const [size, expected] of Object.entries(SAFEDON_EG_EXPECTED.sampling)) {
      expect(evaluation.computed.sizes, size).toMatchObject({
        [size]: {
          lotSizeGloves: expected.lotGloves,
          codeLetter: expected.codeLetter,
          planSampleSize: expected.required,
          belowPlan: expected.belowPlan,
        },
      });
    }
    expect(evaluation.issues.filter((issue) => issue.code === "sample_below_plan")).toEqual([]);
    expect(evaluation.issues.filter((issue) => issue.level === "error")).toEqual([]);

    // Numbers flow forward: n for watertight and visual, dimensions, tensile and dispensing.
    expect(context.aql.inspectionLevel).toBe("I");
    expect(context.sampling.XS).toMatchObject({ cases: 5, watertightVisual: 80, dimensions: 13, physical: 13, packagingDispensing: 5 });
    expect(context.sampling.M).toMatchObject({ cases: 15, watertightVisual: 200, packagingDispensing: 8 });
    expect(evaluation.computed.totals).toMatchObject({ cases: 45, glovesWatertightVisual: 560, innerUnitsDispensing: 26 });
    // 200 gloves from M's 15 inner packs is 14 a pack, 10 put back; the other sizes' divide exactly.
    expect(evaluation.computed.sizes.M).toMatchObject({ glovesPerInnerBox: 14, putBack: 10 });
    expect(evaluation.computed.sizes.S).toMatchObject({ glovesPerInnerBox: 8, putBack: 0 });
    expect(evaluation.computed.totals.putBack).toBe(10);
  });

  it("A. SAFEDON_EG before anything is entered: one short line on the module tab and in the issue list", () => {
    const seed = resolveSeed("SAFEDON_EG").modules.find((entry) => entry.key === "sampling_plan");
    if (!seed) throw new Error("SAFEDON_EG has no sampling plan");
    const template = makeTestTemplate(ENGINE_REGISTRY, [
      "order_lots",
      "packing_config",
      { key: "sampling_plan", title: seed.title, labels: seed.labels, config: seed.config },
    ]);
    // Nothing saved (a new inspection), and a saved plan with no size filled in yet.
    for (const sampling of [undefined, { sizes: {} }]) {
      const data = exampleData(SAFEDON_EG_EXAMPLE, { sampling_plan: sampling });
      const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
      const evaluation = evaluateInspection({ template, data, context }, ENGINE_REGISTRY);
      const found = evaluation.modules.find((entry) => entry.key === "sampling_plan");
      expect(found?.result).toMatchObject({ status: "not_done", summary: "Size XS, S, M, L: Not started." });
      expect(evaluation.issues.filter((issue) => issue.moduleKey === "sampling_plan").map((issue) => issue.message)).toEqual([
        `${seed.title} is not done: Size XS, S, M, L: Not started.`,
      ]);
    }
  });

  it("A. SAFEDON_EG without a level in the template: the plans at the default I, the samples taken as entered, nothing flagged", () => {
    const { context, evaluation } = evaluate(SAFEDON_EG_EXAMPLE, { ...templateConfig("SAFEDON_EG"), inspectionLevel: null });
    expect(evaluation.result.status).toBe("info");
    expect(evaluation.issues).toEqual([]);
    expect(evaluation.computed.inspectionLevel).toBe("I");
    expect(evaluation.computed.sizes.XS).toMatchObject({ codeLetter: "L", planSampleSize: 200, belowPlan: true });
    // The context keeps no level of its own: the default is calc's (resolveInspectionLevel), never a client's.
    expect(context.aql.inspectionLevel).toBeNull();
  });

  it("B. STD_EG at level I: M (5,800,000 gloves) is code N, n 500, matching the 500 sampled", () => {
    const { context, evaluation } = evaluate(STD_EG_EXAMPLE, templateConfig("STD_EG"));
    const expected = STD_EG_EXPECTED.sampling.M!;
    expect(evaluation.result).toEqual({
      status: "info",
      summary: `Size M: ${DONE_M}`,
      perSize: {
        M: { status: "info", summary: DONE_M },
      },
    });
    expect(evaluation.computed.sizes).toEqual({
      M: {
        lotSizeGloves: expected.lotGloves,
        codeLetter: expected.codeLetter,
        planSampleSize: expected.required,
        planCodeLetter: "N",
        sampleCodeLetter: "N",
        belowPlan: expected.belowPlan,
        glovesPerInnerBox: 10,
        putBack: 0,
        codeLetterReduced: false,
        reducedFrom: null,
        belowLetter: false,
      },
    });
    expect(evaluation.issues).toEqual([]);
    expect(context.sampling).toEqual({
      M: {
        cases: 50,
        innerUnits: 50,
        gloves: 500,
        watertightVisual: 500,
        dimensions: 13,
        physical: 13,
        packagingDispensing: 13,
        pouches: null,
        pouchesDyeLeak: null,
      },
    });
  });

  it("B. STD_EG: sizes not ordered (XS, S, L, XL) appear nowhere, even with data saved for them (6.2 rule 4)", () => {
    const sampling = samplingPlanData(STD_EG_EXAMPLE);
    const data = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { ...sampling.sizes, XS: { cases: 5, glovesWatertightVisual: 80 } } },
    });
    const { context, evaluation } = evaluate(STD_EG_EXAMPLE, templateConfig("STD_EG"), data);
    expect(Object.keys(evaluation.result.perSize ?? {})).toEqual(["M"]);
    expect(Object.keys(evaluation.computed.sizes)).toEqual(["M"]);
    expect(evaluation.computed.totals).toMatchObject({ cases: 50, glovesWatertightVisual: 500 });
    expect(Object.keys(context.sampling)).toEqual(["M"]);
    expect(evaluation.result.status).toBe("info");
    expect(evaluation.issues.map(({ code, size }) => [code, size])).toEqual([["size_not_ordered", "XS"]]);
  });

  it("B. STD_EG: text in a count is refused, never stored (6.2 rule 1)", () => {
    const data = exampleData(STD_EG_EXAMPLE, { sampling_plan: { sizes: { M: { cases: "5 0" } } } });
    const { evaluation } = evaluate(STD_EG_EXAMPLE, templateConfig("STD_EG"), data);
    expect(evaluation.result.status).toBe("not_done");
    expect(evaluation.issues.map(({ code, level, path }) => ({ code, level, path }))).toEqual([
      { code: "invalid_data", level: "error", path: ["sizes", "M", "cases"] },
    ]);
  });
});

describe("sampling_plan against the AQLs the template's watertight and visual apply (AQL_SOURCES)", () => {
  type Entry = Parameters<typeof makeTestTemplate>[1][number];

  /** STD_EG size M (5,800,000 gloves, 500 sampled) at level I, with the real watertight and visual configured as given. */
  function lotCheck(entries: readonly Entry[], aqlDefaults: Partial<AqlDefaults> = {}) {
    const template = makeTestTemplate(ENGINE_REGISTRY, [
      "order_lots",
      "packing_config",
      { key: "sampling_plan", config: templateConfig("STD_EG") },
      ...entries,
    ]);
    const data = exampleData(STD_EG_EXAMPLE);
    const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR }, aqlDefaults }, ENGINE_REGISTRY);
    const found = evaluateInspection({ template, data, context }, ENGINE_REGISTRY).modules.find(
      (entry) => entry.key === "sampling_plan",
    );
    if (!found) throw new Error("sampling_plan was not evaluated");
    return { context, computed: found.computed as SamplingPlanComputed, messages: found.issues.map((issue) => issue.message) };
  }

  const watertight = (aql: number | null): Entry => ({ key: "watertight", config: { ...WATERTIGHT_DEFAULT_CONFIG, aql } });
  const visual = (minor: { include: boolean; aql: number | null }): Entry => ({
    key: "visual",
    config: { ...VISUAL_DEFAULT_CONFIG, classes: { ...VISUAL_DEFAULT_CONFIG.classes, minor: { ...VISUAL_DEFAULT_CONFIG.classes.minor, ...minor } } },
  });
  it("works out the larger sample a template watertight AQL's arrow down asks for, flagging nothing", () => {
    // AQL 0.065 at code N points down to P (n 800); the 500 sampled are enough for STD_EG's 1.5.
    const strict = lotCheck([watertight(0.065), visual({ include: true, aql: null })]);
    expect(strict.context.aql.watertight).toBe(0.065);
    expect(strict.computed.sizes.M).toMatchObject({ codeLetter: "N", planSampleSize: 800, planCodeLetter: "P", belowPlan: true });
    expect(strict.messages).toEqual([]);

    const plain = lotCheck([watertight(1.5), visual({ include: true, aql: null })]);
    expect(plain.computed.sizes.M).toMatchObject({ planSampleSize: 500, planCodeLetter: "N", belowPlan: false });
    expect(plain.messages).toEqual([]);
  });

  it("asks nothing for a visual class the template switches off", () => {
    const on = lotCheck([watertight(1.5), visual({ include: true, aql: 0.065 })]);
    expect(on.computed.sizes.M).toMatchObject({ planSampleSize: 800, belowPlan: true });
    expect(on.messages).toEqual([]);
    const off = lotCheck([watertight(1.5), visual({ include: false, aql: 0.065 })]);
    expect(off.context.aql.minor).toBeNull();
    expect(off.computed.sizes.M).toMatchObject({ planSampleSize: 500, belowPlan: false });
    expect(off.messages).toEqual([]);
  });

  it("asks nothing for watertight when the inspection does not run it, not even the client's AQL", () => {
    const client = { watertight: 0.065 };
    expect(lotCheck([watertight(null), visual({ include: true, aql: null })], client).computed.sizes.M).toMatchObject({
      planSampleSize: 800,
      belowPlan: true,
    });
    const switchedOff: Entry = {
      key: "watertight",
      config: { ...WATERTIGHT_DEFAULT_CONFIG, aql: null },
      include: false,
      override: { reason: "Tested at the lab", by: "00000000-0000-4000-8000-000000000102", at: "2026-10-07T08:00:00.000Z" },
    };
    const off = lotCheck([switchedOff, visual({ include: true, aql: null })], client);
    expect(off.context.aql.watertight).toBeNull();
    expect(off.computed.sizes.M).toMatchObject({ planSampleSize: 500, belowPlan: false });
  });
});
