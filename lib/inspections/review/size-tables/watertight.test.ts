import { describe, expect, it } from "vitest";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { WATERTIGHT_DEFAULT_CONFIG, type WatertightConfig } from "@/modules/watertight/config";
import { evaluateSafedonEg } from "@/tests/acceptance/examples";
import { watertightTable } from "./watertight";

const SIZES = ["S", "M", "L", "XL"];

/** Watertight as the engine evaluates it on STD_EG's defaults, sizes S to XL each planned at 315 gloves (AQL 1.5: 10 / 11). */
function evaluated(
  sizes: Record<string, unknown>,
  config: WatertightConfig = WATERTIGHT_DEFAULT_CONFIG,
): { entry: ModuleEvaluation; context: InspectionContext } {
  const context = makeTestContext({
    sizes: SIZES,
    sampling: Object.fromEntries(SIZES.map((size) => [size, makeSampling({ watertightVisual: 315 })])),
  });
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "watertight", config }]);
  const evaluation = evaluateInspection({ template, data: { modules: { watertight: { sizes } }, custom: {} }, context }, MODULE_REGISTRY);
  const entry = evaluation.modules.find((module) => module.key === "watertight");
  if (!entry) throw new Error("watertight was not evaluated");
  return { entry, context };
}

describe("watertightTable", () => {
  it("prints the holes, the limit and where they were as the summary does; a rejected size red, what the template does not list amber", () => {
    const { entry, context } = evaluated({
      S: { tested: 315, holes: { hole_crotch: 1, hole_palm: 3, hole_cuff: 1 } },
      M: { tested: 315, holes: { hole_finger: 11 } },
      L: {
        tested: 315,
        holes: { hole_palm: 1, hole_other: 1 },
        otherDescription: "Near the thumb",
        unmapped: [{ label: "Wrist", count: 2 }],
      },
      // Off the sampling plan's 315: the module warns at the gloves tested.
      XL: { tested: 200 },
    });
    // The cells say what the summary says, size by size.
    expect(entry.result.perSize?.S?.summary).toBe(
      "5 / 315 (Between Fingers (Crotch) 1, Palm 3, Cuff 1), Defect Limit 10 / 11: Passed.",
    );
    expect(entry.result.perSize?.L?.summary).toBe("4 / 315 (Palm 1, Other: Near the thumb 1, Wrist 2), Defect Limit 10 / 11: Passed.");

    expect(watertightTable(entry, context)?.rows).toEqual([
      {
        key: "holes",
        label: "Holes Found",
        cells: [{ text: "5 / 315" }, { text: "11 / 315", tone: "fail" }, { text: "4 / 315" }, { text: "0 / 200", tone: "warn" }],
      },
      {
        key: "defectLimit",
        label: "Defect Limit",
        spec: "Accept / Reject",
        cells: [{ text: "10 / 11" }, { text: "10 / 11" }, { text: "10 / 11" }, { text: "7 / 8" }],
      },
      {
        key: "where",
        label: "Where",
        cells: [
          { text: "Between Fingers (Crotch) 1, Palm 3, Cuff 1" },
          { text: "Finger 11" },
          { text: "Palm 1, Other: Near the thumb 1", note: "Wrist 2", tone: "warn" },
          { text: "None" },
        ],
      },
    ]);
  });

  it("shows holes counted before the gloves tested, a dash for a size with nothing yet, and no table with nothing entered", () => {
    const { entry, context } = evaluated({
      S: { tested: 315 },
      M: { holes: { hole_palm: 2 } },
      // A hole under "Other :" without saying where, and one the template does not list.
      L: { tested: 315, holes: { hole_other: 1 }, unmapped: [{ label: "Wrist", count: 1 }] },
    });
    const table = watertightTable(entry, context);
    expect(table?.rows.map((row) => row.cells.length)).toEqual([4, 4, 4]);
    expect(table?.rows.map((row) => row.cells)).toEqual([
      [{ text: "0 / 315" }, { text: "2 found" }, { text: "2 / 315" }, { text: null }],
      [{ text: "10 / 11" }, { text: null }, { text: "10 / 11" }, { text: null }],
      [{ text: "None" }, { text: "Palm 2" }, { text: "Other 1", note: "Wrist 1", tone: "warn" }, { text: null }],
    ]);

    expect(watertightTable(evaluated({}).entry, context)).toBeNull();
  });

  it("reads the SAFEDON_EG example in its template's wording, four sizes across", () => {
    const example = evaluateSafedonEg();
    expect(example.context.sizes).toEqual(["XS", "S", "M", "L"]);
    expect(watertightTable(example.module("watertight"), example.context)?.rows).toEqual([
      { key: "holes", label: "Holes Found", cells: [{ text: "1 / 80" }, { text: "0 / 200" }, { text: "0 / 200" }, { text: "1 / 80" }] },
      {
        key: "defectLimit",
        label: "Defect Limit",
        spec: "Accept / Reject",
        cells: [{ text: "3 / 4" }, { text: "7 / 8" }, { text: "7 / 8" }, { text: "3 / 4" }],
      },
      { key: "where", label: "Where", cells: [{ text: "Finger 1" }, { text: "None" }, { text: "None" }, { text: "Glove Burst 1" }] },
    ]);
  });

  it("adds up both hands with a hand split, and says where each hand's \"Other :\" hole was", () => {
    const { entry, context } = evaluated(
      {
        S: {
          tested: 315,
          R: { holes: { hole_other: 1 }, otherDescription: "Near the cuff" },
          L: { holes: { hole_palm: 1, hole_other: 1 }, otherDescription: "At the wrist" },
        },
      },
      { ...WATERTIGHT_DEFAULT_CONFIG, handSplit: true },
    );
    expect(entry.result.perSize?.S?.summary).toBe("3 / 315 (Palm 1, Other: Near the cuff, At the wrist 2), Defect Limit 10 / 11: Passed.");
    expect(watertightTable(entry, context)?.rows.map((row) => row.cells[0])).toEqual([
      { text: "3 / 315" },
      { text: "10 / 11" },
      { text: "Palm 1, Other: Near the cuff, At the wrist 2" },
    ]);
  });

  it("has no table for a module that could not be calculated", () => {
    const { entry, context } = evaluated({ S: { tested: 315 } });
    expect(watertightTable({ ...entry, computed: {} }, context)).toBeNull();
  });
});
