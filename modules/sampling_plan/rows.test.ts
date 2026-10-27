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

/** Each row of a group by its kind and key: "count gloves", "worked putBack", "letter codeLetter". */
const kinds = (group: ReturnType<typeof countGroups>[number]) =>
  group.rows.map((row) => (row.kind === "count" ? `count ${row.column}` : `${row.kind} ${row.key}`));

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
          "Put Back",
          "# of Gloves Sample",
          "Code Letter",
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
      specialInspectionLevel: null,
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
  it("types the inner boxes per case before the inner boxes in all, works out the gloves per inner box and put back before the gloves sampled, and ends on the code letter", () => {
    const [quantity] = countGroups(SAMPLING_PLAN_DEFAULT_CONFIG, labelsOf(SAMPLING_PLAN_LABELS));
    expect(kinds(quantity)).toEqual([
      "count cases",
      "count innerUnitsPerCase",
      "count innerUnits",
      "worked glovesPerInnerBox",
      "worked putBack",
      "count gloves",
      "letter codeLetter",
    ]);
  });

  it('has no Total Gloves Taken row any more (Kenneth, 27 October 2026: "remove this row")', () => {
    const rows = countGroups(SAMPLING_PLAN_DEFAULT_CONFIG, labelsOf(SAMPLING_PLAN_LABELS)).flatMap((group) => group.rows);
    expect(rows.map((row) => row.label)).not.toContain("Total Gloves Taken");
    expect(rows.map((row) => (row.kind === "count" ? row.column : row.key))).not.toContain("totalGlovesTaken");
  });

  it("puts the code letter right under # of Gloves Sample wherever the gloves show, and nowhere without them", () => {
    for (const columns of [{}, { innerUnits: false }, { cases: false }]) {
      const quantity = kinds(countGroups(withColumns(columns), labelsOf(SAMPLING_PLAN_LABELS))[0]);
      expect(quantity.slice(-2)).toEqual(["count gloves", "letter codeLetter"]);
    }
    const noGloves = countGroups(withColumns({ gloves: false }), labelsOf(SAMPLING_PLAN_LABELS)).flatMap(kinds);
    expect(noGloves).not.toContain("letter codeLetter");
  });

  it("shows the inner boxes per case with the inner boxes and the cases, and the worked rows with the gloves and the inner boxes", () => {
    expect(shape(withColumns({ innerUnits: false }), SAMPLING_PLAN_LABELS)[0].rows).toEqual(["# of Case", "# of Gloves Sample", "Code Letter"]);
    expect(shape(withColumns({ cases: false }), SAMPLING_PLAN_LABELS)[0].rows).toEqual([
      "Total # of Inner Box",
      "Gloves Taken per Inner Box",
      "Put Back",
      "# of Gloves Sample",
      "Code Letter",
    ]);
    expect(shape(withColumns({ gloves: false }), SAMPLING_PLAN_LABELS)[0].rows).toEqual([
      "# of Case",
      "Inner Box Taken per Case",
      "Total # of Inner Box",
      "# Gloves for Watertight & Visual",
    ]);
  });
});
