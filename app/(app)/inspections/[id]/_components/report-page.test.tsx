// The Report page as server-rendered markup (Kenneth, 27 October 2026): the
// options in the report's structure (General, the content tree with a switch
// per section and its blocks, the photo records), a section the inspection
// cannot show greyed with why, read-only, the report's own pages in the
// preview, and Download PDF to the print route, its only action.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluateRecord } from "@/lib/export/evaluate";
import { STD_EG_IDS, stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import type { InspectionStatus } from "@/lib/schemas/common";
import { DEFAULT_REPORT_OPTIONS, REPORT_SECTIONS, type ReportOptions } from "@/lib/schemas/report-options";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { DOWNLOAD_NOT_ALLOWED, PREVIEW_CAPTION, ReportPage, type ReportSource } from "./report-page";
import { stepZoom, ZOOM_STEPS } from "./report-pages-preview";

/** The STD_EG example as the capture screen holds it: its evaluation, data and meta. */
function source({ status = "submitted", without = [] }: { status?: InspectionStatus; without?: string[] } = {}): ReportSource {
  const record = stdEgRecord();
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok || !record.template) throw new Error("The STD_EG fixture does not evaluate.");
  const { template, context, report, data, inspector, client, manufacturer } = evaluation.evaluated;
  return {
    inspectionId: record.id,
    refNo: record.refNo,
    status,
    inspectionDate: record.inspectionDate,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    result: record.result,
    template: { code: "STD_EG", version: 1, standard: "EN455", productType: "examination", resolved: record.template.resolved as ResolvedTemplate },
    evaluation: { template, context, report: { ...report, modules: report.modules.filter((module) => !without.includes(module.key)) } },
    data,
    // The screen names the manufacturer by its label, as the export does.
    meta: { refNo: record.refNo, inspectionDate: record.inspectionDate, inspector, client, manufacturer },
    manufacturerLabel: manufacturer?.name ?? null,
  };
}

function page({
  options = {},
  readOnly = false,
  canDownload = true,
  status,
  without,
  tab = true,
}: {
  options?: Partial<ReportOptions>;
  readOnly?: boolean;
  canDownload?: boolean;
  status?: InspectionStatus;
  without?: string[];
  tab?: boolean;
} = {}) {
  const chosen = { ...DEFAULT_REPORT_OPTIONS, ...options };
  const base = source({ status, without });
  return renderToStaticMarkup(
    <ReportPage
      id="panel"
      tabLabelledBy={tab ? "cap-tab-report" : undefined}
      titleRef={() => null}
      inspectionId={STD_EG_IDS.inspection}
      options={chosen}
      // The page's options are the screen's copy's: the preview follows them.
      source={{ ...base, data: { ...base.data, report: chosen } }}
      readOnly={readOnly}
      download={{ allowed: canDownload, saveFirst: async () => undefined }}
      onChange={() => {}}
    />,
    // React hints the logo's preload ahead of the markup; a page's head takes it.
  ).replace(/^(?:<link [^>]*\/>)+/, "");
}

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** The control is disabled: its own attribute, not a class that styles it so. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

/** The content tree's rows: key, name, whether its switch is on and disabled, its note. */
const treeRows = (html: string) =>
  Array.from(
    html.matchAll(/<li data-section="([a-zA-Z]+)"(?: data-available="false")?><div[^>]*>(?:(?!<\/div><\/li>|<ul).)*?<(?:label|p)[^>]*>([^<]+)<\/(?:label|p)>(?:<p[^>]*>([^<]+)<\/p>)?<\/div>(?:<button[^>]*role="switch"[^>]*aria-checked="(true|false)"([^>]*)>)?/g),
    ([, key, name, note, checked, rest]) => ({
      key,
      name: name.replaceAll("&amp;", "&"),
      note: note ?? null,
      on: checked === undefined ? null : checked === "true",
      disabled: rest ? /disabled=""/.test(rest) : null,
    }),
  );

const pagesOf = (html: string) => html.split("<section data-report-page").slice(1);

describe("the Report page", () => {
  it("is the open tab's panel, the options card titled Report beside the preview", () => {
    const html = page();
    expect(html).toMatch(/^<div id="panel" role="tabpanel" aria-labelledby="cap-tab-report" data-slot="report-page" data-section-key="report"/);
    expect(html).toMatch(/<h2[^>]*>Report<\/h2>/);
    expect(html).toContain("Choose what the report shows. Saved with this inspection.");
    expect(html).toMatch(/<h2[^>]*>Preview<\/h2>/);
    // Two panes on a desktop and once the page is 56rem wide; stacked, options first, on a narrower touchscreen.
    expect(html).toContain("xl:grid-cols-[22rem_minmax(0,1fr)] @min-[56rem]:grid-cols-[22rem_minmax(0,1fr)]");
    expect(html).toMatch(/data-slot="report-preview" class="[^"]*xl:sticky[^"]*@min-\[56rem\]:sticky/);
    expect(html.indexOf('data-slot="report-options"')).toBeLessThan(html.indexOf('data-slot="report-preview"'));
    expect(page({ tab: false })).toMatch(/^<div id="panel" data-slot="report-page"/);
  });

  it("groups the options as the report is made: General, Report Content, Photo Records", () => {
    const html = page({ options: { title: "Lot Release Report", footerNote: "Confidential." } });
    for (const legend of ["General", "Report Content", "Photo Records"]) expect(html).toMatch(new RegExp(`<legend[^>]*>${legend}</legend>`));
    for (const label of ["Report Template", "Report Title", "Show Client", "Footer Note (Optional)"]) expect(html).toContain(`>${label}</label>`);
    expect(html).toMatch(/<button[^>]*role="combobox"[^>]*>(?:(?!<\/button>).)*Standard Preshipment Report/);
    expect(html).not.toContain("Template design coming soon.");
    expect(html).toMatch(/aria-label="Page Size"/);
    expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*>A4<\/button>/);
    expect(html).toMatch(/<input[^>]*value="Lot Release Report"/);
    expect(html).toMatch(/placeholder="Pre-Shipment Inspection Report"/);
    expect(html).toMatch(/<textarea[^>]*maxLength="300"[^>]*>Confidential\.<\/textarea>/);
    expect(html).toContain(">13 / 300</p>");
  });

  it("lists the report's content as a tree: the Summary always in, then each section with its switch, in print order", () => {
    const rows = treeRows(page());
    expect(rows.map((row) => [row.key, row.name])).toEqual([
      ["summary", "Summary"],
      ["orderSampling", "Order, Product & Sampling"],
      ["dimensions", "Dimensions & Weight"],
      ["measurements", "Measurements by Glove"],
      ["forceAtBreak", "Force at Break"],
      ["holesVisual", "Freedom from Holes & Visual Inspection"],
      ["packing", "Glove Packing & Dispensing"],
      ["labellingConclusion", "Packaging Labelling & Conclusion"],
    ]);
    expect(rows[0]).toMatchObject({ note: "Always included", on: null });
    expect(rows.slice(1).every((row) => row.on === true && row.disabled === false)).toBe(true);
    const off = treeRows(page({ options: { sections: { ...DEFAULT_REPORT_OPTIONS.sections, packing: { ...DEFAULT_REPORT_OPTIONS.sections.packing, include: false } } } }));
    expect(off.find((row) => row.key === "packing")?.on).toBe(false);
  });

  it("opens each row to its blocks' switches, closed at first, greyed while the section is off", () => {
    const html = page();
    const chevron = /<button type="button" aria-expanded="false" aria-controls="panel-options-parts-dimensions"[^>]*>(?:(?!<\/button>).)*Parts of Dimensions &amp; Weight/.exec(html);
    expect(chevron).not.toBeNull();
    expect(html).toMatch(/<ul id="panel-options-parts-dimensions" hidden="" data-slot="report-blocks"/);
    const blocks = (markup: string, key: string) =>
      Array.from(new RegExp(`<ul id="panel-options-parts-${key}"[^>]*>(.*?)</ul>`).exec(markup)?.[1].matchAll(/data-block="([a-zA-Z]+)"(?:(?!<\/li>).)*aria-checked="(true|false)"([^>]*)>/g) ?? [], ([, block, checked, rest]) => [
        block,
        checked === "true",
        /disabled=""/.test(rest),
      ]);
    expect(blocks(html, "dimensions")).toEqual([
      ["gloveLength", true, false],
      ["palmWidth", true, false],
      ["medianResults", true, false],
      ["weightPerGlove", true, false],
    ]);
    expect(blocks(html, "summary").map(([block]) => block)).toEqual(["orderMix", "inspectionSummary", "resultsByCheck"]);
    // Measurements by Glove has no blocks: nothing to open.
    expect(html).not.toContain("panel-options-parts-measurements");
    const sectionOff = page({ options: { sections: { ...DEFAULT_REPORT_OPTIONS.sections, dimensions: { ...DEFAULT_REPORT_OPTIONS.sections.dimensions, include: false } } } });
    expect(blocks(sectionOff, "dimensions").every(([, , disabled]) => disabled)).toBe(true);
  });

  it("greys out a section the inspection cannot show, with why, and leaves it out of the report", () => {
    const html = page({ without: ["force_at_break"] });
    const row = treeRows(html).find((entry) => entry.key === "forceAtBreak");
    expect(row).toMatchObject({ note: "Not in this inspection", on: false, disabled: true });
    expect(html).toContain('<li data-section="forceAtBreak" data-available="false">');
    expect(html).not.toContain("panel-options-parts-forceAtBreak");
  });

  it("offers the three photo records and Photos per Group, greyed while every record is off", () => {
    const html = page();
    expect(Array.from(html.matchAll(/<li data-group="([a-zA-Z]+)"/g), (match) => match[1])).toEqual(["samplingPackaging", "packingVisualAgeing", "watertightLaboratory"]);
    expect(html).toMatch(/aria-label="Photos per Group"/);
    expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*>8<\/button>/);
    const none = page({ options: { photos: { perGroup: 8, groups: { samplingPackaging: false, packingVisualAgeing: false, watertightLaboratory: false } } } });
    expect(tagsWith(none, 'role="radio"').filter(isDisabled)).toHaveLength(3);
  });

  it("gives every element an id of its own, and each label names a control that is there", () => {
    const html = page();
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    const targets = Array.from(html.matchAll(/<label[^>]*\sfor="([^"]+)"/g), (match) => match[1]);
    expect(targets.length).toBeGreaterThan(REPORT_SECTIONS.length);
    for (const target of targets) expect(html).toMatch(new RegExp(`<(input|textarea|button)[^>]*\\sid="${target}"`));
  });

  it("shows the options as saved and takes no change while the inspection is read-only", () => {
    const html = page({ readOnly: true });
    expect(html).toContain("The options saved with this inspection.");
    expect(tagsWith(html, 'role="switch"').every(isDisabled)).toBe(true);
    expect(tagsWith(html, 'role="radio"').every(isDisabled)).toBe(true);
    expect(tagsWith(html, 'role="combobox"').every(isDisabled)).toBe(true);
    expect(html).toMatch(/<input[^>]*readOnly=""/);
    expect(html).toMatch(/<textarea[^>]*readOnly=""/);
    expect(tagsWith(page(), 'role="switch"').some(isDisabled)).toBe(false);
  });
});

describe("the preview: the report's own pages", () => {
  it("draws every page of the report in the new design, numbered, with the count and the paper", () => {
    const html = page();
    const pages = pagesOf(html);
    // The Summary and seven sections, Section 08 on two pages (its matrix holds the packing check's aged sample);
    // the photo records come with the photos the screen loads.
    expect(pages.length).toBe(9);
    expect(html).toMatch(/data-slot="report-page-count"[^>]*>9 pages · A4<\/p>/);
    pages.forEach((markup, index) => expect(markup).toContain(`Page ${index + 1} of 9</p>`));
    expect(pages[0]).toContain('data-slot="report-conclusion" data-status="pass"');
    expect(pages[2]).toContain("Dimensions &amp; Weight");
    expect(html).not.toContain("nothing entered yet");
    expect(html).toContain(PREVIEW_CAPTION);
  });

  it("follows the options at once: the paper, a section switched off, the title", () => {
    const html = page({
      options: {
        pageSize: "letter",
        title: "Lot Release Report",
        sections: { ...DEFAULT_REPORT_OPTIONS.sections, measurements: { include: false, blocks: {} } },
      },
    });
    // Measurements out, and Section 08 on two pages: Letter is shorter than A4.
    expect(pagesOf(html)).toHaveLength(8);
    expect(html).toContain("w-[215.9mm] h-[279.4mm]");
    expect(html).toMatch(/data-slot="report-page-count"[^>]*>8 pages · Letter<\/p>/);
    expect(html).toMatch(/data-slot="report-band-title"[^>]*>Lot Release Report<\/span>/);
    // Its switch keeps its label in the settings; no page of the preview is headed by it.
    expect(html).toMatch(/data-slot="report-section-heading"[^>]*>(?:(?!<\/header>)[\s\S])*Dimensions &amp; Weight/);
    expect(html).not.toMatch(/data-slot="report-section-heading"[^>]*>(?:(?!<\/header>)[\s\S])*Measurements by Glove/);
  });

  it("tags every page Draft until the inspection is approved", () => {
    expect(pagesOf(page()).every((markup) => markup.includes('data-slot="report-draft-tag"'))).toBe(true);
    expect(page({ status: "approved" })).not.toContain('data-slot="report-draft-tag"');
  });

  it("zooms the pages to the preview's width, from half size until measured", () => {
    // As wide as a page and centred by its margins, so a zoom past the width scrolls right rather than cutting the left off.
    expect(page()).toMatch(/data-slot="report-preview-pages" class="w-full"><div data-zoom="0.500" style="zoom:0.5" class="mx-auto w-max">/);
  });
});

describe("Download PDF", () => {
  const link = (html: string) => /<a[^>]*data-slot="report-download"[^>]*>(?:(?!<\/a>).)*<\/a>/.exec(html)?.[0] ?? "";

  it("is the primary action: the print route in a new tab, its dialog opening by itself", () => {
    const anchor = link(page());
    expect(anchor).toContain(`href="/inspections/${STD_EG_IDS.inspection}/report/print?print=1"`);
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain("Download PDF");
    expect(anchor).toContain("(opens in a new tab)");
    expect(anchor).toContain('data-variant="default"');
  });

  it("waits, disabled, with why, for whoever may not export the inspection", () => {
    const html = page({ canDownload: false });
    expect(link(html)).toBe("");
    const button = tagsWith(html, 'data-slot="report-download"');
    expect(button).toHaveLength(1);
    expect(button[0]).toMatch(/^<button /);
    expect(isDisabled(button[0])).toBe(true);
    expect(html).toContain(DOWNLOAD_NOT_ALLOWED.replaceAll("'", "&#x27;"));
  });

  // Kenneth, 27 October 2026: "no need Steri-AI report, because we already have Client Report".
  it("is the page's only action: no Send to Steri-AI Report, no Open Last Report", () => {
    for (const html of [page(), page({ status: "approved" }), page({ readOnly: true })]) {
      expect(html).not.toContain("Steri-AI Report");
      expect(html).not.toContain("Open Last Report");
      expect(html).not.toContain('data-slot="report-send-ai"');
      expect(html).not.toMatch(/<form[\s>]/);
      expect(tagsWith(html, 'data-slot="report-download"')).toHaveLength(1);
    }
  });
});

describe("the preview's zoom (Kenneth, 27 October 2026: \"give a + and - to zoom in and out the report in the preview section\")", () => {
  it("steps in and out through the zooms from wherever it is, the fitted zoom too, stopping at either end", () => {
    expect(stepZoom(0.5, 1)).toBe(0.67);
    // From a column-fitted 62%: the next step either way.
    expect(stepZoom(0.62, 1)).toBe(0.67);
    expect(stepZoom(0.62, -1)).toBe(0.5);
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.25, -1)).toBe(1);
    expect(stepZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1], 1)).toBe(2);
    expect(stepZoom(ZOOM_STEPS[0], -1)).toBe(0.5);
  });

  it("shows Zoom Out, the zoom and Zoom In beside the page count, fitted to the width until + or - is pressed", () => {
    const html = page();
    expect(tagsWith(html, 'data-slot="report-zoom"')).toHaveLength(1);
    // Half size until the column is measured: the smallest step, so only Zoom In goes anywhere.
    expect(tagsWith(html, 'aria-label="Zoom Out"').every(isDisabled)).toBe(true);
    expect(tagsWith(html, 'aria-label="Zoom In"').some(isDisabled)).toBe(false);
    // Fitted at first: the percentage has nothing to put back.
    expect(tagsWith(html, 'aria-label="Zoom 50%, fitted to the width"').every(isDisabled)).toBe(true);
    expect(html).toMatch(/>50%<\/button>/);
  });
});
