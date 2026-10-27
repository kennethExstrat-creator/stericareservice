// Section 08's pages as server-rendered markup, in the report's own frame:
// the lead, the labelling cards, the results matrix and the conclusion card
// (TG35 page 8), failing values red and a HOLD amber, a blank line to sign
// by hand, the parts the options switch off, a second page.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "@/lib/report/__fixtures__/exports";
import { buildReportModel } from "@/lib/report/model";
import type { InspectionExport } from "@/lib/schemas/export";
import { ReportDocument } from "../report-document";
import { TickMatrix } from "../tick-matrix";

const pagesOf = (html: string) => html.split("<section data-report-page").slice(1);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Section 08's pages of the report. */
function sectionPages(doc: InspectionExport): string[] {
  return pagesOf(renderToStaticMarkup(<ReportDocument model={buildReportModel(doc)} />)).filter((page) => page.includes('data-slot="report-labelling-conclusion"'));
}

function withBlocks(doc: InspectionExport, blocks: Record<string, boolean>) {
  const current = doc.report.sections.labellingConclusion;
  return withReportOptions(doc, { sections: { ...doc.report.sections, labellingConclusion: { include: true, blocks: { ...current.blocks, ...blocks } } } });
}

function moduleIn(doc: InspectionExport, key: string) {
  const found = doc.modules.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No ${key} module.`);
  return found;
}

/** Sets a value down a path of a module's JSON (its data or computed values). */
function put(target: unknown, path: readonly string[], value: unknown): void {
  let current = target as Record<string, unknown>;
  for (const key of path.slice(0, -1)) current = current[key] as Record<string, unknown>;
  current[path[path.length - 1]] = value;
}

describe("Section 08: Packaging Labelling & Conclusion", () => {
  const doc = makeStdEgExport();
  const model = buildReportModel(doc);
  const pages = pagesOf(renderToStaticMarkup(<ReportDocument model={model} />));
  const page = pages.find((candidate) => candidate.includes('data-slot="report-labelling-conclusion"')) ?? "";

  it("prints on its own page in the plan's place, numbered across the report", () => {
    expect(pages).toHaveLength(model.pageCount);
    expect(pages.indexOf(page)).toBe(7);
    expect(page).toContain(`Page 8 of ${model.pageCount}</p>`);
  });

  it("heads the page with its kicker, its title and what the labels were checked for", () => {
    expect(text(page)).toContain(
      "Section 08 Packaging Labelling & Conclusion Dispenser and carton boxes checked for lot number, manufacturing date, artwork and box/carton number. Any single error rejects the size.",
    );
  });

  it("draws a card per level: its limit, Boxes Inspected first, the checks, Defects Found tinted and the result's chip", () => {
    expect(text(page)).toContain(
      "Dispenser Box Accept 0 · Reject 1 Dispenser Box: label checks by size Check M Boxes Inspected 3 Wrong / No Lot Number 0 Wrong / No Mfg. Date 0 Wrong Artwork Print 0 Defects Found 0 Result Passed, Size M",
    );
    expect(text(page)).toContain(
      "Carton Box Accept 0 · Reject 1 Carton Box: label checks by size Check M Boxes Inspected 1 Wrong / No Lot Number 0 Wrong / No Mfg. Date 0 Wrong Artwork Print 0 No Box/Carton # Printed 0 Defects Found 0 Result Passed, Size M",
    );
    expect(page.match(/<tr data-row="defects" class="[^"]*bg-brand-50/g)).toHaveLength(2);
    // The Dispenser Box's blank row lines its total up with the Carton Box's.
    expect(page).toContain('data-row="blank-0"');
    expect(page.match(/data-slot="report-status-chip" data-status="pass"/g)).toHaveLength(2);
  });

  it("draws the results matrix: a tick per check and size, the size columns as the design sets them, and its legend", () => {
    expect(text(page)).toContain(
      "Results Matrix Passed Warning Results matrix: each check by size Check M Dimension Force at Break Weight Freedom From Holes – Watertight Test Visual Inspection: Critical, Major, Minor Packing Check Labeling",
    );
    expect(page).toMatch(/aria-label="Weight, M: Warning"/);
    expect(page).toMatch(/aria-label="Visual Inspection: Critical, Major, Minor, M: Passed"/);
    expect(page).toContain('style="width:10.5%"');
  });

  it("concludes PASSED in green, dated as the design does, the signature drawn over its line, the remark none", () => {
    expect(page).toMatch(/data-slot="report-final-conclusion" data-status="pass" class="[^"]*border-pass-border bg-pass-tint/);
    expect(text(page)).toContain("Conclusion PASSED Date 12/04/2025 Inspector's Signature Remark: None recorded.");
    expect(page).toContain('data-signed="drawn"');
    expect(page).toContain('<path d="M40 150Q120 60 160 100Q200 140 250 105L300 70" vector-effect="non-scaling-stroke"></path>');
    // The result's line height stays as set: a font size after leading-none would merge it away.
    expect(page).toMatch(/data-slot="report-final-result" class="text-\[30pt\][^"]*leading-none/);
  });
});

describe("Section 08's results and options", () => {
  it("prints a failing count, the size that failed and its cell in red", () => {
    const doc = makeSafedonExport();
    const labeling = moduleIn(doc, "labeling");
    put(labeling.data, ["sizes", "M", "carton", "defects", "lot_no"], 1);
    put(labeling.computed, ["sizes", "M", "carton"], { accept: 0, reject: 1, total: 1, result: "fail" });
    put(labeling.data, ["sizes", "L", "inner", "inspected"], 2);
    labeling.result = { ...labeling.result, status: "fail", perSize: { ...labeling.result.perSize, M: { status: "fail", summary: "Carton Boxes: 1 defect in 1." } } };
    const [page] = sectionPages(doc);
    expect(page.match(/<span data-tone="fail" class="font-bold text-fail">1<\/span>/g)).toHaveLength(2);
    expect(page).toContain('<span data-tone="warn" class="font-bold text-warn">2</span>');
    expect(page).toMatch(/data-slot="report-status-chip" data-status="fail"[^>]*>.*?Failed, Size M/);
    expect(page).toMatch(/aria-label="Labeling, M: Failed"/);
  });

  it("concludes HOLD in amber and FAILED in red, as page 1 does", () => {
    const held = makeStdEgExport();
    held.conclusion = { ...held.conclusion, finalResult: "hold" };
    expect(sectionPages(held)[0]).toMatch(/data-slot="report-final-conclusion" data-status="hold" class="[^"]*border-hold-border bg-hold-tint/);
    expect(text(sectionPages(held)[0])).toContain("Conclusion HOLD");
    const failed = makeStdEgExport();
    failed.conclusion = { ...failed.conclusion, finalResult: "fail" };
    expect(sectionPages(failed)[0]).toMatch(/data-slot="report-final-conclusion" data-status="fail" class="[^"]*bg-fail-tint/);
  });

  it("leaves the signature line blank to sign by hand after export, and prints the remark", () => {
    const doc = makeStdEgExport();
    doc.conclusion = { ...doc.conclusion, signAfterExport: true, remark: "Labels to be reprinted." };
    const [page] = sectionPages(doc);
    expect(page).toContain('data-signed="by-hand"');
    expect(page).not.toContain("The inspector&#x27;s signature, as drawn");
    expect(text(page)).toContain("Inspector's Signature Remark: Labels to be reprinted.");
  });

  it("leaves out the parts the options switch off; the conclusion card always prints", () => {
    const [cardOnly] = sectionPages(withBlocks(makeStdEgExport(), { dispenserCartonBox: false, resultsMatrix: false, inspectorSignature: false }));
    for (const part of ["report-label-levels", "report-results-matrix", "report-signature"]) expect(cardOnly).not.toContain(part);
    expect(text(cardOnly)).toContain("Section 08 Packaging Labelling & Conclusion Conclusion PASSED Date 12/04/2025 Remark: None recorded.");
    const [bare] = sectionPages(withBlocks(makeStdEgExport(), { inspectorSignature: false, remark: false }));
    expect(bare).toContain("report-results-matrix");
    expect(bare).not.toContain("report-final-remark");
    expect(text(bare)).toMatch(/Conclusion PASSED Date 12\/04\/2025 Brand A/);
  });

  it("reads as the conclusion where the template inspects no labels", () => {
    const doc = makeStdEgExport();
    doc.modules = doc.modules.filter((module) => module.key !== "labeling");
    const [page] = sectionPages(doc);
    expect(text(page)).toMatch(/^.*Section 08 Conclusion Results Matrix/);
    expect(page).not.toContain("report-label-levels");
  });

  it("continues on a second page under its heading again where one cannot hold it", () => {
    const doc = makeSafedonExport();
    doc.conclusion = { ...doc.conclusion, remark: "Long remark. ".repeat(30).trim() };
    const pages = sectionPages(doc);
    expect(pages).toHaveLength(2);
    expect(pages[0]).not.toContain("report-final-conclusion");
    expect(text(pages[1])).toContain("Section 08 Packaging Labelling & Conclusion (Continued) Conclusion PASSED");
  });
});

describe("TickMatrix's size columns", () => {
  it("take the width asked for, else 16% each", () => {
    const rows = [{ key: "fab", label: "Force at Break", cells: ["pass" as const] }];
    expect(renderToStaticMarkup(<TickMatrix columns={["M"]} rows={rows} columnWidth="10.5%" />)).toMatch(/<th scope="col" style="width:10.5%" class="border-b/);
    expect(renderToStaticMarkup(<TickMatrix columns={["M"]} rows={rows} />)).toMatch(/<th scope="col" class="w-\[16%\] border-b/);
  });
});
