// Server-rendered markup of the watertight capture body: ordered sizes only,
// the template's wording, calc's limits, totals and chips, the sampling
// plan's n one tap away, the hand split, one-off rows and read-only. Taps,
// swipes and keys are the capture kit's, tested there.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides, moduleConfig } from "@/lib/coverage";
import type { ResolvedModule } from "@/lib/schemas";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import type { WatertightComputed } from "./calc";
import Capture from "./Capture";
import { WATERTIGHT_DEFAULT_CONFIG, WATERTIGHT_LABELS, WATERTIGHT_TITLE, WatertightConfigSchema, type WatertightConfig } from "./config";
import { WatertightDataSchema } from "./schema";

const noop = () => {};

type RenderInput = {
  sizes: Record<string, unknown>;
  context: InspectionContext;
  config?: WatertightConfig;
  labels?: Record<string, string>;
  readOnly?: boolean;
};

function render({ sizes, context, config = WATERTIGHT_DEFAULT_CONFIG, labels = WATERTIGHT_LABELS, readOnly = false }: RenderInput) {
  const data = WatertightDataSchema.parse({ sizes });
  const template = makeTestTemplate(MODULE_REGISTRY, [
    { key: "watertight", config: config as ResolvedModule["config"], labels },
  ]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { watertight: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "watertight") as ModuleEvaluation<WatertightComputed> | undefined;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={WATERTIGHT_TITLE}
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

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** The footer totals, column by column. */
const totals = (html: string) => Array.from(html.matchAll(/font-bold touch:text-lg[^"]*">(\d+)</g), (match) => Number(match[1]));

const M_500 = () => makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });

describe("watertight capture", () => {
  const safedon = () => {
    const sizes = [...SAFEDON_EG_EXAMPLE.sizesOrdered];
    return render({
      sizes: Object.fromEntries(
        Object.entries(SAFEDON_EG_EXAMPLE.watertight.perSize).map(([size, entry]) => [
          size,
          { tested: entry.tested, holes: { ...entry.holes } },
        ]),
      ),
      context: makeTestContext({
        sizes,
        sampling: Object.fromEntries(
          sizes.map((size) => [size, makeSampling({ watertightVisual: SAFEDON_EG_EXAMPLE.sampling[size]?.watertightVisualGloves ?? null })]),
        ),
      }),
      config: WatertightConfigSchema.parse(moduleConfig("SAFEDON_EG", "watertight")),
      labels: { ...WATERTIGHT_LABELS, ...labelOverrides("SAFEDON_EG", "watertight") },
    });
  };

  it("shows a tab per ordered size only, each with calc's result (6.2 rule 4)", () => {
    const html = safedon();
    const tabs = tagsWith(html, 'role="tab"');
    expect(tabs.map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["XS", "S", "M", "L"]);
    expect(tagsWith(html, 'data-slot="result-chip"').map((chip) => /data-status="(\w+)"/.exec(chip)?.[1])).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
  });

  it("counts by location in the template's order and wording, with calc's limits, totals and chips", () => {
    const html = safedon();
    expect(html).toContain(">Holes<");
    for (const label of ["Between fingers", "Palm", "Cuff", "Finger", "Glove burst", "Other :"]) {
      expect(html).toContain(`aria-label="Increase ${label}, Size XS"`);
    }
    expect(html).toContain("Ac 3 / Re 4");
    expect(html).toContain("Ac 7 / Re 8");
    expect(totals(html)).toEqual([1, 0, 0, 1]);
    expect(tagsWith(html, 'data-slot="status-pill"').every((pill) => pill.includes('data-status="pass"'))).toBe(true);
    expect(html).toContain("Sampling code letter J &amp; L · AQL 1.5");
    expect(html).toContain("Total number of defects found");
    expect(html).toContain("Freedom from holes (Passed / Failed)");
  });

  it("offers the sampling plan's n until the gloves tested are entered", () => {
    const empty = render({ sizes: {}, context: M_500() });
    expect(empty).toContain("Sampling plan: 500");
    expect(empty).toMatch(/Use 500<span class="sr-only"> for size M<\/span>/);
    expect(empty).toContain('placeholder="500"');
    const entered = render({ sizes: { M: { tested: 500 } }, context: M_500() });
    expect(entered).not.toContain("Use 500");
    expect(entered).toContain('value="500"');
    expect(entered).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;tested&quot;]"');
  });

  it("shows the tab's gloves tested field, and every size's only where SizeTabs puts the sizes side by side", () => {
    const sizes = ["S", "M"];
    const html = render({
      sizes: {},
      context: makeTestContext({ sizes, sampling: { S: makeSampling({ watertightVisual: 200 }), M: makeSampling({ watertightVisual: 500 }) } }),
    });
    const fields = tagsWith(html, "data-issue-path=\"\\[&quot;sizes&quot;,&quot;[SM]&quot;\\]\"");
    expect(fields).toHaveLength(2);
    expect(fields[0]).not.toContain("hidden");
    // From 1280 px SizeTabs marks itself data-side-by-side while the table fits; it keeps its tabs otherwise.
    expect(fields[1]).toContain("hidden xl:in-data-[side-by-side]:block");
    expect(tagsWith(html, 'data-slot="size-tabs"')[0]).toContain("data-side-by-side");
    expect(html).toContain('No. of sample tested<span class="sr-only xl:in-data-[side-by-side]:not-sr-only">, size M</span>');
  });

  it("splits each size into right and left hands with a hand toggle (surgical templates)", () => {
    const html = render({
      sizes: { "7.0": { tested: 125, R: { holes: { hole_palm: 2 } } } },
      context: makeTestContext({
        sizes: ["7.0"],
        templateSizes: [{ value: "7.0", label: "7.0" }],
        sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
      }),
      config: { ...WATERTIGHT_DEFAULT_CONFIG, handSplit: true },
    });
    expect(tagsWith(html, 'role="radio"')).toHaveLength(3);
    expect(html).toContain('aria-label="Increase Palm, Size 7.0, right hand"');
    expect(html).toContain('aria-label="Increase Palm, Size 7.0, left hand"');
    expect(totals(html)).toEqual([2]);
  });

  it("flags one-off rows for an admin and offers to add one in the template's words", () => {
    const html = render({ sizes: { M: { tested: 500, unmapped: [{ label: "Near the thumb", count: 2 }] } }, context: M_500() });
    expect(tagsWith(html, 'data-unmapped="true"')).toHaveLength(1);
    expect(html).toContain("Near the thumb<span class=\"sr-only\"> (unmapped label)</span>");
    expect(html).toContain("Defect not in the list");
    expect(totals(html)).toEqual([2]);
  });

  it("asks where the holes under 'Other :' were, showing calc's note", () => {
    const html = render({ sizes: { M: { tested: 500, holes: { hole_other: 1 } } }, context: M_500() });
    expect(html).toContain("Other : description");
    expect(html).toContain("Size M: 1 hole under &quot;Other :&quot; without saying where.");
    expect(render({ sizes: { M: { tested: 500 } }, context: M_500() })).not.toContain("Other : description");
  });

  it("is read-only for an approved inspection: numbers, no steppers or buttons to change them", () => {
    const html = render({ sizes: { M: { tested: 500, holes: { hole_finger: 1, hole_other: 1 } } }, context: M_500(), readOnly: true });
    expect(html).not.toContain('role="spinbutton"');
    expect(html).not.toContain("Defect not in the list");
    expect(html).not.toContain("Use 500");
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((input) => /readOnly|readonly/.test(input))).toBe(true);
  });

  it("says so while no size is ordered", () => {
    expect(render({ sizes: {}, context: makeTestContext() })).toContain("No sizes ordered yet");
  });
});
