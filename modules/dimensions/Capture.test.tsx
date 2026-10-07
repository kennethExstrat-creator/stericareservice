// Server-rendered markup of the Dimension body: what the inspector sees for
// the example reports. Typing, Enter, paste and swipes are the kit's own
// (MeasurementGrid, SizeTabs) and were exercised there in a browser.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TemplateCode } from "@/lib/coverage";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { dimensionsData, exampleContext, templateConfig, templateLabels } from "./__fixtures__/examples";
import type { DimensionsComputed } from "./calc";
import Capture from "./Capture";
import { DIMENSIONS_TITLE } from "./config";
import { emptyDimensions, emptyGlove, type DimensionsData } from "./schema";

const noop = () => {};

function render(
  code: TemplateCode,
  data: DimensionsData,
  context: InspectionContext,
  { readOnly = false }: { readOnly?: boolean } = {},
): string {
  const config = templateConfig(code);
  const labels = templateLabels(code);
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "dimensions", config, labels }]);
  // The engine holds every module's evaluation with its computed values erased, as the screen does.
  const evaluation = (evaluateInspection(
    { template, data: { modules: { dimensions: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((module) => module.key === "dimensions") ?? null) as ModuleEvaluation<DimensionsComputed> | null;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={DIMENSIONS_TITLE}
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

describe("dimensions capture", () => {
  const stdEg = dimensionsData(STD_EG_EXAMPLE.dimensions);

  it("shows the ordered sizes only: STD_EG ordered M, not XS, S, L or XL (6.2 rule 4)", () => {
    const html = render("STD_EG", { sizes: { ...stdEg.sizes, XL: { gloves: [emptyGlove()] } } }, exampleContext(STD_EG_EXAMPLE));
    const tabs = tags(html, 'role="tab"');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toContain('data-size="M"');
    expect(html).toContain("Dimension - Size M");
    expect(html).not.toContain("Dimension - Size XL");
    // The size_not_ordered warning about XL belongs to the screen's issue list, not under size M.
    expect(html).not.toContain("Problems in this size");
  });

  it("is one grid of 13 gloves by the template's measures, in its wording, with the readings", () => {
    const html = render("STD_EG", stdEg, exampleContext(STD_EG_EXAMPLE));
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(13 * 5);
    for (const label of ["Length", "Width", "Finger Thickness", "Palm Thickness", "Cuff Thickness", "Median", "Spec.", "P/F *"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(tags(html, 'aria-label="Length, No. 1"')[0]).toContain('value="245"');
    expect(tags(html, 'aria-label="Finger Thickness, No. 1"')[0]).toContain('value="0.08"');
    expect(html).toContain("≥ 240");
    expect(html).toContain("95 ± 10");
  });

  it("reads SAFEDON_EG's wording and measures: Average, A / Rej., no cuff", () => {
    const html = render("SAFEDON_EG", dimensionsData(SAFEDON_EG_EXAMPLE.dimensions), exampleContext(SAFEDON_EG_EXAMPLE));
    expect(tags(html, 'role="tab"')).toHaveLength(4);
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(13 * 4);
    expect(html).toContain(">Average<");
    expect(html).toContain(">A / Rej.<");
    expect(html).not.toContain("Cuff Thickness");
    expect(html).toContain("Dimension - Size XS");
    expect(html).toContain("76 ± 4");
  });

  it("takes the gloves per size from the sampling plan", () => {
    const html = render("STD_EG", stdEg, exampleContext(STD_EG_EXAMPLE, { sampling: {} }));
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(13 * 5);
    const planned = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions: 5 }) } });
    expect(tags(render("STD_EG", stdEg, planned), 'data-slot="numeric-cell"')).toHaveLength(5 * 5);
  });

  it("lists calc's problems for the size, each a link to its cell", () => {
    const data = { sizes: { M: { gloves: [{ ...emptyGlove(), width: 0 }] } } };
    const html = render("STD_EG", data, exampleContext(STD_EG_EXAMPLE));
    expect(html).toContain("Size M, Width No. 1: must be more than 0 mm.");
    expect(tags(html, 'aria-label="Problems in this size"')).toHaveLength(1);
  });

  it("offers to remove the readings past the planned gloves, which have no row, unless read-only", () => {
    // The sampling plan went down to 10 gloves after 13 were measured.
    const planned = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions: 10 }) } });
    const action = "Remove the readings that are not counted";
    const html = render("STD_EG", stdEg, planned);
    expect(html).toContain(`>${action}</button>`);
    // The button is described by its warning, which names the size and the gloves.
    const button = tags(html, 'data-slot="button"[^>]*aria-describedby')[0];
    const describedBy = /aria-describedby="([^"]*)"/.exec(button)?.[1];
    expect(html).toContain(`<span id="${describedBy}">Size M: readings for No. 11 to 13 are not counted`);
    expect(render("STD_EG", stdEg, exampleContext(STD_EG_EXAMPLE))).not.toContain(action);
    expect(render("STD_EG", stdEg, planned, { readOnly: true })).not.toContain(action);
  });

  it("keeps the readings focusable but unchangeable when read-only", () => {
    const html = render("STD_EG", stdEg, exampleContext(STD_EG_EXAMPLE), { readOnly: true });
    const cells = tags(html, 'data-slot="numeric-cell"');
    expect(cells).toHaveLength(13 * 5);
    for (const cell of cells) {
      expect(cell).toContain('readOnly=""');
      expect(cell).not.toMatch(/\sdisabled=""/);
    }
    expect(html).not.toContain("<fieldset");
    const editable = tags(render("STD_EG", stdEg, exampleContext(STD_EG_EXAMPLE)), 'data-slot="numeric-cell"');
    expect(editable.some((cell) => cell.includes("readOnly"))).toBe(false);
  });

  it("marks each cell with the path calc's issues point at, so an issue link reaches it", () => {
    const html = render("STD_EG", stdEg, exampleContext(STD_EG_EXAMPLE));
    const path = (row: number, measure: string) =>
      `data-issue-path="${JSON.stringify(["sizes", "M", "gloves", row, measure]).replaceAll('"', "&quot;")}"`;
    expect(tags(html, 'aria-label="Width, No. 4"')[0]).toContain(path(3, "width"));
    expect(tags(html, 'aria-label="Cuff Thickness, No. 13"')[0]).toContain(path(12, "cuffThickness"));
  });

  it("shows calc's statistic and verdict in the footer, in the template's words", () => {
    const html = render("SAFEDON_EG", dimensionsData(SAFEDON_EG_EXAMPLE.dimensions), exampleContext(SAFEDON_EG_EXAMPLE));
    const footer = /<tfoot[\s\S]*?<\/tfoot>/.exec(html)?.[0] ?? "";
    // SAFEDON_EG words a pass "A" (A / Rej.), never "Passed".
    expect(footer).toMatch(/data-status="pass"[^>]*><svg[\s\S]*?<\/svg><span>A<\/span>/);
    expect(footer).not.toContain(">Passed<");
  });

  it("lets an issue link land on the warning about readings past the plan", () => {
    const planned = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ dimensions: 10 }) } });
    const notice = tags(render("STD_EG", stdEg, planned), 'tabindex="-1"');
    expect(notice).toHaveLength(1);
    expect(notice[0]).toContain(
      `data-issue-path="${JSON.stringify(["sizes", "M", "gloves", 10]).replaceAll('"', "&quot;")}"`,
    );
  });

  it("says that no size is ordered yet", () => {
    expect(render("STD_EG", emptyDimensions(), makeTestContext())).toContain("No sizes ordered yet.");
  });
});
