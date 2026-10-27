import { describe, expect, it } from "vitest";
import { labelFor } from "@/modules/_framework";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingPlanConfig } from "./config";
import { countGroups } from "./rows";

const labelsOf =
  (labels: Record<string, string>) =>
  (key: string): string =>
    labelFor(labels, key);

const shape = (config: SamplingPlanConfig, labels: Record<string, string>) =>
  countGroups(config, labelsOf(labels)).map((group) => ({
    heading: group.heading,
    rows: group.rows.map((row) => (row.kind === "count" ? row.shown : row.label)),
  }));

const withColumns = (columns: Partial<SamplingPlanConfig["columns"]>): SamplingPlanConfig => ({
  ...SAMPLING_PLAN_DEFAULT_CONFIG,
  columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, ...columns },
});

describe("countGroups (Kenneth, 26 October 2026: design B)", () => {
  it("heads what was sampled with the template's Sampling Quantity, then each test under what it counts", () => {
    expect(shape(SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS)).toEqual([
      {
        heading: "Sampling Quantity",
        rows: [
          "# of Case",
          "Inner Box Taken per Case",
          "Total # of Inner Box",
          "Gloves Taken per Inner Box",
          "Total Gloves Taken",
          "Put Back",
          "# of Gloves Sample",
        ],
      },
      { heading: "# Gloves for Each Test", rows: ["Watertight & Visual", "Dimension", "FAB"] },
      { heading: "# Inner Box", rows: ["Packaging & Dispensing Inspection"] },
    ]);
  });

  it("keeps the template's whole wording as each row's name", () => {
    const groups = countGroups(SAMPLING_PLAN_DEFAULT_CONFIG, labelsOf(SAMPLING_PLAN_LABELS));
    expect(groups[1].rows[0]).toEqual({
      kind: "count",
      column: "glovesWatertightVisual",
      label: "# Gloves for Watertight & Visual",
      shown: "Watertight & Visual",
    });
  });

  it("follows the template's words and columns: SAFEDON_EG's inner packs; never a weight row, even switched on", () => {
    const safedon = { ...SAMPLING_PLAN_LABELS, glovesPhysical: "# Gloves for Tensile", innerUnitsDispensing: "# Inner Packs for Packaging & Dispensing Inspection" };
    expect(shape(SAMPLING_PLAN_DEFAULT_CONFIG, safedon).slice(1)).toEqual([
      { heading: "# Gloves for Each Test", rows: ["Watertight & Visual", "Dimension", "Tensile"] },
      { heading: "# Inner Packs", rows: ["Packaging & Dispensing Inspection"] },
    ]);
    const weighs = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, glovesWeight: true } };
    expect(shape(weighs, SAMPLING_PLAN_LABELS)[1].rows).toEqual(["Watertight & Visual", "Dimension", "FAB"]);
  });

  it("leaves labels not worded '# … for …' as they are, after a plain divider (the SG form)", () => {
    const config: SamplingPlanConfig = {
      inspectionLevel: null,
      columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, gloves: false, innerUnitsDispensing: false, pouches: true, pouchesDyeLeak: true },
    };
    const sg = {
      ...SAMPLING_PLAN_LABELS,
      samplingQuantity: "Sampling Quantity (WTT & Visual)",
      glovesWatertightVisual: "# Gloves",
      glovesDimensions: "# Gloves Dimension",
      glovesPhysical: "# Gloves (FAB)",
    };
    expect(shape(config, sg)).toEqual([
      {
        heading: "Sampling Quantity (WTT & Visual)",
        rows: ["# of Case", "Inner Box Taken per Case", "Total # of Inner Box", "Pouches", "# Gloves"],
      },
      { heading: null, rows: ["# Gloves Dimension", "# Gloves (FAB)", "# Pouches (Dye Leak Test)"] },
    ]);
  });
});

describe("the Sampling Quantity's own rows (Kenneth, 27 October 2026)", () => {
  it("types the inner boxes per case before the inner boxes in all, and works out the gloves per inner box, taken and put back before the gloves sampled", () => {
    const [quantity] = countGroups(SAMPLING_PLAN_DEFAULT_CONFIG, labelsOf(SAMPLING_PLAN_LABELS));
    expect(quantity.rows.map((row) => (row.kind === "count" ? `count ${row.column}` : `worked ${row.key}`))).toEqual([
      "count cases",
      "count innerUnitsPerCase",
      "count innerUnits",
      "worked glovesPerInnerBox",
      "worked totalGlovesTaken",
      "worked putBack",
      "count gloves",
    ]);
  });

  it("shows the inner boxes per case with the inner boxes and the cases, and the worked rows with the gloves and the inner boxes", () => {
    expect(shape(withColumns({ innerUnits: false }), SAMPLING_PLAN_LABELS)[0].rows).toEqual(["# of Case", "# of Gloves Sample"]);
    expect(shape(withColumns({ cases: false }), SAMPLING_PLAN_LABELS)[0].rows).toEqual([
      "Total # of Inner Box",
      "Gloves Taken per Inner Box",
      "Total Gloves Taken",
      "Put Back",
      "# of Gloves Sample",
    ]);
    expect(shape(withColumns({ gloves: false }), SAMPLING_PLAN_LABELS)[0].rows).toEqual([
      "# of Case",
      "Inner Box Taken per Case",
      "Total # of Inner Box",
      "# Gloves for Watertight & Visual",
    ]);
  });
});
