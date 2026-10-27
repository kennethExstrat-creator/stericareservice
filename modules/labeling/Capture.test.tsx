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
    expect(html).toContain('aria-label="Record 3 boxes inspected: Dispenser Box, Size M"');
    expect(html).toContain('aria-label="Record 1 box inspected: Carton Box, Size M"');
    expect(html).not.toContain('aria-label="No. of Sampled Boxes Inspected');
    // The defect counters are there from the start: a defect can be tapped before the count.
    expect(html).toContain('aria-label="Wrong / No Lot Number, Dispenser Box, Size M"');
  });

  it("counts the boxes inspected on a stepper once recorded", () => {
    const html = render(RECORDED);
    expect(html).not.toContain("Record 3");
    expect(html).toMatch(/role="spinbutton"[^>]*aria-label="No. of Sampled Boxes Inspected, Dispenser Box, Size M"[^>]*aria-valuenow="3"/);
  });

  it("speaks the template's words: levels, checks, captions and the disposition line", () => {
    const html = render({ sizes: {} }, { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS });
    for (const text of [
      "Inner Boxes/Packs",
      "Carton Boxes",
      "Wrong / No Expiry Date",
      "No Box/Carton #",
      "Limit : Accept / Reject",
      "Disposition - Inner Box (Passed / Failed)",
      "Disposition - Carton Box (Passed / Failed)",
      "Total Number of Defects Found",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Dispenser Box");
  });

  it("shows the live total and the Accept 0 / Reject 1 decision from calc, in the template's words", () => {
    const html = render(RECORDED);
    expect(html).toContain("Accept 0 / Reject 1");
    // On one line (Kenneth, 27 October 2026): Ac / Re only where a frame is too narrow for the template's words.
    expect(html).toContain('class="whitespace-nowrap hidden @max-md:inline">Ac 0 / Re 1</span>');
    // A template that words them its own way, keyed level first as the dictionary keys level
    // wording: SAFEDON_EG prints both levels Acc. = 0 / Rej. = 1; one level may differ.
    const safedon = render(RECORDED, { labels: SAFEDON_LABELS });
    expect(safedon.match(/<span class="sr-only">Acc\. = 0 \/ Rej\. = 1<\/span>/g)).toHaveLength(2);
    expect(safedon).not.toContain("Accept 0 / Reject 1");
    const worded = render(RECORDED, { labels: { ...LABELING_LABELS, innerAccept: "Acc. =", cartonReject: "Rej. =" } });
    expect(worded).toContain("Acc. = 0 / Reject 1");
    expect(worded).toContain("Accept 0 / Rej. = 1");
    // A template resolved before the dictionary keyed the level words: the words both levels
    // share, or a dotted key added in the editor; a blank level word falls back the same way.
    const older = Object.fromEntries(Object.entries(LABELING_LABELS).filter(([key]) => !/^(inner|carton)(Accept|Reject)$/.test(key)));
    const shared = render(RECORDED, { labels: { ...older, accept: "Acc. =" } });
    expect(shared.match(/<span class="sr-only">Acc\. = 0 \/ Reject 1<\/span>/g)).toHaveLength(2);
    const dotted = render(RECORDED, { labels: { ...older, "inner.accept": "A =" } });
    expect(dotted).toContain("A = 0 / Reject 1");
    expect(dotted).toContain("Accept 0 / Reject 1");
    const blank = render(RECORDED, { labels: { ...LABELING_LABELS, innerAccept: " ", accept: "Acc. =" } });
    expect(blank).toContain("Acc. = 0 / Reject 1");
    expect(blank).toContain("Accept 0 / Reject 1");
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
    expect(html).not.toContain("Accept 0 / Reject 1");
    const results = tagsWith(html, 'data-slot="status-pill"').map((pill) => /data-status="([a-z_]+)"/.exec(pill)?.[1]);
    expect(results).toEqual(["not_done", "not_done"]);
  });

  it("takes the box/carton numbers typed on the numeric keypad with the size's sampled numbers suggested, a field per box and an empty one for the next", () => {
    const html = render(RECORDED);
    const fields = tagsWith(html, 'data-slot="numeric-cell"');
    expect(fields.map((field) => /id="([^"]+)"/.exec(field)?.[1])).toEqual([
      "labeling-inner-M-box-0",
      "labeling-inner-M-box-1",
      "labeling-inner-M-box-2",
      "labeling-carton-M-box-0",
    ]);
    expect(fields.map((field) => /value="([^"]*)"/.exec(field)?.[1])).toEqual(["13", "2336", "", ""]);
    for (const field of fields) expect(field).toContain('inputMode="numeric"');
    // Size M has a sampled list (13, 299, 337 here): each field suggests it (6.2 rule 7; Kenneth, 13 October 2026).
    for (const field of fields) expect(field).toContain('role="combobox"');
    // Named by the field's No., never a number that reads as a box/carton number.
    for (const label of [
      "Box/Carton #, No. 1, Dispenser Box, Size M",
      "Box/Carton #, No. 2, Dispenser Box, Size M",
      "Box/Carton #, No. 3, Dispenser Box, Size M",
      "Box/Carton #, No. 1, Carton Box, Size M",
    ]) {
      expect(html).toContain(`>${label}</label>`);
    }
    // Box 2336 is not in size M's list: stored as typed, amber, and a warning linked below; never an error.
    expect(fields.some((field) => field.includes('aria-invalid="true"'))).toBe(false);
    expect(fields[1]).toContain("border-warn-solid");
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(list).toContain("Box/Carton #2336 is not in M&#x27;s sampled box/carton numbers.");
    expect(list).toContain("text-warn");
    expect(list.match(/<button/g)).toHaveLength(1);
    expect(list).toContain("touch:min-h-11");
    // Each box entered has its Delete, 44 px on the iPad; the empty field has none.
    const deletes = tagsWith(html, 'aria-label="Delete Box/Carton #');
    expect(deletes.map((button) => /aria-label="([^"]+)"/.exec(button)?.[1])).toEqual([
      "Delete Box/Carton #13, Dispenser Box, Size M",
      "Delete Box/Carton #2336, Dispenser Box, Size M",
    ]);
    expect(deletes[0]).toContain("touch:size-11");
  });

  it("suggests nothing and warns about nothing while the size has no sampled list", () => {
    const html = render(RECORDED, { context: makeTestContext({ sizes: ["M", "L"] }) });
    const fields = tagsWith(html, 'data-slot="numeric-cell"');
    expect(fields.some((field) => field.includes('role="combobox"'))).toBe(false);
    expect(html).not.toContain('data-slot="box-issues"');
  });

  it("lists calc's box problems under the fields as links: a box/carton number entered twice at the carton level", () => {
    const config = { levels: { ...LABELING_DEFAULT_CONFIG.levels, carton: { ...LABELING_DEFAULT_CONFIG.levels.carton, n: 2 } } };
    const twice: LabelingData = { sizes: { M: { ...RECORDED.sizes.M, carton: { inspected: 2, boxNos: [337, 337], defects: {} } } } };
    const html = render(twice, { config });
    expect(html).toMatch(
      /<button type="button" class="[^"]*text-fail[^"]*">.*?<span>Carton Box, size M: Box\/Carton #337 is entered twice\.<\/span><\/button>/,
    );
  });

  it("asks for the boxes inspected where the count is, when a defect fails the level first", () => {
    const html = render({ sizes: { M: { ...RECORDED.sizes.M, inner: { inspected: null, boxNos: [], defects: { lot_no: 1 } } } } });
    expect(html).toContain('aria-label="Record 3 boxes inspected: Dispenser Box, Size M"');
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
    expect(html).not.toContain("Delete Box/Carton");
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
