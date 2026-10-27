// Section 08, Packaging Labelling & Conclusion, from the placeholder example
// reports (STD_EG: size M, Dispenser Box and Carton Box; SAFEDON_EG: sizes
// XS to L, its own names for the levels and the limit): the cards, the
// lead, the results matrix, the conclusion card and the pages.
import { describe, expect, it } from "vitest";
import type { InspectionExport } from "@/lib/schemas/export";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { packingBoxes, packingExport } from "../__fixtures__/packing-export";
import { buildReportModel, type LabellingConclusionSection, type ReportPlanEntryFor } from "../model";
import {
  buildLabellingConclusion,
  cardSizeColumn,
  checkedFor,
  labellingHeights,
  labellingPages,
  LABELLING_ROOM,
  NO_REMARK,
  slashDate,
} from "./labellingConclusion";

type Section = LabellingConclusionSection;

/** The section's plan entry and slot, as the model builds them. */
function built(doc: InspectionExport): { entry: ReportPlanEntryFor<"labellingConclusion">; content: Section } {
  const model = buildReportModel(doc);
  const entry = model.plan.find((candidate) => candidate.key === "labellingConclusion");
  if (!entry || entry.kind !== "section" || !model.sections.labellingConclusion) throw new Error("Section 08 is not built.");
  return { entry: entry as ReportPlanEntryFor<"labellingConclusion">, content: model.sections.labellingConclusion };
}

const sectionOf = (doc: InspectionExport) => built(doc).content;

/** The section's options with some of its blocks switched off. */
function withBlocks(doc: InspectionExport, blocks: Partial<Record<"dispenserCartonBox" | "resultsMatrix" | "inspectorSignature" | "remark", boolean>>) {
  const current = doc.report.sections.labellingConclusion;
  return withReportOptions(doc, { sections: { ...doc.report.sections, labellingConclusion: { include: true, blocks: { ...current.blocks, ...blocks } } } });
}

/** A module of the export, to change in a test. */
function moduleIn(doc: InspectionExport, key: string) {
  const found = doc.modules.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No ${key} module.`);
  return found;
}

/** Sets a value down a path of a module's JSON (its data, computed values or config). */
function put(target: unknown, path: readonly string[], value: unknown): void {
  let current = target as Record<string, unknown>;
  for (const key of path.slice(0, -1)) current = current[key] as Record<string, unknown>;
  current[path[path.length - 1]] = value;
}

const values = (cells: readonly { value: number | null }[]) => cells.map((cell) => cell.value);

describe("the labelling cards", () => {
  it("print each level the template inspects in its wording, the computed limit, a row per check and the result", () => {
    const { levels, sizes } = sectionOf(makeStdEgExport());
    expect(sizes).toEqual([{ value: "M", label: "M" }]);
    expect(levels.map((card) => [card.level, card.title, card.limit])).toEqual([
      ["inner", "Dispenser Box", "Accept 0 · Reject 1"],
      ["carton", "Carton Box", "Accept 0 · Reject 1"],
    ]);
    const [inner, carton] = levels;
    expect(values(inner.inspected)).toEqual([3]);
    expect(inner.checks.map((check) => check.label)).toEqual(["Wrong / No Lot Number", "Wrong / No Mfg. Date", "Wrong Artwork Print"]);
    expect(carton.checks.map((check) => [check.code, check.label, values(check.cells)])).toEqual([
      ["lot_no", "Wrong / No Lot Number", [0]],
      ["mfg_date", "Wrong / No Mfg. Date", [0]],
      ["artwork", "Wrong Artwork Print", [0]],
      ["carton_no", "No Box/Carton # Printed", [0]],
    ]);
    // The shorter card takes a blank row, so the two cards' totals line up (TG35's Dispenser Box).
    expect([inner.padding, carton.padding]).toEqual([1, 0]);
    expect(values(carton.defects)).toEqual([0]);
    expect(carton.result).toEqual({ status: "pass", label: "Passed, Size M" });
  });

  it("keep another template's words: SAFEDON_EG's levels and limit, every size on the order", () => {
    const { levels, sizes } = sectionOf(makeSafedonExport());
    expect(sizes.map((size) => size.label)).toEqual(["XS", "S", "M", "L"]);
    expect(levels.map((card) => [card.title, card.limit, card.result.label])).toEqual([
      ["Inner Boxes/Packs", "Acc. = 0 · Rej. = 1", "Passed, All Sizes"],
      ["Carton Boxes", "Acc. = 0 · Rej. = 1", "Passed, All Sizes"],
    ]);
    expect(levels[1].checks.at(-1)?.label).toBe("No Box/Carton #");
    expect(values(levels[0].inspected)).toEqual([3, 3, 3, 3]);
  });

  it("mark a failing count red and name the size it failed; fewer boxes than planned amber; nothing recorded a dash", () => {
    const doc = makeSafedonExport();
    const labeling = moduleIn(doc, "labeling");
    put(labeling.data, ["sizes", "M", "carton", "defects", "lot_no"], 1);
    put(labeling.computed, ["sizes", "M", "carton"], { accept: 0, reject: 1, total: 1, result: "fail" });
    put(labeling.data, ["sizes", "L", "inner", "inspected"], 2);
    put(labeling.data, ["sizes", "S", "inner"], { inspected: null, boxNos: [], defects: {} });
    put(labeling.computed, ["sizes", "S", "inner"], { accept: 0, reject: 1, total: 0, result: "not_done" });
    const [inner, carton] = sectionOf(doc).levels;
    expect(carton.checks[0].cells.map((cell) => cell.tone)).toEqual([null, null, "fail", null]);
    expect(carton.defects[2]).toEqual({ value: 1, tone: "fail" });
    expect(carton.result).toEqual({ status: "fail", label: "Failed, Size M" });
    expect(inner.inspected.map((cell) => cell.tone)).toEqual([null, null, null, "warn"]);
    expect(values(inner.checks[0].cells)).toEqual([0, null, 0, 0]);
    expect(inner.defects[1]).toEqual({ value: null, tone: null });
    expect(inner.result).toEqual({ status: "not_done", label: "Not Done, Size S" });
  });

  it("are left out while switched off, the section keeping its title; with no labels inspected it reads as the conclusion", () => {
    const off = sectionOf(withBlocks(makeStdEgExport(), { dispenserCartonBox: false }));
    expect(off).toMatchObject({ title: "Packaging Labelling & Conclusion", lead: null, levels: [] });
    expect(off.matrix).not.toBeNull();

    const without = makeStdEgExport();
    without.modules = without.modules.filter((module) => module.key !== "labeling");
    expect(sectionOf(without)).toMatchObject({ title: "Conclusion", lead: null, levels: [] });
    // The plan, and so the Report page's settings, say the same.
    expect(buildReportModel(without).plan.find((entry) => entry.key === "labellingConclusion")).toMatchObject({ title: "Conclusion" });

    const levelsOff = makeStdEgExport();
    const config = moduleIn(levelsOff, "labeling").config;
    put(config, ["levels", "inner", "include"], false);
    put(config, ["levels", "carton", "include"], false);
    expect(sectionOf(levelsOff)).toMatchObject({ title: "Conclusion", levels: [] });

    const innerOnly = makeStdEgExport();
    put(moduleIn(innerOnly, "labeling").config, ["levels", "carton", "include"], false);
    const section = sectionOf(innerOnly);
    expect(section.levels.map((card) => [card.title, card.padding])).toEqual([["Dispenser Box", 0]]);
    expect(section.lead).toBe("Dispenser boxes checked for lot number, manufacturing date and artwork. Any single error rejects the size.");
  });

  it("are left out with no size on the order", () => {
    const doc = makeStdEgExport();
    put(moduleIn(doc, "order_lots").data, ["sizes"], {});
    expect(sectionOf(doc)).toMatchObject({ sizes: [], levels: [], lead: null, matrix: null });
  });
});

describe("the lead", () => {
  it("says what the labels were checked for, in the levels' words, and that any single error rejects the size", () => {
    expect(sectionOf(makeStdEgExport()).lead).toBe(
      "Dispenser and carton boxes checked for lot number, manufacturing date, artwork and box/carton number. Any single error rejects the size.",
    );
    expect(sectionOf(makeSafedonExport()).lead).toBe(
      "Inner boxes/packs and carton boxes checked for lot number, manufacturing and expiry dates, artwork and box/carton number. Any single error rejects the size.",
    );
  });

  it("names both dates together, and a check it has no words for by its label", () => {
    expect(checkedFor([{ code: "expiry_date", label: "Wrong / No Expiry Date" }, { code: "mfg_date", label: "Wrong / No Mfg. Date" }])).toEqual([
      "manufacturing and expiry dates",
    ]);
    expect(checkedFor([{ code: "seal", label: "Broken PE Seal" }])).toEqual(["broken PE seal"]);
  });
});

describe("the results matrix", () => {
  it("lists every check of Results by Check by size, Visual Inspection once for its classes, with a legend of what it shows", () => {
    const { matrix } = sectionOf(makeStdEgExport());
    expect(matrix?.rows.map((row) => [row.label, row.cells])).toEqual([
      ["Dimension", ["pass"]],
      ["Force at Break", ["pass"]],
      ["Weight", ["warn"]],
      ["Freedom From Holes – Watertight Test", ["pass"]],
      ["Visual Inspection: Critical, Major, Minor", ["pass"]],
      ["Packing Check", ["pass"]],
      // The fixture's placeholder aged sample (the report printed none).
      ["Packing Check: Aged Sample", ["pass"]],
      ["Labeling", ["pass"]],
    ]);
    expect(matrix?.legend).toEqual(["pass", "warn"]);
  });

  it("gives every size a module's own result where it is worse than every size's, as Results by Check does", () => {
    // SAFEDON_EG's tensile lab report is not attached: not done, whatever each size's readings say.
    const { matrix } = sectionOf(makeSafedonExport());
    expect(matrix?.rows.find((row) => row.key === "tensile")).toEqual({ key: "tensile", label: "Physical Properties", cells: ["not_done", "not_done", "not_done", "not_done"] });
    expect(matrix?.legend).toEqual(["pass", "not_done"]);
  });

  it("shows a size's failure in its own cell, and the packing check's aged sample apart, Not Done where a size has none entered", () => {
    const doc = makeSafedonExport();
    const labeling = moduleIn(doc, "labeling");
    labeling.result = { ...labeling.result, status: "fail", perSize: { ...labeling.result.perSize, M: { status: "fail", summary: "Carton Box: 1 defect in 1." } } };
    expect(sectionOf(doc).matrix?.rows.find((row) => row.key === "labeling")?.cells).toEqual(["pass", "pass", "fail", "pass"]);

    const aged = makeStdEgExport();
    put(moduleIn(aged, "dispensing_packing").computed, ["sizes", "M", "agedSample"], { layeringResult: "fail", dispensingResult: "pass", stickinessResult: "pass", result: "fail" });
    const rows = sectionOf(aged).matrix?.rows ?? [];
    expect(rows.find((row) => row.key === "dispensing_packing")?.cells).toEqual(["pass"]);
    expect(rows.find((row) => row.key === "dispensing_packing:aged")).toEqual({ key: "dispensing_packing:aged", label: "Packing Check: Aged Sample", cells: ["fail"] });

    // Every size needs one (Kenneth, 27 October 2026): size M's boxes passed with none entered, so its cell is Not Done, never a dash.
    const missing = packingExport({
      S: { boxes: packingBoxes(5), aged: { layeringPct: 87, dispensingPct: 85, stickiness: "B" } },
      M: { boxes: packingBoxes(5, {}, 8001) },
    });
    const packing = sectionOf(missing).matrix?.rows ?? [];
    expect(packing.find((row) => row.key === "dispensing_packing")?.cells).toEqual(["pass", "pass"]);
    expect(packing.find((row) => row.key === "dispensing_packing:aged")?.cells).toEqual(["pass", "not_done"]);
    expect(sectionOf(missing).matrix?.legend).toContain("not_done");
  });

  it("is left out while switched off", () => {
    expect(sectionOf(withBlocks(makeStdEgExport(), { resultsMatrix: false })).matrix).toBeNull();
  });
});

describe("the conclusion card", () => {
  it("dates the conclusion as the design does, draws the signature and says when no remark is recorded", () => {
    const { conclusion } = sectionOf(makeStdEgExport());
    expect(conclusion).toEqual({
      heading: "Conclusion",
      dateLabel: "Date",
      date: "12/04/2025",
      signature: { label: "Inspector's Signature", byHand: false, drawing: { width: 600, height: 200, paths: ["M40 150Q120 60 160 100Q200 140 250 105L300 70"] } },
      remark: { label: "Remark", text: null },
    });
    expect(NO_REMARK).toBe("None recorded.");
  });

  it("leaves the line blank to sign by hand after export, or until signed, and prints the remark", () => {
    const byHand = makeStdEgExport();
    byHand.conclusion = { ...byHand.conclusion, signAfterExport: true, remark: "Labels to be reprinted." };
    expect(sectionOf(byHand).conclusion).toMatchObject({ signature: { byHand: true, drawing: null }, remark: { text: "Labels to be reprinted." } });
    // SAFEDON_EG is not signed.
    expect(sectionOf(makeSafedonExport()).conclusion.signature).toEqual({ label: "Inspector's Signature", byHand: false, drawing: null });
  });

  it("leaves the signature and the remark out while switched off, the card always printed", () => {
    const { conclusion, pages } = sectionOf(withBlocks(makeStdEgExport(), { inspectorSignature: false, remark: false }));
    expect(conclusion).toMatchObject({ signature: null, remark: null, date: "12/04/2025" });
    expect(pages.flat()).toContain("conclusion");
  });

  it("writes a day as dd/mm/yyyy, a month as mm/yyyy, anything else as it is", () => {
    expect([slashDate("2026-10-23"), slashDate("2026-10"), slashDate("23 Oct"), slashDate(null), slashDate(" ")]).toEqual(["23/10/2026", "10/2026", "23 Oct", null, null]);
  });
});

describe("the pages", () => {
  it("print the cards, the matrix and the conclusion on one page, as the design does, for four sizes", () => {
    const { entry, content } = built(makeSafedonExport());
    expect(content.pages).toEqual([["levels", "matrix", "conclusion"]]);
    expect(entry).toMatchObject({ kicker: "Section 08", built: true, pageCount: 1 });
  });

  it("run the conclusion on to a second page for STD_EG: its matrix's eight rows, the aged sample's among them, outrun A4", () => {
    const { entry, content } = built(makeStdEgExport());
    const parts = { ...content, sizes: content.sizes.length };
    const heights = labellingHeights(parts, 184);
    expect(heights.matrix).toBeCloseTo(LABELLING_ROOM.matrixFrame + 8 * LABELLING_ROOM.matrixRow);
    // The heading and its two lines of lead, the parts and their gaps: 239.2 mm, of the 236 mm A4 holds.
    const lead = LABELLING_ROOM.heading + LABELLING_ROOM.leadGap + 2 * LABELLING_ROOM.leadLine;
    expect(lead + 3 * LABELLING_ROOM.gap + heights.levels + heights.matrix + heights.conclusion).toBeCloseTo(239.2);
    expect(content.pages).toEqual([["levels", "matrix"], ["conclusion"]]);
    expect(entry).toMatchObject({ kicker: "Section 08", built: true, pageCount: 2 });
  });

  it("move what page one cannot hold to a second: a long remark, or Letter's shorter paper", () => {
    const doc = makeSafedonExport();
    doc.conclusion = { ...doc.conclusion, remark: "Long remark. ".repeat(30).trim() };
    const { entry, content } = built(doc);
    expect(content.pages).toEqual([["levels", "matrix"], ["conclusion"]]);
    expect(entry.pageCount).toBe(2);
    expect(buildReportModel(doc).pageCount).toBe(buildReportModel(makeSafedonExport()).pageCount + 1);
    expect(sectionOf(withReportOptions(makeSafedonExport(), { pageSize: "letter" })).pages).toEqual([["levels", "matrix"], ["conclusion"]]);
  });

  it("estimate each part from its rows, a check that wraps a line taller, and keep the parts in order", () => {
    const content = sectionOf(makeSafedonExport());
    const parts = { ...content, sizes: content.sizes.length };
    const heights = labellingHeights(parts, 184);
    expect(heights.levels).toBeCloseTo(LABELLING_ROOM.cardFrame + 7 * LABELLING_ROOM.cardRow);
    expect(heights.matrix).toBeCloseTo(LABELLING_ROOM.matrixFrame + 6 * LABELLING_ROOM.matrixRow);
    const wrapped = { ...parts, levels: parts.levels.map((card) => ({ ...card, checks: card.checks.map((check) => ({ ...check, label: `${check.label} on the Carton Label` })) })) };
    expect(labellingHeights(wrapped, 184).levels).toBeGreaterThan(heights.levels);
    expect(labellingPages(parts, 120, 184)).toEqual([["levels"], ["matrix"], ["conclusion"]]);
    expect(cardSizeColumn(4)).toBeGreaterThan(cardSizeColumn(5));
  });
});

describe("the builder", () => {
  it("fills Section 08's slot from the export and its plan entry", () => {
    const doc = makeStdEgExport();
    const { entry, content } = built(doc);
    expect(buildLabellingConclusion(doc, entry)).toEqual(content);
  });
});
