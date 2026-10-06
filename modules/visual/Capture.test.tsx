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
    expect(html).toContain("Ac 0 / Re 1");
    expect(html.match(/Ac 21 \/ Re 22/g)).toHaveLength(2);
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
    expect(empty).toMatch(/Use 500 for every class<span class="sr-only"> of size M<\/span>/);
    expect(empty.match(/placeholder="500"/g)).toHaveLength(3);
    expect(render({ sizes: { M: inspectedAll(500) }, context: M_500() })).not.toContain("for every class");
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
