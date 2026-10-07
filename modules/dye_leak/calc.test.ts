import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  buildInspectionContext,
  evaluateInspection,
  type CalcInput,
  type InspectionContext,
} from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { STD_EG_EXAMPLE, STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { calcDyeLeak, plannedPouches } from "./calc";
import { DYE_LEAK_DEFAULT_CONFIG, DYE_LEAK_LABELS, type DyeLeakConfig } from "./config";
import { definition } from "./index";
import type { DyeLeakData, DyeLeakSize } from "./schema";

const SG_SIZES = ["6.5", "7.0", "7.5"];

function surgicalContext(overrides: Partial<InspectionContext> = {}): InspectionContext {
  return makeTestContext({
    template: { code: "TEST_SG", name: "Test surgical gloves", productType: "surgical", standard: "custom", unit: "pairs" },
    templateSizes: ["6.0", "6.5", "7.0", "7.5", "8.0"].map((value) => ({ value, label: value })),
    sizes: SG_SIZES,
    sampling: Object.fromEntries(SG_SIZES.map((size) => [size, makeSampling({ pouches: 20, pouchesDyeLeak: 13 })])),
    ...overrides,
  });
}

function size(values: Partial<DyeLeakSize>): DyeLeakSize {
  return { pouchesTested: null, pouchesFailed: null, notes: null, ...values };
}

function input(
  sizes: Record<string, Partial<DyeLeakSize>>,
  {
    config = DYE_LEAK_DEFAULT_CONFIG,
    context = surgicalContext(),
    labels = DYE_LEAK_LABELS,
  }: { config?: DyeLeakConfig; context?: InspectionContext; labels?: Record<string, string> } = {},
): CalcInput<DyeLeakData, DyeLeakConfig> {
  return {
    data: { sizes: Object.fromEntries(Object.entries(sizes).map(([key, values]) => [key, size(values)])) },
    config,
    title: "Dye Leak Test",
    labels,
    context,
    results: {},
    hasData: true,
  };
}

const ALL_PASS = {
  "6.5": { pouchesTested: 13, pouchesFailed: 0 },
  "7.0": { pouchesTested: 13, pouchesFailed: 0 },
  "7.5": { pouchesTested: 13, pouchesFailed: 0 },
};

describe("dye_leak", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
    expect(definition.perSize).toBe(true);
    expect(definition.handSplit).toBe(false);
  });

  it("passes every size where no pouch leaked", () => {
    expect(calcDyeLeak(input(ALL_PASS))).toEqual({
      result: {
        status: "pass",
        summary: "Pouches Failed: 0 of 39.",
        perSize: {
          "6.5": { status: "pass", summary: "Pouches Failed: 0 of 13." },
          "7.0": { status: "pass", summary: "Pouches Failed: 0 of 13." },
          "7.5": { status: "pass", summary: "Pouches Failed: 0 of 13." },
        },
      },
      computed: {
        pouchesPlanned: { "6.5": 13, "7.0": 13, "7.5": 13 },
        result: { "6.5": "pass", "7.0": "pass", "7.5": "pass" },
        totalTested: 39,
        totalFailed: 0,
      },
      issues: [],
    });
  });

  it("totals only the counts entered, and has no total before any (never a 0 for nothing tested)", () => {
    expect(calcDyeLeak(input({})).computed).toMatchObject({ totalTested: null, totalFailed: null });
    const partial = calcDyeLeak(input({ "6.5": { pouchesTested: 13 }, "7.5": { pouchesFailed: 2 } })).computed;
    expect(partial).toMatchObject({ totalTested: 13, totalFailed: 2 });
    const tested = calcDyeLeak(input({ "6.5": { pouchesTested: 13 }, "7.0": { pouchesTested: 8 } })).computed;
    expect(tested).toMatchObject({ totalTested: 21, totalFailed: null });
    // An entered 0 is a count: "no leaks" totals 0 failed.
    expect(calcDyeLeak(input({ "7.0": { pouchesFailed: 0 } })).computed.totalFailed).toBe(0);
  });

  it("fails a size on any leaking pouch, and the module with it (BUILD_SPEC 6.1)", () => {
    const output = calcDyeLeak(
      input({ ...ALL_PASS, "7.0": { pouchesTested: 13, pouchesFailed: 1, notes: "Dye channel at the seal corner." } }),
    );
    expect(output.result.status).toBe("fail");
    expect(output.result.summary).toBe("Pouches Failed: 1 of 13 in size 7.0.");
    expect(output.result.perSize?.["7.0"]).toEqual({ status: "fail", summary: "Pouches Failed: 1 of 13." });
    expect(output.result.perSize?.["6.5"]?.status).toBe("pass");
    expect(output.computed.result).toEqual({ "6.5": "pass", "7.0": "fail", "7.5": "pass" });
    expect(output.computed.totalFailed).toBe(1);
    expect(output.issues).toEqual([]);
  });

  it("fails on a recorded leak even before the pouches tested are entered", () => {
    const output = calcDyeLeak(input({ ...ALL_PASS, "7.5": { pouchesFailed: 2 } }));
    expect(output.result.perSize?.["7.5"]).toEqual({ status: "fail", summary: "Pouches Failed: 2." });
    expect(output.result.summary).toBe("Pouches Failed: 2 in size 7.5.");
  });

  it("is not done until both counts are entered, never passed (6.2 rule 5)", () => {
    const output = calcDyeLeak(input({ "6.5": { pouchesTested: 13 }, "7.0": { pouchesFailed: 0 } }));
    expect(output.result.status).toBe("not_done");
    expect(output.result.perSize).toEqual({
      "6.5": { status: "not_done", summary: "Missing: Pouches Failed." },
      "7.0": { status: "not_done", summary: "Missing: Pouches Tested." },
      "7.5": { status: "not_done", summary: "Missing: Pouches Tested, Pouches Failed." },
    });
    expect(output.result.summary).toBe("Not done for size 6.5, 7.0, 7.5.");
    expect(calcDyeLeak(input({})).result.status).toBe("not_done");
  });

  it("is not done while a size has nothing tested", () => {
    const output = calcDyeLeak(input({ ...ALL_PASS, "6.5": { pouchesTested: 0, pouchesFailed: 0 } }));
    expect(output.result.perSize?.["6.5"]).toEqual({ status: "not_done", summary: "Pouches Tested: 0, nothing tested yet." });
    expect(output.result.summary).toBe("Pouches Failed: 0 of 26. Not done for size 6.5.");
    expect(calcDyeLeak(input({ "6.5": { pouchesTested: 0 } })).result.perSize?.["6.5"]?.summary).toBe(
      "Pouches Tested: 0, nothing tested yet.",
    );
  });

  it("names a fail and the sizes still open together", () => {
    const output = calcDyeLeak(input({ "6.5": { pouchesTested: 13, pouchesFailed: 3 }, "7.0": { pouchesTested: 13 } }));
    expect(output.result.status).toBe("fail");
    expect(output.result.summary).toBe("Pouches Failed: 3 of 13 in size 6.5. Not done for size 7.0, 7.5.");
  });

  it("plans the pouches from the sampling plan, else from config n (BUILD_SPEC 8)", () => {
    const context = surgicalContext({
      sampling: { "6.5": makeSampling({ pouchesDyeLeak: 8 }), "7.0": makeSampling({ pouches: 20 }) },
    });
    expect(plannedPouches(context, { n: 5 }, "6.5")).toBe(8);
    expect(plannedPouches(context, { n: 5 }, "7.0")).toBe(5);
    expect(plannedPouches(context, { n: null }, "7.0")).toBeNull();
    const none = surgicalContext({ sampling: { "6.5": makeSampling({ pouchesDyeLeak: 0 }) } });
    expect(plannedPouches(none, { n: 5 }, "6.5")).toBe(5);
    expect(plannedPouches(none, { n: null }, "6.5")).toBeNull();
    expect(calcDyeLeak(input({}, { context, config: { n: 5 } })).computed.pouchesPlanned).toEqual({
      "6.5": 8,
      "7.0": 5,
      "7.5": 5,
    });
  });

  it("warns when fewer pouches were tested than planned, with a link to the count", () => {
    const output = calcDyeLeak(input({ ...ALL_PASS, "7.0": { pouchesTested: 8, pouchesFailed: 0 } }));
    expect(output.result.status).toBe("warn");
    expect(output.result.perSize?.["7.0"]).toEqual({ status: "warn", summary: "Pouches Failed: 0 of 8; 13 planned." });
    expect(output.result.summary).toBe("Pouches Failed: 0 of 34. Fewer pouches tested than planned for size 7.0.");
    // The leak verdict itself is a pass: the warning is about the sample.
    expect(output.computed.result["7.0"]).toBe("pass");
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "dye_leak_below_plan",
        message: "Size 7.0: Pouches Tested 8, below the 13 planned.",
        size: "7.0",
        path: ["sizes", "7.0", "pouchesTested"],
      },
    ]);
  });

  it("does not warn on more pouches than planned, or when nothing is planned", () => {
    expect(calcDyeLeak(input({ ...ALL_PASS, "7.0": { pouchesTested: 20, pouchesFailed: 0 } })).result.status).toBe("pass");
    const unplanned = surgicalContext({ sampling: {} });
    const output = calcDyeLeak(input({ ...ALL_PASS, "7.0": { pouchesTested: 2, pouchesFailed: 0 } }, { context: unplanned }));
    expect(output.result.status).toBe("pass");
    expect(output.issues).toEqual([]);
  });

  it("rejects more failed pouches than tested, with a link to the count", () => {
    const output = calcDyeLeak(input({ ...ALL_PASS, "7.5": { pouchesTested: 2, pouchesFailed: 3 } }));
    expect(output.result.status).toBe("fail");
    expect(output.issues).toContainEqual({
      level: "error",
      code: "dye_leak_failed_above_tested",
      message: "Size 7.5: Pouches Failed (3) is more than Pouches Tested (2).",
      size: "7.5",
      path: ["sizes", "7.5", "pouchesFailed"],
    });
  });

  it("speaks the template's wording", () => {
    const labels = { ...DYE_LEAK_LABELS, pouchesTested: "Pouches dyed", pouchesFailed: "Leaking pouches" };
    const output = calcDyeLeak(input({ "6.5": { pouchesTested: 8, pouchesFailed: 0 } }, { labels }));
    expect(output.result.perSize?.["7.0"]?.summary).toBe("Missing: Pouches dyed, Leaking pouches.");
    expect(output.issues[0]?.message).toBe("Size 6.5: Pouches dyed 8, below the 13 planned.");
  });

  it("shows only ordered sizes, using the STD_EG example's order (6.2 rule 4)", () => {
    const ordered = [...STD_EG_EXAMPLE.sizesOrdered];
    const unordered = STD_EG_EXPECTED.unorderedSizes.sizes;
    const context = makeTestContext({ sizes: ordered, sampling: { M: makeSampling({ pouchesDyeLeak: 13 }) } });
    const sizes = Object.fromEntries(
      [...ordered, ...unordered].map((key) => [key, { pouchesTested: 13, pouchesFailed: 0 }]),
    );
    const output = calcDyeLeak(input(sizes, { context }));
    expect(Object.keys(output.result.perSize ?? {})).toEqual(["M"]);
    expect(Object.keys(output.computed.result)).toEqual(["M"]);
    expect(output.computed.totalTested).toBe(13);
  });

  it("is not done with no size ordered", () => {
    const output = calcDyeLeak(input({ "7.0": { pouchesTested: 13, pouchesFailed: 0 } }, { context: surgicalContext({ sizes: [] }) }));
    expect(output.result).toEqual({ status: "not_done", summary: "No sizes ordered yet.", perSize: {} });
  });

  it("works through the engine: unordered sizes are left out with a warning", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "sampling_plan", "dye_leak"]);
    const data = {
      modules: {
        dye_leak: {
          sizes: {
            M: { pouchesTested: 13, pouchesFailed: 0, notes: null },
            XL: { pouchesTested: 13, pouchesFailed: 1, notes: null },
          },
          comment: "Dye: methylene blue.",
        },
      },
      custom: {},
    };
    // order_lots and sampling_plan may still be stubs: give the context its order and plan.
    const context: InspectionContext = {
      ...buildInspectionContext({ template, data }, MODULE_REGISTRY),
      sizes: ["M"],
      sampling: { M: makeSampling({ pouchesDyeLeak: 13 }) },
    };
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    const dyeLeak = evaluation.modules.find((entry) => entry.key === "dye_leak");
    expect(dyeLeak).toMatchObject({
      result: { status: "pass", summary: "Pouches Failed: 0 of 13.", perSize: { M: { status: "pass" } } },
      comment: "Dye: methylene blue.",
      issues: [expect.objectContaining({ code: "size_not_ordered", size: "XL", path: ["sizes", "XL"] })],
    });
    expect(dyeLeak?.computed).toMatchObject({ result: { M: "pass" }, totalFailed: 0 });
  });

  it("refuses text saved in a count through the engine (6.2 rule 1)", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "dye_leak"]);
    const data = { modules: { dye_leak: { sizes: { M: { pouchesTested: "2 42" } } } }, custom: {} };
    const context: InspectionContext = { ...buildInspectionContext({ template, data }, MODULE_REGISTRY), sizes: ["M"] };
    const dyeLeak = evaluateInspection({ template, data, context }, MODULE_REGISTRY).modules.find(
      (entry) => entry.key === "dye_leak",
    );
    expect(dyeLeak?.result.status).toBe("not_done");
    expect(dyeLeak?.issues).toContainEqual(
      expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", "pouchesTested"] }),
    );
  });
});
