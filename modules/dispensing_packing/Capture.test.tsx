// Server-rendered markup of the capture body: sizes, rows, wording, live
// results, issue links and the read-only form. The kit's controls are tested
// in components/qc; the calculations in calc.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { cartonList, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { calcDispensingPacking, type DispensingPackingComputed } from "./calc";
import Capture from "./Capture";
import { DISPENSING_PACKING_DEFAULT_CONFIG, DISPENSING_PACKING_LABELS, type DispensingPackingConfig } from "./config";
import { DispensingPackingDataSchema, type DispensingPackingData } from "./schema";

const noop = () => {};

function stdEgData(): DispensingPackingData {
  const boxes = STD_EG_EXAMPLE.dispensingPacking.perSize.M!.boxes.map((box) => ({
    boxNo: box.box,
    layeringPct: box.layeringPct,
    dispensingPct: box.dispensingPct,
    stickiness: box.stickiness,
  }));
  return DispensingPackingDataSchema.parse({ sizes: { M: { boxes }, XL: { boxes: boxes.slice(0, 2) } } });
}

const CONTEXT = makeTestContext({
  sizes: ["M"],
  cartons: { M: cartonList(STD_EG_EXAMPLE.cartons.M!) },
  sampling: { M: makeSampling({ packagingDispensing: 13 }) },
});

function render({
  data = stdEgData(),
  config = DISPENSING_PACKING_DEFAULT_CONFIG,
  labels = DISPENSING_PACKING_LABELS,
  context = CONTEXT,
  readOnly = false,
  evaluated = true,
  broken = false,
}: {
  data?: DispensingPackingData;
  config?: DispensingPackingConfig;
  labels?: Readonly<Record<string, string>>;
  context?: InspectionContext;
  readOnly?: boolean;
  evaluated?: boolean;
  /** As the engine returns a module whose settings are invalid: no computed values. */
  broken?: boolean;
} = {}): string {
  const ordered = { sizes: Object.fromEntries(context.sizes.flatMap((size) => (data.sizes[size] ? [[size, data.sizes[size]]] : []))) };
  const output = calcDispensingPacking({ data: ordered, config, title: "Glove Packing Check", labels, context, results: {}, hasData: true });
  const evaluation: ModuleEvaluation<DispensingPackingComputed> = {
    key: "dispensing_packing",
    title: "Glove Packing Check",
    labels,
    config,
    data: ordered,
    hasData: true,
    comment: null,
    computed: broken ? ({} as DispensingPackingComputed) : output.computed,
    result: broken ? { status: "not_done", summary: "Template settings are invalid." } : output.result,
    issues: output.issues.map((issue) => ({ ...issue, moduleKey: "dispensing_packing" })),
    stub: false,
  };
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title="Glove Packing Check"
      labels={labels}
      context={context}
      evaluation={evaluated ? evaluation : null}
      focusPath={null}
      readOnly={readOnly}
      onChange={noop}
      onFocusChange={noop}
    />,
  );
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe("dispensing_packing capture", () => {
  it("shows only the ordered sizes, whatever is saved for others (6.2 rule 4)", () => {
    const html = render();
    expect(count(html, 'role="tab"')).toBe(1);
    expect(html).toContain('data-size="M"');
    expect(html).not.toContain('data-size="XL"');
  });

  it("has one row per planned box with the template's column wording, and the heading filled in", () => {
    const html = render();
    expect(count(html, 'aria-label="Box #, Item ')).toBe(13);
    for (const heading of ["Item", "Box #", "Layering %", "Dispensing %", "Stickiness **", "Others:"]) {
      expect(html).toContain(`>${heading}</th>`);
    }
    expect(html).toContain("Glove Packing Check (Sampling Code Letter E) : Min. 70% Layering &amp; 80% Dispensing");
  });

  it("keeps the column headings stuck below the size bar while the rows scroll", () => {
    const html = render();
    expect(/<thead[^>]*>/.exec(html)?.[0]).toContain(
      "sticky top-[calc(var(--capture-sticky-top,0px)_+_var(--size-tabs-bar,0px))]",
    );
    // The table's frame clips instead of scrolling: a scroller would unstick the headings
    // and, on iPad, take the swipe that turns the size.
    const frame = /<div[^>]*>(?=<table)/.exec(html)?.[0];
    expect(frame).toContain("overflow-clip");
    expect(frame).not.toContain("overflow-x-auto");
    // A cell reached with Enter, Shift+Enter or Tab scrolls clear of the size bar and of the
    // heading row as tall as it is measured (the template's wording can wrap it), not a guess.
    expect(/<tbody[^>]*>/.exec(html)?.[0]).toContain(
      "scroll-mt-[calc(var(--size-tabs-bar,0px)_+_var(--packing-head,3rem))]",
    );
  });

  it("uses the template's labels and its rows per size when the sampling plan is silent", () => {
    const labels = { ...DISPENSING_PACKING_LABELS, itemColumn: "No.", boxNo: "Box Number", layeringPct: "Layering (%)" };
    const config = { ...DISPENSING_PACKING_DEFAULT_CONFIG, boxesPerSize: { default: 13, bySize: { XL: 5 } } };
    const html = render({ data: { sizes: {} }, labels, config, context: makeTestContext({ sizes: ["XL"] }) });
    expect(count(html, 'aria-label="Box Number, No. ')).toBe(5);
    expect(html).toContain(">Layering (%)</th>");
    expect(html).not.toContain(">Layering %</th>");
  });

  it("marks every value for issue links, and takes the box numbers as typed, on the numeric keypad", () => {
    const html = render();
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;boxes&quot;,11,&quot;boxNo&quot;]"');
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;boxes&quot;,0,&quot;layeringPct&quot;]"');
    const field = (item: number) => new RegExp(`<input[^>]*aria-label="Box #, Item ${item}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(field(1)).toContain('inputMode="numeric"');
    // The STD_EG box 2336 is in no carton list, and that is no problem: box numbers are not carton numbers (6.2 rule 7).
    expect(field(12)).toContain('value="2336"');
    expect(field(12)).not.toContain('aria-invalid="true"');
    expect(html).not.toContain("carton list");
    expect(html).not.toContain('data-slot="box-issues"');
    expect(count(html, 'data-outcome="pass"')).toBe(3);
  });

  it("lists every problem calc finds in a row of the size on screen, in row order, with a link to its cell", () => {
    const boxes = stdEgData().sizes.M.boxes.map((box, index) =>
      index === 2 ? { ...box, stickiness: "Z" } : index === 9 ? { ...box, layeringPct: 880 } : box,
    );
    const html = render({ data: { sizes: { M: { boxes } } } });
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(count(list, "<li")).toBe(2);
    expect(list).toContain("Stickiness &quot;Z&quot; (item 3) for size M is not one of this template&#x27;s codes");
    expect(list).toContain("Layering 880% (item 10) for size M is not between 0 and 100%.");
    expect(list.indexOf("(item 3)")).toBeLessThan(list.indexOf("(item 10)"));
    expect(count(list, "<button")).toBe(2);
    expect(list).toContain("text-fail");
    // A 44 px target on the iPad, below the table, as the refused entries are.
    expect(list).toContain("touch:min-h-11");
    expect(html.indexOf('data-slot="box-issues"')).toBeGreaterThan(html.indexOf("</table>"));
  });

  it("titles the stickiness legend one level under the section's heading, as the photos are", () => {
    const html = render();
    expect(html).toMatch(/<h3[^>]*>Glove Stickiness Code<\/h3>/);
    expect(html).not.toContain("<h4");
  });

  it("offers the template's stickiness codes and shows its legend", () => {
    const html = render();
    expect(count(html, '<option value="B1">B1</option>')).toBe(13);
    expect(html).toContain("A mix of non sticky to light stickiness at the bead");
    expect(html).toContain("Glove Stickiness Code");
    // The legend's pills at the kit's touch size, 16 px on iPad.
    const legend = /<dl[\s\S]*?<\/dl>/.exec(html)?.[0] ?? "";
    const pills = legend.match(/<span[^>]*data-slot="status-pill"[^>]*>/g) ?? [];
    expect(pills).toHaveLength(DISPENSING_PACKING_DEFAULT_CONFIG.stickinessCodes.length);
    expect(pills.every((pill) => pill.includes("touch:text-base"))).toBe(true);
  });

  it("shows each stickiness cell as a picker: a chevron, and Pick while empty", () => {
    const html = render({ data: { sizes: { M: { boxes: stdEgData().sizes.M.boxes.slice(0, 5) } } } });
    const cell = (item: number) =>
      new RegExp(`<select[^>]*aria-label="Stickiness \\*\\*, Item ${item}"[^>]*>[\\s\\S]*?</select><svg[^>]*>`).exec(html)?.[0] ??
      "";
    expect(cell(6)).toContain('data-empty="true"');
    expect(cell(6)).toContain('<option value="" selected="">Pick</option>');
    expect(cell(6)).toContain("lucide-chevron-down");
    // With a code picked, the empty option clears it.
    expect(cell(1)).not.toContain('data-empty="true"');
    expect(cell(1)).toContain('<option value="">—</option>');
    expect(cell(1)).toContain("lucide-chevron-down");
    // Read-only, a missing code stays the screen's dash for no value.
    const readOnly = render({ data: { sizes: {} }, readOnly: true });
    expect(readOnly).not.toContain("Pick");
    expect(readOnly).not.toContain("lucide-chevron-down");
  });

  it("shows calc's averages and Passed live, and Not Done until the boxes are complete", () => {
    const html = render();
    expect(html).toContain("88.3");
    expect(html).toContain("90.3");
    expect(html).toContain("≥ 70%");
    expect(html).toContain("≥ 80%");
    expect(count(html, 'data-outcome="pass"')).toBe(3);
    const partial = render({ data: { sizes: { M: { boxes: stdEgData().sizes.M.boxes.slice(0, 5) } } } });
    expect(count(partial, 'data-outcome="not_done"')).toBe(3);
    expect(partial).toContain("5 of 13 boxes complete.");
    expect(count(render({ evaluated: false }), 'data-outcome="not_done"')).toBe(3);
  });

  it("still renders, everything Not Done, when the engine could not compute the module", () => {
    const html = render({ broken: true });
    expect(count(html, 'data-outcome="not_done"')).toBe(3);
    expect(html).toContain("Sampling Code Letter —");
  });

  it("is read-only when the inspection is not the user's to edit", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain("Add Box");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="combobox"');
    // The box numbers as read-only fields: still reached by the keyboard and issue links, never typed in.
    expect(/<input[^>]*aria-label="Box #, Item 12"[^>]*>/.exec(html)?.[0]).toContain('value="2336"');
    expect(/<input[^>]*aria-label="Box #, Item 12"[^>]*>/.exec(html)?.[0]).toContain("readOnly");
    expect(render()).toContain("Add Box");
  });
});
