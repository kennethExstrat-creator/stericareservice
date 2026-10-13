import { describe, expect, it } from "vitest";
import { buildInspectionContext, evaluateInspection, type CalcInput, type InspectionContext, type InspectionData } from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { ENGINE_REGISTRY, cartonSamplingData, exampleData } from "@/modules/sampling_plan/__fixtures__/examples";
import {
  cartonList,
  SAFEDON_EG_EXAMPLE,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
} from "@/tests/fixtures/examples";
import { calcCartonSampling, contributeCartonSampling, cartonEntry, type CartonSamplingComputed } from "./calc";
import { CARTON_SAMPLING_DEFAULT_CONFIG, CARTON_SAMPLING_LABELS, type CartonSamplingConfig } from "./config";
import { definition } from "./index";
import { emptyCartonSampling, type CartonSamplingData } from "./schema";

/** Size M: 2,900 cases ordered, 5 sampled. */
function contextM(overrides: Partial<InspectionContext> = {}): InspectionContext {
  return makeTestContext({
    sizes: ["M"],
    order: { M: { qtyCases: 2900, lotNumbers: ["LOT-A01"] } },
    sampling: { M: makeSampling({ cases: 5 }) },
    ...overrides,
  });
}

function input(
  sizes: Record<string, readonly (number | null)[]>,
  context: InspectionContext = contextM(),
): CalcInput<CartonSamplingData, CartonSamplingConfig> {
  return {
    data: { sizes: Object.fromEntries(Object.entries(sizes).map(([size, cartons]) => [size, { cartonNumbers: [...cartons] }])) },
    config: CARTON_SAMPLING_DEFAULT_CONFIG,
    title: "Finished Goods Sampling Information (carton number)",
    labels: CARTON_SAMPLING_LABELS,
    context,
    results: {},
    hasData: true,
  };
}

/** Through the engine: the example's order, packing, sampling plan and cartons. */
function evaluate(example: ExampleReport, data: InspectionData = exampleData(example)) {
  const template = makeTestTemplate(ENGINE_REGISTRY, ["order_lots", "packing_config", "sampling_plan", "carton_sampling"]);
  const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
  const evaluation = evaluateInspection({ template, data, context }, ENGINE_REGISTRY);
  const found = evaluation.modules.find((entry) => entry.key === "carton_sampling");
  if (!found) throw new Error("carton_sampling was not evaluated");
  return { context, evaluation: { ...found, computed: found.computed as CartonSamplingComputed }, all: evaluation };
}

const VALID = [32, 578, 1186, 2389, 2865];

describe("carton_sampling", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("passes when a size lists exactly the cases sampled, unique and between 1 and the order quantity (6.2 rule 6)", () => {
    expect(calcCartonSampling(input({ M: VALID }))).toEqual({
      result: {
        status: "pass",
        summary: "Size M: 5 box/carton numbers, unique and between 1 and 2,900.",
        perSize: { M: { status: "pass", summary: "5 box/carton numbers, unique and between 1 and 2,900." } },
      },
      computed: { sizes: { M: { samplingQuantity: 5, unique: 5, sampledCases: 5, orderQty: 2900 } } },
      issues: [],
    });
    // The first and the last carton of the order are in range.
    expect(calcCartonSampling(input({ M: [1, 2, 3, 4, 2900] })).result.status).toBe("pass");
  });

  it("is not done while the list is short, and blank cells are not cartons (6.2 rule 5)", () => {
    const short = calcCartonSampling(input({ M: [32, null, 578] }));
    expect(short.result).toMatchObject({ status: "not_done", perSize: { M: { status: "not_done", summary: "2 of 5 box/carton numbers." } } });
    expect(short.computed.sizes.M).toEqual({ samplingQuantity: 2, unique: 2, sampledCases: 5, orderQty: 2900 });
    expect(short.issues).toEqual([]);
    expect(calcCartonSampling(input({ M: [32, null, 578, null, 1186, 2389, 2865, null] })).result.status).toBe("pass");
    expect(calcCartonSampling(input({})).result.perSize?.M).toEqual({ status: "not_done", summary: "0 of 5 box/carton numbers." });
  });

  it("waits for the sampled cases and the order quantity: without them the list cannot be checked", () => {
    const noPlan = calcCartonSampling(input({ M: VALID }, contextM({ sampling: {} })));
    expect(noPlan.result.perSize?.M).toEqual({
      status: "not_done",
      summary: "Waiting for the sampled cases; 5 box/carton numbers entered.",
    });
    const noOrder = calcCartonSampling(input({ M: VALID }, contextM({ order: {}, sampling: {} })));
    expect(noOrder.result.perSize?.M?.summary).toBe("Waiting for the order quantity and the sampled cases; 5 box/carton numbers entered.");
    const none = calcCartonSampling(input({ M: [] }, contextM({ sampling: { M: makeSampling({ cases: 0 }) } })));
    expect(none.result.perSize?.M).toEqual({ status: "not_done", summary: "No cases sampled." });
  });

  it("fails on a carton entered twice, with a link to the second entry and both cells named", () => {
    const output = calcCartonSampling(input({ M: [32, 578, 578, 1186, 2389] }));
    expect(output.result).toEqual({
      status: "fail",
      summary: "Size M: Box/Carton #578 is entered twice (No. 2, No. 3).",
      perSize: { M: { status: "fail", summary: "Box/Carton #578 is entered twice (No. 2, No. 3)." } },
    });
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "carton_duplicate",
        message: "Size M: Box/Carton #578 is entered twice (No. 2, No. 3).",
        size: "M",
        path: ["sizes", "M", "cartonNumbers", 2],
      },
    ]);
    expect(output.computed.sizes.M).toMatchObject({ samplingQuantity: 5, unique: 4 });
    const thrice = calcCartonSampling(input({ M: [578, 32, 578, 1186, 578] }));
    expect(thrice.issues.map((issue) => issue.message)).toEqual([
      "Size M: Box/Carton #578 is entered 3 times (No. 1, No. 3, No. 5).",
    ]);
  });

  it("fails on a carton above the order quantity, in grid order, with a link to its cell", () => {
    const output = calcCartonSampling(input({ M: [32, 2901, 578, 1186, 9999] }));
    expect(output.result.status).toBe("fail");
    expect(output.result.perSize?.M?.summary).toBe("Box/Carton #2901 is not between 1 and 2,900, the order quantity (No. 2); 1 more.");
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "carton_out_of_range",
        message: "Size M: Box/Carton #2901 is not between 1 and 2,900, the order quantity (No. 2).",
        size: "M",
        path: ["sizes", "M", "cartonNumbers", 1],
      },
      {
        level: "error",
        code: "carton_out_of_range",
        message: "Size M: Box/Carton #9999 is not between 1 and 2,900, the order quantity (No. 5).",
        size: "M",
        path: ["sizes", "M", "cartonNumbers", 4],
      },
    ]);
  });

  it("fails on more carton numbers than cases sampled; the count includes a duplicate", () => {
    const output = calcCartonSampling(input({ M: [...VALID, 7] }));
    expect(output.result.status).toBe("fail");
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "carton_count_above_cases",
        message: "Size M: 6 box/carton numbers, but the sampling plan has 5 cases.",
        size: "M",
        path: ["sizes", "M", "cartonNumbers"],
      },
    ]);
    // A duplicate is one mistake, not two: the count still matches.
    expect(calcCartonSampling(input({ M: [32, 32, 1186, 2389, 2865] })).issues.map((issue) => issue.code)).toEqual([
      "carton_duplicate",
    ]);
    const one = contextM({ sampling: { M: makeSampling({ cases: 1 }) } });
    expect(calcCartonSampling(input({ M: [32, 578] }, one)).issues.map((issue) => issue.message)).toEqual([
      "Size M: 2 box/carton numbers, but the sampling plan has 1 case.",
    ]);
    expect(calcCartonSampling(input({ M: [32] }, one)).result.summary).toBe(
      "Size M: 1 box/carton number, unique and between 1 and 2,900.",
    );
  });

  it("checks each ordered size on its own: the same number may appear in two sizes", () => {
    const context = makeTestContext({
      sizes: ["S", "M"],
      order: { S: { qtyCases: 850, lotNumbers: [] }, M: { qtyCases: 560, lotNumbers: [] } },
      sampling: { S: makeSampling({ cases: 2 }), M: makeSampling({ cases: 2 }) },
    });
    const output = calcCartonSampling(input({ XS: [1, 1], S: [51, 88], M: [51, 600] }, context));
    expect(output.result).toEqual({
      status: "fail",
      summary: "Size M: Box/Carton #600 is not between 1 and 560, the order quantity (No. 2).",
      perSize: {
        S: { status: "pass", summary: "2 box/carton numbers, unique and between 1 and 850." },
        M: { status: "fail", summary: "Box/Carton #600 is not between 1 and 560, the order quantity (No. 2)." },
      },
    });
    expect(Object.keys(output.computed.sizes)).toEqual(["S", "M"]);
    const fixed = calcCartonSampling(input({ S: [51, 88], M: [51, 60] }, context));
    expect(fixed.result.summary).toBe("Box/carton numbers complete, unique and within the order quantity for size S (2), M (2).");
  });

  it("names the sizes that share a summary together, so an empty grid sums up in one short line", () => {
    const order = {
      XS: { qtyCases: 60, lotNumbers: [] },
      S: { qtyCases: 850, lotNumbers: [] },
      M: { qtyCases: 560, lotNumbers: [] },
      L: { qtyCases: 60, lotNumbers: [] },
    };
    const waiting = makeTestContext({ sizes: ["XS", "S", "M", "L"], order, sampling: {} });
    expect(calcCartonSampling(input({}, waiting)).result.summary).toBe(
      "Size XS, S, M, L: Waiting for the sampled cases; 0 box/carton numbers entered.",
    );
    const sampling = {
      XS: makeSampling({ cases: 5 }),
      S: makeSampling({ cases: 20 }),
      M: makeSampling({ cases: 15 }),
      L: makeSampling({ cases: 5 }),
    };
    const planned = makeTestContext({ sizes: ["XS", "S", "M", "L"], order, sampling });
    expect(calcCartonSampling(input({}, planned)).result.summary).toBe(
      "Size XS, L: 0 of 5 box/carton numbers. Size S: 0 of 20 box/carton numbers. Size M: 0 of 15 box/carton numbers.",
    );
  });

  it("names a carton by its No. in the capture table", () => {
    expect([0, 9, 10, 19, 20, 49, 50].map(cartonEntry)).toEqual([
      "No. 1",
      "No. 10",
      "No. 11",
      "No. 20",
      "No. 21",
      "No. 50",
      "No. 51",
    ]);
  });

  it("passes the entered numbers forward into the context", () => {
    expect(contributeCartonSampling({ data: { sizes: { M: { cartonNumbers: [32, null, 578] } } }, config: {} })).toEqual({
      cartons: { M: [32, 578] },
    });
    expect(contributeCartonSampling({ data: emptyCartonSampling(), config: {} })).toEqual({ cartons: {} });
  });
});

describe("carton_sampling with the example reports (docs/examples/expected-results.md)", () => {
  it("B. STD_EG: one carton entered twice (50 entries, 49 unique) is an error that fails the module and blocks submit", () => {
    const { evaluation, all } = evaluate(STD_EG_EXAMPLE);
    const expected = STD_EG_EXPECTED.cartonList;
    const [error] = STD_EG_EXPECTED.errors;
    const second = expected.duplicate.cells[1];

    expect(evaluation.result.status).toBe(expected.status);
    expect(evaluation.result.perSize).toEqual({ M: { status: "fail", summary: `${error.message}` } });
    expect(evaluation.computed.sizes.M).toEqual({
      samplingQuantity: expected.entries,
      unique: expected.unique,
      sampledCases: STD_EG_EXAMPLE.sampling.M!.cases,
      orderQty: STD_EG_EXAMPLE.order.lines.M!.qtyCases,
    });
    // The conclusion's own error (no final result yet) is left aside: it is not this module's.
    const errors = all.issues.filter((issue) => issue.level === "error" && issue.moduleKey !== "conclusion");
    expect(errors).toEqual([
      {
        level: "error",
        moduleKey: error.module,
        code: error.code,
        message: `Size M: ${error.message}`,
        size: error.size,
        path: ["sizes", "M", "cartonNumbers", (second.row - 1) * 10 + (second.column - 1)],
      },
    ]);
  });

  it("B. STD_EG: the correction (an unused number in range for the second entry) clears the error and passes", () => {
    const { duplicateCarton } = STD_EG_EXPECTED.corrections;
    const index = (duplicateCarton.cell.row - 1) * 10 + (duplicateCarton.cell.column - 1);
    const cartons = cartonList(STD_EG_EXAMPLE.cartons.M!);
    expect(cartons[index]).toBe(duplicateCarton.from);
    cartons[index] = duplicateCarton.to;
    const data = exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: cartons } } } });
    const { context, evaluation, all } = evaluate(STD_EG_EXAMPLE, data);
    expect(evaluation.result).toMatchObject({
      status: "pass",
      summary: "Size M: 50 box/carton numbers, unique and between 1 and 2,900.",
    });
    expect(all.issues.filter((issue) => issue.level === "error" && issue.moduleKey !== "conclusion")).toEqual([]);
    // The context holds the 50 cartons. The dispensing box 2336 is none of them: dispensing warns about it (6.2 rule 7).
    expect(context.cartons.M).toHaveLength(50);
    expect(context.cartons.M).not.toContain(STD_EG_EXPECTED.dispensingBox.box);
    expect(context.cartons.M).toContain(STD_EG_EXPECTED.dispensingBox.likelyIntended);
  });

  it("B. STD_EG: sizes not ordered (XS, S, L, XL) appear nowhere, even with cartons saved for them (6.2 rule 4)", () => {
    const saved = cartonSamplingData(STD_EG_EXAMPLE);
    const data = exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { ...saved.sizes, XS: { cartonNumbers: [1, 1] } } } });
    const { context, evaluation } = evaluate(STD_EG_EXAMPLE, data);
    expect(Object.keys(evaluation.result.perSize ?? {})).toEqual(["M"]);
    expect(Object.keys(evaluation.computed.sizes)).toEqual(["M"]);
    expect(Object.keys(context.cartons)).toEqual(["M"]);
    expect(evaluation.issues.map(({ code, size }) => [code, size])).toEqual([
      ["size_not_ordered", "XS"],
      ["carton_duplicate", "M"],
    ]);
  });

  it("A. SAFEDON_EG: every size lists its sampled cases, unique and in range, the out-of-run carton of S included", () => {
    const { context, evaluation, all } = evaluate(SAFEDON_EG_EXAMPLE);
    expect(evaluation.result).toEqual({
      status: "pass",
      summary: "Box/carton numbers complete, unique and within the order quantity for size XS (5), S (20), M (15), L (5).",
      perSize: {
        XS: { status: "pass", summary: "5 box/carton numbers, unique and between 1 and 60." },
        S: { status: "pass", summary: "20 box/carton numbers, unique and between 1 and 850." },
        M: { status: "pass", summary: "15 box/carton numbers, unique and between 1 and 560." },
        L: { status: "pass", summary: "5 box/carton numbers, unique and between 1 and 60." },
      },
    });
    expect(all.issues.filter((issue) => issue.moduleKey === "carton_sampling")).toEqual([]);
    // The dispensing boxes of the report are cartons of the list (rule 7).
    for (const [size, entry] of Object.entries(SAFEDON_EG_EXAMPLE.dispensingSafedon.perSize)) {
      for (const box of entry.boxes) expect(context.cartons[size], `${size} box ${box}`).toContain(box);
    }
  });

  it("A. SAFEDON_EG: a list taken from a different size's grid fails on the order quantity", () => {
    // Size S's first five cartons on XS, which has 60 cases: only the first is in range.
    const saved = cartonSamplingData(SAFEDON_EG_EXAMPLE);
    const data = exampleData(SAFEDON_EG_EXAMPLE, {
      carton_sampling: { sizes: { ...saved.sizes, XS: { cartonNumbers: cartonList(SAFEDON_EG_EXAMPLE.cartons.S!).slice(0, 5) } } },
    });
    const { evaluation } = evaluate(SAFEDON_EG_EXAMPLE, data);
    expect(evaluation.result.status).toBe("fail");
    expect(evaluation.issues.map(({ code, size, path }) => [code, size, path.at(-1)])).toEqual([
      ["carton_out_of_range", "XS", 1],
      ["carton_out_of_range", "XS", 2],
      ["carton_out_of_range", "XS", 3],
      ["carton_out_of_range", "XS", 4],
    ]);
  });
});
