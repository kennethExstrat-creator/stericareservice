// The Report page as server-rendered markup (Kenneth, 27 October 2026): the
// options, one switch per step, read-only, Generate Report and why it
// waits, the last report, and a preview that follows the options.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inspections/ai/actions", () => ({ sendToAiReport: vi.fn() }));

import { GENERATE_REASONS, type GenerateAvailability, type LastReport, type ReportStep } from "@/lib/inspections/capture/report";
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from "@/lib/schemas/report-options";
import { PREVIEW_CAPTION, ReportPage } from "./report-page";

const STEPS: ReportStep[] = [
  { key: "source_documents", title: "Source Documents", shortTitle: "Source Documents", sectionKeys: ["header", "source_documents"] },
  { key: "order_lots", title: "Order Information", shortTitle: "Order", sectionKeys: ["order_lots", "glove_info", "packing_config"] },
  { key: "weight", title: "Weight (g)", shortTitle: "Weight", sectionKeys: ["weight"] },
  { key: "conclusion", title: "Conclusion", shortTitle: "Conclusion", sectionKeys: ["conclusion"] },
];

const ALLOWED: GenerateAvailability = { allowed: true };
const NOT_YET: GenerateAvailability = { allowed: false, reason: GENERATE_REASONS.notYet };

function page({
  options = {},
  readOnly = false,
  generate = NOT_YET,
  lastReport = null,
  tab = true,
}: {
  options?: Partial<ReportOptions>;
  readOnly?: boolean;
  generate?: GenerateAvailability;
  lastReport?: LastReport | null;
  tab?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <ReportPage
      id="panel"
      tabLabelledBy={tab ? "cap-tab-report" : undefined}
      titleRef={() => null}
      inspectionId="00000000-0000-4000-8000-000000000009"
      options={{ ...DEFAULT_REPORT_OPTIONS, ...options }}
      steps={STEPS}
      facts={{ refNo: "INS-2026-0042", clientName: "Client A", inspectorName: "Inspector A" }}
      readOnly={readOnly}
      generate={generate}
      lastReport={lastReport}
      onChange={() => {}}
    />,
  );
}

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** The switch rows of the Sections list: step key, label and whether it is on. */
const sectionSwitches = (html: string) =>
  Array.from(
    html.matchAll(/<li data-step="([a-z_]+)"[^>]*><label[^>]*title="([^"]*)"[^>]*>([^<]+)<\/label><button[^>]*role="switch"[^>]*aria-checked="(true|false)"/g),
    ([, key, title, label, checked]) => ({ key, title, label, on: checked === "true" }),
  );

/** The control is disabled: its own attribute, not a class that styles it so. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

/** The preview's section blocks, in order, by step key. */
const previewSteps = (html: string) => Array.from(html.matchAll(/data-block="section" data-step="([a-z_]+)"/g), (match) => match[1]);

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
    // No result: the Report page is no step.
    expect(html).not.toContain('data-slot="status-pill"');
    // From 1280 px, no tab: a plain block, the cards named by their titles.
    expect(page({ tab: false })).toMatch(/^<div id="panel" data-slot="report-page"/);
  });

  it("offers the one template, with its quiet note, and A4 or Letter", () => {
    const html = page();
    expect(html).toContain(">Report Template</label>");
    expect(html).toMatch(/<button[^>]*role="combobox"[^>]*>(?:(?!<\/button>).)*Standard Preshipment Report/);
    expect(html).toContain("Template design coming soon.");
    expect(html).toMatch(/aria-label="Page Size"/);
    expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*>A4<\/button>/);
    expect(page({ options: { pageSize: "letter" } })).toMatch(/<button[^>]*aria-checked="true"[^>]*>Letter<\/button>/);
  });

  it("gives every step a switch, in step order, by its short name with its full title on hover, on unless switched off", () => {
    expect(sectionSwitches(page())).toEqual(STEPS.map((step) => ({ key: step.key, title: step.title, label: step.shortTitle, on: true })));
    expect(sectionSwitches(page({ options: { omittedSteps: ["weight"] } })).map((row) => [row.key, row.on])).toEqual([
      ["source_documents", true],
      ["order_lots", true],
      ["weight", false],
      ["conclusion", true],
    ]);
  });

  it("labels the photo, cover, content and footer options in Title Case, the footer note counted", () => {
    const html = page({ options: { title: "Lot Release Report", footerNote: "Confidential." } });
    for (const label of ["Photos", "Cover and Header", "Content"]) expect(html).toMatch(new RegExp(`<legend[^>]*>${label}</legend>`));
    for (const label of ["Include Photos", "Report Title", "Show Client Name", "Include Inspection Summary", "Include Inspector Signature", "Footer Note (Optional)"]) {
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).toMatch(/aria-label="Photos per Step"/);
    expect(html).toMatch(/aria-label="Photo Size"/);
    expect(html).toMatch(/<input[^>]*value="Lot Release Report"/);
    expect(html).toMatch(/placeholder="Pre-Shipment Inspection Report"/);
    expect(html).toMatch(/<textarea[^>]*maxLength="300"[^>]*>Confidential\.<\/textarea>/);
    expect(html).toContain(">13 / 300</p>");
  });

  it("gives every element an id of its own, and each label names a control that is there", () => {
    const html = page({ lastReport: { url: "https://reports.example.com/r.pdf", madeAt: null } });
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    const targets = Array.from(html.matchAll(/<label[^>]*\sfor="([^"]+)"/g), (match) => match[1]);
    expect(targets.length).toBeGreaterThan(STEPS.length);
    for (const target of targets) expect(html).toMatch(new RegExp(`<(input|textarea|button)[^>]*\\sid="${target}"`));
  });

  it("greys out the photo choices while photos are off", () => {
    const on = page();
    const off = page({ options: { includePhotos: false } });
    const disabledPills = (html: string) => tagsWith(html, 'role="radio"').filter(isDisabled).length;
    expect(disabledPills(on)).toBe(0);
    // 2, 4, 6 and Small, Medium, Large; A4 and Letter stay.
    expect(disabledPills(off)).toBe(6);
  });

  it("shows the options as saved and takes no change while the inspection is read-only", () => {
    const html = page({ readOnly: true, options: { omittedSteps: ["weight"] } });
    expect(html).toContain("The options saved with this inspection.");
    const switches = tagsWith(html, 'role="switch"');
    expect(switches.length).toBe(STEPS.length + 4);
    expect(switches.every(isDisabled)).toBe(true);
    expect(tagsWith(html, 'role="radio"').every(isDisabled)).toBe(true);
    expect(tagsWith(html, 'role="combobox"').every(isDisabled)).toBe(true);
    expect(html).toMatch(/<input[^>]*readOnly=""/);
    expect(html).toMatch(/<textarea[^>]*readOnly=""/);
    // Editable, nothing is disabled but what photos off greys out.
    expect(tagsWith(page(), 'role="switch"').some(isDisabled)).toBe(false);
    expect(tagsWith(page(), 'role="combobox"').some(isDisabled)).toBe(false);
  });
});

describe("Generate Report", () => {
  const generateButton = (html: string) => /<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*<\/button>/.exec(html)?.[0] ?? "";

  it("waits, disabled, with why under it, until an admin may send a submitted inspection", () => {
    const html = page({ generate: NOT_YET });
    const button = generateButton(html);
    expect(button).toContain("Generate Report");
    expect(isDisabled(button)).toBe(true);
    const describedBy = /aria-describedby="([^"]+)"/.exec(button)?.[1];
    expect(html).toContain(`<p id="${describedBy}" data-slot="generate-reason"`);
    expect(html).toContain("Available to admins once the inspection is submitted.");
    const notSetUp = page({ generate: { allowed: false, reason: GENERATE_REASONS.notSetUp } });
    expect(notSetUp).toContain("The report service is not set up yet.");
    expect(isDisabled(generateButton(notSetUp))).toBe(true);
  });

  it("is the primary action, ready, for an admin on a submitted inspection with the report service set up", () => {
    const html = page({ generate: ALLOWED });
    const button = generateButton(html);
    expect(button).toContain("Generate Report");
    expect(isDisabled(button)).toBe(false);
    expect(button).not.toContain("aria-describedby");
    expect(button).toContain('data-variant="default"');
    expect(html).not.toContain('data-slot="generate-reason"');
    expect(html).toContain('<input type="hidden" name="inspectionId" value="00000000-0000-4000-8000-000000000009"/>');
  });

  it("opens the last report in a new tab, with when it was made where that is known", () => {
    const made = page({
      lastReport: { url: "https://reports.example.com/INS-2026-0042.pdf", madeAt: { iso: "2026-10-27T06:05:00.000Z", label: "27 Oct 2026, 14:05" } },
    });
    expect(made).toMatch(/<a href="https:\/\/reports\.example\.com\/INS-2026-0042\.pdf" target="_blank" rel="noreferrer"[^>]*>(?:(?!<\/a>).)*Open Last Report/);
    expect(made).toContain("(opens in a new tab)");
    expect(made).toContain('Made <time dateTime="2026-10-27T06:05:00.000Z">27 Oct 2026, 14:05</time>');
    const linkOnly = page({ lastReport: { url: "https://reports.example.com/r.pdf", madeAt: null } });
    expect(linkOnly).toContain("Open Last Report");
    expect(linkOnly).not.toContain("Made ");
    expect(page()).not.toContain("Open Last Report");
  });
});

describe("the preview", () => {
  it("draws the pages at the paper's ratio, white on the screen's ground, with its caption", () => {
    const a4 = page();
    expect(a4).toMatch(/data-page-size="a4"[^>]*style="aspect-ratio:210 \/ 297;--mm:calc\(100cqw \/ 210\)"/);
    expect(a4).toMatch(/data-page-size="a4"[^>]*class="[^"]*bg-white/);
    expect(a4).toMatch(/ pages · A4<\/p>/);
    const letter = page({ options: { pageSize: "letter" } });
    expect(letter).toMatch(/data-page-size="letter"[^>]*style="aspect-ratio:215.9 \/ 279.4;--mm:calc\(100cqw \/ 215.9\)"/);
    expect(letter).toMatch(/ pages · Letter<\/p>/);
    expect(a4).toContain(PREVIEW_CAPTION);
    expect(PREVIEW_CAPTION).toBe("Layout preview. The report design will follow.");
  });

  it("names the inspection: the title, the client while shown, the reference number, the steps by their short names", () => {
    const html = page();
    expect(html).toContain(">Pre-Shipment Inspection Report</p>");
    expect(html).toContain('data-slot="report-client" class="truncate text-slate-700"');
    expect(html).toContain(">Client A</p>");
    expect(html).toContain(">INS-2026-0042</");
    expect(previewSteps(html)).toEqual(STEPS.map((step) => step.key));
    expect(html).toMatch(/data-step="order_lots"(?:(?!data-block).)*title="Order Information"(?:(?!data-block).)*>Order<\/span>/);
    expect(page({ options: { showClientName: false } })).not.toContain('data-slot="report-client"');
  });

  it("follows the options: steps switched off, the photo count and size, the summary, the signature and the footer note", () => {
    expect(previewSteps(page({ options: { omittedSteps: ["order_lots", "weight"] } }))).toEqual(["source_documents", "conclusion"]);
    const photos = (html: string) =>
      Array.from(html.matchAll(/data-block="photos" data-step="([a-z_]+)" data-count="(\d+)" data-size="([a-z]+)"/g), ([, key, count, size]) => ({ key, count: Number(count), size }));
    const total = (html: string, key: string) => photos(html).filter((grid) => grid.key === key).reduce((sum, grid) => sum + grid.count, 0);
    for (const photosPerStep of [2, 4, 6] as const) {
      const html = page({ options: { photosPerStep, photoSize: "small" } });
      for (const step of STEPS) expect(total(html, step.key)).toBe(photosPerStep);
      expect(photos(html).every((grid) => grid.size === "small")).toBe(true);
    }
    expect(page({ options: { includePhotos: false } })).not.toContain('data-block="photos"');
    // Read out by step and count: four small photos are one row, never split over two pages.
    expect(page({ options: { photoSize: "small" } })).toContain('aria-label="Weight: 4 photos"');
    expect(page()).toContain('data-block="summary"');
    expect(page({ options: { includeSummary: false } })).not.toContain('data-block="summary"');
    expect(page()).toMatch(/data-block="signature"(?:(?!data-block).)*>Inspector A<\/p>/);
    expect(page({ options: { includeSignature: false } })).not.toContain('data-block="signature"');
    expect(page({ options: { footerNote: " For Client A only. " } })).toContain('data-slot="report-footer-note" class="min-w-0 truncate">For Client A only.</span>');
  });

  it("counts its pages, each numbered in its footer", () => {
    const html = page();
    const pages = tagsWith(html, "data-page=").filter((tag) => tag.startsWith("<li"));
    expect(pages.length).toBeGreaterThan(1);
    expect(html).toContain(`>${pages.length} pages · A4</p>`);
    for (const number of pages.map((_, index) => index + 1)) expect(html).toContain(`>Page ${number} of ${pages.length}</span>`);
    expect(page({ options: { includePhotos: false, omittedSteps: ["order_lots", "weight", "conclusion"] } })).toContain(">1 page · A4</p>");
  });
});
