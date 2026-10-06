import { describe, expect, it } from "vitest";
import { lookupFrom } from "@/lib/templates";
import { resolveTemplate } from "@/modules";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { ADMIN_ID, evaluated, savedData, storedInspection } from "./__fixtures__/review";
import { evaluateStoredInspection, isListedIssue, summariseIssues } from "./evaluate";

function ok(result: ReturnType<typeof evaluated>) {
  if (!result.ok) throw new Error(`Expected results, got: ${result.message}`);
  return result;
}

describe("evaluateStoredInspection", () => {
  it("runs every included module over the saved data and the inspection's template version", () => {
    const { report, context } = ok(evaluated());
    expect(report.modules.map((entry) => [entry.key, entry.result.status])).toEqual([
      ["header", "info"],
      ["glove_info", "info"],
      ["order_lots", "info"],
      ["packing_config", "info"],
      ["sampling_plan", "info"],
      ["carton_sampling", "fail"],
      ["weight", "warn"],
      ["visual", "fail"],
      ["conclusion", "fail"],
    ]);
    expect(report.modules.find((entry) => entry.key === "visual")?.result.perSize).toEqual({
      M: { status: "pass" },
      L: { status: "fail" },
    });
    expect(context.sizes).toEqual(["M", "L"]);
    expect(context.inspection).toMatchObject({ refNo: "INS-2026-0001", inspector: { name: "Inspector A" } });
  });

  it("keeps the template's wording and the inspector's comments", () => {
    const { report } = ok(evaluated());
    const visual = report.modules.find((entry) => entry.key === "visual");
    expect(visual).toMatchObject({ title: "Visual Inspection (AQL)", comment: "One embedded insect in size L." });
    expect(report.custom).toEqual([
      expect.objectContaining({ values: { gloveType: "Powder-free", sterile: false, length: 240 } }),
    ]);
  });

  it("suggests a result from the module results, apart from the inspector's decision", () => {
    const { report } = ok(evaluated());
    expect(report.suggested).toMatchObject({ result: "fail", failed: ["carton_sampling", "visual"], warned: ["weight"] });
  });

  it("counts errors and warnings, and not-done modules apart from their warning", () => {
    const result = ok(evaluated({ data: { ...savedData(), modules: { ...savedData().modules, packing_config: {} } } }));
    // Packing saved empty is not done: one not-done warning that the summary counts as not done.
    expect(result.report.warnings.map((issue) => issue.code)).toEqual(["module_not_done", "weight_deviation"]);
    expect(result.summary).toEqual({ errors: 1, warnings: 1, notDone: 1 });
  });

  it("leaves out modules an admin switched off for this inspection, with the reason", () => {
    const result = ok(
      evaluated({
        moduleOverrides: {
          weight: { reason: "Scale out of calibration.", by: ADMIN_ID, at: "2026-10-05T03:00:00.000Z" },
          // Malformed entries and modules that cannot be switched off are ignored, as everywhere else.
          visual: { reason: "" },
          order_lots: { reason: "No.", by: ADMIN_ID, at: "2026-10-05T03:00:00.000Z" },
        },
      }),
    );
    expect(result.report.modules.map((entry) => entry.key)).not.toContain("weight");
    expect(result.report.modules.map((entry) => entry.key)).toContain("visual");
    expect(result.report.modules.map((entry) => entry.key)).toContain("order_lots");
    expect(result.report.excluded).toEqual([{ key: "weight", title: "Weight (g)", reason: "Scale out of calibration." }]);
    expect(result.template.modules.find((entry) => entry.key === "weight")?.override?.by).toBe(ADMIN_ID);
  });

  it("says so when the template version cannot be read", () => {
    const result = evaluateStoredInspection(storedInspection({ resolved: { format: 1, code: "OLD" } }), TEST_REGISTRY);
    expect(result).toEqual({ ok: false, problem: "template", message: expect.stringContaining("template version") });
  });

  it("says so when the saved data cannot be read", () => {
    for (const data of [null, [], "text", { modules: [] }]) {
      expect(evaluateStoredInspection(storedInspection({ data }), TEST_REGISTRY)).toMatchObject({ ok: false, problem: "data" });
    }
  });

  it("reads data saved without a custom part as empty", () => {
    const result = ok(evaluated({ data: { modules: savedData().modules } }));
    expect(result.report.custom[0].values).toEqual({ gloveType: null, sterile: null, length: null });
  });

  it("works with the app's own modules: built ones give results, stubs say not built", () => {
    const definition = {
      code: "REVIEW_TEST",
      name: "Review test",
      scope: { productType: "examination", standard: "EN455" },
      unit: "pcs",
      sizes: [{ value: "M" }],
      modules: [
        { key: "header", include: true },
        { key: "glove_info", include: true },
        { key: "conclusion", include: true },
      ],
    };
    const resolution = resolveTemplate(definition, lookupFrom([]));
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    const result = evaluateStoredInspection(
      storedInspection({
        resolved: resolution.template,
        data: {
          modules: {
            glove_info: { surfaceTexture: "Smooth", indicativeWeight: 3.2, colour: "White", length: "240 mm minimum" },
          },
          custom: {},
        },
      }),
    );
    const { report } = ok(result);
    expect(report.modules.find((entry) => entry.key === "glove_info")?.result.status).toBe("info");
    // The conclusion holds the final result, so it is required for submit: not done is an error.
    expect(report.errors.some((issue) => issue.moduleKey === "conclusion")).toBe(true);
  });
});

describe("isListedIssue and summariseIssues", () => {
  it("lists every issue but the not-done warning, which the module's own result shows", () => {
    expect(isListedIssue({ code: "module_not_done", level: "warning" })).toBe(false);
    // Not done on a module required for submit is an error, and stays listed.
    expect(isListedIssue({ code: "module_not_done", level: "error" })).toBe(true);
    expect(isListedIssue({ code: "weight_deviation", level: "warning" })).toBe(true);
  });

  it("counts from the report", () => {
    const { report } = ok(evaluated());
    expect(summariseIssues(report)).toEqual({ errors: 1, warnings: 1, notDone: 0 });
  });
});
