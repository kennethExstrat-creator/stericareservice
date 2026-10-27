// The sampling plan for the manufacturer (Kenneth, 27 October 2026) from the
// placeholder fixture (S to XL, 1,000 gloves a case, M's code letter reduced
// from M to L, FAB switched off), run through the real modules: the chrome,
// the info card, the sample at a glance, the order, the plan by size with
// its totals, the rows left out and the code letters' note.
import { describe, expect, it } from "vitest";
import type { InspectionExport } from "@/lib/schemas/export";
import { makePlanExport, planData, PLAN_CLIENT } from "./__fixtures__/export";
import {
  buildSamplingPlanModel,
  oddOnesOut,
  productKind,
  samplingPlanFileName,
  SAMPLING_PLAN_FOOTER,
  SAMPLING_PLAN_LEAD,
  type SamplingPlanModel,
  type SamplingPlanRow,
  type SamplingPlanRowKey,
} from "./model";
import { samplingPlanPrintPath, samplingPlanReady, samplingPlanStepPath } from "./paths";

function modelOf(doc: InspectionExport = makePlanExport()): SamplingPlanModel {
  const model = buildSamplingPlanModel(doc);
  if (!model) throw new Error("The fixture has a sampling plan.");
  return model;
}

const rowsOf = (model: SamplingPlanModel) => model.groups.flatMap((group) => group.rows);

function rowOf(model: SamplingPlanModel, key: SamplingPlanRowKey): SamplingPlanRow {
  const row = rowsOf(model).find((entry) => entry.key === key);
  if (!row) throw new Error(`No ${key} row.`);
  return row;
}

const valuesOf = (row: SamplingPlanRow) => row.cells.map((cell) => cell.value);

/** The fixture's plan with one size's row changed. */
function withSize(size: string, patch: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const data = planData();
  return { ...data, ...extra, sizes: { ...data.sizes, [size]: { ...data.sizes[size], ...patch } } };
}

describe("the chrome", () => {
  it("is the report's chrome as the sampling plan fills it: its band, the PO and the day, whom it is for, no page number", () => {
    expect(modelOf().chrome).toMatchObject({
      bandTitle: "Sampling Plan",
      bandAside: "PO-0001 · Inspection 11 April 2025",
      footerLeft: "Prepared for Manufacturer A · Factory A1 · PO-0001",
      footerRight: SAMPLING_PLAN_FOOTER,
    });
    expect(SAMPLING_PLAN_FOOTER).toBe("Computer-generated document. No signature required.");
  });

  it("leaves out what is not entered: no PO, no day, no manufacturer", () => {
    const doc = makePlanExport();
    const header = doc.modules.find((module) => module.key === "header");
    if (!header) throw new Error("No header.");
    header.data = { ...header.data, poNo: null, inspectionDate: null };
    header.computed = { ...header.computed, inspectionDate: null, manufacturer: null };
    doc.template.manufacturer = null;
    const { chrome, facts, po } = modelOf(doc);
    expect(chrome.bandAside).toBeNull();
    expect(chrome.footerLeft).toBeNull();
    expect(po).toBeNull();
    expect(facts.filter((fact) => !fact.stated).map((fact) => [fact.label, fact.value])).toEqual([
      ["PO / SO Number", "Not stated"],
      ["Manufacturer", "Not stated"],
      ["Inspection Date", "Not stated"],
    ]);
  });
});

describe("the heading and the details", () => {
  it("names the product type over the product, asks for the samples, and lists the client, PO, manufacturer and day", () => {
    const model = modelOf();
    expect(model.kicker).toBe("Nitrile Examination Gloves");
    expect(model.title).toBe("Brand A PC-A01 Blue Nitrile");
    expect(model.lead).toBe(SAMPLING_PLAN_LEAD);
    expect(SAMPLING_PLAN_LEAD).toBe("Please have these samples ready for SteriCare's pre-shipment inspection.");
    expect(model.facts.map((fact) => [fact.label, fact.value, fact.stated])).toEqual([
      ["Client", PLAN_CLIENT, true],
      ["PO / SO Number", "PO-0001 (SO-0001)", true],
      ["Manufacturer", "Manufacturer A · Factory A1", true],
      ["Inspection Date", "11 April 2025", true],
    ]);
  });

  it("words the product type from Glove Information's material and the template's product type", () => {
    const doc = makePlanExport();
    const glove = doc.modules.find((module) => module.key === "glove_info");
    if (!glove) throw new Error("No glove information.");
    glove.data = { ...glove.data, gloveType: "Powder-free natural rubber latex" };
    expect(productKind(doc)).toBe("Latex Examination Gloves");
    glove.data = { ...glove.data, gloveType: "Powder free" };
    expect(productKind(doc)).toBe("Examination Gloves");
    doc.template.productType = "surgical";
    expect(productKind(doc)).toBe("Surgical Gloves");
  });

  it("falls back to the template's words for the title when no product name is entered", () => {
    const doc = makePlanExport();
    const header = doc.modules.find((module) => module.key === "header");
    if (!header) throw new Error("No header.");
    header.data = { ...header.data, productName: null };
    doc.template.reportTitle = "Preshipment Inspection: Nitrile Disposable Examination Gloves";
    expect(modelOf(doc).title).toBe("Nitrile Disposable Examination Gloves");
  });
});

describe("the sample at a glance", () => {
  it("gives the cases to pull, the inner boxes taken, the gloves drawn with those put back, and the gloves sampled, last and tinted", () => {
    expect(modelOf().glance).toEqual([
      { key: "cases", value: 62, text: "cases to pull", highlight: false },
      { key: "innerUnits", value: 67, text: "inner boxes taken", highlight: false },
      { key: "glovesDrawn", value: 746, text: "gloves drawn, 21 put back", highlight: false },
      { key: "gloves", value: 725, text: "gloves sampled", highlight: true },
    ]);
  });

  it("says none are put back when the boxes give exactly the sample", () => {
    // As many inner boxes as gloves sampled, one glove from each: nothing drawn beyond the sample.
    const sizes = Object.fromEntries(
      Object.entries(planData().sizes).map(([size, row]) => [size, { ...row, innerUnitsPerCase: null, innerUnits: row.gloves }]),
    );
    const glance = modelOf(makePlanExport({ sampling_plan: { ...planData(), sizes } })).glance;
    expect(glance.find((line) => line.key === "glovesDrawn")).toEqual({ key: "glovesDrawn", value: 725, text: "gloves drawn, none put back", highlight: false });
  });
});

describe("the order", () => {
  it("lists each size's lots, cases and gloves at the packing's gloves per case, and the totals", () => {
    expect(modelOf().order).toEqual({
      glovesPerCase: 1000,
      lines: [
        { size: "S", label: "S", lots: ["LOT-S01"], cases: 120, gloves: 120_000 },
        { size: "M", label: "M", lots: ["LOT-M01", "LOT-M02"], cases: 400, gloves: 400_000 },
        { size: "L", label: "L", lots: ["LOT-L01"], cases: 100, gloves: 100_000 },
        { size: "XL", label: "XL", lots: ["LOT-XL01"], cases: 30, gloves: 30_000 },
      ],
      totalCases: 650,
      totalGloves: 650_000,
    });
  });
});

describe("the plan by size", () => {
  const model = modelOf();

  it("heads a column per ordered size, in the template's order, then Total", () => {
    expect(model.sizes.map((size) => size.label)).toEqual(["S", "M", "L", "XL"]);
    expect(model.templateSizes).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(model.showTotal).toBe(true);
  });

  it("orders the Sampling Quantity as the step does, worded for the factory, then what each test takes", () => {
    expect(model.groups.map((group) => [group.title, group.rows.map((row) => (row.unit ? `${row.label} ${row.unit}` : row.label))])).toEqual([
      [
        "Sampling Quantity",
        ["Cases to pull", "Inner boxes per case", "Inner boxes taken", "Gloves per inner box", "Gloves drawn", "Put back", "Gloves sampled"],
      ],
      // Force at break is switched off on the Sampling Plan: left out.
      ["For Each Test", ["Watertight & visual gloves", "Dimension gloves", "Packaging & dispensing inner boxes"]],
    ]);
  });

  it("works out the gloves drawn, per box × inner boxes, and puts back what they take beyond the sample, as taken away", () => {
    expect(valuesOf(rowOf(model, "glovesPerInnerBox"))).toEqual([13, 8, 13, 13]);
    expect(valuesOf(rowOf(model, "innerUnits"))).toEqual([16, 25, 16, 10]);
    expect(valuesOf(rowOf(model, "glovesDrawn"))).toEqual([208, 200, 208, 130]);
    expect(rowOf(model, "putBack")).toMatchObject({ negative: true, total: 21 });
    expect(valuesOf(rowOf(model, "putBack"))).toEqual([8, 0, 8, 5]);
    expect(rowOf(model, "gloves")).toMatchObject({ highlight: true, total: 725 });
    expect(valuesOf(rowOf(model, "gloves"))).toEqual([200, 200, 200, 125]);
  });

  it("totals every row that adds up, and none where a sum means nothing (per case, per box)", () => {
    expect(Object.fromEntries(rowsOf(model).map((row) => [row.key, row.summed ? row.total : "none"]))).toEqual({
      cases: 62,
      innerUnitsPerCase: "none",
      innerUnits: 67,
      glovesPerInnerBox: "none",
      glovesDrawn: 746,
      putBack: 21,
      gloves: 725,
      glovesWatertightVisual: 725,
      glovesDimensions: 47,
      innerUnitsDispensing: 29,
    });
    expect(rowOf(model, "innerUnitsPerCase").total).toBeNull();
  });

  it("marks the count that stands apart in a per-case or per-box row: XL's 2 inner boxes a case, M's 8 gloves a box", () => {
    expect(rowOf(model, "innerUnitsPerCase").cells).toEqual([
      { value: 1, odd: false },
      { value: 1, odd: false },
      { value: 1, odd: false },
      { value: 2, odd: true },
    ]);
    expect(rowOf(model, "glovesPerInnerBox").cells.map((cell) => cell.odd)).toEqual([false, true, false, false]);
    // A row that adds up marks none: 16, 25, 16 and 5 cases are just the plan.
    expect(rowsOf(model).filter((row) => row.summed).flatMap((row) => row.cells).some((cell) => cell.odd)).toBe(false);
  });

  it("leaves out every row switched off on the Sampling Plan, and shows FAB while it is on", () => {
    const allOn = modelOf(makePlanExport({ sampling_plan: { ...planData(), rowsOff: [] } }));
    expect(rowOf(allOn, "glovesPhysical")).toMatchObject({ label: "Force at break (FAB)", unit: "gloves", total: 47 });
    const fewer = modelOf(makePlanExport({ sampling_plan: { ...planData(), rowsOff: ["glovesPhysical", "glovesDimensions", "innerUnitsDispensing"] } }));
    expect(fewer.groups.find((group) => group.key === "tests")?.rows.map((row) => row.key)).toEqual(["glovesWatertightVisual"]);
  });

  it("leaves out the inner boxes per case where no size has one (a plan typed as totals)", () => {
    const sizes = Object.fromEntries(Object.entries(planData().sizes).map(([size, row]) => [size, { ...row, innerUnitsPerCase: null }]));
    const typed = modelOf(makePlanExport({ sampling_plan: { ...planData(), sizes } }));
    expect(rowsOf(typed).map((row) => row.key)).not.toContain("innerUnitsPerCase");
    expect(valuesOf(rowOf(typed, "innerUnits"))).toEqual([16, 25, 16, 10]);
  });

  it("names the inner unit as the packing configuration does, and the physical test the inspection runs", () => {
    const doc = makePlanExport();
    const packing = doc.modules.find((module) => module.key === "packing_config");
    if (!packing) throw new Error("No packing configuration.");
    packing.computed = { ...packing.computed, innerUnit: "plastic pack" };
    // An inspection that runs the tensile test (ASTM) in place of force at break.
    const physical = doc.modules.find((module) => module.key === "force_at_break");
    if (physical) physical.key = "tensile";
    const plan = doc.modules.find((module) => module.key === "sampling_plan");
    if (plan) plan.data = { ...plan.data, rowsOff: [] };
    const model = modelOf(doc);
    expect(rowsOf(model).map((row) => (row.unit ? `${row.label} ${row.unit}` : row.label))).toEqual([
      "Cases to pull",
      "Plastic packs per case",
      "Plastic packs taken",
      "Gloves per plastic pack",
      "Gloves drawn",
      "Put back",
      "Gloves sampled",
      "Watertight & visual gloves",
      "Dimension gloves",
      "Tensile gloves",
      "Packaging & dispensing plastic packs",
    ]);
    expect(model.glance.find((line) => line.key === "innerUnits")?.text).toBe("plastic packs taken");
  });

  it("has no Total column for one size", () => {
    const one = modelOf(
      makePlanExport({
        order_lots: { sizes: { M: { qtyCases: 400, lotNumbers: ["LOT-M01"], packingSite: null } } },
      }),
    );
    expect(one.sizes.map((size) => size.value)).toEqual(["M"]);
    expect(one.showTotal).toBe(false);
    expect(valuesOf(rowOf(one, "cases"))).toEqual([25]);
  });
});

describe("the code letters' note", () => {
  it("names each size's letter from the plan's Code Letter row, and a letter the inspector reduced", () => {
    expect(modelOf().note).toBe(
      "Sample sizes follow ISO 2859-1 single sampling, code letters L, L (reduced from M), L and K for sizes S, M, L and XL.",
    );
  });

  it("falls back to the lot's letter where a size has none in its row", () => {
    const sizes = Object.fromEntries(
      Object.entries(planData().sizes).map(([size, row]) => [size, { ...row, codeLetter: null, codeLetterReason: null }]),
    );
    expect(modelOf(makePlanExport({ sampling_plan: { ...planData(), sizes } })).note).toBe(
      "Sample sizes follow ISO 2859-1 single sampling, code letters L, M, L and K for sizes S, M, L and XL.",
    );
  });

  it("speaks of one letter for one size, and says nothing without a letter", () => {
    const one = makePlanExport({ order_lots: { sizes: { XL: { qtyCases: 30, lotNumbers: [], packingSite: null } } } });
    expect(modelOf(one).note).toBe("Sample sizes follow ISO 2859-1 single sampling, code letter K for size XL.");
    // No lot (no packing) and no letter entered: nothing to name.
    const none = makePlanExport({
      packing_config: { glovesPerInner: null, innersPerCase: null, glovesPerCase: null, packingMode: null },
      sampling_plan: withSize("XL", { codeLetter: null }),
      order_lots: { sizes: { XL: { qtyCases: 30, lotNumbers: [], packingSite: null } } },
    });
    expect(modelOf(none).note).toBeNull();
  });
});

describe("when the plan may go", () => {
  it("is complete once the step is Done, whatever the rest of the inspection", () => {
    expect(modelOf()).toMatchObject({ status: "info", complete: true });
    expect(samplingPlanReady("info")).toBe(true);
    expect(samplingPlanReady("pass")).toBe(true);
    // A plan with a warning is complete too: Kenneth asked for the export "once the sampling plan section is done".
    expect(samplingPlanReady("warn")).toBe(true);
    for (const status of ["fail", "not_done", null, undefined] as const) expect(samplingPlanReady(status)).toBe(false);
  });

  it("still prints a plan not yet complete, its blanks as nothing", () => {
    const model = modelOf(makePlanExport({ sampling_plan: withSize("M", { gloves: null, glovesWatertightVisual: null }) }));
    expect(model).toMatchObject({ status: "not_done", complete: false });
    expect(valuesOf(rowOf(model, "gloves"))).toEqual([200, null, 200, 125]);
    expect(rowOf(model, "gloves").total).toBe(525);
    expect(valuesOf(rowOf(model, "glovesPerInnerBox"))).toEqual([13, null, 13, 13]);
  });

  it("is nothing to print for an inspection without a Sampling Plan step", () => {
    const doc = makePlanExport();
    doc.modules = doc.modules.filter((module) => module.key !== "sampling_plan");
    expect(buildSamplingPlanModel(doc)).toBeNull();
  });

  it("prints at its own address, and goes back to the step", () => {
    expect(samplingPlanPrintPath("abc")).toBe("/inspections/abc/sampling-plan/print");
    expect(samplingPlanStepPath("abc")).toBe("/inspections/abc?module=sampling_plan");
  });
});

describe("the PDF's name", () => {
  it("is the day it is made, then the PO, its slashes and spaces as hyphens; the reference without a PO", () => {
    expect(samplingPlanFileName({ po: "PO-0001", refNo: "INS-2026-0001" }, "2026-10-27")).toBe("2026-10-27_sampling-plan_PO-0001");
    expect(samplingPlanFileName({ po: "PO 12/34/AB/CD", refNo: "INS-2026-0001" }, "2026-10-27")).toBe("2026-10-27_sampling-plan_PO12-34-AB-CD");
    expect(samplingPlanFileName({ po: null, refNo: "INS-2026-0001" }, "2026-10-27")).toBe("2026-10-27_sampling-plan_INS-2026-0001");
    expect(samplingPlanFileName(modelOf(), "2026-10-27")).toBe("2026-10-27_sampling-plan_PO-0001");
  });
});

describe("oddOnesOut", () => {
  it("marks the counts that differ from the one most sizes share, and none without such a count", () => {
    expect(oddOnesOut([1, 1, 1, 2])).toEqual([false, false, false, true]);
    expect(oddOnesOut([13, 11, 13, null])).toEqual([false, true, false, false]);
    expect(oddOnesOut([1, 2])).toEqual([false, false]);
    expect(oddOnesOut([1, 1, 2, 2])).toEqual([false, false, false, false]);
    expect(oddOnesOut([12, 13, 14])).toEqual([false, false, false]);
    expect(oddOnesOut([5])).toEqual([false]);
    expect(oddOnesOut([])).toEqual([]);
  });
});
