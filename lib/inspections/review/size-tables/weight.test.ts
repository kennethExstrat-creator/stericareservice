import { describe, expect, it } from "vitest";
import type { ResolvedTemplate } from "@/lib/schemas/template";
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
import { weightTable } from "./weight";

/** SAFEDON_EG with a weight spec per size in place of its NA ones. */
function withWeightSpecs(template: ResolvedTemplate): ResolvedTemplate {
  const specs = [
    { size: "XS", spec: { kind: "range", min: 2.3, max: 2.7 } },
    { size: "S", spec: { kind: "range", min: 3, max: 3.4 } },
    { size: "M", spec: { kind: "range", min: 3, max: 3.4 } },
    { size: "L", spec: { kind: "range", min: 3.3, max: 3.7 } },
  ];
  return {
    ...template,
    modules: template.modules.map((module) => (module.key === "weight" ? { ...module, config: { ...module.config, specs } } : module)),
  };
}

describe("weightTable", () => {
  it("gives STD_EG's average with the indicative weight under it, and the deviation amber beyond the threshold", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    expect(weightTable(stdEg.module("weight"), stdEg.context)).toEqual({
      rows: [
        { key: "average", label: "Average (g)", cells: [{ text: "2.90", note: "Indicative 3.5" }] },
        {
          key: "deviationPct",
          label: "Deviation From Indicative Weight",
          spec: "Threshold 10%",
          cells: [{ text: "17.1% below", tone: "warn" }],
        },
      ],
    });
  });

  it("prints no NA spec, and compares only the size the indicative weight is given for (SAFEDON_EG)", () => {
    const safedon = evaluateSafedonEg();
    expect(weightTable(safedon.module("weight"), safedon.context)).toEqual({
      rows: [
        {
          key: "average",
          label: "Average (g)",
          cells: [{ text: "2.56" }, { text: "2.94" }, { text: "3.18", note: "Indicative 3.2" }, { text: "3.55" }],
        },
        {
          key: "deviationPct",
          label: "Deviation From Indicative Weight",
          spec: "Threshold 10%",
          // Within the threshold: no tone.
          cells: [{ text: null }, { text: null }, { text: "0.6% below" }, { text: null }],
        },
      ],
    });
  });

  it("puts a spec that differs by size in each size's cell and marks a weight that fails it red", () => {
    const safedon = evaluate(
      withWeightSpecs(seedTemplate("SAFEDON_EG")),
      safedonEgData(),
      inspectionMeta(SAFEDON_EG_EXAMPLE, safedonEgFiles()),
    );
    const average = weightTable(safedon.module("weight"), safedon.context)?.rows[0];
    expect(average?.spec).toBeUndefined();
    expect(average?.cells).toEqual([
      { text: "2.56", note: "2.3 – 2.7" },
      { text: "2.94", note: "3 – 3.4", tone: "fail" },
      { text: "3.18", note: "3 – 3.4 · Indicative 3.2" },
      { text: "3.55", note: "3.3 – 3.7" },
    ]);
  });

  it("has no table while no weight is entered", () => {
    const data = stdEgData({ corrected: true });
    const stdEg = evaluate(
      seedTemplate("STD_EG"),
      { ...data, modules: { ...data.modules, weight: { sizes: {} } } },
      inspectionMeta(STD_EG_EXAMPLE),
    );
    expect(weightTable(stdEg.module("weight"), stdEg.context)).toBeNull();
  });
});
