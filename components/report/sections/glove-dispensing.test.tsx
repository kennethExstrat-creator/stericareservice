// Section 07's pages for a Safedon template, Glove Dispensing, as
// server-rendered markup in the report document as the print route renders
// it: the heading and lead, the defect rate chart against the maximum, the
// per-box table, the defects by type beside their definitions; red for what
// fails, amber for a warned box/carton number, grey for what is not done;
// the page a long per-box table runs on to.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeSafedonExport, withReportOptions } from "@/lib/report/__fixtures__/exports";
import { dispensingBoxes, dispensingExport } from "@/lib/report/__fixtures__/glove-dispensing-export";
import { buildReportModel } from "@/lib/report/model";
import type { InspectionExport } from "@/lib/schemas/export";
import { ReportDocument } from "../report-document";

/** The text of some markup, tags dropped and spaces collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The section's pages in the whole report, and the report's page count. */
function dispensingPages(doc: InspectionExport): { pages: string[]; total: number } {
  const model = buildReportModel(doc);
  const html = renderToStaticMarkup(<ReportDocument model={model} />);
  const pages = html.split("<section data-report-page").slice(1);
  return { pages: pages.filter((page) => page.includes('data-slot="report-dispensing"')), total: model.pageCount };
}

/** A slot's markup on a page: from its element's opening tag to the next slot of the section, or the page's footer. */
function slot(page: string, name: string): string {
  const at = page.indexOf(`data-slot="${name}"`);
  if (at === -1) return "";
  const next = page.slice(at + 1).search(/data-slot="report-(dispensing-(chart|boxes|closing|defects|definitions)|page-footer)"/);
  const end = next === -1 ? page.length : page.lastIndexOf("<", at + 1 + next);
  return page.slice(page.lastIndexOf("<", at), end);
}

/** Each match's first group. */
const all = (html: string, pattern: RegExp) => Array.from(html.matchAll(pattern), (match) => match[1]);

describe("the SAFEDON_EG example: Section 07, Glove Dispensing, on one page", () => {
  const { pages } = dispensingPages(makeSafedonExport());
  const page = pages[0];

  it("heads the page with the section's number, the title and the lead from the data", () => {
    expect(pages).toHaveLength(1);
    expect(text(page)).toContain(
      "Section 07 Glove Dispensing Gloves dispensed from 26 plastic packs of 125 and checked for 6 dispensing defects (sampling code letters C and D). A size passes at a defect rate of 5% or less; every size passed.",
    );
  });

  it("charts each size's defect rate against the maximum's dashed red line, with the figures and the size's result", () => {
    const chart = slot(page, "report-dispensing-chart");
    expect(text(chart)).toContain("Defect Rate (%) against Maximum Defect Rate Maximum");
    expect(text(chart)).toContain("XS 5 boxes Defect Rate 0.48% Total 3 / 625 Passed S 8 boxes Defect Rate 0% Total 0 / 1,000 Passed");
    // Bars from 0 on a 0 to 6% axis; the maximum, 5%, a dashed red line in every row and its tick in red.
    expect(chart).toMatch(/data-slot="report-bar" data-value="0\.48" class="[^"]*bg-brand-600" style="width:8\.000%"/);
    expect(chart).toMatch(/data-slot="report-bar" data-value="1\.1" class="[^"]*" style="width:18\.333%"/);
    expect(all(chart, /data-slot="report-limit-line"[^>]*style="left:([\d.]+)%"/g)).toEqual(["83.333", "83.333", "83.333", "83.333"]);
    expect(Array.from(chart.matchAll(/data-tick="([\d.]+)" class="([^"]*)"[^>]*>([^<]*)</g), ([, tick, classes, label]) => [tick, label, classes.includes("text-fail")])).toEqual([
      ["0", "0%", false],
      ["1", "1%", false],
      ["2", "2%", false],
      ["3", "3%", false],
      ["4", "4%", false],
      ["5", "5", true],
      ["6", "6%", false],
    ]);
    expect(all(chart, /data-slot="report-status-chip" data-status="(\w+)"/g)).toEqual(["pass", "pass", "pass", "pass"]);
  });

  it("lists each box by its No. under its size, the defects found in bold and none in grey, and each size's total", () => {
    const boxes = slot(page, "report-dispensing-boxes");
    expect(text(boxes)).toMatch(/^Per-Box Results Defects found in each box of 125 gloves\. /);
    expect(text(boxes)).toContain("XS S M L No. Box/Carton # Defects Box/Carton # Defects Box/Carton # Defects Box/Carton # Defects");
    expect(text(boxes)).toContain("1 1 1 51 0 92 0 6 0 2 12 0 136 0 122 0 16 0");
    expect(text(boxes)).toContain("8 814 0 550 3 Total 3 0 11 0");
    expect(boxes.match(/<tr data-row="\d+"/g)).toHaveLength(8);
    expect(boxes).toMatch(/<span data-tone="found" class="whitespace-nowrap font-bold text-slate-900">2<\/span>/);
    expect(boxes).toMatch(/<span data-tone="zero" class="whitespace-nowrap text-slate-600">0<\/span>/);
    expect(boxes).toMatch(/<tr data-row="totals"[^>]*><th[^>]*><span class="font-bold text-brand-700">Total<\/span>/);
    // Four sizes across the page, each divided from the last by a hairline.
    expect(boxes).toMatch(/style="width:184mm"/);
    expect(boxes.match(/<th scope="col" class="[^"]*border-l-\[0\.25mm\] border-l-slate-200[^"]*">Box\/Carton #<\/th>/g)).toHaveLength(4);
  });

  it("tables the defects by type in the template's words beside their definitions, each size's result a tick", () => {
    const closing = slot(page, "report-dispensing-closing");
    expect(closing).toContain('class="grid grid-cols-2 items-start gap-x-[6mm]"');
    const defects = slot(page, "report-dispensing-defects");
    expect(text(defects)).toBe(
      "Safedon Packing Defects Safedon Packing Defects Defect XS S M L Boxes Tested 5 8 8 5 No Cuff 2 0 0 0 Finger Out 0 0 0 0 Multiple Gloves Out 0 0 0 0 Glove Stuck 0 0 0 0 Sticky Glove 1 0 11 0 Faulty Cuff 0 0 0 0 Total 3 0 11 0 Gloves Inspected 625 1,000 1,000 625 Defect Rate (%) 0.48% 0% 1.1% 0% Conclusion",
    );
    expect(all(defects, /data-slot="report-status-tick" data-status="(\w+)" role="img" aria-label="Conclusion, \w+: Passed"/g)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(defects).toMatch(/<tr data-row="total" class="bg-brand-50 font-semibold border-t-\[0\.3mm\] border-slate-300">/);
    const definitions = slot(page, "report-dispensing-definitions");
    expect(text(definitions)).toBe(
      "Defect Definitions No Cuff Cuff should ideally be at least 2 cm out. Finger Out Only the cuff, not a finger, should come out first. Multiple Gloves Out Only one glove should come out at a time. Glove Stuck Glove could not be dispensed or was very difficult to dispense. Sticky Glove Two or more gloves out at once because they stick together. Faulty Cuff Deformed or misshapen cuff causing a dispensing problem.",
    );
  });
});

describe("what fails in red, a warned box/carton number in amber, what is not done in grey", () => {
  const { pages } = dispensingPages(
    dispensingExport({
      XS: { boxes: [{ boxNo: 8001, counts: { no_cuff: 1 } }, { boxNo: null, counts: { sticky: 2 } }, { boxNo: 8015 }], planned: 3 },
      S: { boxes: dispensingBoxes(5, 8101), sampled: [8101, 8108, 8115, 8122] },
      M: { boxes: dispensingBoxes(5, 8201, { sticky: 6, multiple_out: 2 }) },
      L: { boxes: dispensingBoxes(3, 8301, { finger_out: 1 }), planned: 5 },
    }),
  );
  const page = pages[0];

  it("draws the failed size's bar and figures in red with a Failed chip, a rate so far in grey with Not Done", () => {
    const chart = slot(page, "report-dispensing-chart");
    expect(all(chart, /data-slot="report-bar" data-value="[\d.]+" class="[^"]* (bg-[\w-]+)"/g)).toEqual(["bg-slate-300", "bg-brand-600", "bg-fail-solid", "bg-slate-300"]);
    expect(chart).toContain('<p data-tone="fail" class="tabular-nums text-fail">Defect Rate<span class="font-bold"> 6.4%</span></p>');
    expect(chart).toContain('<p data-tone="fail" class="tabular-nums text-fail">Total<span class="font-bold"> 40 / 625</span></p>');
    expect(all(chart, /data-slot="report-status-chip" data-status="(\w+)"/g)).toEqual(["not_done", "pass", "fail", "not_done"]);
    expect(text(chart)).toContain("Defect Rate Not done Maximum");
    expect(text(chart)).toContain("XS 2 of 3 boxes");
  });

  it("prints the box counted without a number as a dash, the number S did not sample in amber with the note saying so, the failing total in red", () => {
    const boxes = slot(page, "report-dispensing-boxes");
    expect(boxes).toMatch(/<span data-tone="missing" class="whitespace-nowrap text-slate-400">—<\/span>/);
    expect(boxes).toMatch(/<span data-tone="warn" class="whitespace-nowrap font-semibold text-warn">8129<\/span>/);
    expect(boxes).toMatch(/<span class="font-semibold text-warn">Amber: not one of the size&#x27;s sampled box\/carton numbers\.<\/span>/);
    expect(boxes).toMatch(/<span data-tone="fail" class="whitespace-nowrap font-bold text-fail">40<\/span>/);
  });

  it("tables the boxes tested of those planned and a rate so far in grey, the failing rate in red, and each size's result", () => {
    const defects = slot(page, "report-dispensing-defects");
    expect(text(defects)).toContain("Boxes Tested 2 of 3 5 5 3 of 5");
    expect(defects).toMatch(/<span data-tone="fail" class="whitespace-nowrap font-bold text-fail">6\.4%<\/span>/);
    expect(defects).toMatch(/<span data-tone="muted" class="whitespace-nowrap text-slate-600">0\.4%<\/span>/);
    expect(all(defects, /data-slot="report-status-tick" data-status="(\w+)"/g)).toEqual(["not_done", "pass", "fail", "not_done"]);
  });
});

describe("a long per-box table", () => {
  const doc = dispensingExport({
    S: { boxes: dispensingBoxes(40, 9001, { sticky: 1 }) },
    M: { boxes: dispensingBoxes(40, 9401) },
    L: { boxes: dispensingBoxes(32, 9801) },
    XL: { boxes: dispensingBoxes(20, 9901) },
  });
  const { pages, total } = dispensingPages(doc);

  it("runs on to a page headed Section 07 · Continued, its header repeated and the total row on the last", () => {
    expect(pages).toHaveLength(2);
    expect(text(pages[0])).toContain("Section 07 Glove Dispensing Gloves dispensed from 132 plastic packs");
    expect(text(pages[1])).toMatch(/^.*Section 07 · Continued Glove Dispensing Per-Box Results Continued: No\. 27 to 40 /);
    expect(pages[1]).not.toContain("Gloves dispensed from");
    const tables = pages.map((page) => slot(page, "report-dispensing-boxes"));
    tables.forEach((table) => expect(text(table)).toContain("S M L XL No. Box/Carton # Defects"));
    expect(tables.map((table) => table.includes('data-row="totals"'))).toEqual([false, true]);
    const rows = tables.flatMap((table) => all(table, /<tr data-row="(\d+)"/g).map(Number));
    expect(rows).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(pages[1]).toContain('data-slot="report-dispensing-closing"');
  });

  it("numbers its pages among the report's", () => {
    const numbers = pages.map((page) => Number(/aria-label="Page (\d+) of \d+"/.exec(page)?.[1]));
    expect(numbers[1]).toBe(numbers[0] + 1);
    expect(pages[0]).toContain(`of ${total}"`);
  });
});

describe("one size, and nothing entered yet", () => {
  it("keeps one size's tables to their own width", () => {
    const page = dispensingPages(dispensingExport({ M: { boxes: dispensingBoxes(13, 8001) } })).pages[0];
    expect(slot(page, "report-dispensing-boxes")).toMatch(/style="width:54mm"/);
    expect(slot(page, "report-dispensing-defects")).toMatch(/<div class="max-w-full" style="width:55mm"><table/);
  });

  it("says no box is entered yet, and prints the figures as dashes and every result Not Done", () => {
    const page = dispensingPages(dispensingExport({ S: { boxes: [], planned: 8 }, M: { boxes: [], planned: 8 } })).pages[0];
    expect(text(slot(page, "report-dispensing-boxes"))).toBe("Per-Box Results Defects found in each box of 125 gloves. No boxes are entered yet.");
    const chart = slot(page, "report-dispensing-chart");
    expect(text(chart)).toContain("S 0 of 8 boxes Defect Rate — Total — Not Done M 0 of 8 boxes Defect Rate — Total — Not Done");
    expect(chart).not.toContain('data-slot="report-bar"');
    expect(text(slot(page, "report-dispensing-defects"))).toContain("Boxes Tested 0 of 8 0 of 8 No Cuff — —");
  });
});

describe("follows the report's options", () => {
  const doc = makeSafedonExport();
  const switched = (blocks: Record<string, boolean>) => withReportOptions(doc, { sections: { ...doc.report.sections, packing: { include: true, blocks } } });

  it("leaves out the chart or the per-box table switched off, and prints the defects with their definitions whatever the packing check's switches say", () => {
    const noChart = dispensingPages(switched({ averageLayeringDispensing: false, perBoxResults: true, agedGloves: true, stickinessGrades: true })).pages[0];
    expect(noChart).not.toContain('data-slot="report-dispensing-chart"');
    expect(noChart).toContain('data-slot="report-dispensing-boxes"');
    const alone = dispensingPages(switched({ averageLayeringDispensing: false, perBoxResults: false, agedGloves: true, stickinessGrades: false })).pages[0];
    expect(alone).not.toContain('data-slot="report-dispensing-boxes"');
    expect(alone).toContain('data-slot="report-dispensing-defects"');
    expect(alone).toContain('data-slot="report-dispensing-definitions"');
    expect(alone).not.toContain("coming next");
  });
});
