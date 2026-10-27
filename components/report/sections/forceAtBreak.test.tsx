// Section 05's pages, Force at Break (components/report/sections/
// forceAtBreak.tsx), as server-rendered markup in the report: the four sizes
// the design lays out (made-up readings), a failing size and readings still
// to enter, readings split across pages, Physical Properties (SAFEDON_EG),
// and the two primitive props the section added (a failing figure in red).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeSafedonExport } from "@/lib/report/__fixtures__/exports";
import { FOUR_SIZES, forceExport, type ForceSetup } from "@/lib/report/__fixtures__/force-at-break";
import { buildReportModel } from "@/lib/report/model";
import type { InspectionExport } from "@/lib/schemas/export";
import { HBars } from "../bars";
import { AsideLines } from "../chart-parts";
import { ReportDocument } from "../report-document";

/** The page bodies' markup, page by page. */
const pagesOf = (html: string) => html.split("<section data-report-page").slice(1);
/** The text of some markup, tags dropped and spaces collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
/** The markup of the first element carrying this data-slot, to its end (by depth of its tag). */
function slot(html: string, name: string): string {
  const start = html.indexOf(`data-slot="${name}"`);
  if (start === -1) return "";
  const open = html.lastIndexOf("<", start);
  const tag = /^<([a-z]+)/.exec(html.slice(open))?.[1] ?? "div";
  let depth = 0;
  const pattern = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  pattern.lastIndex = open;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(open, match.index + match[0].length);
  }
  return html.slice(open);
}

/** The report's pages of Section 05. */
function sectionPages(doc: InspectionExport): { pages: string[]; numbers: number[]; total: number } {
  const model = buildReportModel(doc);
  const all = pagesOf(renderToStaticMarkup(<ReportDocument model={model} />));
  const numbers = all.flatMap((page, index) => (page.includes('data-slot="report-force-at-break"') ? [index + 1] : []));
  return { pages: numbers.map((number) => all[number - 1]), numbers, total: model.pageCount };
}

describe("four sizes, as the design lays them out", () => {
  const { pages, numbers } = sectionPages(forceExport(FOUR_SIZES));
  const page = pages[0];

  it("prints one page, after the sections before it, headed by the section's kicker, title and lead", () => {
    const plan = buildReportModel(forceExport(FOUR_SIZES)).plan;
    const before = plan.slice(0, plan.findIndex((entry) => entry.key === "forceAtBreak")).reduce((sum, entry) => sum + entry.pageCount, 0);
    expect(numbers).toEqual([before + 1]);
    expect(text(slot(page, "report-section-heading"))).toBe("Section 05 Force at Break Lab test to EN 455-2. The median of 13 specimens per size must reach 6 N.");
  });

  it("shows what the inspection records of the lab's test on the soft blue card", () => {
    expect(text(slot(page, "report-lab-details"))).toBe("Standard EN 455-2");
    expect(page).toMatch(/data-slot="report-card" data-tone="soft"/);
  });

  it("plots every specimen as a dot per size, the median marked, the minimum dashed red with the zone below it tinted", () => {
    const chart = slot(page, "report-force-chart");
    expect(text(chart)).toContain("Maximum Load per Specimen (N) One specimen Median Below 6 N");
    expect(chart.match(/data-dot="/g)).toHaveLength(52);
    expect(Array.from(chart.matchAll(/data-slot="report-median" data-median="([\d.]+)"/g), (match) => match[1])).toEqual(["6.3", "6.5", "6.6", "6.6"]);
    expect(chart.match(/data-slot="report-reject-zone"[^>]*style="left:0;width:40\.000%"/g)).toHaveLength(4);
    expect(chart.match(/data-slot="report-limit-line"/g)).toHaveLength(4);
    expect(chart).toMatch(/data-tick="6" class="[^"]*font-bold text-fail[^"]*"[^>]*>6\.0<\/span>/);
    expect(Array.from(chart.matchAll(/data-tick="[\d.]+"[^>]*>([\d.]+)<\/span>/g), (match) => match[1])).toEqual(["5.0", "5.5", "6.0", "6.5", "7.0", "7.5"]);
    // Readings that repeat stack: four of size XL read 6.6 N.
    expect(chart.match(/data-dot="6.6" data-level="3"/g)).toHaveLength(1);
    expect(text(chart)).toContain("S Median 6.3 N Range 5.5 to 6.9 M Median 6.5 N Range 6.0 to 7.3");
    expect(chart).toMatch(/<li class="[^"]*font-semibold text-fail[^"]*">.*?Below 6 N<\/li>/);
  });

  it("notes, under the chart, the size that passes although a specimen read below the minimum", () => {
    expect(text(slot(page, "report-force-notes"))).toBe(
      "* One size S specimen read 5.5 N. EN 455-2 judges the median, which is 6.3 N for size S, so the size passes.",
    );
  });

  it("lists the readings by test number and size, the low one red with '*', the Median under them", () => {
    const readings = slot(page, "report-force-readings");
    expect(text(readings)).toContain("Specimen Readings (N) Specimen readings in newtons, by size No. S M L XL 1 6.5 6.4 6.3 6.5 2 6.3 6.8 6.2 6.2");
    expect(readings.match(/<tr data-row="\d+"/g)).toHaveLength(13);
    expect(readings).toContain('<span data-low="true" class="font-semibold text-fail">5.5*</span>');
    expect(readings).toMatch(/<tr data-row="totals" class="[^"]*bg-brand-50/);
    expect(text(readings)).toContain("13 6.2 7.3 6.1 6.6 Median 6.3 6.5 6.6 6.6");
  });

  it("sums each size up beside them: the lots, the readings' figures, the median and the verdict as a pill", () => {
    const summary = slot(page, "report-force-summary");
    for (const row of [
      "Lot Number LOT-S1 LOT-M1 LOT-L1 LOT-XL1",
      "Average (N) 6.4 6.5 6.5 6.5",
      "SD (N) 0.4 0.4 0.3 0.3",
      "Minimum (N) 5.5 6.0 6.0 6.0",
      "Maximum (N) 6.9 7.3 7.1 7.1",
      "Median (N) 6.3 6.5 6.6 6.6",
      "Result Passed Passed Passed Passed",
    ]) {
      expect(text(summary)).toContain(row);
    }
    expect(summary).toMatch(/<tr data-row="median" class="bg-brand-50 font-semibold/);
    const chips = Array.from(summary.matchAll(/data-slot="report-status-chip" data-status="([a-z_]+)" class="([^"]*)"/g));
    expect(chips.map(([, status]) => status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(chips.every(([, , classes]) => classes.includes("[&amp;&gt;svg]:hidden"))).toBe(true);
    expect(summary).toContain('<col style="width:26%"/>');
    expect(text(summary)).toContain("Readings from the lab report attached, for sizes S, M, L and XL.");
  });

  it("sets the readings beside the summary, as the design does", () => {
    expect(page).toMatch(/data-slot="report-force-tables" class="[^"]*grid-cols-\[76mm_minmax\(0,1fr\)\]/);
  });
});

describe("a failing size and readings still to enter", () => {
  const setup: ForceSetup = {
    readings: {
      S: [5.6, 5.9, 6.1, 5.5, 5.8, 6.2, 5.7, 6.0, 5.9, 5.8, 6.3, 5.6, 5.9],
      M: [6.4, 6.8, 6.2, null, 6.5],
      L: [],
    },
    lots: { L: [] },
    config: { decimals: 1 },
  };
  const page = sectionPages(forceExport(setup)).pages[0];

  it("prints the failing median red at the chart's right, and what is still to come", () => {
    const chart = slot(page, "report-force-chart");
    expect(chart).toContain('<p data-tone="fail" class="tabular-nums text-fail">Median<span class="font-bold"> 5.9 N</span></p>');
    expect(text(chart)).toContain("M 4 of 13 readings Range 6.2 to 6.8");
    expect(text(chart)).toContain("L No readings");
    expect(chart.match(/data-slot="report-median"/g)).toHaveLength(1);
    expect(text(slot(page, "report-force-notes"))).toBe(
      "* Nine size S specimens read below 6 N. The test judges the median, which is 5.9 N for size S, below 6 N, so the size fails.",
    );
  });

  it("dashes a reading or a figure not known yet, says Not stated for a lot not entered, and keeps the module's verdicts", () => {
    const readings = slot(page, "report-force-readings");
    expect(text(readings)).toContain("4 5.5* — —");
    expect(text(readings)).toContain("Median 5.9 — —");
    expect(readings).toContain('<span class="text-fail">5.9</span>');
    const summary = slot(page, "report-force-summary");
    expect(text(summary)).toContain("Lot Number LOT-S1 LOT-M1 Not stated");
    expect(text(summary)).toContain("Average (N) 5.9 6.5 —");
    expect(Array.from(summary.matchAll(/data-slot="report-status-chip" data-status="([a-z_]+)"/g), (match) => match[1])).toEqual(["fail", "not_done", "not_done"]);
    expect(text(summary)).toContain("Result Failed Not Done Not Done");
  });
});

describe("readings longer than a page", () => {
  const forty = Array.from({ length: 40 }, (_, index) => Number((6 + ((index * 7) % 13) / 10).toFixed(1)));
  const { pages, numbers } = sectionPages(forceExport({ readings: { S: forty, M: forty, L: forty }, physical: 40, config: { standardLabel: "EN 455-2" } }));

  it("continue on the next page, headed '(Continued)' without the lead, the Median under the last stretch", () => {
    expect(numbers).toEqual([5, 6]);
    expect(text(slot(pages[1], "report-section-heading"))).toBe("Section 05 Force at Break (Continued)");
    const first = slot(pages[0], "report-force-readings");
    const second = slot(pages[1], "report-force-readings");
    const to = Number(/data-to="(\d+)"/.exec(first)?.[1]);
    expect(first).toContain('data-from="1"');
    expect(second).toContain(`data-from="${to + 1}" data-to="40"`);
    expect(first).not.toContain('data-row="totals"');
    expect(second).toContain('data-row="totals"');
    // The summary beside the first stretch only.
    expect(pages[0]).toContain('data-slot="report-force-summary"');
    expect(pages[1]).not.toContain('data-slot="report-force-summary"');
  });
});

describe("Physical Properties (SAFEDON_EG)", () => {
  it("draws each average as a bar against its minimum, and the summary with the template's labels", () => {
    const { pages } = sectionPages(makeSafedonExport());
    const page = pages[0];
    expect(text(slot(page, "report-section-heading"))).toContain("Section 05 Physical Properties Lab test to ASTM D6319.");
    const chart = slot(page, "report-tensile-chart");
    expect(text(chart)).toContain("Tensile Strength (Average) (MPa) XS 34.18 MPa S 32.99 MPa M 34.03 MPa L 33.17 MPa Minimum 14 MPa");
    expect(text(chart)).toContain("Elongation at Break, Average (%) XS 536% S 547% M 555% L 543% Minimum 500%");
    expect(chart.match(/data-slot="report-limit-line"/g)).toHaveLength(8);
    expect(chart).toMatch(/data-slot="report-bar" data-value="34.18"[^>]*style="width:85\.450%"/);
    const summary = slot(page, "report-tensile-summary");
    expect(text(summary)).toContain("Tensile Strength (Average) (MPa) 34.18 32.99 34.03 33.17");
    expect(text(summary)).toContain("Elongation at Break, Average (%) 536 547 555 543");
    expect(text(summary)).toContain("Result Passed Passed Passed Passed");
    expect(text(summary)).toContain("No lab report is attached.");
    expect(page).not.toContain('data-slot="report-force-chart"');
  });

  it("prints an average below its minimum in red, its bar too", () => {
    const doc = makeSafedonExport();
    const tensile = doc.modules.find((module) => module.key === "tensile");
    if (!tensile) throw new Error("No tensile module.");
    tensile.data = { ...tensile.data, sizes: { ...(tensile.data.sizes as object), S: { tensileStrength: 12.5, elongationAtBreak: 547 } } };
    tensile.computed = { ...tensile.computed, sizes: { ...(tensile.computed.sizes as object), S: { tensileResult: "fail", elongationResult: "pass" } } };
    const page = sectionPages(doc).pages[0];
    expect(slot(page, "report-tensile-chart")).toMatch(/data-value="12.5" class="[^"]*bg-fail-solid/);
    expect(slot(page, "report-tensile-chart")).toContain('<p data-tone="fail" class="text-right tabular-nums text-[9pt] leading-[1.5] font-semibold text-fail">12.50 MPa</p>');
    expect(slot(page, "report-tensile-summary")).toContain('<span class="font-semibold text-fail">12.50</span>');
  });
});

describe("the primitives' failing figures", () => {
  it("AsideLines: a line in red where its figure fails, as before otherwise", () => {
    const html = renderToStaticMarkup(
      <AsideLines
        lines={[
          { text: "Median", strong: "5.8 N", tone: "fail" },
          { text: "Range 5.4 to 6.1" },
        ]}
      />,
    );
    expect(html).toContain('<p data-tone="fail" class="tabular-nums text-fail">Median<span class="font-bold"> 5.8 N</span></p>');
    expect(html).toContain('<p class="tabular-nums">Range 5.4 to 6.1</p>');
  });

  it("HBars: a failing row's bar and figure in red, the others in blue and slate", () => {
    const html = renderToStaticMarkup(
      <HBars
        label="Tensile strength"
        axis={{ min: 0, max: 40 }}
        minimum={14}
        rows={[
          { key: "S", label: "S", value: 12.5, display: "12.50 MPa", tone: "fail" },
          { key: "M", label: "M", value: 34.03, display: "34.03 MPa" },
        ]}
      />,
    );
    expect(html).toMatch(/data-value="12.5" class="[^"]*bg-fail-solid"/);
    expect(html).toMatch(/data-value="34.03" class="[^"]*bg-brand-500"/);
    expect(html).toMatch(/<p data-tone="fail" class="[^"]*font-semibold text-fail">12.50 MPa<\/p>/);
    expect(html).toMatch(/<p class="[^"]*text-slate-900">34.03 MPa<\/p>/);
  });
});
