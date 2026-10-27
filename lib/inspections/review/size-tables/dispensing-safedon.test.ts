import { describe, expect, it } from "vitest";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateSafedonEg } from "@/tests/acceptance/examples";
import { dispensingSafedonTable } from "./dispensing-safedon";

const SIZES = ["S", "M", "L"];

/** The Glove Dispensing Inspection as the engine evaluates it on its defaults (125 per pack, max. 5%), two boxes planned per size. */
function evaluated(sizes: Record<string, unknown>): { entry: ModuleEvaluation; context: InspectionContext } {
  const context = makeTestContext({
    sizes: SIZES,
    sampling: Object.fromEntries(SIZES.map((size) => [size, makeSampling({ packagingDispensing: 2 })])),
  });
  const template = makeTestTemplate(MODULE_REGISTRY, ["dispensing_safedon"]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { dispensing_safedon: { sizes } }, custom: {} }, context },
    MODULE_REGISTRY,
  );
  const entry = evaluation.modules.find((module) => module.key === "dispensing_safedon");
  if (!entry) throw new Error("dispensing_safedon was not evaluated");
  return { entry, context };
}

describe("dispensingSafedonTable", () => {
  it("prints the boxes, the defects by kind and the rate as the summary does; a rate over the maximum red", () => {
    const { entry, context } = evaluated({
      // 13 defects in 250 gloves is 5.2%, over 5%. "ring_tear" is no defect of the template: left out, and warned about.
      S: {
        boxes: [
          { boxNo: 1, counts: { sticky: 10, ring_tear: 1 } },
          { boxNo: 2, counts: { no_cuff: 3 } },
        ],
      },
      // The second box has a defect but no box/carton number: not tested, so the size is not done.
      M: {
        boxes: [
          { boxNo: 3, counts: {} },
          { boxNo: null, counts: { stuck: 1 } },
        ],
      },
    });
    expect(entry.result.perSize?.S?.summary).toBe("13 / 250 (5.2%), max. 5%: Failed.");
    expect(entry.result.perSize?.M?.summary).toBe(
      "1 of 2 boxes tested; Box/Carton # missing in No. 2, which has defects counted.",
    );

    expect(dispensingSafedonTable(entry, context)?.rows).toEqual([
      {
        key: "boxesTested",
        label: "Boxes Tested",
        cells: [
          { text: "2 of 2" },
          { text: "1 of 2", note: "Box/Carton # missing in No. 2", tone: "warn" },
          { text: "0 of 2" },
        ],
      },
      { key: "boxesFailed", label: "Boxes Failed", cells: [{ text: "2" }, { text: "0" }, { text: null }] },
      {
        key: "defectCounts",
        label: "Safedon Packing Defects",
        cells: [{ text: "No Cuff 3, Sticky Glove 10", tone: "warn" }, { text: "None" }, { text: null }],
      },
      {
        key: "ratePct",
        label: "Defect Rate (%)",
        spec: "Max. 5%",
        // M's rate of the one box tested so far, not judged while the size is not done.
        cells: [{ text: "13 / 250 (5.2%)", tone: "fail" }, { text: "0 / 125 (0%)" }, { text: null }],
      },
    ]);
  });

  it("leaves the defects row out while no size found one", () => {
    const { entry, context } = evaluated({ S: { boxes: [{ boxNo: 1, counts: {} }, { boxNo: 2, counts: {} }] } });
    expect(dispensingSafedonTable(entry, context)?.rows.map((row) => [row.key, row.cells[0]])).toEqual([
      ["boxesTested", { text: "2 of 2" }],
      ["boxesFailed", { text: "0" }],
      ["ratePct", { text: "0 / 250 (0%)" }],
    ]);
  });

  it("reads the SAFEDON_EG example in its template's wording, four sizes across", () => {
    const example = evaluateSafedonEg();
    expect(dispensingSafedonTable(example.module("dispensing_safedon"), example.context)?.rows).toEqual([
      { key: "boxesTested", label: "Boxes Tested", cells: [{ text: "5 of 5" }, { text: "8 of 8" }, { text: "8 of 8" }, { text: "5 of 5" }] },
      { key: "boxesFailed", label: "Boxes Failed", cells: [{ text: "2" }, { text: "0" }, { text: "5" }, { text: "0" }] },
      {
        key: "defectCounts",
        label: "Safedon Packing Defects",
        cells: [{ text: "No Cuff 2, Sticky Glove 1" }, { text: "None" }, { text: "Sticky Glove 11" }, { text: "None" }],
      },
      {
        key: "ratePct",
        label: "Defect Rate (%)",
        spec: "Max. 5%",
        cells: [{ text: "3 / 625 (0.48%)" }, { text: "0 / 1,000 (0%)" }, { text: "11 / 1,000 (1.1%)" }, { text: "0 / 625 (0%)" }],
      },
    ]);
  });
});
