// Server-rendered markup of the capture body: sizes, the box list, counters,
// wording, live totals, issue links and the read-only form. The kit's
// controls are tested in components/qc; the calculations in calc.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sameWording } from "@/lib/coverage";
import type { InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { cartonList, SAFEDON_DEFECTS, SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { calcDispensingSafedon, type DispensingSafedonComputed } from "./calc";
import Capture from "./Capture";
import { DISPENSING_SAFEDON_DEFAULT_CONFIG, DISPENSING_SAFEDON_LABELS, type DispensingSafedonConfig } from "./config";
import { DispensingSafedonDataSchema, emptySafedonBox, type DispensingSafedonData } from "./schema";

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

/** The box list: the first table, above the counts. */
const listTable = (html: string) => /<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";
/** The box list's rows, each marked with its box's path. */
const listRows = (html: string) => Array.from(listTable(html).matchAll(/<tr data-issue-path[\s\S]*?<\/tr>/g), (match) => match[0]);
/** A row's cells: No., Box #, Defects / Gloves per Pack, Delete. */
const cells = (row: string) => Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (match) => match[1]);
/** The counts' table. */
const counterTable = (html: string) => /<div[^>]*data-slot="counter-table"[^>]*>[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";

describe("dispensing_safedon capture", () => {
  it("shows only the ordered sizes, with their results, and the heading's code letters", () => {
    const html = render();
    expect(count(html, 'role="tab"')).toBe(4);
    for (const size of ORDERED) expect(html).toContain(`data-size="${size}"`);
    expect(html).not.toContain('data-size="XL"');
    // The report's heading in Title Case (docs/DESIGN.md): its words, its code letters.
    const heading = "Glove Dispensing Inspection (Sampling Code Letter C & D)";
    expect(sameWording(EXAMPLE.printedTitle, heading)).toBe(true);
    expect(html).toContain(heading.replace("&", "&amp;"));
  });

  it("lists the boxes as a table, a row per planned box, holding the box numbers picked from the carton list", () => {
    const html = render();
    const list = listTable(html);
    // The list comes first; named as the grid of boxes it replaces was.
    expect(html.indexOf(list)).toBeLessThan(html.indexOf('data-slot="counter-table"'));
    expect(list).toContain('<caption class="sr-only">Box #, Size XS</caption>');
    const headers = Array.from(list.matchAll(/<th[^>]*scope="col"[^>]*>([\s\S]*?)<\/th>/g), (match) => match[1]);
    expect(headers).toEqual(["No.", "Box #", "Defects / Gloves per Pack", '<span class="sr-only">Delete</span>']);
    const rows = listRows(html);
    expect(rows).toHaveLength(5);
    expect(count(list, 'aria-label="Box #, Column ')).toBe(5);
    for (const box of EXAMPLE.perSize.XS!.boxes) expect(list).toContain(`>${box}</span>`);
    expect(list).toContain('data-issue-path="[&quot;sizes&quot;,&quot;XS&quot;,&quot;boxes&quot;,4,&quot;boxNo&quot;]"');
    // Each box as a whole too, on its row, for links to a box without a cell of their own.
    rows.forEach((row, index) =>
      expect(row).toMatch(new RegExp(`^<tr data-issue-path="\\[&quot;sizes&quot;,&quot;XS&quot;,&quot;boxes&quot;,${index}\\]"`)),
    );
    // Each box's defects over the gloves of the pack: the same as its column in the counts.
    expect(rows.map((row) => cells(row)[2])).toEqual(EXAMPLE.perSize.XS!.printedPerBox);
    // Row 1 is the box counted, by its colours only.
    expect(rows.map((row) => row.includes('data-active="true"'))).toEqual([true, false, false, false, false]);
  });

  it("offers Delete on a box holding something, never on the plan's blank rows", () => {
    const html = render();
    expect(html).toContain('aria-label="Delete Box 33"');
    expect(count(listTable(html), "data-remove")).toBe(5);
    const data = safedonData();
    // Three of the five planned boxes, two of the plan's blanks (saved, as box 12 comes after them),
    // then past the plan a blank before box 12.
    const boxes = [...data.sizes.XS.boxes.slice(0, 3), emptySafedonBox(), emptySafedonBox(), emptySafedonBox(), { boxNo: 12, counts: {} }];
    const partial = render({ data: { sizes: { ...data.sizes, XS: { boxes } } } });
    const rows = listRows(partial);
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.includes("data-remove"))).toEqual([true, true, true, false, false, true, true]);
    // A row without a box number is named by its No.
    expect(rows[5]).toContain('aria-label="Delete No. 6"');
    expect(rows[6]).toContain('aria-label="Delete Box 12"');
    // A blank row has no figure yet: a dash, read as No value. A box picked with no taps has 0.
    expect(cells(rows[3])[2]).toContain("—");
    expect(cells(rows[3])[2]).toContain("No value");
    expect(cells(rows[6])[2]).toBe("0/125");
  });

  it("pages the list at 15 rows, while the counts keep every box", () => {
    const listed = cartonList(SAFEDON_EG_EXAMPLE.cartons.XS!);
    const boxes = Array.from({ length: 20 }, (_, index) => ({ boxNo: listed[index % listed.length], counts: {} }));
    const html = render({ data: { sizes: { ...safedonData().sizes, XS: { boxes } } } });
    expect(listRows(html)).toHaveLength(15);
    const nav = /<nav[^>]*aria-label="Box #, Size XS: pages"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(nav).toContain("1–15 of 20");
    const page = (number: number) => new RegExp(`<button[^>]*aria-label="Page ${number}"[^>]*>`).exec(nav)?.[0] ?? "";
    expect(page(1)).toContain('aria-current="page"');
    expect(page(2)).not.toBe("");
    expect(page(2)).not.toContain("aria-current");
    expect(nav).toContain('aria-label="Next Page"');
    // The counts show all 20 boxes: one column each.
    expect(count(counterTable(html), 'aria-label="Increase No Cuff, ')).toBe(20);
    // Five boxes fit one page: no page buttons.
    expect(render()).toContain("<caption class=\"sr-only\">Box #, Size XS</caption>");
    expect(render()).not.toContain(": pages");
  });

  it("with no box planned, shows the notice and Add Box, and no list", () => {
    const context = makeTestContext({
      sizes: ["XS"],
      cartons: { XS: cartonList(SAFEDON_EG_EXAMPLE.cartons.XS!) },
      sampling: { XS: makeSampling({ packagingDispensing: 0 }) },
    });
    const html = render({ data: { sizes: {} }, context });
    expect(html).toContain("No boxes are planned for this size.");
    expect(html).toContain("Add Box");
    expect(html).not.toContain("<caption class=\"sr-only\">Box #, Size XS</caption>");
    expect(html).not.toContain('aria-label="Box #, Column');
    expect(render({ data: { sizes: {} }, context, readOnly: true })).not.toContain("Add Box");
  });

  it("flags a box that is not in the size's carton list (6.2 rule 7)", () => {
    const data = safedonData();
    const stray = Math.max(...cartonList(SAFEDON_EG_EXAMPLE.cartons.XS!)) + 1;
    const boxes = data.sizes.XS.boxes.map((box, index) => (index === 1 ? { ...box, boxNo: stray } : box));
    const html = render({ data: { sizes: { ...data.sizes, XS: { boxes } } } });
    const picker = (column: number) => new RegExp(`<button[^>]*aria-label="Box #, Column ${column}"[^>]*>`).exec(html)?.[0];
    expect(picker(2)).toContain('aria-invalid="true"');
    expect(picker(1)).not.toContain('aria-invalid="true"');
    // The picker names the size as the tabs and calc do.
    expect(html).toContain(`Box ${stray} is not in the carton list for size XS.`);
    // That text is for screen readers: calc's message is listed under the box list, with a link to the box.
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(list).toContain(`Box ${stray} (column 2) is not in the size XS carton list.`);
    expect(count(list, "<button")).toBe(1);
    expect(list).toContain("touch:min-h-11");
    // Only the picker's cell turns red, never its row.
    expect(listRows(html)[1]).toMatch(/^<tr[^>]*class="group\/row cursor-pointer border-t border-border data-active:bg-brand-50"/);
    // Under the table and Add Box, above the counts.
    expect(html.indexOf('data-slot="box-issues"')).toBeGreaterThan(html.indexOf('aria-label="Box #, Column 5"'));
    expect(html.indexOf('data-slot="box-issues"')).toBeGreaterThan(html.indexOf("Add Box"));
    expect(html.indexOf('data-slot="box-issues"')).toBeLessThan(html.indexOf('data-slot="counter-table"'));
    // Its rate decides the size, as before: the stray box blocks submit, it does not fail the size.
    expect(html).toContain('data-outcome="pass"');
    expect(render()).not.toContain('data-slot="box-issues"');
  });

  it("lists a count kept under a defect the template does not list, which has no cell of its own", () => {
    const data = safedonData();
    const boxes = data.sizes.XS.boxes.map((box, index) => (index === 0 ? { ...box, counts: { ...box.counts, torn_pack: 2 } } : box));
    const html = render({ data: { sizes: { ...data.sizes, XS: { boxes } } } });
    const list = /<ul[^>]*data-slot="box-issues"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(list).toContain("2 &quot;torn_pack&quot; counted in column 1 for size XS is not a defect of this template");
    // A warning, in amber.
    expect(list).toContain("text-warn");
  });

  it("keeps the defect labels at their column's width from 1280 px, where every box sits side by side", () => {
    // 13 boxes by default: the table scrolls sideways with the labels pinned, rather than
    // squeezing the label column to one letter a line (a cell's width is no minimum).
    // CounterTable's label column keeps its minimum itself, as every box column table needs.
    const html = render();
    const table = counterTable(html);
    const labels = Array.from(table.matchAll(/<th[^>]*scope="row"[^>]*>/g), (match) => match[0]);
    expect(labels.length).toBeGreaterThan(SAFEDON_DEFECTS.length);
    for (const label of labels) expect(label).toMatch(/class="[^"]*\bxl:min-w-64\b/);
    expect(/<div[^>]*data-slot="counter-table"[^>]*>/.exec(html)?.[0]).not.toContain("min-w-64");
  });

  it("keeps keyboard focus visible on the pressed column button", () => {
    const html = render();
    const column = (index: number) => new RegExp(`<button[^>]*aria-label="Count Column ${index}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(column(1)).toContain('aria-pressed="true"');
    expect(column(2)).toContain('aria-pressed="false"');
    expect(column(1)).toContain("aria-pressed:bg-primary");
    // Out of the Tab order: the keyboard chooses a row by its picker; an issue link lands here.
    expect(column(1)).toContain('tabindex="-1"');
    // Outset, as SizeTabs' filled tab: an inset brand-500 ring would vanish on the brand-500
    // fill. The No. cell's 8 px side padding holds the ring inside the list's frame.
    const classes = (/class="([^"]*)"/.exec(column(1))?.[1] ?? "").split(" ");
    expect(classes).toContain("focus-ring");
    expect(classes).not.toContain("focus-ring-inset");
    const chosen = listRows(html).find((row) => row.includes('data-active="true"')) ?? "";
    const cell = (/<td class="([^"]*)"/.exec(chosen)?.[1] ?? "").split(" ");
    expect(cell).toContain("px-2");
    // The chosen row's edge: an inset shadow, so it takes no room.
    expect(cell).toContain("group-data-active/row:shadow-[inset_3px_0_0_var(--color-brand-500)]");
  });

  it("counts the six defects by tapping, with the app's definitions as hints", () => {
    const html = render();
    for (const defect of DISPENSING_SAFEDON_DEFAULT_CONFIG.defects) {
      expect(html).toContain(defect.label);
      expect(html).toContain(defect.hint);
    }
    expect(html).toContain('aria-label="Increase No Cuff, Box 33"');
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
    for (const label of ["Defects / Gloves per Pack", "Defect Rate", "Specification / Requirement", "Conclusion"]) {
      expect(html).toContain(label);
    }
  });

  it("is not done while boxes are missing, and says how many are tested", () => {
    const data = safedonData();
    const partial = render({ data: { sizes: { ...data.sizes, XS: { boxes: data.sizes.XS.boxes.slice(0, 3) } } } });
    expect(partial).toContain('data-outcome="not_done"');
    expect(partial).toContain("3 of 5 boxes tested.");
    expect(partial).toContain("Boxes Tested: 3 / 5");
  });

  it("uses the template's wording and its defect list", () => {
    const labels = { ...DISPENSING_SAFEDON_LABELS, counts: "Dispensing defects", boxNo: "Pack No." };
    const config = {
      ...DISPENSING_SAFEDON_DEFAULT_CONFIG,
      defects: [{ code: "stuck", label: "Stuck in the pack", hint: "" }],
    };
    const html = render({ labels, config });
    expect(html).toContain("Dispensing defects");
    expect(html).toContain('aria-label="Pack No., Column 1"');
    expect(html).toContain("Stuck in the pack");
    expect(html).not.toContain("No Cuff");
  });

  it("still renders, Not Done, when the engine could not compute the module", () => {
    const html = render({ broken: true });
    expect(html).toContain('data-outcome="not_done"');
    expect(html).toContain("Sampling Code Letter —");
    expect(html).toContain("1/125");
  });

  it("is read-only when the inspection is not the user's to edit", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain("Add Box");
    expect(html).not.toContain('role="spinbutton"');
    expect(html).not.toContain('role="combobox"');
    // No Delete: its heading and buttons go; the last column stays as an empty spacer, so the
    // defects figure still sits beside the box number.
    expect(html).not.toContain('<span class="sr-only">Delete</span>');
    expect(html).not.toContain("data-remove");
    expect(cells(listRows(html)[0])).toHaveLength(4);
    expect(cells(listRows(html)[0])[3]).not.toMatch(/<button/);
    // Rows can still be chosen: that only changes the view.
    expect(listRows(html)[0]).toContain('aria-label="Count Column 1"');
    expect(render()).toContain("Add Box");
  });
});
