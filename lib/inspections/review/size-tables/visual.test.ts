import { describe, expect, it } from "vitest";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { VISUAL_DEFAULT_CONFIG, type VisualConfig } from "@/modules/visual/config";
import { evaluateSafedonEg } from "@/tests/acceptance/examples";
import { visualTable } from "./visual";

const SIZES = ["S", "M", "L", "XL"];

/**
 * Visual as the engine evaluates it, STD_EG's lists and wording, sizes S to
 * XL each planned at 315 gloves: critical 0 / 1, major (AQL 2.5) 14 / 15 and
 * minor (AQL 4.0) 21 / 22 at 315; 10 / 11 and 14 / 15 at 200.
 */
function evaluated(
  sizes: Record<string, unknown>,
  config: VisualConfig = VISUAL_DEFAULT_CONFIG,
): { entry: ModuleEvaluation; context: InspectionContext } {
  const context = makeTestContext({
    sizes: SIZES,
    sampling: Object.fromEntries(SIZES.map((size) => [size, makeSampling({ watertightVisual: 315 })])),
  });
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "visual", config }]);
  const evaluation = evaluateInspection({ template, data: { modules: { visual: { sizes } }, custom: {} }, context }, MODULE_REGISTRY);
  const entry = evaluation.modules.find((module) => module.key === "visual");
  if (!entry) throw new Error("visual was not evaluated");
  return { entry, context };
}

const inspected = (n: number) => ({ critical: { inspected: n }, major: { inspected: n }, minor: { inspected: n } });

describe("visualTable", () => {
  it("gives each class its total over the gloves inspected and its limit, and what was found once a size found any", () => {
    const { entry, context } = evaluated({
      S: { ...inspected(315), major: { inspected: 315, counts: { skin_visual: 1 } } },
      // A critical defect rejects the size; "Ring mark" is the inspector's own label, not in the list.
      M: {
        ...inspected(315),
        critical: { inspected: 315, counts: { embedded_insect: 1 } },
        major: { inspected: 315, counts: { flow_mark: 1 }, unmapped: [{ label: "Ring mark", count: 2 }] },
      },
      // 15 major defects reach Reject 15.
      L: { ...inspected(315), major: { inspected: 315, counts: { thin_spot: 15 } } },
      // Off the sampling plan's 315: the module warns at each class's gloves inspected.
      XL: inspected(200),
    });
    expect(entry.result.perSize?.M?.summary).toBe(
      "Critical Defects 1 / 315 (Embedded Insects 1), Defect Limit 0 / 1: Failed; Major Defects 3 / 315 (Flow Mark 1, Ring mark 2), Defect Limit 14 / 15: Passed; Minor Defects 0 / 315, Defect Limit 21 / 22: Passed.",
    );
    expect(entry.issues.filter((issue) => issue.size === "M").map((issue) => issue.code)).toEqual(["defect_unmapped"]);

    expect(visualTable(entry, context)?.rows).toEqual([
      {
        key: "critical",
        label: "Critical Defects",
        spec: "Limit 0 / 1",
        cells: [{ text: "0 / 315" }, { text: "1 / 315", tone: "fail" }, { text: "0 / 315" }, { text: "0 / 200", tone: "warn" }],
      },
      {
        key: "criticalFound",
        label: "Critical Defects Found",
        cells: [{ text: "None" }, { text: "Embedded Insects 1" }, { text: "None" }, { text: "None" }],
      },
      {
        key: "major",
        label: "Major Defects",
        cells: [
          { text: "1 / 315", note: "Limit 14 / 15" },
          { text: "3 / 315", note: "Limit 14 / 15" },
          { text: "15 / 315", note: "Limit 14 / 15", tone: "fail" },
          { text: "0 / 200", note: "Limit 10 / 11", tone: "warn" },
        ],
      },
      {
        key: "majorFound",
        label: "Major Defects Found",
        cells: [
          { text: "Skin Visual 1" },
          { text: "Flow Mark 1", note: "Ring mark 2", tone: "warn" },
          { text: "Thin Spot on Glove Body 15" },
          { text: "None" },
        ],
      },
      {
        key: "minor",
        label: "Minor Defects",
        cells: [
          { text: "0 / 315", note: "Limit 21 / 22" },
          { text: "0 / 315", note: "Limit 21 / 22" },
          { text: "0 / 315", note: "Limit 21 / 22" },
          { text: "0 / 200", note: "Limit 14 / 15", tone: "warn" },
        ],
      },
    ]);
  });

  it("leaves out a class switched off, fails a critical defect found before the gloves inspected, and shows one-off labels alone in amber", () => {
    const config: VisualConfig = {
      ...VISUAL_DEFAULT_CONFIG,
      classes: { ...VISUAL_DEFAULT_CONFIG.classes, minor: { ...VISUAL_DEFAULT_CONFIG.classes.minor, include: false } },
    };
    const { entry, context } = evaluated(
      {
        S: { critical: { inspected: 315 }, major: { inspected: 315, unmapped: [{ label: "Ring mark", count: 2 }] } },
        M: { critical: { counts: { embedded_metal: 1 } } },
      },
      config,
    );
    const table = visualTable(entry, context);
    expect(table?.rows.map((row) => [row.key, row.label, row.spec ?? null])).toEqual([
      ["critical", "Critical Defects", "Limit 0 / 1"],
      ["criticalFound", "Critical Defects Found", null],
      ["major", "Major Defects", null],
      ["majorFound", "Major Defects Found", null],
    ]);
    expect(table?.rows.map((row) => row.cells)).toEqual([
      [{ text: "0 / 315" }, { text: "1 found", tone: "fail" }, { text: null }, { text: null }],
      [{ text: "None" }, { text: "Embedded Metal Debris 1" }, { text: null }, { text: null }],
      // Only S has a limit yet: on its cell, not under the label.
      [{ text: "2 / 315", note: "Limit 14 / 15" }, { text: null }, { text: null }, { text: null }],
      [{ text: "Ring mark 2", tone: "warn" }, { text: null }, { text: null }, { text: null }],
    ]);
  });

  it("reads the SAFEDON_EG example: no defects, so no found rows, and each size's own limit where they differ", () => {
    const example = evaluateSafedonEg();
    const table = visualTable(example.module("visual"), example.context);
    expect(table?.rows).toEqual([
      {
        key: "critical",
        label: "Critical Defects",
        spec: "Limit 0 / 1",
        cells: [{ text: "0 / 80" }, { text: "0 / 200" }, { text: "0 / 200" }, { text: "0 / 80" }],
      },
      {
        key: "major",
        label: "Major Defects",
        cells: [
          { text: "0 / 80", note: "Limit 5 / 6" },
          { text: "0 / 200", note: "Limit 10 / 11" },
          { text: "0 / 200", note: "Limit 10 / 11" },
          { text: "0 / 80", note: "Limit 5 / 6" },
        ],
      },
      {
        key: "minor",
        label: "Minor Defects",
        cells: [
          { text: "0 / 80", note: "Limit 7 / 8" },
          { text: "0 / 200", note: "Limit 14 / 15" },
          { text: "0 / 200", note: "Limit 14 / 15" },
          { text: "0 / 80", note: "Limit 7 / 8" },
        ],
      },
    ]);
  });

  it("has no table with nothing entered, or no class switched on", () => {
    expect(visualTable(evaluated({}).entry, evaluated({}).context)).toBeNull();
    const none: VisualConfig = {
      ...VISUAL_DEFAULT_CONFIG,
      classes: {
        critical: { ...VISUAL_DEFAULT_CONFIG.classes.critical, include: false },
        major: { ...VISUAL_DEFAULT_CONFIG.classes.major, include: false },
        minor: { ...VISUAL_DEFAULT_CONFIG.classes.minor, include: false },
      },
    };
    const { entry, context } = evaluated({ S: inspected(315) }, none);
    expect(visualTable(entry, context)).toBeNull();
  });
});
