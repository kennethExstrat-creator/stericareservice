// Server-rendered markup of the visual capture body: a section per class the
// template switches on, ordered sizes only, the template's wording, calc's
// limits, totals and chips, the sampling plan's n one tap away, the hand
// split, one-off rows and read-only. Taps, swipes and keys are the capture
// kit's, tested there.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides, moduleConfig } from "@/lib/coverage";
import type { ResolvedModule } from "@/lib/schemas";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import type { VisualComputed } from "./calc";
import Capture from "./Capture";
import { VISUAL_DEFAULT_CONFIG, VISUAL_LABELS, VISUAL_TITLE, VisualConfigSchema, type VisualConfig } from "./config";
import { DEFECT_CLASSES, VisualDataSchema } from "./schema";

const noop = () => {};

type RenderInput = {
  sizes: Record<string, unknown>;
  context: InspectionContext;
  config?: VisualConfig;
  labels?: Record<string, string>;
  readOnly?: boolean;
};

function render({ sizes, context, config = VISUAL_DEFAULT_CONFIG, labels = VISUAL_LABELS, readOnly = false }: RenderInput) {
  const data = VisualDataSchema.parse({ sizes });
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "visual", config: config as ResolvedModule["config"], labels }]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { visual: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "visual") as ModuleEvaluation<VisualComputed> | undefined;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={VISUAL_TITLE}
      labels={labels}
      context={context}
      evaluation={evaluation ?? null}
      focusPath={null}
      readOnly={readOnly}
      onChange={noop}
      onFocusChange={noop}
    />,
  );
}

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** Footer totals in page order: class by class, column by column. */
const totals = (html: string) => Array.from(html.matchAll(/font-bold touch:text-lg[^"]*">(\d+)</g), (match) => Number(match[1]));

const headings = (html: string) => Array.from(html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g), (match) => match[1]);

/** The gloves inspected inputs, class by class. */
const numberInputs = (html: string) => tagsWith(html, 'data-slot="numeric-cell"');

const statuses = (html: string) =>
  tagsWith(html, 'data-slot="status-pill"').map((pill) => /data-status="(\w+)"/.exec(pill)?.[1]);

const M_500 = () => makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });

const inspectedAll = (n: number) => Object.fromEntries(DEFECT_CLASSES.map((cls) => [cls, { inspected: n }]));

describe("visual capture", () => {
  const stdEg = () =>
    render({
      sizes: {
        M: Object.fromEntries(
          DEFECT_CLASSES.map((cls) => {
            const entry = STD_EG_EXAMPLE.visual[cls].perSize.M;
            return [cls, { inspected: entry?.inspected ?? null, counts: { ...entry?.counts } }];
          }),
        ),
      },
      context: M_500(),
      config: VisualConfigSchema.parse(moduleConfig("STD_EG", "visual")),
      labels: { ...VISUAL_LABELS, ...labelOverrides("STD_EG", "visual") },
    });

  it("has a section per class headed in the template's wording with its AQL", () => {
    expect(headings(stdEg())).toEqual(["Critical Defects (AQL 0.0)", "Major Defects (AQL 2.5)", "Minor Defects (AQL 4.0)"]);
  });

  it("B. counts the STD_EG example with calc's limits, totals and chips: 0 / 1, 21 / 22, 21 / 22", () => {
    const html = stdEg();
    // The limit row in the template's words (labels accept, reject), not the kit's Ac / Re.
    expect(html).toContain("Accept 0 / Reject 1");
    expect(html.match(/Accept 21 \/ Reject 22/g)).toHaveLength(2);
    expect(totals(html)).toEqual([0, 8, 0]);
    expect(tagsWith(html, 'data-slot="status-pill"').map((pill) => /data-status="(\w+)"/.exec(pill)?.[1])).toEqual([
      "pass",
      "pass",
      "pass",
    ]);
    expect(html).toContain('aria-label="Increase Thin spot on glove body, Size M"');
    expect(html).toContain('aria-valuenow="5"');
    expect(html).toContain("Total number of &quot;Major Defects&quot; found");
    expect(html).toContain("Disposition - Visual Critical (Passed / Failed)");
    expect(html).toContain("Defect Limit : Accept / Reject");
    expect(html).toContain("Sampling code letter N");
  });

  it("words one code apart per class: Defective bead (major), Defective beads (minor)", () => {
    const html = stdEg();
    expect(html).toContain('aria-label="Increase Defective bead, Size M"');
    expect(html).toContain('aria-label="Increase Defective beads, Size M"');
  });

  it("leaves out a class the template switches off", () => {
    const config = {
      ...VISUAL_DEFAULT_CONFIG,
      classes: { ...VISUAL_DEFAULT_CONFIG.classes, critical: { ...VISUAL_DEFAULT_CONFIG.classes.critical, include: false } },
    };
    const html = render({ sizes: { M: inspectedAll(500) }, context: M_500(), config });
    expect(headings(html)).toEqual(["Major Defects (AQL 2.5)", "Minor Defects (AQL 4.0)"]);
    expect(html).not.toContain("Embedded Insects");
  });

  it("offers the sampling plan's n for every class still without one", () => {
    const empty = render({ sizes: {}, context: M_500() });
    expect(empty).toContain("Sampling plan: 500");
    expect(empty).toMatch(/Use 500 for every class<span class="sr-only"> of size M<\/span>/);
    // 16 px text on touch, as every field's; size sm alone keeps 14 px there.
    expect(/<button[^>]*>Use 500 for every class/.exec(empty)?.[0]).toContain("touch:text-base");
    // Offered beside the fields, never inside them: an empty field must not look filled (6.2 rule 5).
    expect(numberInputs(empty)).toHaveLength(3);
    expect(numberInputs(empty).every((field) => field.includes('value=""') && !field.includes(" placeholder="))).toBe(true);
    expect(render({ sizes: { M: inspectedAll(500) }, context: M_500() })).not.toContain("for every class");
  });

  it("shows a class not inspected as an empty field when read-only, never the sampling plan's n as if recorded", () => {
    const html = render({ sizes: { M: { critical: { inspected: 500 } } }, context: M_500(), readOnly: true });
    const fields = numberInputs(html);
    expect(fields.map((field) => /value="([^"]*)"/.exec(field)?.[1])).toEqual(["500", "", ""]);
    expect(fields.some((field) => field.includes(" placeholder="))).toBe(false);
    expect(statuses(html)).toEqual(["pass", "not_done", "not_done"]);
  });

  it("shows the critical limit Accept 0 / Reject 1 before the gloves inspected are entered, beside a critical defect's failure", () => {
    const html = render({ sizes: { M: { critical: { counts: { embedded_metal: 1 } } } }, context: M_500() });
    expect(html.match(/Accept 0 \/ Reject 1/g)).toHaveLength(1);
    expect(statuses(html)).toEqual(["fail", "not_done", "not_done"]);
    // Major and minor need n for their limits.
    expect(render({ sizes: {}, context: M_500() }).match(/Accept \d+ \/ Reject \d+/g)).toEqual(["Accept 0 / Reject 1"]);
  });

  it("words one class's limit apart where the template does (STD_EG prints Acc. = 0 / Rej. = 1 for critical)", () => {
    const html = render({
      sizes: {},
      context: M_500(),
      labels: { ...VISUAL_LABELS, "critical.accept": "Acc. =", "critical.reject": "Rej. =" },
    });
    expect(html).toContain("Acc. = 0 / Rej. = 1");
  });

  it("says under a class's gloves inspected what calc found there, warnings in amber", () => {
    const html = render({ sizes: { M: { ...inspectedAll(500), minor: { inspected: 315 } } }, context: M_500() });
    const blocks = Array.from(html.matchAll(/<div id="[^"]*-calc-warning"[^>]*text-warn[^>]*>[\s\S]*?<\/div>/g), (match) => match[0]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain(
      "<span>Size M, Minor Defects: No. of sample inspected is 315, but the sampling plan has 500 gloves for watertight and visual.</span>",
    );
  });

  it("shows the tab's fields, and every size's only where SizeTabs puts the sizes side by side", () => {
    const context = makeTestContext({
      sizes: ["S", "M"],
      sampling: { S: makeSampling({ watertightVisual: 200 }), M: makeSampling({ watertightVisual: 500 }) },
    });
    const html = render({ sizes: {}, context });
    const fields = tagsWith(html, 'data-issue-path="\\[&quot;sizes&quot;,&quot;M&quot;,&quot;major&quot;\\]"');
    expect(fields).toHaveLength(1);
    // SizeBlock: from 1280 px every size shows while SizeTabs puts them side by side (the tables fit).
    expect(fields[0]).toContain("max-xl:hidden");
    expect(tagsWith(html, 'data-issue-path="\\[&quot;sizes&quot;,&quot;S&quot;,&quot;major&quot;\\]"')[0]).not.toContain("hidden");
    expect(tagsWith(html, 'data-slot="size-tabs"')[0]).toContain("data-side-by-side");
    // One element in the flex Label, so ", size M" follows the text with no gap when it shows.
    expect(html).toMatch(
      /<label[^>]*><span>No\. of sample inspected<span class="sr-only">, Major Defects<\/span><span class="sr-only xl:not-sr-only">, size M<\/span><\/span><\/label>/,
    );
  });

  it("shows only ordered sizes (6.2 rule 4)", () => {
    const html = render({ sizes: { M: inspectedAll(500), XL: inspectedAll(200) }, context: M_500() });
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["M"]);
    expect(html).not.toContain("Size XL");
  });

  it("splits each size into right and left hands with a hand toggle (surgical templates)", () => {
    const html = render({
      sizes: { "7.0": { ...inspectedAll(125), R: { major: { counts: { thin_spot: 2 } } } } },
      context: makeTestContext({
        sizes: ["7.0"],
        templateSizes: [{ value: "7.0", label: "7.0" }],
        sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
      }),
      config: { ...VISUAL_DEFAULT_CONFIG, handSplit: true },
    });
    expect(tagsWith(html, 'role="radio"')).toHaveLength(3);
    expect(html).toContain('aria-label="Increase Thin spot on glove body, Size 7.0, left hand"');
    expect(totals(html)).toEqual([0, 2, 0]);
  });

  it("flags one-off rows for an admin in their class only", () => {
    const html = render({
      sizes: { M: { ...inspectedAll(500), minor: { inspected: 500, unmapped: [{ label: "Faint print", count: 1 }] } } },
      context: M_500(),
    });
    expect(tagsWith(html, 'data-unmapped="true"')).toHaveLength(1);
    expect(totals(html)).toEqual([0, 0, 1]);
    expect(html.match(/Defect not in the list/g)).toHaveLength(3);
  });

  it("is read-only for an approved inspection", () => {
    const html = render({ sizes: { M: inspectedAll(500) }, context: M_500(), readOnly: true });
    expect(html).not.toContain('role="spinbutton"');
    expect(html).not.toContain("Defect not in the list");
    expect(html).not.toContain("for every class");
  });

  it("says so when the template switches every class off", () => {
    const off = (cls: keyof VisualConfig["classes"]) => ({ ...VISUAL_DEFAULT_CONFIG.classes[cls], include: false });
    const html = render({
      sizes: {},
      context: M_500(),
      config: { ...VISUAL_DEFAULT_CONFIG, classes: { critical: { ...off("critical"), aql: 0 }, major: off("major"), minor: off("minor") } },
    });
    expect(html).toContain("No defect classes are switched on");
  });
});
