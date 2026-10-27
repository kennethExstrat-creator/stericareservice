import { describe, expect, it } from "vitest";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateSafedonEg } from "@/tests/acceptance/examples";
import { labelingTable } from "./labeling";

const SIZES = ["S", "M", "L", "XL"];

/** Labelling as the engine evaluates it on STD_EG's defaults (3 dispenser boxes, 1 carton), sizes S to XL. */
function evaluated(sizes: Record<string, unknown>): { entry: ModuleEvaluation; context: InspectionContext } {
  const context = makeTestContext({ sizes: SIZES });
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "header", include: false }, "labeling"]);
  const evaluation = evaluateInspection({ template, data: { modules: { labeling: { sizes } }, custom: {} }, context }, MODULE_REGISTRY);
  const entry = evaluation.modules.find((module) => module.key === "labeling");
  if (!entry) throw new Error("labeling was not evaluated");
  return { entry, context };
}

describe("labelingTable", () => {
  it("gives each level the summary's words per size, the checks that found defects underneath; a defect red, fewer boxes than planned amber", () => {
    const { entry, context } = evaluated({
      S: { inner: { inspected: 3 }, carton: { inspected: 1 } },
      M: { inner: { inspected: 3, defects: { lot_no: 1, artwork: 2 } }, carton: { inspected: 1 } },
      L: { inner: { inspected: 2 }, carton: { inspected: 0 } },
      // A defect before the boxes inspected are recorded: the level fails, and the module warns.
      XL: { carton: { defects: { carton_no: 1 } } },
    });
    expect(entry.result.perSize?.L?.summary).toBe("Dispenser Box: 0 defects in 2 (plan 3); Carton Box: no boxes inspected.");
    expect(entry.result.perSize?.XL?.summary).toBe("Dispenser Box: not recorded; Carton Box: 1 defect, boxes inspected not recorded.");

    expect(labelingTable(entry, context)?.rows).toEqual([
      {
        key: "inner",
        label: "Dispenser Box",
        spec: "Limit 0 / 1",
        cells: [
          { text: "0 defects in 3" },
          { text: "3 defects in 3", note: "Wrong / No Lot Number 1, Wrong Artwork Print 2", tone: "fail" },
          { text: "0 defects in 2 (plan 3)", tone: "warn" },
          { text: null },
        ],
      },
      {
        key: "carton",
        label: "Carton Box",
        spec: "Limit 0 / 1",
        cells: [
          { text: "0 defects in 1" },
          { text: "0 defects in 1" },
          { text: "No boxes inspected" },
          { text: "1 defect", note: "No Box/Carton # Printed 1", tone: "fail" },
        ],
      },
    ]);
  });

  it("has no table while nothing is recorded", () => {
    const { entry, context } = evaluated({});
    expect(labelingTable(entry, context)).toBeNull();
  });

  it("reads the SAFEDON_EG example in its template's wording, four sizes across", () => {
    const example = evaluateSafedonEg();
    expect(labelingTable(example.module("labeling"), example.context)?.rows).toEqual([
      {
        key: "inner",
        label: "Inner Boxes/Packs",
        spec: "Limit 0 / 1",
        cells: Array.from({ length: 4 }, () => ({ text: "0 defects in 3" })),
      },
      {
        key: "carton",
        label: "Carton Boxes",
        spec: "Limit 0 / 1",
        cells: Array.from({ length: 4 }, () => ({ text: "0 defects in 1" })),
      },
    ]);
  });
});
