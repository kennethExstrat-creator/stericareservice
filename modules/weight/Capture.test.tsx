// Server-rendered markup of the Weight body for the two example reports.
// Typing, Enter, paste and swipes are the kit's own (NumberField,
// MeasurementGrid, SizeTabs) and were exercised there in a browser.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TemplateCode } from "@/lib/coverage";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { exampleContext, templateConfig, templateLabels, templateTitle, weightData } from "./__fixtures__/examples";
import type { WeightComputed } from "./calc";
import Capture from "./Capture";
import type { WeightConfig } from "./config";
import type { WeightData } from "./schema";

const noop = () => {};

function render(
  code: TemplateCode,
  data: WeightData,
  context: InspectionContext,
  { readOnly = false, config = templateConfig(code) }: { readOnly?: boolean; config?: WeightConfig } = {},
): string {
  const labels = templateLabels(code);
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "weight", config, labels }]);
  // The engine holds every module's evaluation with its computed values erased, as the screen does.
  const evaluation = (evaluateInspection(
    { template, data: { modules: { weight: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((module) => module.key === "weight") ?? null) as ModuleEvaluation<WeightComputed> | null;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={templateTitle(code)}
      labels={labels}
      context={context}
      evaluation={evaluation}
      focusPath={null}
      readOnly={readOnly}
      onChange={noop}
      onFocusChange={noop}
    />,
  );
}

const tags = (html: string, pattern: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${pattern}[^>]*>`, "g")), (match) => match[0]);

describe("weight capture, 13 gloves per size (STD_EG)", () => {
  const data = weightData(STD_EG_EXAMPLE.weight);
  const html = render("STD_EG", data, exampleContext(STD_EG_EXAMPLE));

  it("is a grid of 13 weights for the ordered size M only, its footer the average", () => {
    const tabs = tags(html, 'role="tab"');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toContain('data-size="M"');
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(13);
    expect(tags(html, 'aria-label="Weight \\(g\\), No. 1"')[0]).toContain('value="2.90"');
    for (const label of ["Weight (g)", "Average", "Remark"]) expect(html).toContain(`>${label}<`);
  });

  it("shows the deviation from the indicative weight as a warning", () => {
    const note = html.slice(html.indexOf('data-slot="weight-deviation"'));
    expect(note).toContain("Deviation from indicative weight, size M");
    expect(note).toContain("-17.1");
    expect(note).toContain("indicative 3.5 g, threshold 10%");
    expect(tags(note, 'data-slot="status-pill"')[0]).toContain('data-status="warn"');
  });

  it("stops every edit when read-only", () => {
    const fieldset = (readOnly: boolean) =>
      /<fieldset[^>]*>/.exec(render("STD_EG", data, exampleContext(STD_EG_EXAMPLE), { readOnly }))?.[0];
    expect(fieldset(true)).toMatch(/ disabled=""/);
    expect(fieldset(false)).not.toMatch(/ disabled=""/);
  });
});

describe("weight capture, one value per size (SAFEDON_EG)", () => {
  const data = weightData(SAFEDON_EG_EXAMPLE.weight);
  const html = render("SAFEDON_EG", data, exampleContext(SAFEDON_EG_EXAMPLE));

  it("is one table row per ordered size, no tabs, in Safedon's wording", () => {
    expect(tags(html, 'role="tab"')).toHaveLength(0);
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(4);
    expect(tags(html, 'aria-label="Weight \\(g\\), size XS"')[0]).toContain('value="2.56"');
    expect(html).toContain(">A / Rej.<");
    expect(html).toContain(">Spec.<");
    expect(html).toContain(">NA<");
    const pills = tags(html, 'data-slot="status-pill"');
    expect(pills.slice(0, 4).every((pill) => pill.includes('data-status="info"'))).toBe(true);
    expect(html).toContain("<span>A</span>");
  });

  it("runs Enter and a pasted column down the sizes, one column of the table", () => {
    const cells = tags(html, 'data-slot="numeric-cell"');
    expect(cells.every((cell) => cell.includes('data-enter-group="values"'))).toBe(true);
  });

  it("marks the value calc refuses, and lists the problem as a link", () => {
    const zero = render("SAFEDON_EG", { sizes: { ...data.sizes, S: { values: [0] } } }, exampleContext(SAFEDON_EG_EXAMPLE));
    // The cell is drawn in fail red and described by calc's message.
    const marked = (size: string) => {
      const cell = tags(zero, `aria-label="Weight \\(g\\), size ${size}"`)[0];
      const classes = /class="([^"]*)"/.exec(cell)?.[1].split(" ") ?? [];
      return classes.includes("ring-fail") && /aria-describedby="[^"]*calc-error"/.test(cell);
    };
    expect(marked("S")).toBe(true);
    expect(marked("XS")).toBe(false);
    expect(zero).toContain("Size S, Weight (g): must be more than 0 g.");
    expect(tags(zero, 'aria-label="Problems with the weights"')).toHaveLength(1);
  });

  it("sizes its result pills for touch: 16 px text on iPad", () => {
    const pills = tags(html, 'data-slot="status-pill"');
    expect(pills.length).toBeGreaterThan(0);
    expect(pills.every((pill) => pill.includes("touch:text-base"))).toBe(true);
  });

  it("compares size M with the indicative weight: within the threshold", () => {
    const note = html.slice(html.indexOf('data-slot="weight-deviation"'));
    expect(note).toContain("-0.6");
    expect(tags(note, 'data-slot="status-pill"')[0]).toContain('data-status="pass"');
    expect(html.match(/data-slot="weight-deviation"/g)).toHaveLength(1);
  });

  it("leaves out the Spec. column when no size has a spec", () => {
    const config = { ...templateConfig("STD_EG"), n: 1 };
    const noSpecs = render("STD_EG", { sizes: { M: { values: [2.9] } } }, makeTestContext({ sizes: ["M"] }), { config });
    expect(tags(noSpecs, 'data-slot="numeric-cell"')).toHaveLength(1);
    expect(noSpecs).not.toContain(">Spec.<");
    expect(noSpecs).toContain(">Remark<");
  });

  it("makes the values read-only", () => {
    const readOnly = render("SAFEDON_EG", data, exampleContext(SAFEDON_EG_EXAMPLE), { readOnly: true });
    const cells = tags(readOnly, 'data-slot="numeric-cell"');
    expect(cells).toHaveLength(4);
    expect(cells.every((input) => /readonly/i.test(input))).toBe(true);
  });

  it("says that no size is ordered yet", () => {
    expect(render("SAFEDON_EG", data, makeTestContext())).toContain("No sizes ordered yet.");
  });
});
