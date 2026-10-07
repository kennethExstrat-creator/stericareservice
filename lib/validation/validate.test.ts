import { describe, expect, it } from "vitest";
import { buildInspectionContext as buildAppContext, MODULE_REGISTRY, resolveTemplate } from "@/modules";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { buildInspectionContext } from "@/modules/_framework/context";
import type { InspectionData } from "@/modules/_framework/data";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { validateInspection } from "./validate";

const INSPECTOR = { id: "00000000-0000-4000-8000-000000000101", name: "Inspector A" };

function stdEgData(cartonsM: number[], finalResult: "pass" | "fail" | "hold" | null = "pass"): InspectionData {
  return {
    modules: {
      header: { poNo: "PO-0001", productName: "Brand X nitrile", client: null },
      glove_info: { indicativeWeight: 3.5, colour: "Blue" },
      order_lots: { lots: [{ size: "M", qtyCases: 2900, lotNumbers: ["LOT-M-0001"] }] },
      sampling_plan: { sizes: { M: { cases: 5, watertightVisual: 500, dimensions: 13 } } },
      carton_sampling: { sizes: { M: cartonsM } },
      weight: { sizes: { M: { values: Array.from({ length: 13 }, () => 2.9) } } },
      ...(finalResult === null ? {} : { conclusion: { finalResult, remark: null } }),
    },
    custom: {},
  };
}

const VALID_CARTONS = [32, 578, 1186, 2389, 2865];

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
    const report = validate(stdEgData(VALID_CARTONS));
    expect(report.canSubmit).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((issue) => [issue.moduleKey, issue.code])).toEqual([["weight", "weight_deviation"]]);
  });

  it("allows submit with a module not done: the inspection goes on hold", () => {
    const data = stdEgData(VALID_CARTONS, "hold");
    data.modules = { ...data.modules, weight: { sizes: { M: { values: [2.9] } } } };
    const report = validate(data);
    expect(report.canSubmit).toBe(true);
    expect(report.warnings.map((issue) => [issue.moduleKey, issue.code])).toEqual([["weight", "module_not_done"]]);
    expect(report.suggested.result).toBe("hold");
  });

  it("blocks submit until the conclusion has its final result (BUILD_SPEC 6.1 conclusion)", () => {
    const report = validate(stdEgData(VALID_CARTONS, null));
    expect(report.canSubmit).toBe(false);
    expect(report.errors).toEqual([
      {
        level: "error",
        moduleKey: "conclusion",
        code: "module_not_done",
        message: "Conclusion must be complete before submit: No final result.",
        path: [],
      },
    ]);
  });

  it("carries the results and the suggested result with the issues", () => {
    const report = validate(stdEgData(VALID_CARTONS));
    expect(report.modules.map((module) => [module.key, module.result.status])).toEqual([
      ["header", "info"],
      ["glove_info", "info"],
      ["order_lots", "info"],
      ["sampling_plan", "info"],
      ["carton_sampling", "pass"],
      ["weight", "warn"],
      ["conclusion", "pass"],
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
    // An unfinished conclusion blocks submit, whatever it lists as missing.
    expect(report.errors.map((issue) => [issue.moduleKey, issue.code])).toEqual([["conclusion", "module_not_done"]]);
    expect(report.canSubmit).toBe(false);
    expect(report.suggested.result).toBe("hold");
    expect(validateInspection(data, template, context, MODULE_REGISTRY)).toEqual(report);
  });

  describe("data saved before a schema limit (data tolerance)", () => {
    const resolution = resolveTemplate(
      {
        code: "TOLERANCE_EG",
        name: "Data tolerance",
        scope: { productType: "examination", standard: "EN455" },
        unit: "pcs",
        sizes: [{ value: "M" }, { value: "L" }],
        modules: [
          { key: "order_lots", include: true },
          { key: "labeling", include: true },
        ],
      },
      () => undefined,
    );
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    const template = resolution.template;
    // A lot number of 250 characters, saved before order_lots took at most 200.
    const data: InspectionData = {
      modules: {
        order_lots: {
          sizes: {
            M: { qtyCases: 2900, lotNumbers: ["LOT-M-0001", "L".repeat(250)] },
            L: { qtyCases: 60, lotNumbers: ["LOT-L-0001"] },
          },
        },
      },
      custom: {},
    };

    it("keeps every ordered size for the per-size modules", () => {
      const context = buildAppContext({ template, data, meta: { inspector: INSPECTOR } });
      expect(context.sizes).toEqual(["M", "L"]);
      expect(context.order).toEqual({
        M: { qtyCases: 2900, lotNumbers: ["LOT-M-0001"] },
        L: { qtyCases: 60, lotNumbers: ["LOT-L-0001"] },
      });
      const report = validateInspection(data, template, context);
      const labeling = report.modules.find((entry) => entry.key === "labeling");
      expect(Object.keys(labeling?.result.perSize ?? {})).toEqual(["M", "L"]);
    });

    it("blocks submit with an error that names the module and the field, and links to it", () => {
      const context = buildAppContext({ template, data, meta: { inspector: INSPECTOR } });
      const report = validateInspection(data, template, context);
      expect(report.errors).toContainEqual({
        level: "error",
        moduleKey: "order_lots",
        code: "invalid_data",
        message:
          "Order: size M, Lot Number no. 2 is longer than 200 characters. Until it is corrected, the other sections use the rest of what is saved here.",
        path: ["sizes", "M", "lotNumbers", 1],
      });
      expect(report.canSubmit).toBe(false);
      expect(report.modules.find((entry) => entry.key === "order_lots")?.result.status).toBe("not_done");
    });

    it("says so when nothing of a source module can be read", () => {
      const unreadable: InspectionData = { modules: { order_lots: "not an order" }, custom: {} };
      const context = buildAppContext({ template, data: unreadable, meta: { inspector: INSPECTOR } });
      expect(context.sizes).toEqual([]);
      const report = validateInspection(unreadable, template, context);
      expect(report.errors).toContainEqual(
        expect.objectContaining({
          moduleKey: "order_lots",
          code: "invalid_data",
          path: [],
          message: expect.stringContaining("Until it is corrected, the other sections get nothing from this one."),
        }),
      );
    });
  });

  it("names the hand of a value a hand-split module cannot read", () => {
    const resolution = resolveTemplate(
      {
        code: "HANDS_SG",
        name: "Hands",
        scope: { productType: "surgical", standard: "EN455" },
        unit: "pairs",
        sizes: [{ value: "7.0" }],
        modules: [
          { key: "order_lots", include: true },
          { key: "watertight", include: true, config: { handSplit: true } },
        ],
      },
      () => undefined,
    );
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    const data: InspectionData = {
      modules: {
        order_lots: { sizes: { "7.0": { qtyCases: 40, lotNumbers: ["LOT-7-0001"] } } },
        watertight: { sizes: { "7.0": { tested: 80, R: { holes: { hole_finger: "two" } } } } },
      },
      custom: {},
    };
    const context = buildAppContext({ template: resolution.template, data, meta: { inspector: INSPECTOR } });
    const report = validateInspection(data, resolution.template, context);
    expect(report.errors).toContainEqual({
      level: "error",
      moduleKey: "watertight",
      code: "invalid_data",
      message: "Freedom from Holes by watertight test: size 7.0, right hand, Pin hole, hole_finger is not a number.",
      path: ["sizes", "7.0", "R", "holes", "hole_finger"],
    });
  });
});
