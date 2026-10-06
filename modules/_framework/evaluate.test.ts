import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, ResolvedTemplate } from "@/lib/schemas/template";
import { TEST_ADMIN_ID, TEST_REGISTRY, registryWith } from "./__fixtures__/test-registry";
import { buildInspectionContext, type InspectionMeta } from "./context";
import type { CalcOutput, ModuleRegistry } from "./contract";
import { emptyInspectionData, type InspectionData } from "./data";
import { defineModule, NOT_BUILT_SUMMARY, stubModule } from "./define";
import { evaluateInspection, type InspectionEvaluation } from "./evaluate";
import { makeTestTemplate } from "./testing";

const MODULES: ModuleKey[] = [
  "header",
  "glove_info",
  "order_lots",
  "packing_config",
  "sampling_plan",
  "carton_sampling",
  "weight",
  "visual",
  "conclusion",
];

const META: InspectionMeta = { inspector: { id: "00000000-0000-4000-8000-000000000101", name: "Inspector A" } };

const WEIGHTS_M = [2.86, 2.91, 2.88, 2.93, 2.9, 2.87, 2.92, 2.89, 2.94, 2.88, 2.91, 2.9, 2.91];

/** STD_EG example B with placeholders: size M only; carton 578 entered twice. */
function exampleB(): InspectionData {
  return {
    modules: {
      header: { poNo: "PO-0001", productName: "Brand X nitrile", client: null },
      glove_info: { indicativeWeight: 3.5, colour: "Blue" },
      order_lots: { lots: [{ size: "M", qtyCases: 2900, lotNumbers: ["LOT-M-0001"] }] },
      packing_config: { glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 },
      sampling_plan: { sizes: { M: { cases: 50, watertightVisual: 500, dimensions: 13 } } },
      carton_sampling: { sizes: { M: [32, 609, 578, 578, 1186] } },
      weight: { sizes: { M: { values: WEIGHTS_M } }, comment: "Weighed on the factory scale." },
      visual: { sizes: { M: { critical: 0, major: 8 } } },
    },
    custom: {},
  };
}

function evaluate(
  data: InspectionData,
  template: ResolvedTemplate = makeTestTemplate(TEST_REGISTRY, MODULES),
  registry: ModuleRegistry = TEST_REGISTRY,
  meta: InspectionMeta = META,
): InspectionEvaluation {
  const context = buildInspectionContext({ template, data, meta }, registry);
  return evaluateInspection({ template, data, context }, registry);
}

function moduleOf(evaluation: InspectionEvaluation, key: ModuleKey) {
  const found = evaluation.modules.find((module) => module.key === key);
  if (!found) throw new Error(`${key} was not evaluated`);
  return found;
}

const codes = (evaluation: InspectionEvaluation, key: string) =>
  evaluation.issues.filter((issue) => issue.moduleKey === key).map((issue) => issue.code);

describe("evaluateInspection: the STD_EG example flow (expected results B)", () => {
  it("evaluates the included modules in template order", () => {
    expect(evaluate(exampleB()).modules.map((module) => module.key)).toEqual(MODULES);
  });

  it("blocks on the carton entered twice, with a link to it", () => {
    const evaluation = evaluate(exampleB());
    expect(moduleOf(evaluation, "carton_sampling").result.status).toBe("fail");
    expect(evaluation.issues).toContainEqual({
      level: "error",
      moduleKey: "carton_sampling",
      code: "carton_duplicate",
      message: "Carton 578 is entered twice for size M.",
      size: "M",
      path: ["sizes", "M", 3],
    });
    expect(evaluation.suggested.result).toBe("fail");
  });

  it("warns that the weight is 17% below the indicative weight", () => {
    const weight = moduleOf(evaluate(exampleB()), "weight");
    expect(weight.result).toMatchObject({ status: "warn", perSize: { M: { status: "warn" } } });
    expect(weight.issues).toEqual([
      expect.objectContaining({
        level: "warning",
        code: "weight_deviation",
        message: "Average 2.9 g is 17% below the indicative 3.5 g.",
        size: "M",
      }),
    ]);
    expect(weight.computed).toEqual({ M: expect.closeTo(2.9, 10) });
    expect(weight.comment).toBe("Weighed on the factory scale.");
  });

  it("gives sizes that were not ordered no results (6.2 rule 4)", () => {
    const data = exampleB();
    data.modules = { ...data.modules, weight: { sizes: { M: { values: WEIGHTS_M }, L: { values: [3.4] } } } };
    const weight = moduleOf(evaluate(data), "weight");
    expect(Object.keys(weight.result.perSize ?? {})).toEqual(["M"]);
    expect(weight.data).toEqual({ sizes: { M: { values: WEIGHTS_M } } });
    expect(weight.issues.map((issue) => [issue.code, issue.size])).toEqual([
      ["size_not_ordered", "L"],
      ["weight_deviation", "M"],
    ]);
  });

  it("suggests pass once the cartons are fixed, the weight warning listed, conclusion left to the inspector", () => {
    const data = exampleB();
    data.modules = { ...data.modules, carton_sampling: { sizes: { M: [32, 609, 578, 2389, 1186] } } };
    const evaluation = evaluate(data);
    expect(evaluation.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(evaluation.suggested).toEqual({
      result: "pass",
      failed: [],
      notDone: [],
      warned: ["weight"],
      summary: "Pass. Warnings: Weight (g).",
    });
    const conclusion = moduleOf(evaluation, "conclusion");
    expect(conclusion.result.status).toBe("not_done");
    expect(conclusion.computed).toEqual({ suggestedResult: "pass", seen: [...MODULES.filter((key) => key !== "conclusion")].sort() });
  });

  it("lists issues in module order", () => {
    const keys = evaluate(exampleB()).issues.map((issue) => issue.moduleKey);
    expect(keys).toEqual([...keys].sort((a, b) => MODULES.indexOf(a as ModuleKey) - MODULES.indexOf(b as ModuleKey)));
    expect(keys.at(-1)).toBe("conclusion");
  });
});

describe("evaluateInspection: framework rules for every module", () => {
  it("shows a module with nothing saved as not done, never passed (6.2 rule 5)", () => {
    const optimist = defineModule({
      ...stubModule({ key: "dimensions", title: "Dimension" }),
      calc: (): CalcOutput => ({ result: { status: "pass", summary: "Looks fine." }, computed: {}, issues: [] }),
    });
    const evaluation = evaluate(exampleB(), makeTestTemplate(TEST_REGISTRY, ["dimensions"]), registryWith({ dimensions: optimist }));
    expect(moduleOf(evaluation, "dimensions").result).toEqual({ status: "not_done", summary: "Not done." });
    expect(codes(evaluation, "dimensions")).toEqual(["module_not_done"]);
  });

  it("keeps a per-size module not done until sizes are ordered", () => {
    const evaluation = evaluate({ modules: { weight: { sizes: { M: { values: WEIGHTS_M } } } }, custom: {} }, makeTestTemplate(TEST_REGISTRY, ["weight"]));
    expect(moduleOf(evaluation, "weight").result).toEqual({ status: "not_done", summary: "No sizes ordered yet.", perSize: {} });
  });

  it("shows a placeholder module as not built yet", () => {
    const evaluation = evaluate(exampleB(), makeTestTemplate(TEST_REGISTRY, ["order_lots", "dimensions"]));
    const dimensions = moduleOf(evaluation, "dimensions");
    expect(dimensions).toMatchObject({ stub: true, result: { status: "not_done", summary: NOT_BUILT_SUMMARY } });
    expect(dimensions.result.perSize).toEqual({ M: { status: "not_done" } });
  });

  it("reports saved data its schema rejects, such as text in a numeric cell (6.2 rule 1)", () => {
    const data = exampleB();
    data.modules = { ...data.modules, weight: { sizes: { M: { values: [2.9, "2 42"] } } } };
    const weight = moduleOf(evaluate(data), "weight");
    expect(weight.result).toMatchObject({ status: "not_done", summary: "Saved data could not be read." });
    expect(weight.issues).toEqual([
      expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", "values", 1] }),
    ]);
  });

  it("reports a template config the module rejects", () => {
    const template = makeTestTemplate(TEST_REGISTRY, ["order_lots", { key: "weight", config: { n: "13" } }]);
    const weight = moduleOf(evaluate(exampleB(), template), "weight");
    expect(weight.result.status).toBe("not_done");
    expect(weight.issues.map((issue) => issue.code)).toEqual(["invalid_config"]);
  });

  it("contains a calc that throws to its own module", () => {
    const failing = defineModule({
      ...stubModule({ key: "dimensions", title: "Dimension" }),
      calc: (): CalcOutput => {
        throw new Error("median of nothing");
      },
    });
    const registry = registryWith({ dimensions: failing });
    const evaluation = evaluate(exampleB(), makeTestTemplate(registry, ["glove_info", "dimensions"]), registry);
    expect(moduleOf(evaluation, "dimensions").issues).toEqual([
      expect.objectContaining({ code: "calc_failed", message: "Dimension could not be calculated: median of nothing" }),
    ]);
    expect(moduleOf(evaluation, "glove_info").result.status).toBe("info");
  });

  it("reports a calc that breaks the contract", () => {
    const sloppy = defineModule({
      ...stubModule({ key: "dimensions", title: "Dimension" }),
      calc: () => ({ result: { status: "passed", summary: "" }, computed: {}, issues: [] }) as unknown as CalcOutput,
    });
    const registry = registryWith({ dimensions: sloppy });
    const data: InspectionData = { modules: { dimensions: { anything: 1 } }, custom: {} };
    expect(codes(evaluate(data, makeTestTemplate(registry, ["dimensions"]), registry), "dimensions")).toEqual(["invalid_output"]);
  });

  it("requires the inspector (6.2 rule 11)", () => {
    const evaluation = evaluate(exampleB(), undefined, TEST_REGISTRY, {});
    expect(evaluation.issues).toContainEqual(expect.objectContaining({ moduleKey: "header", code: "inspector_missing" }));
  });
});

describe("evaluateInspection: what the template switches off", () => {
  it("skips modules the template excludes and lists those switched off for the inspection", () => {
    const template = makeTestTemplate(TEST_REGISTRY, [
      "order_lots",
      { key: "glove_info", include: false },
      { key: "weight", include: false, override: { reason: "Scale broken", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } },
    ]);
    const evaluation = evaluate(exampleB(), template);
    expect(evaluation.modules.map((module) => module.key)).toEqual(["header", "order_lots", "conclusion"]);
    expect(evaluation.excluded).toEqual([{ key: "weight", title: "Weight (g)", reason: "Scale broken" }]);
    expect(evaluation.issues.some((issue) => issue.moduleKey === "weight")).toBe(false);
  });
});

describe("evaluateInspection: custom modules", () => {
  const form: CustomModule = {
    key: "client_form",
    title: "Client form",
    after: "glove_info",
    layout: "fields",
    fields: [
      { key: "po", label: "Purchase order", type: "text", mapsTo: "modules.header.poNo", required: true },
      { key: "remark", label: "Remark", type: "textarea", required: true },
    ],
  };

  it("evaluates them in place, with mapped fields read from their module", () => {
    const template = makeTestTemplate(TEST_REGISTRY, ["glove_info", "order_lots"], { customModules: [form] });
    const data = exampleB();
    data.custom = { client_form: { comment: "Filled from the client sheet." } };
    const evaluation = evaluate(data, template);
    expect(evaluation.custom).toEqual([
      {
        custom: form,
        values: { remark: null, po: "PO-0001" },
        comment: "Filled from the client sheet.",
        issues: [expect.objectContaining({ moduleKey: "client_form", code: "required", path: ["remark"] })],
      },
    ]);
    const order = evaluation.issues.map((issue) => issue.moduleKey);
    expect(order.indexOf("client_form")).toBeGreaterThan(order.indexOf("glove_info"));
    expect(order.indexOf("client_form")).toBeLessThan(order.indexOf("conclusion"));
  });
});

describe("evaluateInspection: an empty inspection", () => {
  it("is not done anywhere and suggests hold", () => {
    const evaluation = evaluate(emptyInspectionData());
    expect(evaluation.modules.every((module) => module.result.status === "not_done")).toBe(true);
    expect(evaluation.suggested.result).toBe("hold");
    expect(evaluation.issues.every((issue) => issue.level === "warning")).toBe(true);
  });
});
