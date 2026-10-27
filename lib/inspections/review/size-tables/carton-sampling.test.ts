import { describe, expect, it } from "vitest";
import type { CartonSamplingData } from "@/modules/carton_sampling";
import {
  evaluate,
  evaluateSafedonEg,
  evaluateStdEg,
  inspectionMeta,
  safedonEgData,
  safedonEgFiles,
  seedTemplate,
} from "@/tests/acceptance/examples";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { cartonSamplingTable } from "./carton-sampling";

/** The SAFEDON_EG example with these box/carton numbers. */
function safedonWith(cartons: (current: CartonSamplingData["sizes"]) => CartonSamplingData["sizes"]) {
  const data = safedonEgData();
  const sampling = data.modules.carton_sampling as CartonSamplingData;
  const modules = { ...data.modules, carton_sampling: { sizes: cartons(sampling.sizes) } };
  return evaluate(seedTemplate("SAFEDON_EG"), { ...data, modules }, inspectionMeta(SAFEDON_EG_EXAMPLE, safedonEgFiles()));
}

describe("cartonSamplingTable", () => {
  it("gives STD_EG's box/carton numbers against the cases sampled, how many are unique and the range they are in", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    expect(cartonSamplingTable(stdEg.module("carton_sampling"), stdEg.context)).toEqual({
      rows: [
        { key: "samplingQuantity", label: "Sampling Quantity", cells: [{ text: "50 / 50" }] },
        { key: "unique", label: "Unique", cells: [{ text: "50" }] },
        { key: "range", label: "Between", cells: [{ text: "1 and 2,900" }] },
      ],
    });
  });

  it("marks the report's carton entered twice red on Unique (STD_EG as printed)", () => {
    const stdEg = evaluateStdEg({ corrected: false });
    const table = cartonSamplingTable(stdEg.module("carton_sampling"), stdEg.context);
    expect(table?.rows.map((row) => row.cells)).toEqual([[{ text: "50 / 50" }], [{ text: "49", tone: "fail" }], [{ text: "1 and 2,900" }]]);
  });

  it("puts SAFEDON_EG's four sizes side by side, each within its own order quantity", () => {
    const safedon = evaluateSafedonEg();
    const table = cartonSamplingTable(safedon.module("carton_sampling"), safedon.context);
    expect(table?.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["5 / 5", "20 / 20", "15 / 15", "5 / 5"],
      ["5", "20", "15", "5"],
      ["1 and 60", "1 and 850", "1 and 560", "1 and 60"],
    ]);
    expect(table?.rows.flatMap((row) => row.cells).some((cell) => cell.tone !== undefined)).toBe(false);
  });

  it("marks more numbers than cases sampled and a number past the order quantity red", () => {
    const safedon = safedonWith((sizes) => ({ ...sizes, XS: { cartonNumbers: [1, 12, 18, 25, 33, 61] } }));
    const table = cartonSamplingTable(safedon.module("carton_sampling"), safedon.context);
    expect(table?.rows.map((row) => row.cells[0])).toEqual([
      { text: "6 / 5", tone: "fail" },
      { text: "6" },
      { text: "1 and 60", tone: "fail" },
    ]);
  });

  it("has no table while no box/carton number is entered", () => {
    const safedon = safedonWith(() => ({}));
    expect(cartonSamplingTable(safedon.module("carton_sampling"), safedon.context)).toBeNull();
  });
});
