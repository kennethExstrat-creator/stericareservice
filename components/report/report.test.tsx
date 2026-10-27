// The report's pages and primitives as server-rendered markup: page 1 (the
// Summary) with its chrome, the pages still to come, the frame reused by
// another document (the sampling plan, A4 landscape), and each primitive's
// geometry, empty data and one size included.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "@/lib/report/__fixtures__/exports";
import { STERICARE_LETTERHEAD } from "@/lib/report/letterhead";
import { buildReportModel, paperOf, type PageChrome } from "@/lib/report/model";
import type { InspectionExport } from "@/lib/schemas/export";
import {
  DotPlot,
  GroupedHBars,
  HBars,
  PhotoGrid,
  RangeBand,
  ReportDocument,
  ReportTable,
  SectionHeading,
  SizeChip,
  sizeTone,
  StackedBar,
  StatusChip,
  StripPlot,
  TickMatrix,
  TrackBar,
} from "./index";

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

function concluded(result: "pass" | "fail" | "hold"): InspectionExport {
  const doc = makeStdEgExport();
  doc.conclusion = { ...doc.conclusion, finalResult: result };
  return doc;
}

describe("page 1: the Summary", () => {
  const model = buildReportModel(makeStdEgExport());
  const html = renderToStaticMarkup(<ReportDocument model={model} />);
  const first = pagesOf(html)[0];

  it("heads the page with the kicker and the product, and concludes PASSED in green with the verdict and the date", () => {
    expect(text(first)).toContain("Preshipment Inspection · Nitrile Disposable Examination Gloves Brand A PC-A01 Blue Nitrile");
    expect(first).toMatch(/<h2[^>]*>Brand A PC-A01 Blue Nitrile<\/h2>/);
    const card = /<section data-slot="report-conclusion" data-status="pass" class="([^"]*)"/.exec(first);
    expect(card?.[1]).toContain("bg-pass-tint");
    expect(card?.[1]).toContain("border-pass-border");
    expect(text(first)).toContain("Overall Conclusion PASSED 8 of 9 checks passed for size M; Weight has a warning. Concluded 12 April 2025");
    expect(first).toMatch(/data-slot="report-status-tick" data-status="pass" role="img" aria-label="Passed"/);
  });

  it("colours a failed conclusion red and a held one amber", () => {
    const failed = pagesOf(renderToStaticMarkup(<ReportDocument model={buildReportModel(concluded("fail"))} />))[0];
    expect(failed).toMatch(/data-slot="report-conclusion" data-status="fail" class="[^"]*bg-fail-tint/);
    expect(text(failed)).toContain("FAILED");
    const held = pagesOf(renderToStaticMarkup(<ReportDocument model={buildReportModel(concluded("hold"))} />))[0];
    expect(held).toMatch(/data-slot="report-conclusion" data-status="hold" class="[^"]*bg-hold-tint/);
  });

  it("lists the details by the template's labels, a blank one grey", () => {
    const details = text(first);
    for (const [label, value] of [
      ["PO / SO Number", "PO-0001 (SO-0001)"],
      ["Manufacturer / Supplier", "Manufacturer A · Factory A1"],
      ["Inspection Date", "Friday, 11 April 2025"],
      ["Supplier Factory Address / Location", "Address A"],
      ["Manufacturing Date", "1 April 2025"],
      ["Expiry Date", "1 March 2030"],
    ]) {
      expect(details).toContain(`${label} ${value}`);
    }
    expect(first).toMatch(/<dd class="[^"]*text-slate-600[^"]*">Not stated<\/dd>/);
  });

  it("draws the order mix: each size's share, the legend and the totals", () => {
    expect(first).toContain('aria-label="Order mix by size: M 100%."');
    expect(first).toMatch(/data-segment="M" data-share="1.0000" class="[^"]*bg-brand-500/);
    expect(text(first)).toContain("M · 2,900 cartons · 100%");
    expect(text(first)).toContain("2,900 cartons · 5,800,000 gloves · 2,000 gloves per carton");
  });

  it("lists Results by Check with each status's chip in the status colours", () => {
    expect(text(first)).toContain("Check Criterion Result Status");
    expect(text(first)).toContain("Weight Within 10% of the indicative 3.5 g Average 2.90 g Warning");
    expect(text(first)).toContain("Force at Break Median ≥ 6 N Median 6.537 N Passed");
    const chips = Array.from(first.matchAll(/data-slot="report-status-chip" data-status="([a-z_]+)" class="([^"]*)"/g));
    expect(chips.map(([, status]) => status)).toEqual(["pass", "pass", "warn", "pass", "pass", "pass", "pass", "pass", "pass"]);
    expect(chips.find(([, status]) => status === "warn")?.[2]).toContain("bg-warn-tint");
    expect(chips.find(([, status]) => status === "pass")?.[2]).toContain("text-pass");
  });

  it("says, on a draft, that no Inspection Summary is written yet; an approved report leaves the block out", () => {
    expect(text(first)).toContain("Inspection Summary No inspection summary has been written yet.");
    const approved = buildReportModel({ ...makeStdEgExport(), status: "approved" });
    expect(text(pagesOf(renderToStaticMarkup(<ReportDocument model={approved} />))[0])).not.toContain("Inspection Summary");
  });

  it("draws the inspector's formatted summary as the app draws it, with no HTML strings", () => {
    const doc = makeStdEgExport();
    const conclusion = doc.modules.find((module) => module.key === "conclusion");
    if (conclusion) {
      conclusion.data = {
        ...conclusion.data,
        inspectionSummary: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Every size passed.", marks: [{ type: "bold" }] }] }] },
      };
    }
    const page = pagesOf(renderToStaticMarkup(<ReportDocument model={buildReportModel(doc)} />))[0];
    expect(page).toMatch(/data-slot="report-inspection-summary"[^>]*><div class="[^"]*"><p><strong>Every size passed\.<\/strong><\/p><\/div>/);
  });
});

describe("the chrome on every page", () => {
  const model = buildReportModel(makeStdEgExport());
  const pages = pagesOf(renderToStaticMarkup(<ReportDocument model={model} />));

  it("numbers every page across the report, as many as the plan", () => {
    expect(pages).toHaveLength(model.pageCount);
    pages.forEach((page, index) => expect(page).toContain(`Page ${index + 1} of ${model.pageCount}</p>`));
  });

  it("carries the letterhead, the band's title and reference, a Draft tag until approved, and the footer", () => {
    for (const page of pages) {
      expect(page).toContain(`${STERICARE_LETTERHEAD.company} (${STERICARE_LETTERHEAD.registration})`);
      expect(page).toContain(STERICARE_LETTERHEAD.address);
      expect(page).toMatch(/data-slot="report-band-title"[^>]*>Pre-Shipment Inspection Report<\/span>/);
      expect(page).toContain('data-slot="report-draft-tag"');
      expect(page).toMatch(/data-slot="report-band-aside"[^>]*>PO-0001 · Inspected 11 April 2025<\/p>/);
      expect(page).toContain(">Brand A PC-A01 Blue Nitrile</p>");
    }
    const approved = renderToStaticMarkup(<ReportDocument model={buildReportModel({ ...makeStdEgExport(), status: "approved" })} />);
    expect(approved).not.toContain('data-slot="report-draft-tag"');
  });

  it("follows the options: the title, the client and the footer note", () => {
    const html = renderToStaticMarkup(
      <ReportDocument model={buildReportModel(withReportOptions(makeStdEgExport(), { title: "Lot Release Report", footerNote: "For the buyer only." }))} />,
    );
    expect(html).toMatch(/data-slot="report-band-title"[^>]*>Lot Release Report<\/span>/);
    expect(html).toMatch(/data-slot="report-footer-note"[^>]*>For the buyer only\.<\/p>/);
  });

  it("prints each page at the paper's size, breaking after it", () => {
    expect(pages[0]).toMatch(/^="true" data-page="1" data-orientation="portrait" aria-label="Page 1 of \d+" class="[^"]*break-after-page[^"]*w-\[210mm\] h-\[297mm\]/);
    const letter = renderToStaticMarkup(<ReportDocument model={buildReportModel(withReportOptions(makeStdEgExport(), { pageSize: "letter" }))} />);
    expect(letter).toContain("w-[215.9mm] h-[279.4mm]");
    expect(letter).toContain('data-page-size="letter"');
  });
});

describe("the pages still to come", () => {
  it("are none once every section's builder has landed: each planned page is built", () => {
    for (const doc of [makeStdEgExport(), makeSafedonExport()]) {
      const model = buildReportModel(doc);
      const html = renderToStaticMarkup(<ReportDocument model={model} />);
      expect(pagesOf(html)).toHaveLength(model.pageCount);
      for (const entry of model.plan) if (entry.kind !== "summary" && entry.key !== "packing") expect(entry.built, entry.key).toBe(true);
    }
  });

  it("print an entry its builder left empty as its heading, '<title>: coming next' and the parts the options keep", () => {
    const model = buildReportModel(makeStdEgExport());
    const plan = model.plan.map((entry) => (entry.kind === "section" && entry.key === "dimensions" ? { ...entry, pageCount: 1, built: false } : entry));
    const pages = pagesOf(renderToStaticMarkup(<ReportDocument model={{ ...model, plan }} />));
    const placeholder = pages.find((page) => text(page).includes("Dimensions & Weight: coming next")) ?? "";
    expect(text(placeholder)).toContain("Section 03 Dimensions & Weight Dimensions & Weight: coming next Glove Length Chart Palm Width Chart Median Results by Size Weight per Glove");
  });

  it("follow the options at once: a section switched off leaves its page out", () => {
    const doc = makeStdEgExport();
    const off = withReportOptions(doc, { sections: { ...doc.report.sections, measurements: { include: false, blocks: {} } } });
    const html = renderToStaticMarkup(<ReportDocument model={buildReportModel(off)} />);
    expect(html).not.toContain("Measurements by Glove");
    expect(pagesOf(html)).toHaveLength(buildReportModel(doc).pageCount - 1);
  });
});

describe("the frame for another document (the sampling plan for manufacturers)", () => {
  const chrome: PageChrome = {
    letterhead: STERICARE_LETTERHEAD,
    bandTitle: "Sampling Plan",
    bandAside: "PO-0001 · Inspection 11 April 2025",
    draft: false,
    footerLeft: "Prepared for Manufacturer A · PO-0001",
    footerNote: null,
    footerRight: "Computer-generated document. No signature required.",
    numbered: false,
  };
  const html = renderToStaticMarkup(
    <ReportDocument paper={paperOf("a4", "landscape")} chrome={chrome} pages={[{ key: "plan", body: <p>The plan</p> }]} />,
  );

  it("turns the page, sets the band's words and the footer's, with no numbers and no Draft tag", () => {
    expect(html).toContain('data-orientation="landscape"');
    expect(html).toContain("w-[297mm] h-[210mm]");
    expect(html).toMatch(/data-slot="report-band-title"[^>]*>Sampling Plan<\/span>/);
    expect(html).toMatch(/data-slot="report-band-aside"[^>]*>PO-0001 · Inspection 11 April 2025<\/p>/);
    expect(html).toContain(">Prepared for Manufacturer A · PO-0001</p>");
    expect(html).toMatch(/data-slot="report-footer-right"[^>]*>Computer-generated document\. No signature required\.<\/p>/);
    expect(html).not.toContain("Page 1 of 1");
    expect(html).not.toContain("report-draft-tag");
    expect(html).toContain("<p>The plan</p>");
  });

  it("sets the letterhead's address on the company's line, as the landscape design does", () => {
    const letterhead = /<address data-slot="report-letterhead"[^>]*>(.*?)<\/address>/.exec(html)?.[1] ?? "";
    expect(text(letterhead)).toBe(
      `${STERICARE_LETTERHEAD.company} (${STERICARE_LETTERHEAD.registration}) · ${STERICARE_LETTERHEAD.address} ${STERICARE_LETTERHEAD.phone} · ${STERICARE_LETTERHEAD.email} · ${STERICARE_LETTERHEAD.website}`,
    );
    expect(letterhead.match(/<p>/g)).toHaveLength(2);
  });
});

describe("the primitives", () => {
  it("StatusChip and SectionHeading: the status's words and colours; the kicker over the title", () => {
    const chips = renderToStaticMarkup(
      <>
        <StatusChip status="pass" />
        <StatusChip status="fail" />
        <StatusChip status="hold" />
        <StatusChip status="not_done" />
        <StatusChip status="pass" label="Passed, All Sizes" size="sm" />
      </>,
    );
    expect(text(chips)).toBe("Passed Failed On Hold Not Done Passed, All Sizes");
    expect(chips).toMatch(/data-status="fail" class="[^"]*bg-fail-tint text-fail/);
    expect(chips).toMatch(/data-status="hold" class="[^"]*bg-hold-tint text-hold/);
    expect(chips).toMatch(/data-status="not_done" class="[^"]*border-dashed/);
    const heading = renderToStaticMarkup(<SectionHeading kicker="Section 02" title="Order, Product & Sampling" lead="What was ordered." />);
    expect(text(heading)).toBe("Section 02 Order, Product & Sampling What was ordered.");
    expect(heading).toContain("uppercase");
  });

  it("DotPlot: stacks repeated readings, marks the median and the minimum, and draws an empty row", () => {
    const axis = { min: 239, max: 247, ticks: [239, 240, 241, 242, 243, 244, 245, 246, 247] };
    const html = renderToStaticMarkup(
      <DotPlot
        label="Glove length"
        axis={axis}
        limit={{ value: 240 }}
        rows={[
          { key: "S", label: "S", values: [242, 242, 243, 242], median: 242, aside: [{ text: "Median", strong: "242 mm" }] },
          { key: "M", label: "M", values: [] },
        ]}
      />,
    );
    expect(Array.from(html.matchAll(/data-dot="242" data-level="(\d)"/g), (match) => Number(match[1]))).toEqual([0, 1, 2]);
    expect(html).toMatch(/data-slot="report-median" data-median="242"[^>]*style="left:37\.500%/);
    expect(html).toMatch(/data-slot="report-reject-zone"[^>]*style="left:0;width:12\.500%"/);
    expect(html).toMatch(/data-tick="240" class="[^"]*font-bold text-fail/);
    expect(text(html)).toContain("Median 242 mm");
    expect(html).toContain('data-row="M"');
  });

  it("RangeBand: the band and the range between their edges, the median at its place", () => {
    const axis = { min: 60, max: 120, ticks: [60, 80, 100, 120] };
    const html = renderToStaticMarkup(
      <RangeBand label="Palm width" axis={axis} rows={[{ key: "S", label: "S", band: { from: 70, to: 90 }, range: { min: 83, max: 85 }, median: 84 }, { key: "XL", label: "XL" }]} />,
    );
    expect(html).toMatch(/data-slot="report-band" data-from="70" data-to="90"[^>]*style="left:16\.667%;width:33\.333%"/);
    expect(html).toMatch(/data-slot="report-median" data-median="84"[^>]*style="left:40\.000%"/);
    expect(html).toContain('data-row="XL"');
  });

  it("TrackBar: the track ends at the reject number, filled to the count, red once it reaches it", () => {
    const within = renderToStaticMarkup(<TrackBar found={2} accept={7} reject={8} />);
    expect(text(within)).toBe("2 found · accept ≤ 7");
    expect(within).toMatch(/data-slot="report-reject-zone"[^>]*style="left:87\.500%"/);
    expect(within).toMatch(/data-slot="report-track-fill" class="[^"]*bg-brand-600[^"]*" style="width:25\.000%"/);
    const over = renderToStaticMarkup(<TrackBar found={9} accept={7} reject={8} />);
    expect(over).toContain('data-over="true"');
    expect(over).toContain("bg-fail-solid");
    expect(text(renderToStaticMarkup(<TrackBar found={0} accept={0} />))).toBe("0 found · accept 0");
  });

  it("StackedBar: each part's width its share, a size in its own blue; nothing for nothing", () => {
    const html = renderToStaticMarkup(
      <StackedBar
        label="Order mix"
        segments={[
          { key: "S", label: "S", value: 1, tone: sizeTone("S") },
          { key: "M", label: "M", value: 3, tone: sizeTone("M") },
        ]}
      />,
    );
    expect(html).toMatch(/data-segment="S" data-share="0\.2500" class="[^"]*bg-brand-300[^"]*" style="flex-basis:0;flex-grow:0\.25"/);
    expect(html).toMatch(/data-segment="M" data-share="0\.7500" class="[^"]*bg-brand-500/);
    expect(renderToStaticMarkup(<StackedBar label="Nothing" segments={[]} />)).not.toContain("data-segment");
  });

  it("HBars and GroupedHBars: bars from the axis's start, minimums as dashed red lines, a grade chip", () => {
    const bars = renderToStaticMarkup(
      <HBars label="Weight" axis={{ min: 0, max: 5 }} rows={[{ key: "M", label: "M", value: 3.5, display: "3.5 g" }, { key: "L", label: "L", value: null }]} />,
    );
    expect(bars).toMatch(/data-slot="report-bar" data-value="3.5"[^>]*style="width:70\.000%"/);
    expect(text(bars)).toContain("M 3.5 g");
    const grouped = renderToStaticMarkup(
      <GroupedHBars
        label="Layering and dispensing"
        axis={{ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] }}
        series={[
          { key: "layering", label: "Layering", tone: "brand" },
          { key: "dispensing", label: "Dispensing", tone: "accent" },
        ]}
        minimums={{ layering: 70, dispensing: 80 }}
        rows={[{ key: "S", label: "S", sublabel: "8 boxes", values: { layering: 90, dispensing: 92 }, tag: { text: "A", status: "pass" } }]}
      />,
    );
    expect(grouped).toMatch(/data-series="layering"[^>]*><span[^>]*data-value="90"[^>]*style="width:90\.000%"/);
    expect(grouped.match(/data-slot="report-limit-line"/g)).toHaveLength(2);
    expect(grouped).toMatch(/data-tick="70" class="[^"]*text-fail/);
    expect(text(grouped)).toContain("S 8 boxes");
    expect(grouped).toMatch(/data-slot="report-status-chip" data-status="pass"[^>]*>.*A<\/span>/);
  });

  it("StripPlot: each sampled number at its place along 1 to N", () => {
    const html = renderToStaticMarkup(<StripPlot label="Sampled cartons" rows={[{ key: "XL", label: "XL", sublabel: "3 of 250", marks: [1, 125, 250], total: 250, numbers: "001 125 250" }]} />);
    expect(Array.from(html.matchAll(/data-mark="(\d+)"[^>]*style="left:calc\(1\.5mm \+ \(100% - 3mm\) \* ([\d.]+)\)"/g), ([, mark, at]) => [Number(mark), Number(at)])).toEqual([
      [1, 0],
      [125, 0.498],
      [250, 1],
    ]);
    expect(text(html)).toContain("XL 3 of 250 001 125 250 1–250");
  });

  it("TickMatrix: a tick per check and size, a dash where it does not apply", () => {
    const html = renderToStaticMarkup(
      <TickMatrix columns={["S", "M"]} rows={[{ key: "fab", label: "Force at Break", cells: ["pass", null] }, { key: "dims", label: "Dimensions", cells: ["fail", "pass"] }]} />,
    );
    expect(html).toMatch(/data-cell="pass"[^>]*><span data-slot="report-status-tick" data-status="pass" role="img" aria-label="Force at Break, S: Passed"/);
    expect(html).toContain('data-cell="none"');
    expect(html).toContain("Not applicable");
    expect(html).toMatch(/aria-label="Dimensions, S: Failed"/);
  });

  it("PhotoGrid: each photo with its caption, the lead over two columns", () => {
    const html = renderToStaticMarkup(
      <PhotoGrid
        lead
        photos={[
          { id: "1", url: "https://storage.example.com/1.jpg", caption: "Warehouse" },
          { id: "2", url: "https://storage.example.com/2.jpg", caption: "Pinhole, palm" },
        ]}
      />,
    );
    expect(html).toMatch(/data-photo="1" class="[^"]*col-span-2 row-span-2/);
    expect(html).toContain('<img src="https://storage.example.com/2.jpg" alt="Pinhole, palm"');
    expect(renderToStaticMarkup(<PhotoGrid photos={[]} />)).toBe('<ul data-slot="report-photo-grid" class="grid gap-x-[3mm] gap-y-[2.4mm] grid-cols-4"></ul>');
  });

  it("ReportTable: header groups, right-aligned figures, zebra rows and a totals row", () => {
    const html = renderToStaticMarkup(
      <ReportTable
        zebra
        caption="Order lots"
        groups={[{ span: 1 }, { label: "Order", span: 2 }]}
        columns={[
          { key: "size", label: "Size", strong: true },
          { key: "cases", label: "Cases", numeric: true },
          { key: "gloves", label: "Gloves", numeric: true },
        ]}
        rows={[
          { key: "S", cells: { size: "S", cases: "1,120", gloves: "1,120,000" } },
          { key: "M", cells: { size: "M", cases: "2,081", gloves: "2,081,000" } },
        ]}
        totals={{ size: "Total", cases: "3,201", gloves: "3,201,000" }}
      />,
    );
    expect(html).toMatch(/<th colSpan="2" scope="colgroup" class="[^"]*text-brand-600[^"]*">Order<\/th>/);
    expect(html).toMatch(/<td class="[^"]*text-right[^"]*tabular-nums[^"]*">1,120<\/td>/);
    expect(html).toMatch(/<tr data-row="M" class="bg-slate-50/);
    expect(html).toMatch(/<tr data-row="totals" class="[^"]*bg-brand-50/);
    expect(text(html)).toContain("Total 3,201 3,201,000");
  });

  it("SizeChip and sizeTone: S light blue, M blue, L dark blue, XL navy; other sizes by their place", () => {
    expect(["S", "M", "L", "XL"].map((size) => sizeTone(size).fill)).toEqual(["bg-brand-300", "bg-brand-500", "bg-brand-700", "bg-brand-900"]);
    expect(sizeTone("xs").fill).toBe("bg-brand-200");
    const numeric = ["5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"];
    expect(sizeTone("5.5", numeric).fill).toBe("bg-brand-200");
    expect(sizeTone("9.0", numeric).fill).toBe("bg-brand-900");
    expect(sizeTone("7.25", numeric).fill).toBe("bg-brand-500");
    const chip = renderToStaticMarkup(<SizeChip size="XL" />);
    expect(chip).toMatch(/data-slot="report-size-chip" data-size="XL" class="[^"]*bg-brand-900 text-white[^"]*">XL<\/span>/);
  });
});
