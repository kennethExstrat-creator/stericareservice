// The conclusion's HOLD on the capture screen reads as the review and the
// final result read it: On Hold with the pause glyph, on the section's tab,
// its pill and its row in the sidebar, and it counts as done, while the
// module records a warning (lib/inspections/capture/sections.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressTracker } from "@/components/qc";
import { filledData, TEST_META, TEST_REGISTRY, testTemplate } from "@/lib/inspections/capture/__fixtures__/capture";
import { evaluateCapture } from "@/lib/inspections/capture/evaluate";
import { capturePages, captureSections, findSection, isIncluded, progressSteps } from "@/lib/inspections/capture/sections";
import { SectionFrame } from "./section-frame";
import { SectionList } from "./section-list";
import { SectionTabs } from "./section-tabs";

const noop = () => {};

/** ResultChip's pause glyph. */
const PAUSE = 'd="M8 6.75v6.5m4-6.5v6.5"';

/** The capture fixture with the inspector's final result HOLD. */
function holdSections() {
  const filled = filledData();
  const data = { ...filled, modules: { ...filled.modules, conclusion: { finalResult: "hold", remark: null } } };
  const { template, report } = evaluateCapture({ template: testTemplate(), overrides: {}, data, meta: TEST_META }, TEST_REGISTRY);
  return captureSections(template, report, data);
}

/** The first `tag` whose opening tag carries `attribute`, to its closing tag (none of the same tag inside). */
function element(html: string, tag: string, attribute: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*${attribute}[^>]*>[\\s\\S]*?</${tag}>`).exec(html);
  if (!match) throw new Error(`No <${tag}> with ${attribute}`);
  return match[0];
}

describe("the conclusion's HOLD on the capture screen", () => {
  const sections = holdSections();
  const pages = capturePages(sections);
  const conclusion = findSection(sections, "conclusion");
  if (!conclusion || !isIncluded(conclusion)) throw new Error("The fixture has a conclusion.");

  it("reads On Hold with the pause glyph on the section's tab, never Warning", () => {
    const html = renderToStaticMarkup(
      <SectionTabs pages={pages} activeKey="conclusion" onSelect={noop} panelId="panel" idPrefix="cap" />,
    );
    const tab = element(html, "button", 'data-section="conclusion"');
    expect(tab).toContain('data-status="hold"');
    expect(tab).toContain(PAUSE);
    expect(tab).toContain('<span class="sr-only">On Hold</span>');
    expect(tab).not.toContain("Warning");
  });

  it("reads On Hold with the pause icon on the section's pill", () => {
    const html = renderToStaticMarkup(
      <SectionFrame id="panel" title={conclusion.title} status={conclusion.status} summary={conclusion.summary}>
        <p>Body</p>
      </SectionFrame>,
    );
    const pill = element(html, "span", 'data-slot="status-pill"');
    expect(pill).toContain('data-status="hold"');
    expect(pill).toContain("lucide-circle-pause");
    expect(pill).toContain("<span>On Hold</span>");
    expect(html).not.toContain("Warning");
  });

  it("is done and on hold in the desktop sidebar, and done on the iPad's progress bar", () => {
    const list = renderToStaticMarkup(<SectionList pages={pages} activeKey="conclusion" onSelect={noop} />);
    const row = element(list, "button", 'title="Conclusion"');
    expect(row).toContain('<span class="sr-only">, Done</span>');
    expect(row).toContain('data-status="hold"');
    expect(row).toContain(PAUSE);

    const steps = progressSteps(pages);
    const bar = renderToStaticMarkup(<ProgressTracker steps={steps} activeKey="conclusion" />);
    expect(bar).toContain("Conclusion: Done");
    const done = steps.filter((step) => step.state === "done").length;
    expect(bar).toContain(`${done} of ${steps.length} done`);
  });
});

describe("step names on the capture screen (docs/DESIGN.md, Step Names)", () => {
  // The test registry's titles: "Manufacturer Information", "Packing configuration" (on the order's page), "Weight (g)".
  const filled = filledData();
  const { template, report } = evaluateCapture({ template: testTemplate(), overrides: {}, data: filled, meta: TEST_META }, TEST_REGISTRY);
  const pages = capturePages(captureSections(template, report, filled));

  it("names each tab by its short name, with the template's title on hover", () => {
    const html = renderToStaticMarkup(<SectionTabs pages={pages} activeKey="weight" onSelect={noop} panelId="panel" idPrefix="cap" />);
    const header = element(html, "button", 'data-section="header"');
    expect(header).toContain('title="Manufacturer Information"');
    expect(header).toContain(">Manufacturer</span>");
    const weight = element(html, "button", 'data-section="weight"');
    expect(weight).toContain('title="Weight (g)"');
    expect(weight).toContain(">Weight</span>");
  });

  it("names each sidebar row by its short name, with the template's title on hover and its key for specs", () => {
    const html = renderToStaticMarkup(<SectionList pages={pages} activeKey="weight" onSelect={noop} />);
    const header = element(html, "button", 'data-step="header"');
    expect(header).toContain('title="Manufacturer Information"');
    expect(header).toContain(">Manufacturer</span>");
    expect(element(html, "button", 'data-step="weight"')).toContain(">Weight</span>");
  });

  it("names the step in view above the progress bar by its short name, with its title on hover", () => {
    const html = renderToStaticMarkup(<ProgressTracker steps={progressSteps(pages)} activeKey="weight" />);
    expect(html).toMatch(/title="Weight \(g\)">Weight<\/span>/);
    expect(html).toContain("Manufacturer: Done");
  });
});
