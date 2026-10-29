import { describe, expect, it } from "vitest";
import type { InspectionData } from "@/modules/_framework";
import type { SamplingPlanData, SamplingSize } from "@/modules/sampling_plan";
import { evaluate, evaluateSafedonEg, evaluateStdEg, inspectionMeta, seedTemplate, stdEgData } from "@/tests/acceptance/examples";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { samplingPlanTable } from "./sampling-plan";

/** A size with nothing sampled. */
const EMPTY_SIZE: SamplingSize = {
  cases: null,
  innerUnitsPerCase: null,
  innerUnits: null,
  gloves: null,
  codeLetter: null,
  codeLetterReason: null,
  glovesWatertightVisual: null,
  glovesDimensions: null,
  glovesPhysical: null,
  glovesWeight: null,
  innerUnitsDispensing: null,
  pouches: null,
  pouchesDyeLeak: null,
};

/** STD_EG with its size M sampled as given (Lot: 2,900 cases of 2,000 gloves, code letter N at level I). */
function stdEgWith(change: (sizeM: SamplingSize) => SamplingSize, extra: Partial<SamplingPlanData> = {}) {
  const data: InspectionData = stdEgData({ corrected: true });
  const sampling = data.modules.sampling_plan as SamplingPlanData;
  const sampled: SamplingPlanData = { ...sampling, ...extra, sizes: { ...sampling.sizes, M: change(sampling.sizes.M) } };
  const stdEg = evaluate(
    seedTemplate("STD_EG"),
    { ...data, modules: { ...data.modules, sampling_plan: sampled } },
    inspectionMeta(STD_EG_EXAMPLE),
  );
  return samplingPlanTable(stdEg.module("sampling_plan"), stdEg.context);
}

describe("samplingPlanTable", () => {
  it("lists STD_EG's counts as the capture screen does, the worked-out ones included, without the rows it has no value for", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    // No inner boxes per case and no code letter: the report prints neither.
    expect(samplingPlanTable(stdEg.module("sampling_plan"), stdEg.context)?.rows).toEqual([
      { key: "cases", label: "# of Case", cells: [{ text: "50" }] },
      { key: "innerUnits", label: "Total # of Inner Box", cells: [{ text: "50" }] },
      { key: "glovesPerInnerBox", label: "Gloves Taken per Inner Box", cells: [{ text: "10" }] },
      { key: "putBack", label: "Put Back", cells: [{ text: "0" }] },
      { key: "gloves", label: "# of Gloves Sample", cells: [{ text: "500" }] },
      { key: "glovesWatertightVisual", label: "# Gloves for Watertight & Visual", cells: [{ text: "500" }] },
      { key: "glovesDimensions", label: "# Gloves for Dimension", cells: [{ text: "13" }] },
      { key: "glovesPhysical", label: "# Gloves for FAB", cells: [{ text: "13" }] },
      { key: "innerUnitsDispensing", label: "# Inner Box for Packaging & Dispensing Inspection", cells: [{ text: "13" }] },
    ]);
  });

  it("puts the sizes side by side, the test rows in the template's wording (SAFEDON_EG)", () => {
    const safedon = evaluateSafedonEg();
    const table = samplingPlanTable(safedon.module("sampling_plan"), safedon.context);
    expect(table?.rows.map((row) => [row.label, row.cells.map((cell) => cell.text)])).toEqual([
      ["# of Case", ["5", "20", "15", "5"]],
      ["Total # of Inner Box", ["10", "25", "15", "10"]],
      ["Gloves Taken per Inner Box", ["8", "8", "14", "8"]],
      ["Put Back", ["0", "0", "10", "0"]],
      ["# of Gloves Sample", ["80", "200", "200", "80"]],
      ["# Gloves for Watertight & Visual", ["80", "200", "200", "80"]],
      ["# Gloves for Dimension", ["13", "13", "13", "13"]],
      ["# Gloves for Tensile", ["13", "13", "13", "13"]],
      ["# Inner Packs for Packaging & Dispensing Inspection", ["5", "8", "8", "5"]],
    ]);
  });

  it("shows the inner boxes per case and a code letter where entered: one lowered says so, gloves apart from its sample no warning", () => {
    const table = stdEgWith((sizeM) => ({
      ...sizeM,
      innerUnitsPerCase: 1,
      gloves: 100,
      codeLetter: "J",
      codeLetterReason: "Consistent factory performance.",
    }));
    expect(table?.rows.map((row) => row.key)).toEqual([
      "cases",
      "innerUnitsPerCase",
      "innerUnits",
      "glovesPerInnerBox",
      "putBack",
      "gloves",
      "codeLetter",
      "glovesWatertightVisual",
      "glovesDimensions",
      "glovesPhysical",
      "innerUnitsDispensing",
    ]);
    const row = (key: string) => table?.rows.find((entry) => entry.key === key);
    expect(row("innerUnitsPerCase")).toEqual({ key: "innerUnitsPerCase", label: "Inner Box Taken per Case", cells: [{ text: "1" }] });
    expect(row("glovesPerInnerBox")?.cells).toEqual([{ text: "2" }]);
    // Code J samples 80 gloves: 100 is no warning (Kenneth, 29 October 2026), the lowered letter still says so.
    expect(row("codeLetter")).toEqual({
      key: "codeLetter",
      label: "Code Letter",
      cells: [{ text: "J", note: "Reduced From N" }],
    });
  });

  it("marks more cases than ordered red, and leaves out a test row switched off with nothing in it", () => {
    const table = stdEgWith((sizeM) => ({ ...sizeM, cases: 3000, glovesPhysical: null }), {
      rowsOff: ["glovesPhysical", "glovesDimensions"],
    });
    expect(table?.rows.find((row) => row.key === "cases")?.cells).toEqual([{ text: "3,000", tone: "fail" }]);
    // Switched off, its 13 still go forward to dimension: it stays in view.
    expect(table?.rows.find((row) => row.key === "glovesDimensions")?.cells).toEqual([{ text: "13" }]);
    expect(table?.rows.some((row) => row.key === "glovesPhysical")).toBe(false);
  });

  it("has no table while nothing is sampled", () => {
    expect(stdEgWith(() => ({ ...EMPTY_SIZE }))).toBeNull();
  });
});
