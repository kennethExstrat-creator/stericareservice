// Section 07's pages (TG35 page 7) as server-rendered markup, in the report
// document as the print route renders it: the heading and lead, the chart
// with its minimums and grades, the per-box table, the aged gloves and the
// grades; red for what fails; the pages a long table runs on to. And the
// primitive props it added: ReportTable's divided columns and row spans,
// GroupedHBars' sublabel under its label, an aside line in red.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeStdEgExport, withReportOptions } from "@/lib/report/__fixtures__/exports";
import { fourSizeExport, packingBoxes, packingExport, type PackingSizeInput } from "@/lib/report/__fixtures__/packing-export";
import { buildReportModel } from "@/lib/report/model";
import type { InspectionExport } from "@/lib/schemas/export";
import { AsideLines } from "../chart-parts";
import { GroupedHBars } from "../bars";
import { ReportDocument } from "../report-document";
import { ReportTable } from "../report-table";

/** The text of some markup, tags dropped and spaces collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The section's pages in the whole report, and the report's page count. */
function packingPages(doc: InspectionExport): { pages: string[]; total: number } {
  const model = buildReportModel(doc);
  const html = renderToStaticMarkup(<ReportDocument model={model} />);
  const pages = html.split("<section data-report-page").slice(1);
  return { pages: pages.filter((page) => page.includes('data-slot="report-packing"')), total: model.pageCount };
}

/** A slot's markup on a page: from its element's opening tag to the next slot of the section, or the page's footer. */
function slot(page: string, name: string): string {
  const at = page.indexOf(`data-slot="${name}"`);
  if (at === -1) return "";
  const next = page.slice(at + 1).search(/data-slot="report-(packing-(chart|boxes|closing|aged|grades)|page-footer)"/);
  const end = next === -1 ? page.length : page.lastIndexOf("<", at + 1 + next);
  return page.slice(page.lastIndexOf("<", at), end);
}

describe("the STD_EG example: Section 07 on one page", () => {
  const { pages } = packingPages(makeStdEgExport());
  const page = pages[0];

  it("heads the page with the section's number and title and the lead from the template", () => {
    expect(pages).toHaveLength(1);
    expect(text(page)).toContain(
      "Section 07 Glove Packing & Dispensing Inner boxes opened to check glove layering and how cleanly gloves dispense. Minimum 70% layering and 80% dispensing; stickiness grades A to C pass, D fails.",
    );
  });

  it("charts the size's averages against the minimums, with the legend, the figures and the grade", () => {
    const chart = slot(page, "report-packing-chart");
    expect(text(chart)).toContain("Average Layering & Dispensing Layering Dispensing Minimum A Stickiness grade");
    expect(text(chart)).toContain("M 13 boxes Layering 88.3% Dispensing 90.3% A");
    expect(chart).toMatch(/data-series="layering"[^>]*><span[^>]*data-value="88.3076923076923"[^>]*style="width:88\.308%"/);
    // Each minimum a dashed red line across its own bar's lane, the size's and the aged gloves', and its tick in red.
    expect(Array.from(chart.matchAll(/data-slot="report-limit-line"[^>]*style="left:([\d.]+)%"/g), (match) => match[1])).toEqual([
      "70.000",
      "80.000",
      "70.000",
      "80.000",
    ]);
    expect(Array.from(chart.matchAll(/data-tick="(\d+)" class="([^"]*)"[^>]*>([^<]*)</g), ([, tick, classes, label]) => [tick, label, classes.includes("text-fail")])).toEqual([
      ["0", "0%", false],
      ["20", "20%", false],
      ["40", "40%", false],
      ["60", "60%", false],
      ["70", "70", true],
      ["80", "80", true],
      ["100", "100%", false],
    ]);
    expect(chart).toMatch(/data-slot="report-status-chip" data-status="pass"[^>]*>.*?<span>A<\/span>/);
    // The placeholder aged sample (the report printed none): its row under a dashed rule.
    expect(Array.from(chart.matchAll(/data-row="(\w+)"/g), (match) => match[1])).toEqual(["M", "aged"]);
    expect(text(chart)).toContain("Aged Gloves 70 °C · 7 days · 1 box Layering 85% Dispensing 88% A");
  });

  it("lists each box by item under the size, with the note and the average row", () => {
    const boxes = slot(page, "report-packing-boxes");
    expect(text(boxes)).toContain("Per-Box Results Layering and dispensing in %. Every box graded stickiness A.");
    expect(text(boxes)).toContain("M Item Box/Carton # Layer Disp. 1 13 90 92 2 299 88 90");
    expect(text(boxes)).toContain("12 2336 88 90 13 2819 88 90 Average 88.3 90.3");
    // One size keeps to its own width: 60 mm.
    expect(boxes).toMatch(/style="width:60mm"/);
    expect(boxes).toMatch(/<tr data-row="totals"[^>]*><th[^>]*><span class="font-bold text-brand-700">Average<\/span>/);
  });

  it("gives the grades with their legends, D in red, beside the aged gloves' table", () => {
    const grades = slot(page, "report-packing-grades");
    expect(text(grades)).toBe(
      "Stickiness Grades A Non sticky. Passed. B A mix of non sticky to lightly sticky. Passed. B1 A mix of non sticky to light stickiness at the bead. Passed. C Lightly sticky but dispensable. Passed. D Too sticky & affect dispensing. Failed.",
    );
    expect(Array.from(grades.matchAll(/data-slot="report-grade-chip" data-status="(\w+)"/g), (match) => match[1])).toEqual(["pass", "pass", "pass", "pass", "fail"]);
    expect(grades).toMatch(/data-status="fail" class="[^"]*bg-fail-tint text-fail[^"]*">D</);
    const aged = slot(page, "report-packing-aged");
    expect(text(aged)).toContain("Box-Aged Gloves (70 °C, 7 Days) Size Layering Dispensing Stickiness Result M 85% 88% A Passed Average 85% 88% A");
  });
});

describe("a size with no aged sample entered", () => {
  it("prints its row of the aged gloves' table blank and Not Done (Kenneth, 27 October 2026)", () => {
    const { pages } = packingPages(
      packingExport({
        S: { boxes: packingBoxes(8), aged: { layeringPct: 87, dispensingPct: 85, stickiness: "B" } },
        M: { boxes: packingBoxes(13, {}, 8001) },
      }),
    );
    const aged = slot(pages[0], "report-packing-aged");
    expect(text(aged)).toContain("S 87% 85% B Passed M — — — Not Done Average 87% 85% B");
    expect(Array.from(aged.matchAll(/data-slot="report-status-chip" data-status="(\w+)"/g), (match) => match[1])).toEqual(["pass", "not_done"]);
  });
});

describe('"Aged Sample?" answered No (Kenneth, 30 October 2026)', () => {
  it("prints no Aged Gloves row in the chart and no Box-Aged Gloves table, whatever is saved in one; the grades stay", () => {
    const { pages } = packingPages(fourSizeExport({ hasAgedSample: "no" }));
    expect(pages).toHaveLength(1);
    const chart = slot(pages[0], "report-packing-chart");
    expect(Array.from(chart.matchAll(/data-row="(\w+)"/g), (match) => match[1])).toEqual(["S", "M", "L", "XL"]);
    expect(text(chart)).not.toContain("Aged Gloves");
    expect(slot(pages[0], "report-packing-aged")).toBe("");
    expect(text(pages[0])).not.toContain("Box-Aged Gloves");
    expect(text(slot(pages[0], "report-packing-grades"))).toContain("Non sticky");
  });
});

describe("four sizes with aged samples, as TG35 page 7", () => {
  const { pages } = packingPages(fourSizeExport());
  const page = pages[0];

  it("prints on one page", () => {
    expect(pages).toHaveLength(1);
  });

  it("charts every size, then the aged gloves under a dashed rule with their ageing and count under the label", () => {
    const chart = slot(page, "report-packing-chart");
    expect(Array.from(chart.matchAll(/data-row="(\w+)"/g), (match) => match[1])).toEqual(["S", "M", "L", "XL", "aged"]);
    expect(text(chart)).toContain("Aged Gloves 70 °C · 7 days · 4 boxes Layering 88.5% Dispensing 86.5% B1");
    expect(chart).toMatch(/<span class="text-slate-600 block">70 °C · 7 days · 4 boxes<\/span>/);
    expect(chart).toMatch(/data-row="aged" class="contents"><div class="[^"]*border-t-\[0\.3mm\] border-dashed/);
  });

  it("sets the sizes side by side in the per-box table, each under its label and divided by a hairline", () => {
    const boxes = slot(page, "report-packing-boxes");
    expect(Array.from(boxes.matchAll(/scope="colgroup"[^>]*><span[^>]*>([^<]+)<\/span>/g), (match) => match[1])).toEqual(["S", "M", "L", "XL"]);
    expect(boxes.match(/<th scope="col" class="[^"]*border-l-\[0\.25mm\] border-l-slate-200[^"]*">Box\/Carton #<\/th>/g)).toHaveLength(4);
    expect(boxes.match(/<tr data-row="\d+"/g)).toHaveLength(13);
    // The design's tighter rows over the dense table's.
    expect(boxes).toContain("[&amp;_td]:py-[0.5mm]");
    expect(text(boxes)).toContain("Average 90 92 90 92 88 90 87 89");
    // XL has five boxes, S and L eight: their later rows are blank.
    expect(text(boxes)).toContain("5 3029 90 92 4029 90 92 5029 88 90 6029 87 89 6 3036 90 92 4036 90 92 5036 88 90 7 3043");
    expect(text(boxes)).toContain("12 4078 90 92 13 4085 90 92 Average");
  });

  it("tables the aged gloves with one result across their rows, as the design prints it", () => {
    const aged = slot(page, "report-packing-aged");
    expect(text(aged)).toContain("Box-Aged Gloves (70 °C, 7 Days) Size Layering Dispensing Stickiness Result S 87% 85% B Passed M 91% 89% B L 89% 87% B1 XL 87% 85% B Average 88.5% 86.5% B1");
    expect(aged).toMatch(/<td rowSpan="5"[^>]*><div class="flex justify-end"><span data-slot="report-status-chip" data-status="pass"/);
    expect(aged.match(/data-slot="report-status-chip"/g)).toHaveLength(1);
    expect(aged).toMatch(/<tr data-row="average" class="bg-brand-50 font-semibold/);
  });
});

describe("what fails, in red", () => {
  const { pages } = packingPages(
    packingExport({
      S: { boxes: packingBoxes(4, { layeringPct: 60, dispensingPct: 75 }), aged: { layeringPct: 72, dispensingPct: 81, stickiness: "A" } },
      M: { boxes: [...packingBoxes(3), { boxNo: 7900, layeringPct: 88, dispensingPct: 90, stickiness: "D" }], aged: { layeringPct: 65, dispensingPct: 82, stickiness: "D" } },
    }),
  );
  const page = pages[0];

  it("draws a low average's figures in red and a failing worst grade's chip red", () => {
    const chart = slot(page, "report-packing-chart");
    expect(chart).toMatch(/<p data-tone="fail" class="tabular-nums text-fail">Layering<span class="font-bold"> 60%<\/span><\/p>/);
    expect(chart).toMatch(/<p data-tone="fail" class="tabular-nums text-fail">Dispensing<span class="font-bold"> 75%<\/span><\/p>/);
    expect(chart).toMatch(/data-slot="report-status-chip" data-status="fail"[^>]*>.*?<span>D<\/span>/);
  });

  it("marks each low box and average in the table, and the failing grade in the note", () => {
    const boxes = slot(page, "report-packing-boxes");
    expect(boxes.match(/<span data-low="true" class="font-semibold text-fail">60<\/span>/g)).toHaveLength(5);
    expect(boxes).toMatch(/<span class="font-semibold text-fail">1 box D<\/span>/);
    expect(text(boxes)).toContain("Stickiness grades: 7 boxes A and 1 box D");
  });

  it("gives each aged sample its own result when they differ, the failing one red", () => {
    const aged = slot(page, "report-packing-aged");
    expect(aged).not.toContain("rowSpan");
    expect(Array.from(aged.matchAll(/data-slot="report-status-chip" data-status="(\w+)"/g), (match) => match[1])).toEqual(["pass", "fail"]);
    expect(aged).toMatch(/<span data-low="true" class="font-semibold text-fail">65%<\/span>/);
    expect(aged).toMatch(/<span data-grade-fails="true" class="font-semibold text-fail">D<\/span>/);
  });
});

describe("a long per-box table", () => {
  const doc = packingExport(
    Object.fromEntries(
      ["XS", "S", "M", "L", "XL"].map((size, index): [string, PackingSizeInput] => [
        size,
        { boxes: packingBoxes(50, {}, 10000 + 1000 * index), aged: { layeringPct: 88, dispensingPct: 86, stickiness: "B" } },
      ]),
    ),
  );
  const { pages, total } = packingPages(doc);

  it("runs on to more pages, each continued, its header repeated and the average row on the last", () => {
    expect(pages.length).toBeGreaterThan(1);
    expect(text(pages[0])).toContain("Section 07 Glove Packing & Dispensing Inner boxes opened");
    for (const later of pages.slice(1)) {
      expect(text(later)).toMatch(/^.*Section 07 Glove Packing & Dispensing Continued /);
      expect(later).not.toContain("Inner boxes opened");
    }
    const tables = pages.map((page) => slot(page, "report-packing-boxes")).filter((table) => table !== "");
    expect(tables.length).toBeGreaterThan(1);
    tables.forEach((table) => expect(text(table)).toContain("XS S M L XL Item Box/Carton # Layer Disp."));
    expect(tables.map((table) => table.includes('data-row="totals"'))).toEqual(tables.map((_, index) => index === tables.length - 1));
    expect(text(tables[1])).toMatch(/Per-Box Results Continued: Item \d+ to \d+/);
    const items = tables.flatMap((table) => Array.from(table.matchAll(/<tr data-row="(\d+)"/g), (match) => Number(match[1])));
    expect(items).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  });

  it("numbers its pages among the report's", () => {
    const numbers = pages.map((page) => Number(/aria-label="Page (\d+) of \d+"/.exec(page)?.[1]));
    numbers.slice(1).forEach((number, index) => expect(number).toBe(numbers[index] + 1));
    expect(pages[0]).toContain(`of ${total}"`);
  });

  it("five sizes share the page's width, the item column narrower", () => {
    expect(slot(pages[0], "report-packing-boxes")).toMatch(/style="width:184mm"/);
    expect(slot(pages[0], "report-packing-boxes")).toMatch(/<colgroup><col style="width:5\.435%"\/>/);
  });
});

describe("follows the report's options", () => {
  it("leaves out a block switched off", () => {
    const doc = fourSizeExport();
    const off = withReportOptions(doc, {
      sections: { ...doc.report.sections, packing: { include: true, blocks: { averageLayeringDispensing: true, perBoxResults: false, agedGloves: false, stickinessGrades: true } } },
    });
    const page = packingPages(off).pages[0];
    expect(page).toContain('data-slot="report-packing-chart"');
    expect(page).not.toContain('data-slot="report-packing-boxes"');
    expect(page).not.toContain('data-slot="report-packing-aged"');
    expect(page).toContain('data-slot="report-packing-grades"');
  });

  it("says when no box is entered yet", () => {
    const page = packingPages(packingExport({ M: { boxes: [] } })).pages[0];
    expect(text(slot(page, "report-packing-boxes"))).toBe("Per-Box Results Layering and dispensing in %. No boxes are entered yet.");
  });
});

describe("the primitive props the section added", () => {
  it("ReportTable: a divided column's hairline down every row, and a cell spanning the rows under it", () => {
    const html = renderToStaticMarkup(
      <ReportTable
        columns={[
          { key: "size", label: "Size" },
          { key: "value", label: "Value", numeric: true, divided: true },
          { key: "result", label: "Result" },
        ]}
        rows={[
          { key: "S", cells: { size: "S", value: "1", result: "Passed" }, rowSpans: { result: 2 } },
          { key: "M", cells: { size: "M", value: "2", result: "unused" } },
          { key: "L", cells: { size: "L", value: "3", result: "Failed" } },
        ]}
        totals={{ size: "Total", value: "6" }}
      />,
    );
    expect(html.match(/border-l-\[0\.25mm\] border-l-slate-200/g)).toHaveLength(5);
    expect(html).toMatch(/<th scope="col" class="[^"]*border-slate-900[^"]*border-l-slate-200[^"]*">Value<\/th>/);
    expect(html).toMatch(/<td rowSpan="2"[^>]*>Passed<\/td>/);
    expect(html).not.toContain("unused");
    expect(html).toMatch(/<tr data-row="L"[^>]*>.*<td[^>]*>Failed<\/td><\/tr>/);
    // Without the new props, the markup is as before.
    expect(renderToStaticMarkup(<ReportTable columns={[{ key: "a", label: "A" }]} rows={[{ key: "1", cells: { a: "x" } }]} />)).not.toMatch(/rowSpan|border-l-/);
  });

  it("GroupedHBars: a sublabel under its label; AsideLines: a failing line in red", () => {
    const bars = renderToStaticMarkup(
      <GroupedHBars
        label="Bars"
        axis={{ min: 0, max: 100, ticks: [0, 100] }}
        series={[{ key: "a", label: "A", tone: "brand" }]}
        rows={[
          { key: "S", label: "S", sublabel: "8 boxes", values: { a: 50 } },
          { key: "aged", label: "Aged Gloves", sublabel: "4 boxes", sublabelBelow: true, values: { a: 40 } },
        ]}
      />,
    );
    expect(bars).toContain('<span class="text-slate-600"> 8 boxes</span>');
    expect(bars).toContain('<span class="text-slate-600 block">4 boxes</span>');
    expect(bars).toContain('class="relative flex w-full flex-col gap-[0.8mm] py-[1.6mm]"');
    const aside = renderToStaticMarkup(<AsideLines lines={[{ text: "Layering", strong: "60%", tone: "fail" }, { text: "Dispensing", strong: "92%" }]} />);
    expect(aside).toContain('<p data-tone="fail" class="tabular-nums text-fail">Layering<span class="font-bold"> 60%</span></p>');
    expect(aside).toContain('<p class="tabular-nums">Dispensing<span class="font-bold"> 92%</span></p>');
  });
});
