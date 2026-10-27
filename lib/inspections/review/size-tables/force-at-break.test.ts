import { describe, expect, it } from "vitest";
import type { InspectionData } from "@/modules/_framework";
import type { OrderLotsData } from "@/modules/order_lots";
import { evaluate, evaluateStdEg, inspectionMeta, readingsWithMedian, seedTemplate, stdEgData } from "@/tests/acceptance/examples";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { forceAtBreakTable } from "./force-at-break";

/** STD_EG with sizes S and L ordered too, and these force at break readings. */
function threeSizes(values: Record<string, (number | null)[]>): InspectionData {
  const data = stdEgData({ corrected: true });
  const order = data.modules.order_lots as OrderLotsData;
  const sizes = {
    ...order.sizes,
    S: { qtyCases: 100, lotNumbers: ["LOT-S-0001"], packingSite: null },
    L: { qtyCases: 100, lotNumbers: ["LOT-L-0001"], packingSite: null },
  };
  const readings = Object.fromEntries(Object.entries(values).map(([size, list]) => [size, { values: list }]));
  return {
    ...data,
    modules: { ...data.modules, order_lots: { ...order, sizes }, force_at_break: { sizes: readings, labReports: [] } },
  };
}

describe("forceAtBreakTable", () => {
  it("gives STD_EG's median as printed, under the minimum every size shares", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    expect(forceAtBreakTable(stdEg.module("force_at_break"), stdEg.context)).toEqual({
      rows: [{ key: "median", label: "Median (N)", spec: "≥ 6", cells: [{ text: "6.537" }] }],
    });
  });

  it("marks a median below the minimum red and shows the readings in for a size still waiting", () => {
    const data = threeSizes({
      S: readingsWithMedian(5.8),
      M: readingsWithMedian(6.537),
      L: readingsWithMedian(6.2).slice(0, 9),
    });
    const stdEg = evaluate(seedTemplate("STD_EG"), data, inspectionMeta(STD_EG_EXAMPLE));
    expect(stdEg.context.sizes).toEqual(["S", "M", "L"]);
    expect(forceAtBreakTable(stdEg.module("force_at_break"), stdEg.context)?.rows[0]?.cells).toEqual([
      { text: "5.800", tone: "fail" },
      { text: "6.537" },
      { text: null, note: "9 of 13 Readings" },
    ]);
  });

  it("marks a size with a reading of 0 N red, as its error blocks submit", () => {
    const readings = readingsWithMedian(6.537);
    readings[3] = 0;
    const stdEg = evaluate(seedTemplate("STD_EG"), threeSizes({ M: readings }), inspectionMeta(STD_EG_EXAMPLE));
    // The 0 does not count: 12 of the 13 readings are in, and the size waits.
    expect(forceAtBreakTable(stdEg.module("force_at_break"), stdEg.context)?.rows[0]?.cells).toEqual([
      { text: null },
      { text: null, note: "12 of 13 Readings", tone: "fail" },
      { text: null },
    ]);
  });

  it("shows the readings coming before any size has its median, and has no table while none is entered", () => {
    const started = evaluate(seedTemplate("STD_EG"), threeSizes({ M: [6.1, 6.2] }), inspectionMeta(STD_EG_EXAMPLE));
    expect(forceAtBreakTable(started.module("force_at_break"), started.context)?.rows[0]?.cells).toEqual([
      { text: null },
      { text: null, note: "2 of 13 Readings" },
      { text: null },
    ]);
    const empty = evaluate(seedTemplate("STD_EG"), threeSizes({}), inspectionMeta(STD_EG_EXAMPLE));
    expect(forceAtBreakTable(empty.module("force_at_break"), empty.context)).toBeNull();
  });
});
