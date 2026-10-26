import { describe, expect, it } from "vitest";
import { moduleConfig } from "@/lib/coverage";
import {
  buildInspectionContext,
  evaluateInspection,
  type AqlDefaults,
  type CalcInput,
  type InspectionContext,
} from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
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
import { calcSamplingPlan, contributeSamplingPlan, lotPlan, samplingValues, type SamplingPlanComputed } from "./calc";
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
  return { columns: { ...config.columns }, inspectionLevel: config.inspectionLevel };
}

describe("sampling_plan", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("is info once every shown column is entered for every ordered size, with no level set", () => {
    expect(calcSamplingPlan(input({ M: ROW_M }))).toEqual({
      result: {
        status: "info",
        summary: "Size M: Case: 50; # Gloves for Watertight & Visual: 500.",
        perSize: { M: { status: "info", summary: "Case: 50; # Gloves for Watertight & Visual: 500." } },
      },
      computed: {
        inspectionLevel: null,
        sizes: {
          M: {
            lotSizeGloves: 5_800_000,
            codeLetter: null,
            planSampleSize: null,
            planCodeLetter: null,
            sampleCodeLetter: "N",
            belowPlan: null,
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
        },
      },
      issues: [],
    });
  });

  it("is not done while a shown column is empty, naming it in the template's wording (6.2 rule 5)", () => {
    const labels = { ...SAMPLING_PLAN_LABELS, innerUnits: "Inner Pack", glovesPhysical: "# Gloves for Tensile" };
    const output = calcSamplingPlan({ ...input({ M: { ...ROW_M, innerUnits: null, glovesPhysical: null } }), labels });
    expect(output.result).toMatchObject({
      status: "not_done",
      perSize: { M: { status: "not_done", summary: "Missing: Inner Pack, # Gloves for Tensile." } },
    });
    expect(output.issues).toEqual([]);
    expect(calcSamplingPlan(input({ M: { cases: 50 } })).result.perSize?.M.summary).toBe(
      "Missing: Inner Box, Gloves, # Gloves for Watertight & Visual, # Gloves for Dimension, # Gloves for FAB, # Inner Box for Packaging & Dispensing Inspection.",
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
    expect(some.result.summary).toBe("Size S, L: Not started. Size M: Missing: Gloves.");
  });

  it("never asks for the gloves for weight, even where the template switches the row on (Kenneth, 26 October 2026)", () => {
    const empty = calcSamplingPlan(input({ M: ROW_M }, WEIGHT_ROW));
    expect(empty.result.perSize?.M).toEqual({ status: "info", summary: "Case: 50; # Gloves for Watertight & Visual: 500." });
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
      summary: "Size M: Case: 50; # Gloves for Watertight & Visual: 500.",
      perSize: {
        M: { status: "info", summary: "Case: 50; # Gloves for Watertight & Visual: 500." },
      },
    });
    expect(output.computed.sizes.M).toEqual({
      lotSizeGloves: 5_800_000,
      codeLetter: "N",
      planSampleSize: 500,
      planCodeLetter: "N",
      sampleCodeLetter: "N",
      belowPlan: false,
    });
    expect(output.issues).toEqual([]);
  });

  it("does not warn when the watertight and visual sample is below the plan (Kenneth, 26 October 2026: \"the warning is not needed\")", () => {
    const output = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 315 } }, LEVEL_I));
    expect(output.result).toMatchObject({
      status: "info",
      perSize: { M: { status: "info", summary: "Case: 50; # Gloves for Watertight & Visual: 315." } },
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
      summary: "Case is 0; # Gloves for Watertight & Visual 1 is below 2.",
    });
    expect(zero.issues).toEqual([
      {
        level: "error",
        code: "cases_zero",
        message: "Size M, Case: 0 cases sampled; every ordered size needs at least 1.",
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
    expect(above.result.perSize?.M).toEqual({ status: "not_done", summary: "Case 3,000 is more than the 2,900 ordered." });
    expect(above.issues).toEqual([
      {
        level: "error",
        code: "cases_above_order",
        message: "Size M, Case: 3,000 cases sampled, more than the 2,900 cases ordered.",
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
    expect(output.result.perSize?.M).toEqual({ status: "info", summary: "Case: 50; # Gloves for Watertight & Visual: 500." });
    expect(output.computed.sizes.M).toMatchObject({ lotSizeGloves: null, codeLetter: null, belowPlan: null });
    // Without a level there is nothing to check.
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

  it("A. SAFEDON_EG without an inspection level: the samples are taken as entered, nothing flagged", () => {
    const { evaluation } = evaluate(SAFEDON_EG_EXAMPLE, { ...templateConfig("SAFEDON_EG"), inspectionLevel: null });
    expect(evaluation.result.status).toBe("info");
    expect(evaluation.issues).toEqual([]);
  });

  it("B. STD_EG at level I: M (5,800,000 gloves) is code N, n 500, matching the 500 sampled", () => {
    const { context, evaluation } = evaluate(STD_EG_EXAMPLE, templateConfig("STD_EG"));
    const expected = STD_EG_EXPECTED.sampling.M!;
    expect(evaluation.result).toEqual({
      status: "info",
      summary: "Size M: Case: 50; # Gloves for Watertight & Visual: 500.",
      perSize: {
        M: { status: "info", summary: "Case: 50; # Gloves for Watertight & Visual: 500." },
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
