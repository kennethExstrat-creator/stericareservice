// Server-rendered markup of the capture body: sizes, rows, wording, live
// results, issue links and the read-only form. The kit's controls are tested
// in components/qc; the calculations in calc.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { cartonList, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { passingAgedSample } from "./__fixtures__/examples";
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
  // As the engine hands calc the data: the ordered sizes, and the step's own fields ("Aged Sample?") as saved.
  const ordered = {
    ...data,
    sizes: Object.fromEntries(context.sizes.flatMap((size) => (data.sizes[size] ? [[size, data.sizes[size]]] : []))),
  };
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
    expect(count(html, 'aria-label="Box/Carton #, Item ')).toBe(13);
    for (const heading of ["Item", "Box/Carton #", "Layering %", "Dispensing %", "Stickiness **", "Others:"]) {
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

  it("marks every value for issue links, types the box/carton numbers on the numeric keypad with the size's sampled numbers suggested", () => {
    const html = render();
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;boxes&quot;,11,&quot;boxNo&quot;]"');
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;boxes&quot;,0,&quot;layeringPct&quot;]"');
    const field = (item: number) => new RegExp(`<input[^>]*aria-label="Box/Carton #, Item ${item}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(field(1)).toContain('inputMode="numeric"');
    // Size M has a sampled list (BUILD_SPEC 6.2 rule 7; Kenneth, 13 October 2026): each field suggests its numbers.
    expect(field(1)).toContain('role="combobox"');
    expect(field(1)).toContain('aria-autocomplete="list"');
    // The STD_EG box 2336 is in no carton list: stored as typed, amber, never an error, and the size passes.
    expect(field(12)).toContain('value="2336"');
    expect(field(12)).not.toContain('aria-invalid="true"');
    expect(field(12)).toContain("bg-warn-tint");
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(count(list, "<li")).toBe(1);
    expect(list).toContain("Box/Carton #2336 is not in M&#x27;s sampled box/carton numbers.");
    expect(list).toContain("text-warn");
    expect(list).not.toContain("text-fail");
    expect(count(html, 'data-outcome="pass"')).toBe(3);
  });

  it("is a plain number field while the size has no sampled list, and warns about nothing", () => {
    // Its aged sample entered too: nothing else to warn about.
    const data = stdEgData();
    data.sizes.M.agedSample = passingAgedSample();
    const html = render({ data, context: makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ packagingDispensing: 13 }) } }) });
    const field = /<input[^>]*aria-label="Box\/Carton #, Item 12"[^>]*>/.exec(html)?.[0] ?? "";
    expect(field).toContain('value="2336"');
    expect(field).not.toContain('role="combobox"');
    expect(field).not.toContain("bg-warn-tint");
    expect(html).not.toContain('data-slot="box-issues"');
  });

  it("lists every problem calc finds in a row of the size on screen, in row order, with a link to its cell", () => {
    const boxes = stdEgData().sizes.M.boxes.map((box, index) =>
      index === 2 ? { ...box, stickiness: "Z" } : index === 9 ? { ...box, layeringPct: 880 } : box,
    );
    const html = render({ data: { sizes: { M: { boxes } } } });
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    // Two errors and item 12's warning (box 2336, not sampled for size M), in row order.
    expect(count(list, "<li")).toBe(3);
    expect(list).toContain("Stickiness &quot;Z&quot; (item 3) for size M is not one of this template&#x27;s codes");
    expect(list).toContain("Layering 880% (item 10) for size M is not between 0 and 100%.");
    expect(list.indexOf("(item 3)")).toBeLessThan(list.indexOf("(item 10)"));
    expect(list.indexOf("(item 10)")).toBeLessThan(list.indexOf("Box/Carton #2336"));
    expect(count(list, "<button")).toBe(3);
    expect(list).toContain("text-fail");
    expect(list).toContain("text-warn");
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
    // In each of the 13 box rows and in the aged sample's row.
    expect(count(html, '<option value="B1">B1</option>')).toBe(13 + 1);
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
    expect(/<input[^>]*aria-label="Box\/Carton #, Item 12"[^>]*>/.exec(html)?.[0]).toContain('value="2336"');
    expect(/<input[^>]*aria-label="Box\/Carton #, Item 12"[^>]*>/.exec(html)?.[0]).toContain("readOnly");
    expect(render()).toContain("Add Box");
  });
});

describe("dispensing_packing capture: the aged sample (Kenneth, 26 October 2026)", () => {
  const AGED = { layeringPct: 88, dispensingPct: 86, stickiness: "B", note: "Aged sample" };
  const withAged = (agedSample: Partial<typeof AGED>, boxes = stdEgData().sizes.M.boxes) =>
    DispensingPackingDataSchema.parse({ sizes: { M: { boxes, agedSample } } });
  /** The size's Aged Sample section. */
  const agedSection = (html: string) =>
    /<section[^>]*data-issue-path="\[&quot;sizes&quot;,&quot;M&quot;,&quot;agedSample&quot;\]"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  /** Size M's tab, with its result. */
  const sizeTab = (html: string) => /<button[^>]*role="tab"[^>]*data-size="M"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";

  it("gives the size a section of its own under the boxes and their results: one row of their values, no box/carton number", () => {
    const html = render();
    const section = agedSection(html);
    expect(section).toMatch(/<h3[^>]*>Aged Sample<\/h3>/);
    expect(section).toContain("Judged on its own: not counted with the boxes or in their averages.");
    expect(html.indexOf(section)).toBeGreaterThan(html.lastIndexOf('data-slot="requirement-list"'));
    expect(html.indexOf(section)).toBeLessThan(html.indexOf("Glove Stickiness Code"));
    for (const heading of ["Layering %", "Dispensing %", "Stickiness **", "Others:"]) expect(section).toContain(`>${heading}</th>`);
    expect(section).not.toContain("Box/Carton #");
    expect(section).not.toContain(">Item</th>");
    for (const label of ["Layering %, Aged Sample", "Dispensing %, Aged Sample", "Others:, Aged Sample"]) {
      expect(section).toMatch(new RegExp(`<input[^>]*aria-label="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    }
    expect(section).toContain('aria-label="Stickiness **, Aged Sample"');
    // Its cells are reached by issue links, and are as tall as a box row's: 44 px on a touchscreen.
    expect(section).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;agedSample&quot;,&quot;dispensingPct&quot;]"');
    expect(/<select[^>]*aria-label="Stickiness \*\*, Aged Sample"[^>]*>/.exec(section)?.[0]).toContain("touch:h-11");
    expect(/<input[^>]*aria-label="Others:, Aged Sample"[^>]*>/.exec(section)?.[0]).toContain("touch:h-11");
    // Nothing in it yet: Not Done (every size needs one: Kenneth, 27 October 2026), with no checks of its own.
    expect(/<header[\s\S]*?<\/header>/.exec(section)?.[0]).toContain('data-slot="status-pill" data-status="not_done"');
    expect(section).not.toContain('data-slot="requirement-list"');
  });

  it("keeps the size Not Done while nothing is in it: with the boxes complete, calc's warning sits under its row with a link (Kenneth, 27 October 2026)", () => {
    const html = render();
    const section = agedSection(html);
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(section)?.[0] ?? "";
    expect(count(list, "<button")).toBe(1);
    // "Aged Sample?" is unanswered: the warning offers No too (Kenneth, 30 October 2026).
    expect(list).toContain("Aged Sample for size M is not entered yet, or answer No to Aged Sample?");
    expect(list).toContain("text-warn");
    expect(list).toContain("touch:min-h-11");
    // An empty cell is no error: it does not turn red.
    expect(/<input[^>]*aria-label="Layering %, Aged Sample"[^>]*>/.exec(section)?.[0]).not.toContain('aria-invalid="true"');
    // The boxes keep their Passed; the size is Not Done.
    expect(count(html.slice(0, html.indexOf(section)), 'data-outcome="pass"')).toBe(3);
    expect(sizeTab(html)).toContain('data-slot="result-chip" data-status="not_done"');
    // While boxes are still to come, their count says what is left: Not Done, no warning under it yet.
    const partial = agedSection(render({ data: { sizes: { M: { boxes: stdEgData().sizes.M.boxes.slice(0, 5) } } } }));
    expect(/<header[\s\S]*?<\/header>/.exec(partial)?.[0]).toContain('data-status="not_done"');
    expect(partial).not.toContain('data-slot="box-issues"');
    // Without calc's values (before the first evaluation, or a module it could not compute), no state of its own.
    expect(agedSection(render({ evaluated: false }))).not.toContain('data-slot="status-pill"');
    expect(agedSection(render({ broken: true }))).not.toContain('data-slot="status-pill"');
  });

  it("shows its own Passed / Failed against the same spec, and leaves the boxes' averages and results as they are", () => {
    const html = render({ data: withAged({ ...AGED, layeringPct: 60 }) });
    const section = agedSection(html);
    expect(/<header[\s\S]*?<\/header>/.exec(section)?.[0]).toContain('data-slot="status-pill" data-status="fail"');
    expect(section).toContain("60.0");
    expect(section).toContain("≥ 70%");
    expect(section).toContain("≥ 80%");
    expect(section).toContain("A, B, B1, C");
    const outcomes = [...section.matchAll(/data-outcome="([a-z_]+)"/g)].map((match) => match[1]);
    expect(outcomes).toEqual(["fail", "pass", "pass"]);
    // The boxes' table: 88.3% and 90.3% passed, as without it.
    const boxes = html.slice(0, html.indexOf(section));
    expect(boxes).toContain("88.3");
    expect(boxes).toContain("90.3");
    expect(count(boxes, 'data-outcome="pass"')).toBe(3);
    // The size fails with it.
    expect(sizeTab(html)).toContain('data-slot="result-chip" data-status="fail"');
  });

  it("completes eight complete boxes with it, as on Kenneth's screen: nothing incomplete, every result Passed", () => {
    const eight = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ packagingDispensing: 8 }) } });
    const html = render({ data: withAged(AGED, stdEgData().sizes.M.boxes.slice(0, 8)), context: eight });
    expect(html).not.toContain("boxes complete");
    expect(html).not.toContain("is incomplete");
    expect(count(html, 'data-outcome="pass"')).toBe(3 + 3);
    expect(count(html, 'data-outcome="not_done"')).toBe(0);
    expect(/<header[\s\S]*?<\/header>/.exec(agedSection(html))?.[0]).toContain('data-status="pass"');
    expect(sizeTab(html)).toContain('data-slot="result-chip" data-status="pass"');
  });

  it("lists a value still missing under its row with a link, Not Done, while the boxes keep their results", () => {
    const html = render({ data: withAged({ layeringPct: 88 }) });
    const section = agedSection(html);
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(section)?.[0] ?? "";
    expect(count(list, "<button")).toBe(1);
    expect(list).toContain("Aged Sample for size M: Dispensing and Stickiness are not entered yet.");
    expect(list).toContain("text-warn");
    expect(/<header[\s\S]*?<\/header>/.exec(section)?.[0]).toContain('data-status="not_done"');
    // An empty cell is no error: it does not turn red.
    expect(/<input[^>]*aria-label="Dispensing %, Aged Sample"[^>]*>/.exec(section)?.[0]).not.toContain('aria-invalid="true"');
    // The boxes are done: no line about them under their table, and their results stand.
    expect(html).not.toContain("13 of 13 boxes complete");
    expect(count(html.slice(0, html.indexOf(section)), 'data-outcome="pass"')).toBe(3);
  });

  it("fails the size as soon as it fails, and still says how many boxes are complete", () => {
    const html = render({ data: withAged({ ...AGED, dispensingPct: 76 }, stdEgData().sizes.M.boxes.slice(0, 5)) });
    expect(sizeTab(html)).toContain('data-slot="result-chip" data-status="fail"');
    expect(html).toContain("5 of 13 boxes complete.");
    expect(html).not.toContain("Aged Sample: Layering");
    expect(count(html.slice(0, html.indexOf(agedSection(html))), 'data-outcome="not_done"')).toBe(3);
  });

  it("is read-only with the inspection, and shows there where none was entered: Not Done, with calc's warning", () => {
    const html = render({ data: withAged(AGED), readOnly: true });
    const section = agedSection(html);
    expect(section).not.toContain("<select");
    expect(/<input[^>]*aria-label="Layering %, Aged Sample"[^>]*>/.exec(section)?.[0]).toContain("readOnly");
    expect(section).toContain("Aged sample");
    expect(section).toMatch(/>B<\/span>/);
    // Kenneth, 27 October 2026: an empty one keeps the size not done, so the reader sees why.
    const empty = agedSection(render({ readOnly: true }));
    expect(empty).toMatch(/<h3[^>]*>Aged Sample<\/h3>/);
    expect(empty).not.toContain("<select");
    expect(/<header[\s\S]*?<\/header>/.exec(empty)?.[0]).toContain('data-status="not_done"');
    expect(empty).toContain("Aged Sample for size M is not entered yet, or answer No to Aged Sample?");
  });

  it("is headed in the template's wording", () => {
    const html = render({ labels: { ...DISPENSING_PACKING_LABELS, agedSample: "Retained Sample" } });
    expect(html).toMatch(/<h3[^>]*>Retained Sample<\/h3>/);
    expect(html).toContain('aria-label="Layering %, Retained Sample"');
  });
});

describe('dispensing_packing capture: "Aged Sample?" (Kenneth, 30 October 2026: "no aged sample then turn it off and let the page complete")', () => {
  const AGED = { layeringPct: 88, dispensingPct: 86, stickiness: "B", note: "Aged sample" };
  const answered = (hasAgedSample: "yes" | "no", agedSample?: Partial<typeof AGED>) =>
    DispensingPackingDataSchema.parse({ hasAgedSample, sizes: { M: { boxes: stdEgData().sizes.M.boxes, ...(agedSample ? { agedSample } : {}) } } });
  const agedSection = (html: string) =>
    /<section[^>]*data-issue-path="\[&quot;sizes&quot;,&quot;M&quot;,&quot;agedSample&quot;\]"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  const header = (html: string) => /<header[\s\S]*?<\/header>/.exec(agedSection(html))?.[0] ?? "";
  const sizeTab = (html: string) => /<button[^>]*role="tab"[^>]*data-size="M"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
  const chosen = (html: string, answer: "Yes" | "No") => new RegExp(`aria-checked="true"[^>]*>${answer}<`).test(header(html));

  it("asks it beside the section's heading, Yes or No, neither chosen while unanswered", () => {
    const html = render();
    const head = header(html);
    expect(head).toContain(">Aged Sample?</span>");
    expect(head).toMatch(/role="radiogroup"[^>]*aria-label="Aged Sample\?"|aria-label="Aged Sample\?"[^>]*role="radiogroup"/);
    expect(head).toMatch(/aria-checked="false"[^>]*>Yes</);
    expect(head).toMatch(/aria-checked="false"[^>]*>No</);
    // Issue links can reach it, and its answers are 44 px on a touchscreen.
    expect(head).toContain('data-issue-path="[&quot;hasAgedSample&quot;]"');
    expect(head).toContain("touch:h-11");
    // Unanswered, the aged sample is expected: its row, Not Done, and the warning offering No.
    expect(agedSection(html)).toContain("<table");
    expect(head).toContain('data-slot="status-pill" data-status="not_done"');
  });

  it("Yes: chosen, and the section as before, the warning asking for the aged sample alone", () => {
    const html = render({ data: answered("yes") });
    expect(chosen(html, "Yes")).toBe(true);
    expect(chosen(html, "No")).toBe(false);
    const section = agedSection(html);
    expect(section).toContain("<table");
    expect(section).toContain("Aged Sample for size M is not entered yet.");
    expect(section).not.toContain("or answer No");
    expect(sizeTab(html)).toContain('data-slot="result-chip" data-status="not_done"');
    expect(sizeTab(render({ data: answered("yes", AGED) }))).toContain('data-slot="result-chip" data-status="pass"');
  });

  it("No with nothing entered: no row and no status, a line saying there is none, and the size complete on its boxes", () => {
    const html = render({ data: answered("no") });
    expect(chosen(html, "No")).toBe(true);
    const section = agedSection(html);
    expect(section).toContain("No Aged Sample for any size.");
    expect(section).not.toContain("Values entered are kept");
    expect(section).not.toContain("<table");
    expect(section).not.toContain("<input");
    expect(section).not.toContain('data-slot="status-pill"');
    expect(section).not.toContain('data-slot="box-issues"');
    expect(html).not.toContain("is not entered yet");
    // The boxes pass, and so does the size: nothing keeps it Not Done.
    expect(count(html.slice(0, html.indexOf(section)), 'data-outcome="pass"')).toBe(3);
    expect(sizeTab(html)).toContain('data-slot="result-chip" data-status="pass"');
  });

  it("No with values saved: says they are kept, not counted, shows none of them, and they change nothing", () => {
    const html = render({ data: answered("no", { ...AGED, layeringPct: 60 }) });
    const section = agedSection(html);
    expect(section).toContain("No Aged Sample for any size.");
    expect(section).toContain("Values entered are kept, not counted.");
    expect(section).not.toContain("Aged sample");
    expect(section).not.toContain("60.0");
    expect(section).not.toContain('data-slot="requirement-list"');
    // The failing value fails nothing while No.
    expect(sizeTab(html)).toContain('data-slot="result-chip" data-status="pass"');
    // Answered Yes, it counts again.
    expect(sizeTab(render({ data: answered("yes", { ...AGED, layeringPct: 60 }) }))).toContain('data-slot="result-chip" data-status="fail"');
  });

  it("shows the answer read-only with the inspection, and speaks the template's wording", () => {
    const html = render({ data: answered("no"), readOnly: true });
    expect(chosen(html, "No")).toBe(true);
    expect(/<button[^>]*role="radio"[^>]*>/.exec(header(html))?.[0]).toContain("disabled");
    expect(agedSection(html)).toContain("No Aged Sample for any size.");
    const labels = { ...DISPENSING_PACKING_LABELS, agedSample: "Retained Sample" };
    const worded = render({ data: answered("no"), labels });
    expect(worded).toContain(">Retained Sample?</span>");
    expect(worded).toContain('aria-label="Retained Sample?"');
    expect(worded).toContain("No Retained Sample for any size.");
  });
});
