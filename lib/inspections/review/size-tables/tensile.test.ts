import { describe, expect, it } from "vitest";
import type { TensileSize } from "@/modules/tensile/schema";
import {
  evaluate,
  evaluateSafedonEg,
  inspectionMeta,
  safedonEgData,
  safedonEgFiles,
  seedTemplate,
} from "@/tests/acceptance/examples";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { tensileTable } from "./tensile";

/** The SAFEDON_EG example with its tensile averages changed as given. */
function safedonWith(sizes: (current: Record<string, TensileSize>) => Record<string, TensileSize>) {
  const data = safedonEgData();
  const tensile = data.modules.tensile as { sizes: Record<string, TensileSize> };
  const modules = { ...data.modules, tensile: { ...tensile, sizes: sizes(tensile.sizes) } };
  return evaluate(seedTemplate("SAFEDON_EG"), { ...data, modules }, inspectionMeta(SAFEDON_EG_EXAMPLE, safedonEgFiles()));
}

describe("tensileTable", () => {
  it("gives SAFEDON_EG's two averages per size, worded and printed as the template has them", () => {
    const safedon = evaluateSafedonEg();
    expect(tensileTable(safedon.module("tensile"), safedon.context)).toEqual({
      rows: [
        {
          key: "tensileStrength",
          label: "Tensile Strength (Average) (MPa)",
          spec: "≥ 14.00",
          cells: [{ text: "34.18" }, { text: "32.99" }, { text: "34.03" }, { text: "33.17" }],
        },
        {
          key: "elongationAtBreak",
          label: "Elongation at Break, Average (%)",
          spec: "≥ 500",
          cells: [{ text: "536" }, { text: "547" }, { text: "555" }, { text: "543" }],
        },
      ],
    });
  });

  it("marks an average below its minimum red, and one of 0 red as not valid; one not entered is a dash", () => {
    const safedon = safedonWith((sizes) => ({
      ...sizes,
      S: { ...sizes.S, tensileStrength: 12.5 },
      M: { ...sizes.M, elongationAtBreak: 0 },
      L: { ...sizes.L, elongationAtBreak: null },
    }));
    const table = tensileTable(safedon.module("tensile"), safedon.context);
    expect(table?.rows[0]?.cells).toEqual([{ text: "34.18" }, { text: "12.50", tone: "fail" }, { text: "34.03" }, { text: "33.17" }]);
    expect(table?.rows[1]?.cells).toEqual([
      { text: "536" },
      { text: "547" },
      { text: "0", note: "Not Valid", tone: "fail" },
      { text: null },
    ]);
  });

  it("has no table while no average is entered", () => {
    const safedon = safedonWith(() => ({}));
    expect(tensileTable(safedon.module("tensile"), safedon.context)).toBeNull();
  });
});
