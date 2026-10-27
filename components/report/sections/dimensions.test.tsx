// Sections 03 and 04 (TG35 pages 3 and 4) as server-rendered markup in the
// report: the charts, the tables and their status colours, the pages they
// run to, numbered across the report, and the primitives' props they added
// (a dot plot's own limits per row and smaller dots, a chart note's figure
// in red, a bar in a status colour). The room the builders count is checked
// against the components' own sizes.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReportModel } from "@/lib/report/model";
import { makeSafedonExport, makeStdEgExport } from "@/lib/report/__fixtures__/exports";
import { failingSafedon, fourSizes, safedonWith, stdEgWith, withSizeXL } from "@/lib/report/sections/__fixtures__/dimensions";
import { DIMENSIONS_ROOM, lengthRowHeight, LENGTH_DOT, MEASUREMENTS_ROOM } from "@/lib/report/sections/dimension-shared";
import type { InspectionExport } from "@/lib/schemas/export";
import { DOT, dotRowHeight, DotPlot, HBars, ReportDocument } from "../index";
import { AsideLines } from "../chart-parts";

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

function render(doc: InspectionExport) {
  const model = buildReportModel(doc);
  const pages = pagesOf(renderToStaticMarkup(<ReportDocument model={model} />));
  return {
    model,
    pages,
    dimensions: pages.filter((page) => page.includes('data-slot="report-dimensions"')),
    measurements: pages.filter((page) => page.includes('data-slot="report-measurements"')),
  };
}

/** The markup of a page from one part, by its data-slot, to the next part named (or the page's end). */
function slot(page: string, name: string, next?: string): string {
  const start = page.indexOf(`data-slot="${name}"`);
  if (start === -1) return "";
  const end = next ? page.indexOf(`data-slot="${next}"`, start) : -1;
  return page.slice(start, end === -1 ? undefined : end);
}

describe("Section 03 in the report", () => {
  const { dimensions } = render(stdEgWith(fourSizes));
  const [page] = dimensions;

  it("prints on one page for the design's four sizes, headed by the section, its title and the lead", () => {
    expect(dimensions).toHaveLength(1);
    expect(text(page)).toContain(
      "Section 03 Dimensions & Weight 13 gloves measured per size. Length must reach 240 mm and palm width must sit inside each size's tolerance. Thickness and weight are recorded for information.",
    );
    // After the Summary and Section 02, however many pages those take (this fixture's four strips give Section 02 two).
    const plan = buildReportModel(stdEgWith(fourSizes)).plan;
    const before = plan.slice(0, plan.findIndex((entry) => entry.key === "dimensions")).reduce((sum, entry) => sum + entry.pageCount, 0);
    expect(page).toContain(`Page ${before + 1} of`);
  });

  it("draws each glove's length as a dot per size, the median's mark, the minimum's line over its tinted zone, the key and the notes", () => {
    const chart = slot(page, "report-glove-length", "report-palm-width");
    expect(text(chart)).toContain("Glove Length (mm), Each Glove One glove Median Below 240 mm minimum");
    expect(chart.match(/data-dot="/g)).toHaveLength(52);
    // Six gloves of 242 mm in size S, stacked.
    expect(Array.from(chart.matchAll(/data-dot="242" data-level="(\d)"/g)).slice(0, 6).map((match) => Number(match[1]))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(chart.match(/data-slot="report-reject-zone"/g)).toHaveLength(4);
    expect(chart.match(/data-slot="report-limit-line"/g)).toHaveLength(4);
    expect(chart).toMatch(/data-slot="report-reject-zone"[^>]*style="left:0;width:12\.500%"/);
    expect(chart).toMatch(/data-tick="240" class="[^"]*font-bold text-fail/);
    expect(Array.from(chart.matchAll(/data-slot="report-median" data-median="(\d+)"/g), (match) => Number(match[1]))).toEqual([243, 244, 244, 243]);
    expect(text(chart)).toContain("Median 243 mm Range 242 to 245");
    // The design's dots: smaller than the plot's own.
    expect(chart).toContain(`width:${LENGTH_DOT.size}mm;height:${LENGTH_DOT.size}mm`);
  });

  it("bands the palm width's tolerance per size, the range measured and the median, with the spec and the median at the right", () => {
    const chart = slot(page, "report-palm-width");
    expect(text(chart)).toContain("Palm Width (mm) against Size Tolerance Tolerance Measured range Median");
    expect(Array.from(chart.matchAll(/data-slot="report-band" data-from="(\d+)" data-to="(\d+)"/g), (match) => [Number(match[1]), Number(match[2])])).toEqual([
      [70, 90],
      [85, 105],
      [100, 120],
      [110, 130],
    ]);
    expect(text(chart)).toContain("Spec 80 ± 10 Median 84");
    expect(text(chart)).toContain("Spec ≥ 110 Median 114");
  });

  it("lists the medians by size beside the weight per glove, each size's result as its chip", () => {
    const results = slot(page, "report-dimensions-results");
    expect(results).toMatch(/<th colSpan="2" scope="colgroup" class="[^"]*">Median \(mm\)<\/th><th colSpan="3" scope="colgroup" class="[^"]*">Thickness \(mm\)<\/th>/);
    expect(text(results)).toContain("Size Length Width Finger Palm Cuff Result S 243 84 0.10 0.06 0.05 Passed M 244 95");
    expect(results.match(/data-slot="report-status-chip" data-status="pass"/g)).toHaveLength(4);
    expect(Array.from(results.matchAll(/data-slot="report-bar" data-value="([\d.]+)"/g), (match) => Number(match[1]))).toEqual([3.2, 3.5, 3.8, 4.2]);
    expect(text(results)).toContain("Weight per Glove (g) S 3.20 g M 3.50 g L 3.80 g XL 4.20 g Average of 13 gloves per size. For information only; indicative weight for size M is 3.5 g.");
  });

  it("shows failing values in red: a size's own spec, the statistic, the chip; a P/F set by hand marked", () => {
    const [failing] = render(safedonWith(failingSafedon)).dimensions;
    const chart = slot(failing, "report-glove-length");
    expect(chart).toMatch(/data-row="S".*?data-slot="report-reject-zone"[^>]*style="left:0;width:85\.000%"/);
    expect(chart).toMatch(/data-tick="245" class="[^"]*font-bold text-fail/);
    expect(chart).toMatch(/<p data-tone="fail" class="tabular-nums text-fail">Average<span class="font-bold"> 243 mm<\/span>/);
    const results = slot(failing, "report-median-results");
    expect(results).toContain('<span class="font-semibold text-fail">243</span>');
    expect(results.match(/data-slot="report-status-chip" data-status="fail"/g)).toHaveLength(2);
    expect(results).toContain('<span class="sr-only">Set by the inspector</span>');
    expect(text(results)).toContain("* Set by the inspector: size M Width.");
  });

  it("colours a weight past the indicative weight's threshold amber", () => {
    const [std] = render(makeStdEgExport()).dimensions;
    expect(slot(std, "report-weight-per-glove")).toMatch(/data-slot="report-bar" data-value="2.9" class="[^"]*bg-warn-solid/);
    expect(slot(std, "report-weight-per-glove")).toMatch(/<p data-tone="warn" class="[^"]*font-semibold text-warn">2\.90 g<\/p>/);
  });

  it("runs five sizes onto a second page, headed Continued, numbered across the report", () => {
    const { model, pages, dimensions: five } = render(safedonWith(withSizeXL));
    expect(five).toHaveLength(2);
    expect(text(five[1])).toContain("Section 03 · Continued Dimensions & Weight Average Results by Size");
    expect(pages).toHaveLength(model.pageCount);
    pages.forEach((each, index) => expect(each).toContain(`Page ${index + 1} of ${model.pageCount}</p>`));
  });
});

describe("Section 04 in the report", () => {
  it("prints four sizes' tables on one page, two side by side, with the unit and gloves at the right", () => {
    const { measurements } = render(makeSafedonExport());
    expect(measurements).toHaveLength(1);
    const [page] = measurements;
    expect(text(page)).toContain(
      "Section 04 Measurements by Glove All values in mm · 13 gloves per size Size XS Lot LOT-B01 · Avg. weight 2.56 g Size XS: each glove's measurements in mm No. Length Width Finger Palm 1 241 76 0.19 0.11",
    );
    expect(Array.from(page.matchAll(/data-slot="report-glove-table" data-size="([A-Z]+)"/g), (match) => match[1])).toEqual(["XS", "S", "M", "L"]);
    expect(page.match(/class="grid grid-cols-2 items-start gap-x-\[7mm\]"/g)).toHaveLength(2);
  });

  it("tints the statistic's row blue under a dark rule, greys the spec, colours the result, and zebras the gloves", () => {
    const [page] = render(makeStdEgExport()).measurements;
    expect(page).toMatch(/<tr data-row="2" class="bg-slate-50/);
    expect(page).toMatch(/<tr data-row="statistic" class="bg-brand-50 font-semibold"><th scope="row" class="[^"]*"><span class="block py-\[0\.7mm\] whitespace-nowrap text-brand-700">Median<\/span>/);
    expect(text(page)).toContain("Median 245 95 0.09 0.05 0.04 Spec. ≥ 240 95 ± 10 NA NA NA Result Passed Passed Passed Passed Passed");
    expect(page).toMatch(/<span class="block py-\[0\.7mm\] font-semibold text-pass">Passed<\/span>/);
    expect(page).toContain("[&amp;_tr[data-row=statistic]]:border-t-[0.4mm]");
  });

  it("shows readings outside the spec, a failed statistic and its result in red, marks a P/F set by hand, and says what both mean", () => {
    const [page] = render(safedonWith(failingSafedon)).measurements;
    const s = slot(page, 'report-glove-table" data-size="S');
    expect(s).toMatch(/<td class="[^"]*"><span class="text-fail">243<\/span><\/td>/);
    expect(s).toMatch(/<span class="block py-\[0\.7mm\] font-semibold text-fail">Rej\.<\/span>/);
    const m = slot(page, 'report-glove-table" data-size="M');
    expect(m).toMatch(/Rej\.<span aria-hidden="true">\*<\/span><span class="sr-only"> \(set by the inspector\)<\/span>/);
    expect(page).toMatch(/data-slot="report-measurements-note"[^>]*>\* Set by the inspector\. Readings in red are outside the spec; the average is judged\.<\/p>/);
  });

  it("puts the fifth size on a page headed Continued", () => {
    const { measurements } = render(safedonWith(withSizeXL));
    expect(measurements).toHaveLength(2);
    expect(text(measurements[1])).toContain("Section 04 · Continued Measurements by Glove All values in mm · 13 gloves per size Size XL Lot LOT-B05 · Avg. weight 3.90 g");
  });
});

describe("the room the builders count, against the components", () => {
  it("counts a glove length row as tall as the dot plot draws it with the section's dots", () => {
    for (let stack = 0; stack <= 13; stack += 1) expect(lengthRowHeight(stack)).toBeCloseTo(dotRowHeight(stack, { ...DOT, ...LENGTH_DOT }));
  });

  it("counts the gaps the pages are laid out with", () => {
    const { dimensions, measurements } = render(stdEgWith(fourSizes));
    expect(dimensions[0]).toContain(`flex flex-col gap-[${DIMENSIONS_ROOM.gap}mm]`);
    expect(dimensions[0]).toContain(`flex flex-col gap-[${DIMENSIONS_ROOM.blockGap}mm]`);
    expect(measurements[0]).toContain(`flex flex-col gap-[${MEASUREMENTS_ROOM.gap}mm]`);
    expect(measurements[0]).toContain(`flex flex-col gap-[${MEASUREMENTS_ROOM.rowGap}mm]`);
    expect(measurements[0]).toContain(`gap-x-[${MEASUREMENTS_ROOM.columnGap}mm]`);
    expect(measurements[0]).toContain(`<col style="width:${MEASUREMENTS_ROOM.noColumn}mm"/>`);
    expect(measurements[0]).toContain(`[&amp;_td]:px-[${MEASUREMENTS_ROOM.cellPadding}mm]`);
  });
});

describe("the primitives' props for Sections 03 and 04", () => {
  it("DotPlot: a row's own limits in place of the plot's, both of a range, each tick in red; smaller dots by `geometry`", () => {
    const axis = { min: 238, max: 248, ticks: [238, 240, 242, 244, 246, 248] };
    const html = renderToStaticMarkup(
      <DotPlot
        label="Glove length"
        axis={axis}
        limit={{ value: 240 }}
        geometry={{ size: 2, rise: 2.6 }}
        rows={[
          { key: "S", label: "S", values: [242, 242] },
          { key: "M", label: "M", values: [243], limits: [{ value: 241, side: "below" }, { value: 247, side: "above" }] },
          { key: "L", label: "L", values: [244], limits: [] },
        ]}
      />,
    );
    const zones = Array.from(html.matchAll(/data-slot="report-reject-zone"[^>]*style="([^"]*)"/g), (match) => match[1]);
    expect(zones).toEqual(["left:0;width:20.000%", "left:0;width:30.000%", "left:90.000%;right:0"]);
    expect(html.match(/data-slot="report-limit-line"/g)).toHaveLength(3);
    for (const tick of [240, 241, 247]) expect(html).toMatch(new RegExp(`data-tick="${tick}" class="[^"]*font-bold text-fail`));
    expect(html).toMatch(/data-dot="242" data-level="1"[^>]*style="left:40\.000%;bottom:6\.1mm;width:2mm;height:2mm"/);
  });

  it("AsideLines: a figure in red where it fails", () => {
    const html = renderToStaticMarkup(<AsideLines lines={[{ text: "Median", strong: "238 mm", tone: "fail" }, { text: "Range 236 to 241" }]} />);
    expect(html).toContain('<p data-tone="fail" class="tabular-nums text-fail">Median<span class="font-bold"> 238 mm</span>');
    expect(html).toContain("<p class=\"tabular-nums\">Range 236 to 241</p>");
  });

  it("HBars: a bar and its figure in the status colour, failed red", () => {
    const html = renderToStaticMarkup(
      <HBars label="Weight" axis={{ min: 0, max: 5 }} rows={[{ key: "M", label: "M", value: 2.5, display: "2.50 g", tone: "fail" }, { key: "L", label: "L", value: 4, display: "4.00 g" }]} />,
    );
    expect(html).toMatch(/data-value="2.5" class="[^"]*bg-fail-solid"/);
    expect(html).toMatch(/<p data-tone="fail" class="[^"]*font-semibold text-fail">2\.50 g<\/p>/);
    expect(html).toMatch(/data-value="4" class="[^"]*bg-brand-500"/);
    expect(html).toMatch(/<p class="[^"]*text-slate-900">4\.00 g<\/p>/);
  });
});
