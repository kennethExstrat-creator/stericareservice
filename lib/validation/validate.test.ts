import { describe, expect, it } from "vitest";
import { buildInspectionContext as buildAppContext, MODULE_REGISTRY, resolveTemplate } from "@/modules";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { buildInspectionContext } from "@/modules/_framework/context";
import type { InspectionData } from "@/modules/_framework/data";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { validateInspection } from "./validate";

const INSPECTOR = { id: "00000000-0000-4000-8000-000000000101", name: "Inspector A" };

function stdEgData(cartonsM: number[]): InspectionData {
  return {
    modules: {
      header: { poNo: "PO-0001", productName: "Brand X nitrile", client: null },
      glove_info: { indicativeWeight: 3.5, colour: "Blue" },
      order_lots: { lots: [{ size: "M", qtyCases: 2900, lotNumbers: ["LOT-M-0001"] }] },
      sampling_plan: { sizes: { M: { cases: 5, watertightVisual: 500, dimensions: 13 } } },
      carton_sampling: { sizes: { M: cartonsM } },
      weight: { sizes: { M: { values: Array.from({ length: 13 }, () => 2.9) } } },
    },
    custom: {},
  };
}

function validate(data: InspectionData) {
  const template = makeTestTemplate(TEST_REGISTRY, [
    "glove_info",
    "order_lots",
    "sampling_plan",
    "carton_sampling",
    "weight",
  ]);
  const context = buildInspectionContext({ template, data, meta: { inspector: INSPECTOR } }, TEST_REGISTRY);
  return validateInspection(data, template, context, TEST_REGISTRY);
}

describe("validateInspection", () => {
  it("blocks submit on errors and lists each with its module and path", () => {
    const report = validate(stdEgData([32, 578, 578, 1186, 2389]));
    expect(report.canSubmit).toBe(false);
    expect(report.errors).toEqual([
      {
        level: "error",
        moduleKey: "carton_sampling",
        code: "carton_duplicate",
        message: "Carton 578 is entered twice for size M.",
        size: "M",
        path: ["sizes", "M", 2],
      },
    ]);
  });

  it("allows submit with warnings, which go into the export", () => {
    const report = validate(stdEgData([32, 578, 1186, 2389, 2865]));
    expect(report.canSubmit).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((issue) => [issue.moduleKey, issue.code])).toEqual([
      ["weight", "weight_deviation"],
      ["conclusion", "module_not_done"],
    ]);
  });

  it("carries the results and the suggested result with the issues", () => {
    const report = validate(stdEgData([32, 578, 1186, 2389, 2865]));
    expect(report.modules.map((module) => [module.key, module.result.status])).toEqual([
      ["header", "info"],
      ["glove_info", "info"],
      ["order_lots", "info"],
      ["sampling_plan", "info"],
      ["carton_sampling", "pass"],
      ["weight", "warn"],
      ["conclusion", "not_done"],
    ]);
    expect(report.suggested).toMatchObject({ result: "pass", warned: ["weight"] });
  });
});

describe("validateInspection with the app's modules", () => {
  it("resolves, builds the context and validates against the registry by default", () => {
    const resolution = resolveTemplate(
      {
        code: "SMOKE_EG",
        name: "Smoke test",
        scope: { productType: "examination", standard: "EN455" },
        unit: "pcs",
        sizes: [{ value: "M" }],
        modules: [{ key: "glove_info", include: true, config: { fields: { colour: false } } }],
      },
      () => undefined,
    );
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    const template = resolution.template;
    expect(template.modules.map((module) => module.key)).toEqual(["header", "glove_info", "conclusion"]);

    const data: InspectionData = {
      modules: { glove_info: { surfaceTexture: "Finger-textured", indicativeWeight: 3.5, length: "240 mm minimum" } },
      custom: {},
    };
    const context = buildAppContext({ template, data, meta: { inspector: INSPECTOR } });
    expect(context.indicativeWeight).toEqual({ grams: 3.5, size: "M" });

    const report = validateInspection(data, template, context);
    expect(report.modules.map((module) => [module.key, module.result.status])).toEqual([
      ["header", "not_done"],
      ["glove_info", "info"],
      ["conclusion", "not_done"],
    ]);
    expect(report.modules[1].result.summary).toBe("Finger-textured, 240 mm minimum; indicative weight 3.5 g (size M).");
    expect(report.canSubmit).toBe(true);
    expect(report.suggested.result).toBe("hold");
    expect(validateInspection(data, template, context, MODULE_REGISTRY)).toEqual(report);
  });
});
