import { describe, expect, it } from "vitest";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateStdEg } from "@/tests/acceptance/examples";
import { dispensingPackingTable } from "./dispensing-packing";

const SIZES = ["S", "M", "L"];

/** The Glove Packing Check as the engine evaluates it on its defaults (min. 70% / 80%, D fails), two boxes planned per size. */
function evaluated(sizes: Record<string, unknown>): { entry: ModuleEvaluation; context: InspectionContext } {
  const context = makeTestContext({
    sizes: SIZES,
    sampling: Object.fromEntries(SIZES.map((size) => [size, makeSampling({ packagingDispensing: 2 })])),
  });
  const template = makeTestTemplate(MODULE_REGISTRY, ["dispensing_packing"]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { dispensing_packing: { sizes } }, custom: {} }, context },
    MODULE_REGISTRY,
  );
  const entry = evaluation.modules.find((module) => module.key === "dispensing_packing");
  if (!entry) throw new Error("dispensing_packing was not evaluated");
  return { entry, context };
}

const box = (boxNo: number | null, layeringPct: number, dispensingPct: number, stickiness: string) => ({
  boxNo,
  layeringPct,
  dispensingPct,
  stickiness,
});

describe("dispensingPackingTable", () => {
  it("prints the averages and the stickiest code as the summary does, each against its spec; the aged sample judged on its own", () => {
    const { entry, context } = evaluated({
      // Layering 65.0% under 70%, a box coded D: both fail. The aged sample fails on dispensing alone.
      S: {
        boxes: [box(1, 60, 85, "A"), box(2, 70, 85, "D")],
        agedSample: { layeringPct: 75, dispensingPct: 70, stickiness: "B" },
      },
      // One of two boxes: not done, so its averages so far are not judged.
      M: { boxes: [box(3, 90, 92, "A")] },
      // An aged sample entered in part: the module warns at the first value missing.
      L: { agedSample: { layeringPct: 80 } },
    });
    expect(entry.result.perSize?.S?.summary).toBe(
      "Layering 65.0% (min. 70%), Dispensing 85.0% (min. 80%), Stickiness D: Failed (Layering, Stickiness).\nAged Sample: Layering 75.0% (min. 70%), Dispensing 70.0% (min. 80%), Stickiness B: Failed (Dispensing).",
    );

    expect(dispensingPackingTable(entry, context)?.rows).toEqual([
      { key: "boxesComplete", label: "Boxes Complete", cells: [{ text: "2 of 2" }, { text: "1 of 2" }, { text: "0 of 2" }] },
      {
        key: "layeringPct",
        label: "Layering",
        spec: "Min. 70%",
        cells: [{ text: "65.0%", tone: "fail" }, { text: "90.0%" }, { text: null }],
      },
      { key: "dispensingPct", label: "Dispensing", spec: "Min. 80%", cells: [{ text: "85.0%" }, { text: "92.0%" }, { text: null }] },
      {
        key: "stickiness",
        label: "Stickiness",
        spec: "A, B, B1, C",
        cells: [{ text: "D", note: "A 1, D 1", tone: "fail" }, { text: "A" }, { text: null }],
      },
      {
        key: "agedSample.layeringPct",
        label: "Aged Sample: Layering",
        spec: "Min. 70%",
        cells: [{ text: "75.0%" }, { text: null }, { text: "80.0%" }],
      },
      {
        key: "agedSample.dispensingPct",
        label: "Aged Sample: Dispensing",
        spec: "Min. 80%",
        cells: [{ text: "70.0%", tone: "fail" }, { text: null }, { text: null, tone: "warn" }],
      },
      {
        key: "agedSample.stickiness",
        label: "Aged Sample: Stickiness",
        spec: "A, B, B1, C",
        cells: [{ text: "B" }, { text: null }, { text: null }],
      },
    ]);
  });

  it("leaves the aged sample's rows out while no size has one", () => {
    const { entry, context } = evaluated({ S: { boxes: [box(1, 88, 90, "A"), box(2, 90, 92, "B")] } });
    const table = dispensingPackingTable(entry, context);
    expect(table?.rows.map((row) => row.key)).toEqual(["boxesComplete", "layeringPct", "dispensingPct", "stickiness"]);
    expect(table?.rows.map((row) => row.cells[0])).toEqual([
      { text: "2 of 2" },
      { text: "89.0%" },
      { text: "91.0%" },
      { text: "B", note: "A 1, B 1" },
    ]);
  });

  it("reads the STD_EG example: 88.3% and 90.3%, box 2336, not in M's sampled box/carton numbers, amber, and the placeholder aged sample", () => {
    const example = evaluateStdEg({ corrected: true });
    const entry = example.module("dispensing_packing");
    expect(entry.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["box_not_in_carton_list", ["sizes", "M", "boxes", 11, "boxNo"]],
    ]);
    expect(dispensingPackingTable(entry, example.context)?.rows).toEqual([
      { key: "boxesComplete", label: "Boxes Complete", cells: [{ text: "13 of 13", tone: "warn" }] },
      { key: "layeringPct", label: "Layering", spec: "Min. 70%", cells: [{ text: "88.3%" }] },
      { key: "dispensingPct", label: "Dispensing", spec: "Min. 80%", cells: [{ text: "90.3%" }] },
      { key: "stickiness", label: "Stickiness", spec: "A, B, B1, C", cells: [{ text: "A" }] },
      // The report printed no aged sample; the example carries one that passes (every size needs one: Kenneth, 27 October 2026).
      { key: "agedSample.layeringPct", label: "Aged Sample: Layering", spec: "Min. 70%", cells: [{ text: "85.0%" }] },
      { key: "agedSample.dispensingPct", label: "Aged Sample: Dispensing", spec: "Min. 80%", cells: [{ text: "88.0%" }] },
      { key: "agedSample.stickiness", label: "Aged Sample: Stickiness", spec: "A, B, B1, C", cells: [{ text: "A" }] },
    ]);
  });
});
