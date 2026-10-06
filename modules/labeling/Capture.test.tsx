// Server-rendered markup of the labelling capture: what the inspector sees for
// the data and the template, from a real evaluation. Pointer, key and swipe
// handling belong to the kit (docs/CAPTURE_KIT.md); the edits are in edit.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides, moduleConfig } from "@/lib/coverage";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import Capture from "./Capture";
import type { LabelingComputed } from "./calc";
import { LABELING_DEFAULT_CONFIG, LABELING_LABELS, LabelingConfigSchema, type LabelingConfig } from "./config";
import type { LabelingData } from "./schema";

const noop = () => {};
const SAFEDON_CONFIG = LabelingConfigSchema.parse(moduleConfig("SAFEDON_EG", "labeling"));
const SAFEDON_LABELS = { ...LABELING_LABELS, ...labelOverrides("SAFEDON_EG", "labeling") };

type Options = {
  config?: LabelingConfig;
  labels?: Readonly<Record<string, string>>;
  context?: InspectionContext;
  readOnly?: boolean;
};

function render(
  data: LabelingData,
  {
    config = LABELING_DEFAULT_CONFIG,
    labels = LABELING_LABELS,
    context = makeTestContext({ sizes: ["M", "L"], cartons: { M: [13, 299, 337] } }),
    readOnly = false,
  }: Options = {},
): string {
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "header", include: false }, { key: "labeling", config, labels }]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { labeling: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "labeling") as ModuleEvaluation<LabelingComputed>;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title="Packaging Labeling Inspection"
      labels={labels}
      context={context}
      evaluation={evaluation}
      focusPath={null}
      readOnly={readOnly}
      onChange={noop}
    />,
  );
}

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

const RECORDED: LabelingData = {
  sizes: {
    M: {
      inner: { inspected: 3, boxNos: [13, 2336], defects: { lot_no: 1 } },
      carton: { inspected: 1, boxNos: [], defects: {} },
    },
  },
};

describe("labeling capture", () => {
  it("shows a tab for each ordered size only, with its result", () => {
    const data = { sizes: { ...RECORDED.sizes, XL: RECORDED.sizes.M } };
    const tabs = tagsWith(render(data), 'role="tab"');
    expect(tabs.map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["M", "L"]);
    const chips = tagsWith(render(data), 'data-slot="result-chip"');
    expect(chips.map((chip) => /data-status="([a-z_]+)"/.exec(chip)?.[1])).toEqual(["fail", "not_done"]);
  });

  it("asks for nothing while no size is ordered", () => {
    const html = render({ sizes: {} }, { context: makeTestContext() });
    expect(html).toContain("No sizes ordered yet.");
    expect(html).not.toContain('role="tab"');
  });

  it("offers the planned count in one tap until the boxes inspected are recorded", () => {
    const html = render({ sizes: {} });
    expect(html).toContain('aria-label="Record 3 boxes inspected: Dispenser Box, size M"');
    expect(html).toContain('aria-label="Record 1 box inspected: Carton Box, size M"');
    expect(html).not.toContain('aria-label="No. of sampled boxes inspected');
    // The defect counters are there from the start: a defect can be tapped before the count.
    expect(html).toContain('aria-label="Wrong / No lot number, Dispenser Box, size M"');
  });

  it("counts the boxes inspected on a stepper once recorded", () => {
    const html = render(RECORDED);
    expect(html).not.toContain("Record 3");
    expect(html).toMatch(/role="spinbutton"[^>]*aria-label="No. of sampled boxes inspected, Dispenser Box, size M"[^>]*aria-valuenow="3"/);
  });

  it("speaks the template's words: levels, checks, captions and the disposition line", () => {
    const html = render({ sizes: {} }, { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS });
    for (const text of [
      "Inner Boxes/Packs",
      "Carton Boxes",
      "Wrong / No expiry date",
      "No carton number",
      "Limit : Accept / Reject",
      "Disposition - Inner Box (Passed / Failed)",
      "Disposition - Carton Box (Passed / Failed)",
      "Total number of defects found",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Dispenser Box");
  });

  it("shows the live total and the Accept 0 / Reject 1 decision from calc", () => {
    const html = render(RECORDED);
    expect(html).toContain("Ac 0 / Re 1");
    const results = tagsWith(html, 'data-slot="status-pill"').map((pill) => /data-status="([a-z_]+)"/.exec(pill)?.[1]);
    expect(results).toEqual(["fail", "pass"]);
  });

  it("takes the limits and the verdict from calc only: before the first evaluation it shows neither", () => {
    const html = renderToStaticMarkup(
      <Capture
        data={RECORDED}
        config={LABELING_DEFAULT_CONFIG}
        title="Packaging Labeling Inspection"
        labels={LABELING_LABELS}
        context={makeTestContext({ sizes: ["M"] })}
        evaluation={null}
        focusPath={null}
        readOnly={false}
        onChange={noop}
      />,
    );
    expect(html).not.toContain("Ac 0 / Re 1");
    const results = tagsWith(html, 'data-slot="status-pill"').map((pill) => /data-status="([a-z_]+)"/.exec(pill)?.[1]);
    expect(results).toEqual(["not_done", "not_done"]);
  });

  it("picks boxes from the carton list, flags one that is not in it, and offers the next pick", () => {
    const html = render(RECORDED);
    const pickers = tagsWith(html, 'role="combobox"');
    expect(pickers.map((picker) => /aria-label="([^"]+)"/.exec(picker)?.[1])).toEqual([
      "Box # 1, Dispenser Box, size M",
      "Box # 2, Dispenser Box, size M",
      "Box # 3, Dispenser Box, size M",
      "Box # 1, Carton Box, size M",
    ]);
    expect(pickers[1]).toContain('aria-invalid="true"');
    // The picker keeps its own description for screen readers; on screen the problem is listed under the row.
    expect(html).toContain("Box 2336 is not in the carton list for size M.");
    expect(html).toMatch(/<p class="[^"]*text-fail[^"]*">Box 2336 \(Dispenser Box\) is not in the size M carton list\.<\/p>/);
  });

  it("asks for the boxes inspected where the count is, when a defect fails the level first", () => {
    const html = render({ sizes: { M: { ...RECORDED.sizes.M, inner: { inspected: null, boxNos: [], defects: { lot_no: 1 } } } } });
    expect(html).toContain('aria-label="Record 3 boxes inspected: Dispenser Box, size M"');
    expect(html).toMatch(
      /<p class="[^"]*text-warn[^"]*">Dispenser Box, size M: 1 defect found but the boxes inspected are not recorded\.<\/p>/,
    );
  });

  it("marks every value for the links in the issue list", () => {
    const paths = tagsWith(render(RECORDED), "data-issue-path").map((tag) => /data-issue-path="([^"]+)"/.exec(tag)?.[1]);
    for (const path of [
      '["sizes","M","inner"]',
      '["sizes","M","inner","inspected"]',
      '["sizes","M","inner","boxNos"]',
      '["sizes","M","inner","boxNos",1]',
      '["sizes","M","inner","defects","lot_no"]',
      '["sizes","M","carton","defects","carton_no"]',
    ]) {
      expect(paths).toContain(path.replaceAll('"', "&quot;"));
    }
  });

  it("shows the plan's shortfall where the count is", () => {
    const html = render({ sizes: { M: { ...RECORDED.sizes.M, inner: { inspected: 2, boxNos: [], defects: {} } } } });
    expect(html).toContain("Dispenser Box, size M: 2 boxes inspected; the plan is 3.");
  });

  it("is read-only for an approved inspection: numbers and boxes as text, no controls", () => {
    const html = render(RECORDED, { readOnly: true });
    expect(html).not.toContain('role="spinbutton"');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain("Record ");
    expect(html).not.toContain("Increase ");
    expect(html).toContain('role="tab"');
  });

  it("says so when the template inspects no level", () => {
    const { levels } = LABELING_DEFAULT_CONFIG;
    const config = { levels: { inner: { ...levels.inner, include: false }, carton: { ...levels.carton, include: false } } };
    expect(render(RECORDED, { config })).toContain("This template inspects no labelling level.");
  });
});
