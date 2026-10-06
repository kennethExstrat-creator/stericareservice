// Server-rendered markup of the capture body: sizes, box columns, counters,
// wording, live totals, issue links and the read-only form. The kit's
// controls are tested in components/qc; the calculations in calc.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { cartonList, SAFEDON_DEFECTS, SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { calcDispensingSafedon, type DispensingSafedonComputed } from "./calc";
import Capture from "./Capture";
import { DISPENSING_SAFEDON_DEFAULT_CONFIG, DISPENSING_SAFEDON_LABELS, type DispensingSafedonConfig } from "./config";
import { DispensingSafedonDataSchema, type DispensingSafedonData } from "./schema";

const noop = () => {};
const EXAMPLE = SAFEDON_EG_EXAMPLE.dispensingSafedon;
const ORDERED = SAFEDON_EG_EXAMPLE.sizesOrdered;

function safedonData(): DispensingSafedonData {
  const sizes = Object.fromEntries(
    Object.entries(EXAMPLE.perSize).map(([size, entry]) => [
      size,
      {
        boxes: entry!.boxes.map((boxNo, index) => ({
          boxNo,
          counts: Object.fromEntries(SAFEDON_DEFECTS.map((code) => [code, entry!.counts[code][index]])),
        })),
      },
    ]),
  );
  return DispensingSafedonDataSchema.parse({ sizes: { ...sizes, XL: { boxes: [{ boxNo: 1, counts: { sticky: 9 } }] } } });
}

const CONTEXT = makeTestContext({
  sizes: ORDERED,
  cartons: Object.fromEntries(ORDERED.map((size) => [size, cartonList(SAFEDON_EG_EXAMPLE.cartons[size]!)])),
  sampling: Object.fromEntries(
    ORDERED.map((size) => [size, makeSampling({ packagingDispensing: SAFEDON_EG_EXAMPLE.sampling[size]!.dispensingInners })]),
  ),
});

function render({
  data = safedonData(),
  config = DISPENSING_SAFEDON_DEFAULT_CONFIG,
  labels = DISPENSING_SAFEDON_LABELS,
  context = CONTEXT,
  readOnly = false,
  broken = false,
}: {
  data?: DispensingSafedonData;
  config?: DispensingSafedonConfig;
  labels?: Readonly<Record<string, string>>;
  context?: InspectionContext;
  readOnly?: boolean;
  /** As the engine returns a module whose settings are invalid: no computed values. */
  broken?: boolean;
} = {}): string {
  const ordered = { sizes: Object.fromEntries(context.sizes.flatMap((size) => (data.sizes[size] ? [[size, data.sizes[size]]] : []))) };
  const output = calcDispensingSafedon({
    data: ordered,
    config,
    title: "Glove Dispensing Inspection",
    labels,
    context,
    results: {},
    hasData: true,
  });
  const evaluation: ModuleEvaluation<DispensingSafedonComputed> = {
    key: "dispensing_safedon",
    title: "Glove Dispensing Inspection",
    labels,
    config,
    data: ordered,
    hasData: true,
    comment: null,
    computed: broken ? ({} as DispensingSafedonComputed) : output.computed,
    result: broken ? { status: "not_done", summary: "Template settings are invalid." } : output.result,
    issues: output.issues.map((issue) => ({ ...issue, moduleKey: "dispensing_safedon" })),
    stub: false,
  };
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title="Glove Dispensing Inspection"
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

const count = (html: string, text: string) => html.split(text).length - 1;

describe("dispensing_safedon capture", () => {
  it("shows only the ordered sizes, with their results, and the heading's code letters", () => {
    const html = render();
    expect(count(html, 'role="tab"')).toBe(4);
    for (const size of ORDERED) expect(html).toContain(`data-size="${size}"`);
    expect(html).not.toContain('data-size="XL"');
    expect(html).toContain(EXAMPLE.printedTitle.replace("&", "&amp;"));
  });

  it("has a box picker per planned column, holding the box numbers picked from the carton list", () => {
    const html = render();
    expect(count(html, 'aria-label="Box #, column ')).toBe(5);
    for (const box of EXAMPLE.perSize.XS!.boxes) expect(html).toContain(`>${box}</span>`);
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;XS&quot;,&quot;boxes&quot;,4,&quot;boxNo&quot;]"');
  });

  it("counts the six defects by tapping, with the app's definitions as hints", () => {
    const html = render();
    for (const defect of DISPENSING_SAFEDON_DEFAULT_CONFIG.defects) {
      expect(html).toContain(defect.label);
      expect(html).toContain(defect.hint);
    }
    expect(html).toContain('aria-label="Increase No cuff, box 33"');
    expect(html).toContain(
      'data-issue-path="[&quot;sizes&quot;,&quot;XS&quot;,&quot;boxes&quot;,4,&quot;counts&quot;,&quot;no_cuff&quot;]"',
    );
  });

  it("shows the per-box lines and the size total live, against the maximum", () => {
    const html = render();
    expect(html).toContain("1/125");
    expect(html).toContain("2/125");
    expect(html).toContain("0.016");
    expect(html).toContain("3 / 625 (0.48%)");
    expect(html).toContain("≤ 5%");
    expect(html).toContain('data-outcome="pass"');
    for (const label of ["Defects / gloves per pack", "Defect rate", "Specification / Requirement", "Conclusion"]) {
      expect(html).toContain(label);
    }
  });

  it("is not done while boxes are missing, and says how many are tested", () => {
    const data = safedonData();
    const partial = render({ data: { sizes: { ...data.sizes, XS: { boxes: data.sizes.XS.boxes.slice(0, 3) } } } });
    expect(partial).toContain('data-outcome="not_done"');
    expect(partial).toContain("3 of 5 boxes tested.");
    expect(partial).toContain("Boxes tested: 3 / 5");
  });

  it("uses the template's wording and its defect list", () => {
    const labels = { ...DISPENSING_SAFEDON_LABELS, counts: "Dispensing defects", boxNo: "Pack No." };
    const config = {
      ...DISPENSING_SAFEDON_DEFAULT_CONFIG,
      defects: [{ code: "stuck", label: "Stuck in the pack", hint: "" }],
    };
    const html = render({ labels, config });
    expect(html).toContain("Dispensing defects");
    expect(html).toContain('aria-label="Pack No., column 1"');
    expect(html).toContain("Stuck in the pack");
    expect(html).not.toContain("No cuff");
  });

  it("still renders, Not done, when the engine could not compute the module", () => {
    const html = render({ broken: true });
    expect(html).toContain('data-outcome="not_done"');
    expect(html).toContain("Sampling code letter —");
    expect(html).toContain("1/125");
  });

  it("is read-only when the inspection is not the user's to edit", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain("Add box");
    expect(html).not.toContain('role="spinbutton"');
    expect(html).not.toContain('role="combobox"');
    expect(render()).toContain("Add box");
  });
});
