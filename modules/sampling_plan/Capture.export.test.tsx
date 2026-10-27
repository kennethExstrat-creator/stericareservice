// Export Sampling Plan on the Sampling Plan's card (Kenneth, 27 October
// 2026: "sampling plan should be can be exported once the sampling plan
// section is done"), server-rendered: disabled until the step is Done, with
// why as its title; once Done, a link that opens the plan for the
// manufacturer in a new tab, on a draft and read-only alike; none where the
// screen gives no links. The click itself (save first, then the tab) is the
// browser's: checked there by the integrator.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { samplingPlanPrintPath } from "@/lib/sampling-plan/paths";
import { buildInspectionContext, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { InspectionLinksProvider, type InspectionLinks } from "@/modules/_framework/inspection-links";
import { makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData } from "./__fixtures__/examples";
import type { SamplingPlanComputed } from "./calc";
import Capture, { EXPORT_NOT_READY } from "./Capture";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingPlanConfig } from "./config";
import { withCount, type SamplingPlanData } from "./schema";

const CONFIG: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "I" };
const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const LINKS: InspectionLinks = { samplingPlanPrint: samplingPlanPrintPath(INSPECTION), saveFirst: async () => undefined };
const noop = () => {};

function props(data: InspectionData) {
  const template = makeTestTemplate(ENGINE_REGISTRY, ["order_lots", "packing_config", { key: "sampling_plan", config: CONFIG, labels: SAMPLING_PLAN_LABELS }]);
  const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
  const found = evaluateInspection({ template, data, context }, ENGINE_REGISTRY).modules.find((entry) => entry.key === "sampling_plan");
  if (!found) throw new Error("sampling_plan was not evaluated");
  return {
    data: data.modules.sampling_plan as SamplingPlanData,
    config: CONFIG,
    title: "Sampling Plan",
    labels: SAMPLING_PLAN_LABELS,
    context,
    evaluation: { ...found, computed: found.computed as SamplingPlanComputed },
    focusPath: null,
    readOnly: false,
    onChange: noop,
  };
}

/** The STD_EG example's plan, complete: the step is Done. */
const done = () => exampleData(STD_EG_EXAMPLE);

/** The same plan with size M's # of Gloves Sample emptied: the step is not done. */
function notDone(): InspectionData {
  const data = done();
  return { ...data, modules: { ...data.modules, sampling_plan: withCount(data.modules.sampling_plan as SamplingPlanData, "M", "gloves", null) } };
}

function render(data: InspectionData, { readOnly = false, links = LINKS as InspectionLinks | null } = {}) {
  return renderToStaticMarkup(
    <InspectionLinksProvider value={links}>
      <Capture {...props(data)} readOnly={readOnly} />
    </InspectionLinksProvider>,
  );
}

/** Export Sampling Plan's element, whole. */
const exportControl = (html: string) => /<(a|button)\b[^>]*data-slot="export-sampling-plan"[^>]*>[\s\S]*?<\/\1>/.exec(html)?.[0] ?? "";

describe("Export Sampling Plan", () => {
  it("is a step that is Done and one that is not, as the fixtures say", () => {
    expect(props(done()).evaluation.result.status).toBe("info");
    expect(props(notDone()).evaluation.result.status).toBe("not_done");
  });

  it("opens the plan for the manufacturer in a new tab once the step is Done, after Sampling Settings, as tall as it (44 px on touch)", () => {
    const html = render(done());
    const control = exportControl(html);
    expect(control).toMatch(/^<a\b/);
    expect(control).toContain(`href="/inspections/${INSPECTION}/sampling-plan/print"`);
    expect(control).toContain('target="_blank"');
    expect(control).toContain('rel="noopener"');
    expect(control).toContain('data-variant="outline"');
    expect(control).toContain('data-size="sm"');
    expect(control).toMatch(/\bh-8\b[^"]*\btouch:h-11\b/);
    expect(control).toContain("lucide-file-down");
    expect(control).toContain("Export Sampling Plan");
    expect(control).toContain('<span class="sr-only"> (opens in a new tab)</span>');
    // The attribute, not the `disabled:` classes every button has.
    expect(control).not.toMatch(/\sdisabled(=""|\s|>)/);
    // Beside Auto Calculate Sampling and Sampling Settings, after both.
    expect(html.indexOf("Auto Calculate Sampling")).toBeLessThan(html.indexOf('aria-label="Sampling Settings"'));
    expect(html.indexOf('aria-label="Sampling Settings"')).toBeLessThan(html.indexOf('data-slot="export-sampling-plan"'));
  });

  it("waits, disabled with why as its title, until the step is Done", () => {
    const control = exportControl(render(notDone()));
    expect(control).toMatch(/^<button\b/);
    expect(control).toMatch(/\sdisabled=""/);
    expect(control).toContain(`title="${EXPORT_NOT_READY}"`);
    expect(EXPORT_NOT_READY).toBe("Complete the Sampling Plan first");
    expect(control).not.toContain("href=");
    expect(control).toContain("Export Sampling Plan");
  });

  it("works on a read-only inspection too, where Auto Calculate Sampling is gone", () => {
    const html = render(done(), { readOnly: true });
    expect(html).not.toContain("Auto Calculate Sampling");
    expect(exportControl(html)).toContain(`href="/inspections/${INSPECTION}/sampling-plan/print"`);
    expect(exportControl(render(notDone(), { readOnly: true }))).toMatch(/^<button\b[^>]*\sdisabled=""/);
  });

  it("does not show where the screen gives no links (the design page, a preview)", () => {
    expect(render(done(), { links: null })).not.toContain("export-sampling-plan");
    expect(renderToStaticMarkup(<Capture {...props(done())} />)).not.toContain("Export Sampling Plan");
  });
});
