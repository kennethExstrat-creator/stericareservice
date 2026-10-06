// Server-rendered markup of the dye leak capture: ordered sizes only, the
// template's wording, the plan flowing forward, counts that are tapped and
// never shown as 0 before they are entered, and read-only. Pointer and key
// handling belong to the kit's own tests.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaptureProps, InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { STD_EG_EXAMPLE, STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { calcDyeLeak, type DyeLeakComputed } from "./calc";
import Capture from "./Capture";
import { DYE_LEAK_DEFAULT_CONFIG, DYE_LEAK_LABELS, DYE_LEAK_TITLE, type DyeLeakConfig } from "./config";
import type { DyeLeakData } from "./schema";

const noop = () => {};

const CONTEXT: InspectionContext = makeTestContext({
  template: { code: "TEST_SG", name: "Test surgical gloves", productType: "surgical", standard: "custom", unit: "pairs" },
  templateSizes: ["6.5", "7.0", "7.5"].map((value) => ({ value, label: value })),
  sizes: ["6.5", "7.0"],
  sampling: { "6.5": makeSampling({ pouchesDyeLeak: 13 }), "7.0": makeSampling({ pouchesDyeLeak: 13 }) },
});

function render(
  data: DyeLeakData,
  {
    readOnly = false,
    labels = DYE_LEAK_LABELS,
    config = DYE_LEAK_DEFAULT_CONFIG,
    broken = false,
    context = CONTEXT,
  }: {
    readOnly?: boolean;
    labels?: Record<string, string>;
    config?: DyeLeakConfig;
    broken?: boolean;
    context?: InspectionContext;
  } = {},
): string {
  const output = calcDyeLeak({ data, config, title: DYE_LEAK_TITLE, labels, context, results: {}, hasData: true });
  const evaluation: ModuleEvaluation<DyeLeakComputed> = {
    key: "dye_leak",
    title: DYE_LEAK_TITLE,
    labels,
    config,
    data,
    hasData: true,
    comment: null,
    // What the engine hands over when the module cannot be evaluated: nothing computed.
    computed: broken ? ({} as DyeLeakComputed) : output.computed,
    result: broken ? { status: "not_done", summary: "Saved data could not be read." } : output.result,
    issues: output.issues.map((issue) => ({ ...issue, moduleKey: "dye_leak" })),
    stub: false,
  };
  const props: CaptureProps<DyeLeakData, DyeLeakConfig, DyeLeakComputed> = {
    data,
    config,
    title: DYE_LEAK_TITLE,
    labels,
    context,
    evaluation,
    focusPath: null,
    readOnly,
    onChange: noop,
  };
  return renderToStaticMarkup(<Capture {...props} />);
}

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

describe("dye_leak capture", () => {
  it("shows a tab for each ordered size only, each with its result", () => {
    const html = render({
      sizes: {
        "6.5": { pouchesTested: 13, pouchesFailed: 0, notes: null },
        "7.5": { pouchesTested: 13, pouchesFailed: 2, notes: null },
      },
    });
    const tabs = tagsWith(html, 'role="tab"');
    expect(tabs.map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["6.5", "7.0"]);
    const chips = tagsWith(html, 'data-slot="result-chip"').map((chip) => /data-status="([a-z_]+)"/.exec(chip)?.[1]);
    expect(chips.slice(0, 2)).toEqual(["pass", "not_done"]);
    expect(html).not.toContain('data-size="7.5"');
  });

  it("has no tab, panel or result for the sizes the STD_EG example did not order (expected results)", () => {
    const ordered = [...STD_EG_EXAMPLE.sizesOrdered];
    const unordered = STD_EG_EXPECTED.unorderedSizes.sizes;
    const context = makeTestContext({ sizes: ordered, sampling: { M: makeSampling({ pouchesDyeLeak: 13 }) } });
    // Data saved for every size of the report: the unordered ones stay saved but show nowhere.
    const sizes = Object.fromEntries(
      [...ordered, ...unordered].map((key) => [key, { pouchesTested: 13, pouchesFailed: 0, notes: null }]),
    );
    const html = render({ sizes }, { context });
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["M"]);
    expect(html.match(/Pouches failed: 0 of 13\./g)).toHaveLength(1);
    expect(html).not.toMatch(/aria-label="[^"]*Size (XS|S|L|XL)"/);
  });

  it("offers the plan and a one-tap clean result before anything is entered, never a 0", () => {
    const html = render({ sizes: {} });
    expect(html).toMatch(/Pouches planned:<span data-slot="figure"[^>]*>13<\/span>/);
    expect(html).toContain("13 as planned");
    expect(html).toContain("No leaks");
    expect(html).not.toContain('role="spinbutton"');
    // Named with the count and the size, since every size's buttons may be on screen at once.
    expect(html).toContain('aria-label="13 as planned, Pouches tested, Size 6.5"');
    expect(html).toContain('aria-label="No leaks, Pouches failed, Size 7.0"');
  });

  it("counts entered values with steppers named by size, and lists the totals", () => {
    const html = render({ sizes: { "6.5": { pouchesTested: 13, pouchesFailed: 1, notes: "Channel at the seal." } } });
    expect(html).toContain('aria-label="Pouches failed, Size 6.5"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain("Channel at the seal.");
    expect(html).toContain("Pouches failed: 1 of 13.");
    expect(html).toMatch(/Pouches tested<\/dt><dd[^>]*><span[^>]*>13<\/span>/);
  });

  it("speaks the template's wording", () => {
    const labels = { ...DYE_LEAK_LABELS, pouchesTested: "Pouches dyed", pouchesFailed: "Leaking pouches", notes: "Remarks" };
    const html = render({ sizes: { "6.5": { pouchesTested: 13, pouchesFailed: 0, notes: null } } }, { labels });
    expect(html).toContain("Pouches dyed");
    expect(html).toContain("Leaking pouches");
    expect(html).toContain("Remarks");
    expect(html).not.toContain("Pouches tested");
    const planned = render({ sizes: {} }, { labels: { ...DYE_LEAK_LABELS, pouchesPlanned: "Pouches to dye" } });
    expect(planned).toContain("Pouches to dye:");
    expect(planned).not.toContain("Pouches planned");
  });

  it("shows the plan from the sampling plan, else config n, else none", () => {
    const planned = (html: string) =>
      Array.from(html.matchAll(/Pouches planned:<span data-slot="figure"([^>]*)>(.*?)<\/span>/g), (match) =>
        match[1].includes("data-empty") ? null : match[2],
      );
    // The sampling plan's 13 wins where it is set.
    expect(planned(render({ sizes: {} }, { config: { n: 5 } }))).toEqual(["13", "13"]);
    const unplanned: InspectionContext = { ...CONTEXT, sampling: { "6.5": makeSampling({ pouchesDyeLeak: 13 }) } };
    expect(planned(render({ sizes: {} }, { config: { n: 5 }, context: unplanned }))).toEqual(["13", "5"]);
    const html = render({ sizes: {} }, { context: unplanned });
    expect(planned(html)).toEqual(["13", null]);
    expect(html).toContain("Start counting");
  });

  it("shows an error from calc under the count it points at", () => {
    const html = render({ sizes: { "6.5": { pouchesTested: 2, pouchesFailed: 3, notes: null } } });
    expect(html).toContain("Size 6.5: Pouches failed (3) is more than Pouches tested (2).");
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;6.5&quot;,&quot;pouchesFailed&quot;]"');
  });

  it("still renders, with the plan from the context, when calc could not run", () => {
    const html = render({ sizes: {} }, { broken: true });
    expect(html).toMatch(/Pouches planned:<span data-slot="figure"[^>]*>13<\/span>/);
    expect(html).toContain("No value");
  });

  it("is read-only on an approved inspection: counts become numbers, nothing to start or clear", () => {
    const html = render({ sizes: { "6.5": { pouchesTested: 13, pouchesFailed: 0, notes: "Fine." } } }, { readOnly: true });
    expect(html).not.toContain("No leaks");
    expect(html).not.toContain("as planned");
    expect(html).not.toContain("Clear Pouches");
    expect(html).not.toContain('role="spinbutton"');
    expect(html).toMatch(/Pouches failed<\/span><span data-slot="figure"[^>]*>0<\/span>/);
    // Size 7.0 has nothing entered: a dash read as "No value", never a 0.
    expect(html).toContain("No value");
    const textareas = Array.from(html.matchAll(/<textarea[^>]*>/g), (match) => match[0]);
    expect(textareas).toHaveLength(2);
    expect(textareas.every((tag) => /readonly=""/i.test(tag))).toBe(true);
  });
});
