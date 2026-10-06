import { describe, expect, it } from "vitest";
import { moduleConfig } from "@/lib/coverage";
import { buildInspectionContext, evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import {
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
} from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "./__fixtures__/examples";
import { calcSamplingPlan, contributeSamplingPlan, lotPlan, samplingValues, type SamplingPlanComputed } from "./calc";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingPlanConfig } from "./config";
import { definition } from "./index";
import { emptySamplingPlan, emptySamplingSize, type SamplingPlanData, type SamplingSize } from "./schema";

const LEVEL_I: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "I" };

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
        summary: "Size M: Case: 50; # gloves for watertight & Visual: 500.",
        perSize: { M: { status: "info", summary: "Case: 50; # gloves for watertight & Visual: 500." } },
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
    const labels = { ...SAMPLING_PLAN_LABELS, innerUnits: "Inner pack", glovesPhysical: "# gloves for Tensile" };
    const output = calcSamplingPlan({ ...input({ M: { ...ROW_M, innerUnits: null, glovesPhysical: null } }), labels });
    expect(output.result).toMatchObject({
      status: "not_done",
      perSize: { M: { status: "not_done", summary: "Missing: Inner pack, # gloves for Tensile." } },
    });
    expect(output.issues).toEqual([]);
    expect(calcSamplingPlan(input({})).result.status).toBe("not_done");
    expect(calcSamplingPlan(input({ M: {} })).result.perSize?.M.summary).toBe(
      "Missing: Case, Inner Box, Gloves, # gloves for watertight & Visual, # gloves for dimension, # gloves for FAB, # inner box for packaging & dispensing inspection.",
    );
  });

  it("asks only for the columns the template shows: the surgical pouches, or no gloves column (STD_SG)", () => {
    const surgical: SamplingPlanConfig = {
      ...SAMPLING_PLAN_DEFAULT_CONFIG,
      columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, gloves: false, innerUnitsDispensing: false, pouches: true, pouchesDyeLeak: true },
    };
    const row = { ...ROW_M, gloves: null, innerUnitsDispensing: null };
    expect(calcSamplingPlan(input({ M: row }, surgical)).result.perSize?.M).toEqual({
      status: "not_done",
      summary: "Missing: Pouches, # pouches (dye leak test).",
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

  it("computes the inspection level's plan from the lot in gloves: STD_EG M at level I is code N, n 500, met", () => {
    const output = calcSamplingPlan(input({ M: ROW_M }, LEVEL_I));
    expect(output.result).toEqual({
      status: "info",
      summary: "Size M: Case: 50; # gloves for watertight & Visual: 500; inspection level I needs 500 (code N).",
      perSize: {
        M: { status: "info", summary: "Case: 50; # gloves for watertight & Visual: 500; inspection level I needs 500 (code N)." },
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

  it("warns when the watertight and visual sample is below the plan, with a link to the cell (BUILD_SPEC 6.1, 7)", () => {
    const output = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 315 } }, LEVEL_I));
    expect(output.result).toMatchObject({
      status: "warn",
      perSize: { M: { status: "warn", summary: "315 sampled, inspection level I needs 500 (code N)." } },
    });
    expect(output.computed.sizes.M).toMatchObject({ planSampleSize: 500, sampleCodeLetter: "M", belowPlan: true });
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "sample_below_plan",
        message:
          "Size M, # gloves for watertight & Visual: 315 gloves sampled; inspection level I needs 500 (lot 5,800,000 gloves, code N).",
        size: "M",
        path: ["sizes", "M", "glovesWatertightVisual"],
      },
    ]);
    // A larger sample than the plan sets its own, stricter code letter: nothing to flag.
    const larger = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 800 } }, LEVEL_I));
    expect(larger.issues).toEqual([]);
    expect(larger.computed.sizes.M).toMatchObject({ sampleCodeLetter: "P", belowPlan: false });
  });

  it("asks for the largest n the AQLs need: an arrow down names its AQL (docs/AQL.md, BUILD_SPEC 7 lot 100)", () => {
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
    expect(output.issues.map((issue) => issue.message)).toEqual([
      "Size M, # gloves for watertight & Visual: 8 gloves sampled; inspection level I at AQL 4.0 needs 13 (lot 100 gloves, code E).",
    ]);
    // A client's AQLs: watertight 1.0 on lot 1,000 at level I needs H (n 50) where Table 1 gives G (n 32).
    expect(lotPlan(1_000, "I", { ...context.aql, watertight: 1.0 })).toMatchObject({ codeLetter: "G", usedLetter: "H", n: 50 });
    // An AQL Table 2-A does not have is left out; none left means no plan.
    expect(lotPlan(1_000, "I", { ...context.aql, watertight: 3, critical: 3, major: 3, minor: 3 })).toBeNull();
  });

  it("asks for every glove when the plan's n is not smaller than the lot", () => {
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
    expect(output.issues.map((issue) => issue.message)).toEqual([
      "Size M, # gloves for watertight & Visual: 5 gloves sampled; inspection level III at AQL 0.65 needs all 8 (lot 8 gloves, code F).",
    ]);
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
        code: "sample_nonstandard",
        message:
          "Size M, # gloves for watertight & Visual: 100 is not a standard sample size, so it is read as code letter J (n 80), the largest standard sample size below it.",
        size: "M",
        path: ["sizes", "M", "glovesWatertightVisual"],
      },
    ]);
    // Below a level's plan too: both are flagged.
    const both = calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 400 } }, LEVEL_I));
    expect(both.issues.map((issue) => issue.code)).toEqual(["sample_nonstandard", "sample_below_plan"]);
    expect(calcSamplingPlan(input({ M: { ...ROW_M, glovesWatertightVisual: 2500 } })).computed.sizes.M.sampleCodeLetter).toBe("R");
  });

  it("rejects impossible samples with errors that block submit: no case, more cases than ordered, fewer than 2 gloves", () => {
    const zero = calcSamplingPlan(input({ M: { ...ROW_M, cases: 0, glovesWatertightVisual: 1 } }, LEVEL_I));
    expect(zero.result.perSize?.M).toEqual({
      status: "not_done",
      summary: "Case is 0; # gloves for watertight & Visual 1 is below 2.",
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
        code: "sample_size_invalid",
        message: "Size M, # gloves for watertight & Visual: 1 gloves sampled; an ISO 2859-1 sample has at least 2.",
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
        message: "Size M, Case: 3,000 cases sampled, but 2,900 were ordered.",
        size: "M",
        path: ["sizes", "M", "cases"],
      },
    ]);
    // Exactly the order is possible; a column switched off is never checked.
    expect(calcSamplingPlan(input({ M: { ...ROW_M, cases: 2900 } })).issues).toEqual([]);
    const noCases = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, cases: false } };
    expect(calcSamplingPlan(input({ M: { ...ROW_M, cases: 0 } }, noCases)).issues).toEqual([]);
  });

  it("is not done with a level set until the lot size is known: the plan cannot be checked", () => {
    const context = contextM({ packing: { ...contextM().packing, glovesPerCase: null } });
    const output = calcSamplingPlan(input({ M: ROW_M }, LEVEL_I, context));
    expect(output.result.perSize?.M).toEqual({
      status: "not_done",
      summary: "Lot size unknown: the inspection level I plan needs the order quantity and the gloves per case.",
    });
    expect(output.computed.sizes.M).toMatchObject({ lotSizeGloves: null, codeLetter: null, belowPlan: null });
    // Without a level there is nothing to check.
    expect(calcSamplingPlan(input({ M: ROW_M }, SAMPLING_PLAN_DEFAULT_CONFIG, context)).result.status).toBe("info");
  });

  it("takes the client's inspection level when the template sets none; the template's wins", () => {
    const context = contextM({ aql: { ...makeTestContext().aql, inspectionLevel: "II" } });
    // Lot 5,800,000 at level II is code Q (n 1,250).
    const client = calcSamplingPlan(input({ M: ROW_M }, SAMPLING_PLAN_DEFAULT_CONFIG, context));
    expect(client.computed).toMatchObject({ inspectionLevel: "II", sizes: { M: { codeLetter: "Q", planSampleSize: 1250 } } });
    expect(client.issues.map((issue) => issue.code)).toEqual(["sample_below_plan"]);
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
});

describe("sampling_plan with the example reports (docs/examples/expected-results.md)", () => {
  it("A. SAFEDON_EG at level I: XS and L (120,000 gloves) need 200, S and M (over 500,000) need 500, so 80 and 200 are flagged", () => {
    const config = templateConfig("SAFEDON_EG");
    expect(config.inspectionLevel).toBe("I");
    const { context, evaluation } = evaluate(SAFEDON_EG_EXAMPLE, config);

    expect(evaluation.result.status).toBe("warn");
    expect(evaluation.result.perSize).toEqual({
      XS: { status: "warn", summary: "80 sampled, inspection level I needs 200 (code L)." },
      S: { status: "warn", summary: "200 sampled, inspection level I needs 500 (code N)." },
      M: { status: "warn", summary: "200 sampled, inspection level I needs 500 (code N)." },
      L: { status: "warn", summary: "80 sampled, inspection level I needs 200 (code L)." },
    });
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
    const warnings = evaluation.issues.filter((issue) => issue.code === "sample_below_plan");
    expect(warnings.map(({ level, moduleKey, size }) => ({ level, module: moduleKey, size }))).toEqual(
      SAFEDON_EG_EXPECTED.warnings.map(({ level, module, size }) => ({ level, module, size })),
    );
    SAFEDON_EG_EXPECTED.warnings.forEach((expected, index) => {
      expect(warnings[index].message).toContain(expected.message);
      expect(warnings[index].path).toEqual(["sizes", expected.size, "glovesWatertightVisual"]);
    });
    expect(evaluation.issues.filter((issue) => issue.level === "error")).toEqual([]);

    // Numbers flow forward: n for watertight and visual, dimensions, tensile and dispensing.
    expect(context.aql.inspectionLevel).toBe("I");
    expect(context.sampling.XS).toMatchObject({ cases: 5, watertightVisual: 80, dimensions: 13, physical: 13, packagingDispensing: 5 });
    expect(context.sampling.M).toMatchObject({ cases: 15, watertightVisual: 200, packagingDispensing: 8 });
    expect(evaluation.computed.totals).toMatchObject({ cases: 45, glovesWatertightVisual: 560, innerUnitsDispensing: 26 });
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
      summary: "Size M: Case: 50; # gloves for watertight & Visual: 500; inspection level I needs 500 (code N).",
      perSize: {
        M: { status: "info", summary: "Case: 50; # gloves for watertight & Visual: 500; inspection level I needs 500 (code N)." },
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
