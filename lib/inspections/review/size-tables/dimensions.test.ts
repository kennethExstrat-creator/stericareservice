import { describe, expect, it } from "vitest";
import type { InspectionData } from "@/modules/_framework";
import type { DimensionsData } from "@/modules/dimensions";
import type { SamplingPlanData } from "@/modules/sampling_plan";
import {
  evaluate,
  evaluateSafedonEg,
  evaluateStdEg,
  inspectionMeta,
  safedonEgData,
  safedonEgFiles,
  seedTemplate,
  stdEgData,
} from "@/tests/acceptance/examples";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import type { SizeTable } from "../size-table";
import { dimensionsTable } from "./dimensions";

function withModules(data: InspectionData, modules: Record<string, unknown>): InspectionData {
  return { ...data, modules: { ...data.modules, ...modules } };
}

function rowOf(table: SizeTable | null, key: string) {
  const row = table?.rows.find((entry) => entry.key === key);
  if (!row) throw new Error(`No ${key} row`);
  return row;
}

describe("dimensionsTable", () => {
  it("gives STD_EG's one size a row per measure, the specs under the labels and the medians as printed", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    const table = dimensionsTable(stdEg.module("dimensions"), stdEg.context);
    expect(table?.rows).toEqual([
      { key: "length", label: "Length (mm)", spec: "≥ 240", cells: [{ text: "245" }] },
      // One size ordered: its spec is the one every size shares.
      { key: "width", label: "Width (mm)", spec: "95 ± 10", cells: [{ text: "95" }] },
      // NA: no spec printed.
      { key: "fingerThickness", label: "Finger Thickness (mm)", cells: [{ text: "0.09" }] },
      { key: "palmThickness", label: "Palm Thickness (mm)", cells: [{ text: "0.05" }] },
      { key: "cuffThickness", label: "Cuff Thickness (mm)", cells: [{ text: "0.04" }] },
    ]);
  });

  it("puts a spec that differs by size in each size's cell (SAFEDON_EG's averages, sizes XS to L)", () => {
    const safedon = evaluateSafedonEg();
    const table = dimensionsTable(safedon.module("dimensions"), safedon.context);
    expect(safedon.context.sizes).toEqual(["XS", "S", "M", "L"]);
    expect(table?.rows.map((row) => row.label)).toEqual([
      "Length (mm)",
      "Width (mm)",
      "Finger Thickness (mm)",
      "Palm Thickness (mm)",
    ]);
    expect(table?.rows.every((row) => row.cells.length === 4)).toBe(true);
    expect(rowOf(table, "length")).toEqual({
      key: "length",
      label: "Length (mm)",
      spec: "≥ 230",
      cells: [{ text: "241" }, { text: "243" }, { text: "243" }, { text: "243" }],
    });
    const width = rowOf(table, "width");
    expect(width.spec).toBeUndefined();
    expect(width.cells).toEqual([
      { text: "76", note: "76 ± 4" },
      { text: "87", note: "86 ± 4" },
      { text: "97", note: "98 ± 4" },
      { text: "107", note: "107 ± 4" },
    ]);
    expect(rowOf(table, "fingerThickness").spec).toBe("0.18 ± 0.04");
    expect(rowOf(table, "palmThickness").cells.map((cell) => cell.text)).toEqual(["0.12", "0.12", "0.11", "0.12"]);
  });

  it("shows a dash and the readings in for a size still missing some, and says when the plan has no gloves", () => {
    const base = safedonEgData({ textCells: "refused" });
    const sampling = base.modules.sampling_plan as SamplingPlanData;
    const data = withModules(base, {
      sampling_plan: { ...sampling, sizes: { ...sampling.sizes, XS: { ...sampling.sizes.XS, glovesDimensions: 0 } } },
    });
    const safedon = evaluate(seedTemplate("SAFEDON_EG"), data, inspectionMeta(SAFEDON_EG_EXAMPLE, safedonEgFiles()));
    const table = dimensionsTable(safedon.module("dimensions"), safedon.context);
    // XS has no spec computed: S to L still share theirs. Size S's cells typed with a space were refused: 12 of its 13 lengths are in.
    expect(rowOf(table, "length").spec).toBe("≥ 230");
    expect(rowOf(table, "length").cells).toEqual([
      { text: null, note: "No Gloves Planned" },
      { text: null, note: "12 of 13 Readings" },
      { text: "243" },
      { text: "243" },
    ]);
    expect(rowOf(table, "width").cells[0]).toEqual({ text: null, note: "No Gloves Planned" });
    expect(rowOf(table, "fingerThickness").cells[1]).toEqual({ text: null, note: "11 of 13 Readings" });
  });

  it("marks a median out of spec and a reading of 0 mm red, and a P/F set by hand against the readings amber", () => {
    const base = stdEgData({ corrected: true });
    const dimensions = base.modules.dimensions as DimensionsData;
    const gloves = dimensions.sizes.M.gloves;
    const outOfSpec = gloves.map((glove, index) => ({ ...glove, width: 106, length: index === 0 ? 0 : glove.length }));
    const evaluateWith = (sizeM: DimensionsData["sizes"][string]) =>
      evaluate(seedTemplate("STD_EG"), withModules(base, { dimensions: { sizes: { M: sizeM } } }), inspectionMeta(STD_EG_EXAMPLE));

    const failed = evaluateWith({ gloves: outOfSpec });
    const table = dimensionsTable(failed.module("dimensions"), failed.context);
    expect(rowOf(table, "width").cells).toEqual([{ text: "106", tone: "fail" }]);
    // The median still reads 245; the 0 mm reading is an error that blocks submit.
    expect(rowOf(table, "length").cells).toEqual([{ text: "245", tone: "fail" }]);

    const byHand = evaluateWith({
      gloves: gloves.map((glove) => ({ ...glove, width: 106 })),
      manualResults: { width: { result: "pass", comment: "Measured again at the lab: 104." } },
    });
    const kept = dimensionsTable(byHand.module("dimensions"), byHand.context);
    expect(rowOf(kept, "width").cells).toEqual([{ text: "106", note: "Passed by the Inspector", tone: "warn" }]);
  });

  it("has no table while nothing is measured, nor for a module that computed nothing", () => {
    const stdEg = evaluate(
      seedTemplate("STD_EG"),
      withModules(stdEgData({ corrected: true }), { dimensions: { sizes: {} } }),
      inspectionMeta(STD_EG_EXAMPLE),
    );
    expect(dimensionsTable(stdEg.module("dimensions"), stdEg.context)).toBeNull();
    expect(dimensionsTable({ ...stdEg.module("dimensions"), computed: {} }, stdEg.context)).toBeNull();
  });
});
