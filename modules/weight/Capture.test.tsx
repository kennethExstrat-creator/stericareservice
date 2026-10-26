// Server-rendered markup of the Weight body for the two example reports:
// one value per size, the size's average weight (Kenneth, 26 October 2026).
// Typing, Enter and paste are the kit's own (NumberField, EnterGroup) and
// were exercised there in a browser.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TemplateCode } from "@/lib/coverage";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { exampleContext, gloveByGloveData, templateConfig, templateLabels, templateTitle, weightData } from "./__fixtures__/examples";
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

/** The opening tag of the size's weight cell. */
const cellOf = (html: string, size: string): string => tags(html, `aria-label="Weight \\(g\\), Size ${size}"`)[0] ?? "";

describe("weight capture, one average per size (STD_EG, whose n of 13 is no longer used)", () => {
  const data = weightData(STD_EG_EXAMPLE.weight);
  const html = render("STD_EG", data, exampleContext(STD_EG_EXAMPLE));

  it("is one table row per ordered size, its value the report's average, with no tabs and no grid of gloves", () => {
    expect(tags(html, 'role="tab"')).toHaveLength(0);
    expect(tags(html, 'data-slot="measurement-grid"')).toHaveLength(0);
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(1);
    expect(cellOf(html, "M")).toContain('value="2.90"');
    expect(html).toContain(">Remark<");
    // STD_EG sets no weight spec.
    expect(html).not.toContain(">Spec.<");
    expect(html).not.toContain("No. 1");
  });

  it("shows the deviation from the indicative weight as a warning", () => {
    const note = html.slice(html.indexOf('data-slot="weight-deviation"'));
    expect(note).toContain("Deviation From Indicative Weight, Size M");
    expect(note).toContain("-17.1");
    expect(note).toContain("Indicative 3.5 g, Threshold 10%");
    expect(tags(note, 'data-slot="status-pill"')[0]).toContain('data-status="warn"');
  });

  it("keeps the weight focusable but unchangeable when read-only", () => {
    const readOnly = render("STD_EG", data, exampleContext(STD_EG_EXAMPLE), { readOnly: true });
    const cells = tags(readOnly, 'data-slot="numeric-cell"');
    expect(cells).toHaveLength(1);
    expect(cells[0]).toContain('readOnly=""');
    expect(cells[0]).not.toMatch(/\sdisabled=""/);
    expect(tags(html, 'data-slot="numeric-cell"').some((cell) => cell.includes("readOnly"))).toBe(false);
  });

  it("marks the weight's field with the path calc's issues point at", () => {
    const path = JSON.stringify(["sizes", "M", "values", 0]).replaceAll('"', "&quot;");
    const fields = tags(html, 'data-slot="number-field"');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toContain(`data-issue-path="${path}"`);
  });

  it("lets the deviation warning's issue link land on its note", () => {
    const note = tags(html, 'data-slot="weight-deviation"')[0];
    expect(note).toContain('tabindex="-1"');
    expect(note).toContain(`data-issue-path="${JSON.stringify(["sizes", "M", "values"]).replaceAll('"', "&quot;")}"`);
  });

  it("shows an inspection saved before 26 October 2026, its 13 gloves weighed one by one, as their average", () => {
    const older = render("STD_EG", gloveByGloveData(STD_EG_EXAMPLE.weight), exampleContext(STD_EG_EXAMPLE));
    expect(tags(older, 'data-slot="numeric-cell"')).toHaveLength(1);
    expect(cellOf(older, "M")).toContain('value="2.90"');
    const varied = render("STD_EG", { sizes: { M: { values: [2.85, 2.95, 2.9] } } }, exampleContext(STD_EG_EXAMPLE));
    expect(cellOf(varied, "M")).toContain('value="2.90"');
    expect(varied).not.toContain("not counted");
  });
});

describe("weight capture, one value per size (SAFEDON_EG)", () => {
  const data = weightData(SAFEDON_EG_EXAMPLE.weight);
  const html = render("SAFEDON_EG", data, exampleContext(SAFEDON_EG_EXAMPLE));

  it("is one table row per ordered size, no tabs, in Safedon's wording", () => {
    expect(tags(html, 'role="tab"')).toHaveLength(0);
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(4);
    expect(cellOf(html, "XS")).toContain('value="2.56"');
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

  it("edges each value cell as MeasurementGrid edges its cells, so an empty one shows where the weight goes", () => {
    const empty = render("SAFEDON_EG", { sizes: {} }, exampleContext(SAFEDON_EG_EXAMPLE));
    const cells = Array.from(empty.matchAll(/<td class="([^"]*)"><div data-slot="number-field"/g), (match) => match[1].split(" "));
    expect(cells).toHaveLength(4);
    expect(cells.every((classes) => classes.includes("border-x") && classes.includes("border-border"))).toBe(true);
  });

  it("marks the value calc refuses, and lists the problem as a link", () => {
    const zero = render("SAFEDON_EG", { sizes: { ...data.sizes, S: { values: [0] } } }, exampleContext(SAFEDON_EG_EXAMPLE));
    // The cell is drawn in fail red and described by calc's message.
    const marked = (size: string) => {
      const cell = cellOf(zero, size);
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

  it("compares size M with the indicative weight: within the threshold, which is no verdict", () => {
    const note = html.slice(html.indexOf('data-slot="weight-deviation"'));
    expect(note).toContain("-0.6");
    // A neutral note, not a green Passed beside the size's "A".
    expect(tags(note, 'data-slot="status-pill"')[0]).toContain('data-status="info"');
    expect(note).toContain("<span>Within 10%</span>");
    expect(note).not.toContain("Passed");
    expect(html.match(/data-slot="weight-deviation"/g)).toHaveLength(1);
  });

  it("shows a size holding several values as their average, with nothing past it to remove", () => {
    const extra = { sizes: { ...data.sizes, M: { values: [3.18, 3.2] } } };
    const shown = render("SAFEDON_EG", extra, exampleContext(SAFEDON_EG_EXAMPLE));
    expect(cellOf(shown, "M")).toContain('value="3.19"');
    expect(shown).not.toContain("Remove");
    expect(shown).not.toContain("not counted");
  });

  it("leaves out the Spec. column when no size has a spec", () => {
    const noSpecs = render("STD_EG", { sizes: { M: { values: [2.9] } } }, makeTestContext({ sizes: ["M"] }));
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
