// The report's model from the export (docs/REPORT.md): the chrome every page
// shares, the Summary (page 1), the plan of pages and the options it
// follows, from the placeholder example reports (STD_EG: size M, no client;
// SAFEDON_EG: sizes XS to L, Client A).
import { describe, expect, it } from "vitest";
import { richTextExample, richTextParagraph } from "@/lib/rich-text/__fixtures__/example";
import type { InspectionExport } from "@/lib/schemas/export";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "./__fixtures__/exports";
import { STERICARE_LETTERHEAD } from "./letterhead";
import {
  bandReference,
  buildReportModel,
  NOT_CONCLUDED,
  NOT_STATED,
  orderTotals,
  paperOf,
  poOf,
  preparedFor,
  reportPageChrome,
  type ReportSectionPlanEntry,
} from "./model";

const sectionsOf = (doc: InspectionExport) =>
  buildReportModel(doc).plan.filter((entry): entry is ReportSectionPlanEntry => entry.kind === "section");

function withConclusion(doc: InspectionExport, patch: Partial<InspectionExport["conclusion"]>, data: Record<string, unknown> = {}): InspectionExport {
  const next = structuredClone(doc);
  next.conclusion = { ...next.conclusion, ...patch };
  const conclusion = next.modules.find((module) => module.key === "conclusion");
  if (conclusion) conclusion.data = { ...conclusion.data, ...(data as typeof conclusion.data) };
  return next;
}

describe("the chrome every page shares", () => {
  it("names SteriCare, the report's title, the PO and the inspection day, and whom the report is for", () => {
    const { chrome } = buildReportModel(makeSafedonExport());
    expect(chrome).toMatchObject({
      letterhead: STERICARE_LETTERHEAD,
      title: "Pre-Shipment Inspection Report",
      po: "PO-0002",
      inspectedOn: "19 February 2025",
      client: "Client A",
      product: "Brand B Nitrile PF Examination Gloves",
      footerNote: null,
      refNo: "INS-2026-0002",
    });
    expect(bandReference(chrome)).toBe("PO-0002 · Inspected 19 February 2025");
    expect(preparedFor(chrome)).toBe("Prepared for Client A · Brand B Nitrile PF Examination Gloves");
    // No client recorded: the footer names the product alone.
    expect(preparedFor(buildReportModel(makeStdEgExport()).chrome)).toBe("Brand A PC-A01 Blue Nitrile");
  });

  it("keeps the PO without its bracketed reference, and gives a bare PO its letters", () => {
    expect(poOf("PO-0001 (SO-0001)")).toBe("PO-0001");
    expect(poOf("77/99/AB (REF-0077)")).toBe("PO 77/99/AB");
    expect(poOf("P.O. 77")).toBe("P.O. 77");
    expect(poOf(null)).toBeNull();
  });

  it("tags every page Draft until the inspection is approved", () => {
    expect(buildReportModel(makeStdEgExport()).chrome.draft).toBe(true);
    const approved = { ...makeStdEgExport(), status: "approved" as const };
    expect(buildReportModel(approved).chrome.draft).toBe(false);
  });

  it("is drawn as the report's page chrome: its title in the band, numbered pages", () => {
    expect(reportPageChrome(buildReportModel(makeSafedonExport()).chrome)).toEqual({
      letterhead: STERICARE_LETTERHEAD,
      bandTitle: "Pre-Shipment Inspection Report",
      bandAside: "PO-0002 · Inspected 19 February 2025",
      draft: true,
      footerLeft: "Prepared for Client A · Brand B Nitrile PF Examination Gloves",
      footerNote: null,
      footerRight: null,
      numbered: true,
    });
  });
});

describe("the paper", () => {
  it("is A4 or Letter as the options say, upright for the report and turned for a landscape document", () => {
    expect(buildReportModel(makeStdEgExport()).paper).toEqual({ size: "a4", orientation: "portrait", label: "A4", width: 210, height: 297 });
    expect(buildReportModel(withReportOptions(makeStdEgExport(), { pageSize: "letter" })).paper).toMatchObject({ width: 215.9, height: 279.4 });
    expect(paperOf("a4", "landscape")).toEqual({ size: "a4", orientation: "landscape", label: "A4", width: 297, height: 210 });
  });
});

describe("the Summary", () => {
  it("heads page 1 with the template's report title as the kicker and the product's name", () => {
    const { summary } = buildReportModel(makeStdEgExport());
    expect(summary.kicker).toBe("Preshipment Inspection · Nitrile Disposable Examination Gloves");
    expect(summary.title).toBe("Brand A PC-A01 Blue Nitrile");
  });

  it("concludes with the template's word, the conclusion's date and a verdict worked out from the checks", () => {
    const { conclusion } = buildReportModel(makeStdEgExport()).summary;
    expect(conclusion).toEqual({
      status: "pass",
      result: "pass",
      label: "PASSED",
      verdict: "8 of 9 checks passed for size M; Weight has a warning.",
      date: "12 April 2025",
    });
    const failed = buildReportModel(withConclusion(makeStdEgExport(), { finalResult: "fail" })).summary.conclusion;
    expect(failed).toMatchObject({ status: "fail", label: "FAILED" });
    const held = buildReportModel(withConclusion(makeStdEgExport(), { finalResult: "hold" })).summary.conclusion;
    expect(held).toMatchObject({ status: "hold", label: "HOLD" });
  });

  it("says Not Concluded, with the app's suggestion, until the inspector concludes", () => {
    const open = buildReportModel(withConclusion(makeStdEgExport(), { finalResult: null, date: null })).summary.conclusion;
    expect(open).toMatchObject({ status: "not_done", result: null, label: NOT_CONCLUDED, date: null });
    expect(open.verdict).toBe("8 of 9 checks passed for size M; Weight has a warning. Suggested Result: PASSED.");
  });

  it("lists the details in the design's order by the template's labels, a blank one Not stated", () => {
    const facts = buildReportModel(makeStdEgExport()).summary.facts;
    expect(facts.map((fact) => [fact.label, fact.value])).toEqual([
      ["Client Name", NOT_STATED],
      ["PO / SO Number", "PO-0001 (SO-0001)"],
      ["Manufacturer / Supplier", "Manufacturer A · Factory A1"],
      ["Inspection Date", "Friday, 11 April 2025"],
      ["Supplier Factory Address / Location", "Address A"],
      ["Manufacturing Date", "1 April 2025"],
      ["Expiry Date", "1 March 2030"],
    ]);
    expect(facts.find((fact) => fact.key === "client")).toMatchObject({ stated: false });
    expect(facts.find((fact) => fact.key === "factoryAddress")).toMatchObject({ wide: true });
    // SAFEDON_EG keeps its dates to the month, and names the client.
    const safedon = buildReportModel(makeSafedonExport()).summary.facts;
    expect(safedon.find((fact) => fact.key === "client")?.value).toBe("Client A");
    expect(safedon.find((fact) => fact.key === "mfgDate")?.value).toBe("February 2025");
    expect(safedon.find((fact) => fact.key === "poNo")?.label).toBe("PO Number");
  });

  it("leaves out a detail the template switches off", () => {
    const doc = makeStdEgExport();
    const header = doc.modules.find((module) => module.key === "header");
    if (header?.config) header.config = { ...header.config, fields: { ...(header.config.fields as object), factoryAddress: false } };
    expect(buildReportModel(doc).summary.facts.map((fact) => fact.key)).not.toContain("factoryAddress");
  });

  it("splits the order by size, the shares adding up to 100%, with the totals", () => {
    const mix = buildReportModel(makeSafedonExport()).summary.orderMix;
    expect(mix?.rows.map((row) => [row.label, row.cases, row.share])).toEqual([
      ["XS", 60, 3.9],
      ["S", 850, 55.6],
      ["M", 560, 36.6],
      ["L", 60, 3.9],
    ]);
    expect(Math.round((mix?.rows.reduce((sum, row) => sum + row.share, 0) ?? 0) * 10)).toBe(1000);
    expect(mix).toMatchObject({ totalCases: 1530, totalGloves: 3060000, glovesPerCase: 2000, unitWord: "gloves" });
    expect(orderTotals(mix!)).toEqual(["1,530 cartons", "3,060,000 gloves", "2,000 gloves per carton"]);
    // One size is the whole order.
    expect(buildReportModel(makeStdEgExport()).summary.orderMix?.rows).toEqual([{ size: "M", label: "M", cases: 2900, share: 100 }]);
  });

  it("works the gloves out from the cases while the order has no total, and has no mix with nothing ordered", () => {
    const doc = makeSafedonExport();
    const order = doc.modules.find((module) => module.key === "order_lots");
    if (order) order.computed = { ...order.computed, totalGloves: null };
    expect(buildReportModel(doc).summary.orderMix?.totalGloves).toBe(1530 * 2000);
    if (order) order.data = { sizes: {} };
    expect(buildReportModel(doc).summary.orderMix).toBeNull();
  });

  it("carries the inspector's formatted summary to be drawn as the app draws it, else none", () => {
    expect(buildReportModel(makeStdEgExport()).summary.inspectionSummary).toEqual({ kind: "empty" });
    const written = withConclusion(makeStdEgExport(), {}, { inspectionSummary: richTextExample() });
    expect(buildReportModel(written).summary.inspectionSummary).toEqual({ kind: "rich", doc: richTextExample() });
  });

  it("puts a summary too long for page 1 on a page of its own after it", () => {
    const short = withConclusion(makeStdEgExport(), {}, { inspectionSummary: richTextParagraph("All sizes passed.") });
    expect(buildReportModel(short).summary.summaryPlacement).toBe("first");
    expect(buildReportModel(short).plan[0]).toEqual({ kind: "summary", key: "summary", pageCount: 1 });
    const long = withConclusion(makeStdEgExport(), {}, { inspectionSummary: richTextParagraph("Every glove was checked twice. ".repeat(140).trim()) });
    const model = buildReportModel(long);
    expect(model.summary.summaryPlacement).toBe("own");
    expect(model.plan[0]).toEqual({ kind: "summary", key: "summary", pageCount: 2 });
    expect(model.pageCount).toBe(buildReportModel(short).pageCount + 1);
  });

  it("lists Results by Check, one row per check with its criterion, result and status", () => {
    const checks = buildReportModel(makeStdEgExport()).summary.checks;
    expect(checks?.map((row) => [row.check, row.criterion, row.result, row.status])).toEqual([
      ["Dimension", "Length ≥ 240 mm; Width 95 ± 10 mm", "Median Length 245 mm", "pass"],
      ["Force at Break", "Median ≥ 6 N", "Median 6.537 N", "pass"],
      ["Weight", "Within 10% of the indicative 3.5 g", "Average 2.90 g", "warn"],
      ["Watertight Test", "Watertight test, AQL 1.5", "1 pinhole in 500 gloves", "pass"],
      ["Visual Inspection: Critical", "AQL 0.0, accept 0", "0 in 500 gloves", "pass"],
      ["Visual Inspection: Major", "AQL 2.5", "8 in 500 gloves", "pass"],
      ["Visual Inspection: Minor", "AQL 4.0", "0 in 500 gloves", "pass"],
      ["Packing Check", "Layering ≥ 70%, dispensing ≥ 80%", "Layering 88.3%, dispensing 90.3%", "pass"],
      ["Labeling", "Dispenser Box and Carton Box", "0 defects in 4 boxes", "pass"],
    ]);
  });
});

describe("the options", () => {
  it("title the report, hide the client and add the footer note", () => {
    const model = buildReportModel(withReportOptions(makeSafedonExport(), { title: "Lot Release Report", showClient: false, footerNote: "For the buyer only." }));
    expect(model.chrome).toMatchObject({ title: "Lot Release Report", client: null, footerNote: "For the buyer only." });
    expect(model.summary.facts.map((fact) => fact.key)).not.toContain("client");
    expect(preparedFor(model.chrome)).toBe("Brand B Nitrile PF Examination Gloves");
  });

  it("leave out the Summary's blocks switched off", () => {
    const { summary } = buildReportModel(
      withReportOptions(makeStdEgExport(), { summary: { orderMix: false, inspectionSummary: false, resultsByCheck: false } }),
    );
    expect(summary.orderMix).toBeNull();
    expect(summary.inspectionSummary).toBeNull();
    expect(summary.checks).toBeNull();
    // The verdict still reads the checks.
    expect(summary.conclusion.verdict).toBe("8 of 9 checks passed for size M; Weight has a warning.");
  });

  it("leave out a section switched off, or with every block off, and number the rest without a gap", () => {
    const all = sectionsOf(makeStdEgExport());
    expect(all.map((entry) => [entry.key, entry.kicker])).toEqual([
      ["orderSampling", "Section 02"],
      ["dimensions", "Section 03"],
      ["measurements", "Section 04"],
      ["forceAtBreak", "Section 05"],
      ["holesVisual", "Section 06"],
      ["packing", "Section 07"],
      ["labellingConclusion", "Section 08"],
    ]);
    const doc = makeStdEgExport();
    const off = withReportOptions(doc, {
      sections: {
        ...doc.report.sections,
        dimensions: { include: false, blocks: doc.report.sections.dimensions.blocks },
        packing: { include: true, blocks: { averageLayeringDispensing: false, perBoxResults: false, agedGloves: false, stickinessGrades: false } },
      },
    });
    expect(sectionsOf(off).map((entry) => [entry.key, entry.kicker])).toEqual([
      ["orderSampling", "Section 02"],
      ["measurements", "Section 03"],
      ["forceAtBreak", "Section 04"],
      ["holesVisual", "Section 05"],
      ["labellingConclusion", "Section 06"],
    ]);
  });

  it("keep each section's blocks switched on, in print order, for its page", () => {
    const doc = makeStdEgExport();
    const off = withReportOptions(doc, {
      sections: { ...doc.report.sections, dimensions: { include: true, blocks: { ...doc.report.sections.dimensions.blocks, palmWidth: false } } },
    });
    expect(sectionsOf(off).find((entry) => entry.key === "dimensions")?.blocks.map((block) => block.label)).toEqual([
      "Glove Length Chart",
      "Median Results by Size",
      "Weight per Glove",
    ]);
  });

  it("show a section only when the inspection includes one of its modules, titled by the test it shows", () => {
    const safedon = sectionsOf(makeSafedonExport());
    expect(safedon.find((entry) => entry.key === "forceAtBreak")).toMatchObject({ title: "Physical Properties", moduleKeys: ["tensile"] });
    expect(safedon.find((entry) => entry.key === "packing")).toMatchObject({ title: "Glove Dispensing", moduleKeys: ["dispensing_safedon"] });
    const doc = makeStdEgExport();
    doc.modules = doc.modules.filter((module) => module.key !== "force_at_break");
    expect(sectionsOf(doc).map((entry) => entry.key)).not.toContain("forceAtBreak");
  });

  it("plan every page, each section 'coming next' until its builder lands, and count them", () => {
    const model = buildReportModel(makeStdEgExport());
    expect(model.plan.filter((entry) => entry.kind !== "summary").every((entry) => "built" in entry && !entry.built)).toBe(true);
    expect(model.pageCount).toBe(model.plan.reduce((sum, entry) => sum + entry.pageCount, 0));
    expect(model.sizes.map((size) => size.value)).toEqual(["XS", "S", "M", "L", "XL"]);
  });
});

describe("the photo records", () => {
  /** The photo records the plan prints, as one entry after the sections. */
  const recordsOf = (doc: InspectionExport) => {
    const entry = buildReportModel(doc).plan.find((candidate) => candidate.kind === "photos");
    return entry?.kind === "photos" ? entry : null;
  };

  it("print the photos marked In Report by their modules' group, a page each, a flagged original left out", () => {
    const entry = recordsOf(makeStdEgExport());
    expect(entry).toMatchObject({ key: "photos", pageCount: 2, built: false });
    expect(entry?.records.map((record) => [record.kicker, record.title, record.photos.map((photo) => photo.moduleKey)])).toEqual([
      ["Photo Record 1 of 2", "Packing, Visual & Ageing", ["visual"]],
      ["Photo Record 2 of 2", "Watertight & Laboratory Testing", ["watertight"]],
    ]);
  });

  it("take every photo the browser can show until an admin marks some, at most Photos per Group, and leave a group switched off out", () => {
    const doc = makeStdEgExport();
    doc.photos = doc.photos.map((photo) => ({ ...photo, includeInReport: false }));
    const records = recordsOf(doc)?.records ?? [];
    // The weight and packing photos join the visual one; the HEIC original stays out.
    expect(records.find((record) => record.key === "packingVisualAgeing")?.photos.map((photo) => photo.moduleKey)).toEqual(["weight", "visual"]);
    expect(records.find((record) => record.key === "samplingPackaging")?.photos.map((photo) => photo.moduleKey)).toEqual(["labeling"]);
    const few = recordsOf(withReportOptions(doc, { photos: { perGroup: 4, groups: { samplingPackaging: false, packingVisualAgeing: true, watertightLaboratory: true } } }));
    expect(few?.records.map((record) => record.key)).toEqual(["packingVisualAgeing", "watertightLaboratory"]);
    expect(few?.pageCount).toBe(2);
  });

  it("print none without photos", () => {
    expect(recordsOf(makeSafedonExport())).toBeNull();
  });
});
