import { describe, expect, it } from "vitest";
import { lookupFrom } from "@/lib/templates";
import { resolveTemplate } from "@/modules";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { ADMIN_ID, evaluated, savedData, storedInspection } from "./__fixtures__/review";
import { evaluateStoredInspection, inspectorDecision, isListedIssue, summariseIssues } from "./evaluate";

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

describe("evaluateStoredInspection with the inspection's files (docs/MODULES.md 10.1)", () => {
  const LAB_REPORT = "00000000-0000-4000-8000-0000000004a1";
  const GALLERY_REPORT = "00000000-0000-4000-8000-0000000004a2";

  /** Tensile, whose lab report is required, kept by id in its data; the averages pass. */
  function tensile(labReport: string | null, files?: { id: string; moduleKey: string | null; kind: "lab_report" }[] | null) {
    const definition = {
      code: "REVIEW_FILES",
      name: "Review files test",
      scope: { productType: "examination", standard: "ASTM_D6319" },
      unit: "pcs",
      sizes: [{ value: "M" }],
      modules: [
        { key: "header", include: true },
        { key: "order_lots", include: true },
        { key: "tensile", include: true },
        { key: "conclusion", include: true },
      ],
    };
    const resolution = resolveTemplate(definition, lookupFrom([]));
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    const { report } = ok(
      evaluateStoredInspection(
        storedInspection({
          resolved: resolution.template,
          data: {
            modules: {
              order_lots: { sizes: { M: { qtyCases: 10, lotNumbers: ["LOT-M-0001"], packingSite: null } } },
              tensile: { sizes: { M: { tensileStrength: 20.5, elongationAtBreak: 560 } }, labReport },
            },
            custom: {},
          },
          ...(files === undefined ? {} : { files }),
        }),
      ),
    );
    const entry = report.modules.find((module) => module.key === "tensile");
    if (!entry) throw new Error("no tensile");
    return { entry, warnings: report.warnings.filter((issue) => issue.moduleKey === "tensile").map((issue) => issue.code) };
  }

  it("counts a kept lab report the inspection holds as attached", () => {
    const { entry, warnings } = tensile(LAB_REPORT, [{ id: LAB_REPORT, moduleKey: "tensile", kind: "lab_report" }]);
    expect(entry.result.status).toBe("pass");
    expect(entry.computed).toMatchObject({ labReportAttached: true });
    expect(warnings).toEqual([]);
  });

  it("reads a kept lab report whose file was deleted as missing: a warning, and tensile not done", () => {
    const { entry, warnings } = tensile(LAB_REPORT, []);
    expect(entry.result.status).toBe("not_done");
    expect(entry.computed).toMatchObject({ labReportAttached: false });
    expect(warnings).toContain("lab_report_missing");
  });

  it("counts a lab report added in the gallery, which keeps no id", () => {
    const { entry } = tensile(null, [{ id: GALLERY_REPORT, moduleKey: "tensile", kind: "lab_report" }]);
    expect(entry.result.status).toBe("pass");
    expect(entry.computed).toMatchObject({ labReportAttached: true });
  });

  it("takes a kept lab report as attached while the files are not known (a failed read)", () => {
    for (const files of [null, undefined]) {
      const { entry, warnings } = tensile(LAB_REPORT, files);
      expect(entry.result.status).toBe("pass");
      expect(warnings).toEqual([]);
    }
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

describe("inspectorDecision", () => {
  /** The fixture's data with the conclusion's entry replaced; `undefined` leaves the conclusion out. */
  function withConclusion(conclusion: unknown) {
    const modules: Record<string, unknown> = { ...savedData().modules, conclusion };
    if (conclusion === undefined) delete modules.conclusion;
    return evaluated({ data: { ...savedData(), modules } });
  }

  it("takes what the conclusion saved, over the row's copies (the export's rule too)", () => {
    // The fixture's conclusion: final result fail, remark "Critical defect in size L."
    expect(inspectorDecision({ result: "pass", remarks: "Accepted after the retest." }, evaluated())).toEqual({
      result: "fail",
      remarks: "Critical defect in size L.",
    });
    expect(inspectorDecision({ result: null, remarks: null }, evaluated())).toEqual({
      result: "fail",
      remarks: "Critical defect in size L.",
    });
  });

  it("lets the row's copies stand in where the conclusion holds none, trimmed, a blank remark as none", () => {
    const empty = withConclusion({ finalResult: null, remark: null });
    expect(inspectorDecision({ result: "pass", remarks: "  Accepted after the retest.  " }, empty)).toEqual({
      result: "pass",
      remarks: "Accepted after the retest.",
    });
    expect(inspectorDecision({ result: "hold", remarks: " \n " }, empty)).toEqual({ result: "hold", remarks: null });
    // A final result chosen without its date yet: the row has no copy until the conclusion is done.
    expect(inspectorDecision({ result: null, remarks: null }, withConclusion({ finalResult: "hold", remark: "  " }))).toEqual({
      result: "hold",
      remarks: null,
    });
  });

  it("has neither when the row and the conclusion hold none", () => {
    expect(inspectorDecision({ result: null, remarks: null }, withConclusion(undefined))).toEqual({ result: null, remarks: null });
    expect(inspectorDecision({ result: null, remarks: "" }, withConclusion({ finalResult: null, remark: "   " }))).toEqual({
      result: null,
      remarks: null,
    });
  });

  it("takes nothing from a conclusion whose saved data cannot be read", () => {
    const unreadable = withConclusion({ finalResult: "maybe", remark: "Kept apart." });
    expect(inspectorDecision({ result: null, remarks: null }, unreadable)).toEqual({ result: null, remarks: null });
  });

  it("keeps the row's own values when the results cannot be worked out", () => {
    const failed = evaluated({ resolved: { broken: true } });
    expect(failed.ok).toBe(false);
    expect(inspectorDecision({ result: "fail", remarks: " Burst at the cuff. " }, failed)).toEqual({
      result: "fail",
      remarks: "Burst at the cuff.",
    });
    expect(inspectorDecision({ result: null, remarks: null }, failed)).toEqual({ result: null, remarks: null });
  });

  it("works with the app's conclusion, a placeholder or built: a value that is not a result is left out", () => {
    const definition = {
      code: "REVIEW_TEST",
      name: "Review test",
      scope: { productType: "examination", standard: "EN455" },
      unit: "pcs",
      sizes: [{ value: "M" }],
      modules: [
        { key: "header", include: true },
        { key: "conclusion", include: true },
      ],
    };
    const resolution = resolveTemplate(definition, lookupFrom([]));
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    const withApp = (conclusion: unknown) =>
      evaluateStoredInspection(
        storedInspection({ resolved: resolution.template, data: { modules: { conclusion }, custom: {} } }),
      );
    expect(inspectorDecision({ result: null, remarks: null }, withApp({ finalResult: "hold", remark: "Lab report pending." }))).toEqual({
      result: "hold",
      remarks: "Lab report pending.",
    });
    expect(inspectorDecision({ result: null, remarks: null }, withApp({ finalResult: "maybe" }))).toEqual({
      result: null,
      remarks: null,
    });
  });
});
