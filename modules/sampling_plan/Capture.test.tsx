// Server-rendered markup of the Sampling Plan body: one table with a column
// per ordered size (Kenneth, 26 October 2026), the template's wording, the
// order and lot beside the counts, warnings in place, issue links and
// read-only. Keys and paste are the kit's (components/qc): here, the run
// order they follow; they are checked in a browser by the integrator.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { buildInspectionContext, effectiveLabels, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE, type ExampleReport } from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData, samplingPlanData, STD_EG_V6_LABELS } from "./__fixtures__/examples";
import type { SamplingPlanComputed } from "./calc";
import Capture from "./Capture";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingColumn, type SamplingPlanConfig } from "./config";
import { definition } from "./index";
import { emptySamplingPlan, withCodeLetterStep, withCount, withRowOff, type SamplingPlanData, type SamplingSize } from "./schema";

const LEVEL_I: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "I" };
const noop = () => {};

function props(
  example: ExampleReport,
  config: SamplingPlanConfig = LEVEL_I,
  labels: Record<string, string> = SAMPLING_PLAN_LABELS,
  data: InspectionData = exampleData(example),
) {
  const template = makeTestTemplate(ENGINE_REGISTRY, ["order_lots", "packing_config", { key: "sampling_plan", config, labels }]);
  const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
  const found = evaluateInspection({ template, data, context }, ENGINE_REGISTRY).modules.find(
    (entry) => entry.key === "sampling_plan",
  );
  if (!found) throw new Error("sampling_plan was not evaluated");
  return {
    data: data.modules.sampling_plan as SamplingPlanData,
    config,
    title: "Sampling Plan",
    labels,
    context,
    evaluation: { ...found, computed: found.computed as SamplingPlanComputed },
    focusPath: null,
    readOnly: false,
    onChange: noop,
  };
}

const render = (input: Parameters<typeof Capture>[0]) => renderToStaticMarkup(<Capture {...input} />);

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

const pathAttribute = (path: readonly (string | number)[]) =>
  `data-issue-path="${JSON.stringify(path).replaceAll('"', "&quot;")}"`;

/** Cells calc marked with an error: `ring-fail` as a class of its own, not the `aria-invalid:` variant every cell has. */
const redCells = (html: string): string[] =>
  tagsWith(html, "data-enter-field").filter((tag) => /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/).includes("ring-fail"));

describe("sampling_plan Capture", () => {
  it("offers Auto Calculate Sampling while it can write, top right of the card in the capture screen (Kenneth, 26 October 2026)", () => {
    // Outside the capture screen's frame it sits at the top of the body; the frame puts it in its header.
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const button = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Auto Calculate Sampling<\/button>/.exec(html)?.[0] ?? "";
    expect(button).not.toBe("");
    // Every size has its order quantity: the attribute, not the `disabled:` classes every button has.
    expect(button).not.toMatch(/\sdisabled(=""|\s|>)/);
    expect(render({ ...props(SAFEDON_EG_EXAMPLE), readOnly: true })).not.toContain("Auto Calculate Sampling");
  });

  it("puts Sampling Settings right after Auto Calculate Sampling, an outline icon button of its height, read-only too (Kenneth, 27 October 2026)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const after = html.slice(html.indexOf("Auto Calculate Sampling</button>") + "Auto Calculate Sampling</button>".length);
    const settings = /^<button[^>]*>/.exec(after)?.[0] ?? "";
    expect(settings).toContain('aria-label="Sampling Settings"');
    expect(settings).toContain('aria-haspopup="dialog"');
    // Auto Calculate Sampling is outline, 32 px (44 px on any touchscreen): so is the icon button.
    expect(settings).toContain('data-variant="outline"');
    expect(settings).toContain('data-size="icon-sm"');
    expect(settings).toMatch(/\bsize-8\b.*\btouch:size-11\b/);
    // The dialog is closed until it is asked for: none of it on the card (no level on the card, 26 October 2026).
    expect(html).not.toContain("General Inspection Level");
    expect(html).not.toContain("View Code Letter Table");
    // A read-only inspection keeps the button, to see its settings, and loses Auto Calculate Sampling.
    const readOnly = render({ ...props(SAFEDON_EG_EXAMPLE), readOnly: true });
    expect(readOnly).toContain('aria-label="Sampling Settings"');
    expect(readOnly).not.toContain("Auto Calculate Sampling");
  });

  it("shows one table with a column per ordered size only, each count a whole-number cell (6.2 rules 1 and 4)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(tagsWith(html, "data-size-head").map((cell) => /data-size-head="([^"]+)"/.exec(cell)?.[1])).toEqual([
      "XS",
      "S",
      "M",
      "L",
    ]);
    // No tabs: every size is on screen at once.
    expect(tagsWith(html, 'role="tab"')).toEqual([]);
    expect(tagsWith(html, 'role="group"').map((group) => /aria-label="([^"]+)"/.exec(group)?.[1])).toEqual([
      // The test rows' switches with their labels (Kenneth, 26 October 2026), then each size's cells.
      "Tests counted",
      "Size XS",
      "Size S",
      "Size M",
      "Size L",
      "Total",
    ]);
    const inputs = tagsWith(html, "data-enter-field");
    // Seven counts and the inner boxes per case (Kenneth, 27 October 2026), per size.
    expect(inputs).toHaveLength(4 * 8);
    for (const input of inputs) expect(input).toContain('inputMode="decimal"');
  });

  it("runs the cells size by size, top to bottom: Enter and a pasted row or column go down a size's column, then on", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const fields = tagsWith(html, "data-enter-field");
    expect(fields.slice(0, 9).map((field) => /id="([^"]+)"/.exec(field)?.[1])).toEqual([
      "sampling-plan-XS-cases",
      "sampling-plan-XS-innerUnitsPerCase",
      "sampling-plan-XS-innerUnits",
      "sampling-plan-XS-gloves",
      "sampling-plan-XS-glovesWatertightVisual",
      "sampling-plan-XS-glovesDimensions",
      "sampling-plan-XS-glovesPhysical",
      "sampling-plan-XS-innerUnitsDispensing",
      "sampling-plan-S-cases",
    ]);
    // One run in one EnterGroup: no named group splits it into columns.
    expect(html).toContain('data-enter-scope=""');
    for (const field of fields) expect(field).toContain('data-enter-group=""');
  });

  it("heads the counts as the forms group them, each test under what it counts (Kenneth, 26 October 2026)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const headings = Array.from(
      html.matchAll(/data-slot="count-heading"[^>]*><span class="sticky left-3">([^<]+)<\/span>/g),
      (match) => match[1],
    );
    expect(headings).toEqual(["Sampling Quantity", "# Gloves for Each Test", "# Inner Box"]);
    // The row says what the test is; the cell keeps the template's whole wording as its name.
    expect(html).toMatch(/data-slot="row-switch"[^>]*>(?:(?!data-slot="row-switch")[\s\S])*>Watertight &amp; Visual<\/span>/);
    expect(html).toContain('aria-label="# Gloves for Watertight &amp; Visual, Size M"');
    // The order and the lot come first, read-only, then the counts; no inspection level (Kenneth, 26 October 2026).
    expect(html.indexOf("Order Qty (Case)")).toBeLessThan(html.indexOf("Lot Size (Gloves)"));
    expect(html.indexOf("Lot Size (Gloves)")).toBeLessThan(html.indexOf("Sampling Quantity"));
    expect(html).not.toContain("Inspection Level");
  });

  it("reads every label from the template's wording, the Sampling Quantity's own rows aside, and never offers it for editing (6.2 rule 11)", () => {
    // SAFEDON_EG's words for its inner unit, the plastic pack, as the screen gets them (effectiveLabels).
    const labels = effectiveLabels(definition, {
      labels: {
        ...SAMPLING_PLAN_LABELS,
        innerUnits: "Inner Pack",
        glovesPhysical: "# Gloves for Tensile",
        innerUnitsDispensing: "# Inner Packs for Packaging & Dispensing Inspection",
      },
    });
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, labels));
    expect(html).toContain("# Gloves for Tensile");
    expect(html).toContain('aria-label="# Inner Packs for Packaging &amp; Dispensing Inspection, Size XS"');
    expect(html).not.toContain("# Gloves for FAB");
    // The inner units sampled are the module's own words (Kenneth, 27 October 2026).
    expect(html).toContain('aria-label="Total # of Inner Box, Size XS"');
    expect(html).not.toContain('aria-label="Inner Pack, Size XS"');
    expect(html).toContain("Sampling Quantity");
  });

  it("names the Sampling Quantity's rows in Kenneth's words on a STD_EG version 6 inspection, whatever it stored (27 October 2026)", () => {
    const labels = effectiveLabels(definition, { labels: STD_EG_V6_LABELS });
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, labels));
    for (const name of ["# of Case", "Inner Box Taken per Case", "Total # of Inner Box", "# of Gloves Sample"]) {
      expect(html).toContain(`aria-label="${name}, Size M"`);
    }
    expect(html).toContain(">Gloves Taken per Inner Box<");
    expect(html).toContain(">Put Back<");
    expect(html).toContain(">Code Letter<");
    // Kenneth's order (27 October 2026): per box, put back, the gloves sampled, then the code letter last.
    const order = [">Gloves Taken per Inner Box<", ">Put Back<", 'aria-label="# of Gloves Sample, Size M"', 'data-code-letter="M"'].map((text) =>
      html.indexOf(text),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Total Gloves Taken is gone, and with it the italics (Kenneth, 27 October 2026: "remove this row").
    expect(html).not.toContain("Total Gloves Taken");
    expect(html).not.toContain("totalGlovesTaken");
    expect(html).not.toMatch(/class="[^"]*\bitalic\b/);
    for (const old of ['aria-label="Case, Size M"', 'aria-label="Inner Box, Size M"', 'aria-label="Gloves, Size M"']) {
      expect(html).not.toContain(old);
    }
  });

  it("never offers # Gloves for Weight, even where the template switches it on (STD_EG; Kenneth, 26 October 2026)", () => {
    const weighs = { ...LEVEL_I, columns: { ...LEVEL_I.columns, glovesWeight: true } };
    // An older inspection's count is kept in the data, never shown.
    const data = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, glovesWeight: 13 } } },
    });
    const html = render(props(STD_EG_EXAMPLE, weighs, SAMPLING_PLAN_LABELS, data));
    expect(html).not.toContain("# Gloves for Weight");
    expect(tagsWith(html, `id="sampling-plan-M-glovesWeight"`)).toHaveLength(0);
    expect(html).toContain('aria-label="# Gloves for FAB, Size M"');
  });

  it("shows the order and the lot in gloves beside the counts, computed not typed, and nothing of the level's plan (6.2 rule 2)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    for (const text of ["Order Qty (Case)", "Lot Size (Gloves)"]) expect(html).toContain(text);
    for (const value of ["120,000", "1,700,000", "1,120,000"]) expect(html).toContain(value);
    // No inspection level or plan sample size on the card (Kenneth, 26 October 2026). The Code Letter row is data,
    // each size's own letter (27 October 2026), not the plan's read-only one.
    expect(html).not.toContain("Inspection Level");
    expect(html).not.toContain("Sample Size by Plan");
  });

  it("warns of nothing below the level's plan; a warning it does give sits in its cell and under the table (BUILD_SPEC 6.1, 6.2)", () => {
    // The example's 80 and 200 are below inspection level I's plan: no warning (Kenneth, 26 October 2026).
    const below = render(props(SAFEDON_EG_EXAMPLE));
    expect(below).not.toContain("inspection level I needs");
    expect(tagsWith(below, 'data-slot="sampling-issues"')).toHaveLength(0);
    expect(below).toContain(pathAttribute(["sizes", "XS", "glovesWatertightVisual"]));
    expect(below).toContain(pathAttribute(["sizes", "L", "cases"]));
    // A sample size Table 2-A does not have is still flagged: an amber cell and a note naming the size, not a red cell.
    const data = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, glovesWatertightVisual: 100 } } },
    });
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, data));
    expect(redCells(html)).toEqual([]);
    expect(tagsWith(html, 'id="sampling-plan-M-glovesWatertightVisual"')[0]).toContain("bg-warn-tint");
    expect(html).toContain("Size M, # Gloves for Watertight &amp; Visual: 100 is not a standard sample size");
    expect(tagsWith(html, 'data-slot="sampling-issues"')).toHaveLength(1);
  });

  it("puts a switch at the left of each test row; off, the row is greyed, takes no typing and is not asked for (Kenneth, 26 October 2026)", () => {
    // STD_EG's columns as its template stores them, the weight row on: no switch for it, as there is no row.
    const withWeight: SamplingPlanConfig = { ...LEVEL_I, columns: { ...LEVEL_I.columns, glovesWeight: true } };
    const html = render(props(STD_EG_EXAMPLE, withWeight));
    const switches = tagsWith(html, 'role="switch"');
    // Watertight & visual, dimension, the physical test and packaging & dispensing: not the cases, inner units or gloves.
    expect(switches.map((tag) => /aria-label="([^"]+)"/.exec(tag)?.[1])).toEqual([
      "# Gloves for Watertight &amp; Visual: counted",
      "# Gloves for Dimension: counted",
      "# Gloves for FAB: counted",
      "# Inner Box for Packaging &amp; Dispensing Inspection: counted",
    ]);
    for (const tag of switches) expect(tag).toContain('aria-checked="true"');

    // Dimension switched off: still on screen, greyed, read-only, and no longer missing from the size.
    const data = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { ...samplingPlanData(STD_EG_EXAMPLE), sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, glovesDimensions: null } } },
    });
    const missing = props(STD_EG_EXAMPLE, withWeight, SAMPLING_PLAN_LABELS, data);
    expect(missing.evaluation.result.perSize?.M?.status).toBe("not_done");
    const offData = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { ...(data.modules.sampling_plan as SamplingPlanData), rowsOff: ["glovesDimensions"] },
    });
    const off = props(STD_EG_EXAMPLE, withWeight, SAMPLING_PLAN_LABELS, offData);
    expect(off.evaluation.result.perSize?.M?.status).toBe("info");
    const offHtml = render(off);
    expect(tagsWith(offHtml, 'role="switch"').find((tag) => tag.includes("Dimension"))).toContain('aria-checked="false"');
    expect(tagsWith(offHtml, 'id="sampling-plan-M-glovesDimensions"')[0]).toContain("readOnly");
    expect(tagsWith(offHtml, 'data-row-off="true"').length).toBeGreaterThan(0);
    // Data that switched the weight row off before it went still loads, with nothing to show for it.
    const weightOff = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { ...samplingPlanData(STD_EG_EXAMPLE), rowsOff: ["glovesWeight"] },
    });
    const loaded = props(STD_EG_EXAMPLE, withWeight, SAMPLING_PLAN_LABELS, weightOff);
    expect(loaded.evaluation.result.perSize?.M?.status).toBe("info");
    expect(tagsWith(render(loaded), 'role="switch"').every((tag) => tag.includes('aria-checked="true"'))).toBe(true);
  });

  it("marks an impossible count red in its cell", () => {
    const data = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, cases: 3000 } } },
    });
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, data));
    expect(html).toContain("Size M, # of Case: 3,000 cases sampled, more than the 2,900 cases ordered.");
    const red = redCells(html);
    expect(red).toHaveLength(1);
    expect(red[0]).toContain('aria-label="# of Case, Size M"');
  });

  it("names each size's column and its cells with the size, Title Case as a label is", () => {
    const html = render(props(STD_EG_EXAMPLE));
    expect(html).toContain('role="group" aria-label="Size M"');
    // A refused entry's link in the problem list repeats the cell's name.
    expect(html).toContain('aria-label="# of Case, Size M"');
    expect(html).not.toContain(", size M");
  });

  it("shows each size's result under its column, at the kit's touch size: 16 px text on iPad", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const pills = tagsWith(html, 'data-slot="status-pill"');
    expect(pills).toHaveLength(4);
    for (const pill of pills) expect(pill).toContain("touch:text-base");
    // An empty size says so in a few words.
    const empty = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, exampleData(SAFEDON_EG_EXAMPLE, { sampling_plan: { sizes: {} } })));
    expect(empty.match(/Not started\./g)).toHaveLength(4);
    expect(empty).not.toContain("Missing:");
  });

  it("totals every row over the sizes in a Total column wider than a size's (Kenneth, 26 October 2026)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(html).toContain('role="group" aria-label="Total"');
    expect(html).toContain("1,530");
    expect(html).toContain("560");
    // At least 10rem against a size's 6rem, and it grows 1.4 times as fast.
    expect(html).toContain("repeat(4, minmax(6rem, 1fr)) minmax(10rem, 1.4fr)");
    // One size: the column is its own total.
    const one = render(props(STD_EG_EXAMPLE));
    expect(one).not.toContain('aria-label="Total"');
    expect(one).not.toContain("1.4fr");
  });

  it("scrolls sideways in its own box where the sizes do not fit, the labels pinned at the left", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(tagsWith(html, "overflow-x-auto")).toHaveLength(1);
    // Labels 10rem, four sizes of 6rem and the 10rem total: below that the box scrolls, never the page.
    expect(html).toContain("min-width:44rem");
    expect(tagsWith(html, "data-label-head")[0]).toContain("sticky left-0");
  });

  it("groups the surgical columns as the SG form does, under Sampling Quantity (WTT & Visual)", () => {
    const config: SamplingPlanConfig = {
      inspectionLevel: null,
      columns: {
        ...SAMPLING_PLAN_DEFAULT_CONFIG.columns,
        gloves: false,
        innerUnitsDispensing: false,
        pouches: true,
        pouchesDyeLeak: true,
      },
    };
    const labels = { ...SAMPLING_PLAN_LABELS, samplingQuantity: "Sampling Quantity (WTT & Visual)", glovesWatertightVisual: "# Gloves" };
    const html = render(props(STD_EG_EXAMPLE, config, labels));
    const group = html.indexOf("Sampling Quantity (WTT &amp; Visual)");
    expect(group).toBeGreaterThan(-1);
    const order = ["# of Case", "Inner Box Taken per Case", "Total # of Inner Box", "Pouches", "# Gloves", "# Gloves for Dimension"];
    const positions = order.map((name) => html.indexOf(`aria-label="${name}, Size M"`));
    expect(positions.every((position) => position > group)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // No gloves row, so nothing to take per inner box or put back.
    expect(html).not.toContain('aria-label="# of Gloves, Size M"');
    expect(html).not.toContain("Gloves Taken per Inner Box");
  });

  it("is read-only for an approved inspection: cells become text, every size still on screen", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), readOnly: true });
    for (const input of tagsWith(html, "data-enter-field")) expect(input).toContain("readOnly");
    expect(tagsWith(html, "data-size-head")).toHaveLength(1);
  });

  it("says so while no size is ordered", () => {
    const base = props(STD_EG_EXAMPLE);
    const html = render({ ...base, context: makeTestContext(), evaluation: null });
    expect(html).toContain("No sizes ordered yet");
    expect(tagsWith(html, "data-enter-field")).toEqual([]);
  });
});

describe("sampling_plan Capture's Sampling Quantity (Kenneth, 27 October 2026)", () => {
  /** STD_EG's size M with its Sampling Quantity as given, the rest as printed. */
  function withQuantity(row: Partial<SamplingSize>, example: ExampleReport = STD_EG_EXAMPLE): InspectionData {
    const plan = samplingPlanData(example);
    return exampleData(example, { sampling_plan: { sizes: { ...plan.sizes, M: { ...plan.sizes.M, ...row } } } });
  }

  /** The markup of the first grid cell carrying `attribute`, from its opening tag to the next cell's. */
  const cellOf = (html: string, attribute: string) => {
    const openings = Array.from(html.matchAll(/<div [^>]*style="grid-row:[^"]*"[^>]*>/g), (match) => match.index);
    const at = html.indexOf(attribute);
    const start = openings.findLast((index) => index <= at);
    if (at === -1 || start === undefined) return "";
    return html.slice(start, openings.find((index) => index > start) ?? html.length);
  };

  /** A figure named for screen readers by its row's label: "Put Back: 10". */
  const figure = (label: string, value: string) => new RegExp(`${label}(?:<!-- -->)?: </span><span data-slot="figure"[^>]*>${value}</span>`);

  it("works the total out from the cases while the inner boxes per case are entered: read-only on grey, the sum at its left", () => {
    const data = withQuantity({ cases: 16, innerUnitsPerCase: 1, innerUnits: 16, gloves: 315 });
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, data));
    const total = tagsWith(html, 'id="sampling-plan-M-innerUnits"')[0];
    expect(total).toContain("readOnly");
    expect(total).toContain('value="16"');
    const cell = cellOf(html, 'data-worked-out="true"');
    expect(cell).toContain("bg-slate-50");
    expect(cell).toContain('title="# of Case × Inner Box Taken per Case"');
    expect(cell).toMatch(/data-slot="worked-out"[^>]*>16 × 1<\/span>/);
    // The inner boxes per case stay a typed cell, as every other count.
    expect(tagsWith(html, 'id="sampling-plan-M-innerUnitsPerCase"')[0]).not.toContain("readOnly");
    expect(tagsWith(html, 'id="sampling-plan-M-cases"')[0]).not.toContain("readOnly");
  });

  it("keeps the total a typed cell holding its stored value while the inner boxes per case are empty (data saved before, a total read)", () => {
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, withQuantity({ innerUnitsPerCase: null, innerUnits: 50 })));
    const total = tagsWith(html, 'id="sampling-plan-M-innerUnits"')[0];
    expect(total).not.toContain("readOnly");
    expect(total).toContain('value="50"');
    expect(html).not.toContain("data-worked-out");
    expect(html).not.toContain('data-slot="worked-out"');
  });

  it("flags a stored total that is not # of Case × the inner boxes per case, on the total and under the table", () => {
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, withQuantity({ cases: 16, innerUnitsPerCase: 2, innerUnits: 30 })));
    expect(tagsWith(html, 'id="sampling-plan-M-innerUnits"')[0]).toContain("bg-warn-tint");
    expect(html).toContain("Size M, Total # of Inner Box: 30 is not 16 × 2 = 32");
    expect(tagsWith(html, 'data-slot="sampling-issues"')).toHaveLength(1);
  });

  it("shows the gloves taken per inner box and those put back, worked out and read-only, a dash while a count is missing", () => {
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, withQuantity({ cases: 25, innerUnitsPerCase: 1, innerUnits: 25, gloves: 315 })));
    const perBox = cellOf(html, 'data-worked="glovesPerInnerBox"');
    expect(perBox).toContain("bg-slate-50");
    expect(perBox).toMatch(figure("Gloves Taken per Inner Box", "13"));
    expect(cellOf(html, 'data-worked="putBack"')).toMatch(figure("Put Back", "10"));
    // Never typed: no cell to type in.
    expect(tagsWith(html, 'id="sampling-plan-M-glovesPerInnerBox"')).toEqual([]);
    const missing = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, withQuantity({ gloves: null })));
    expect(cellOf(missing, 'data-worked="glovesPerInnerBox"')).toContain("data-empty");
    expect(cellOf(missing, 'data-worked="putBack"')).toContain("data-empty");
  });

  it("says under the Lot Size (Gloves) row why its lots show a dash: no gloves per case yet (Kenneth, 27 October 2026)", () => {
    const data = exampleData(SAFEDON_EG_EXAMPLE, { packing_config: { glovesPerInner: null, innersPerCase: null, glovesPerCase: null } });
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, data));
    // One quiet line across the grid, straight under the row, for the eye.
    expect(html).toMatch(/data-slot="lot-size-note"[^>]*><span class="sticky left-3">Needs the Packing Configuration on the Order page<\/span>/);
    expect(html.indexOf('data-slot="lot-size-note"')).toBeGreaterThan(html.indexOf("Lot Size (Gloves)"));
    expect(html.indexOf('data-slot="lot-size-note"')).toBeLessThan(html.indexOf("Sampling Quantity"));
    // Each dash keeps "—" and says why on hover and to screen readers.
    const lots = tagsWith(html, 'title="Needs the Packing Configuration on the Order page"');
    expect(lots).toHaveLength(4 + 1);
    expect(html).toContain('<span class="sr-only"> Needs the Packing Configuration on the Order page.</span>');
    // With the gloves per case known, no line and no title.
    const known = render(props(SAFEDON_EG_EXAMPLE));
    expect(known).not.toContain("lot-size-note");
    expect(known).not.toContain("Needs the Packing Configuration");
  });

  it("shows # of Gloves Sample's sum at its left: (Total # of Inner Box × Gloves Taken per Inner Box) − Put Back (Kenneth, 27 October 2026)", () => {
    // 500 gloves from 15 inner boxes is 34 a box, 510 taken, 10 put back.
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, withQuantity({ cases: 15, innerUnitsPerCase: 1, innerUnits: 15, gloves: 500 })));
    const cell = cellOf(html, 'id="sampling-plan-M-gloves"');
    expect(cell).toMatch(/data-slot="gloves-formula"[^>]*>\(15 × 34\) − 10<\/span>/);
    expect(cell).toContain('title="Total # of Inner Box × Gloves Taken per Inner Box − Put Back"');
    // Beside the count while the cell has room, under it where it has not; the count stays typed.
    expect(cell).toMatch(/class="[^"]*@container[^"]*"/);
    expect(cell).toMatch(/data-slot="gloves-formula" class="[^"]*\bhidden fine:@min-\[8\.5rem\]:flex touch:@min-\[10rem\]:flex/);
    expect(cell).toMatch(/data-slot="gloves-formula-under" class="[^"]*fine:@min-\[8\.5rem\]:hidden touch:@min-\[10rem\]:hidden/);
    expect(tagsWith(html, 'id="sampling-plan-M-gloves"')[0]).not.toContain("readOnly");
  });

  it("shows the product alone when nothing is put back: 300 gloves from 25 inner boxes is 25 × 12", () => {
    const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, withQuantity({ cases: 25, innerUnitsPerCase: 1, innerUnits: 25, gloves: 300 })));
    const cell = cellOf(html, 'id="sampling-plan-M-gloves"');
    expect(cell).toMatch(/data-slot="gloves-formula"[^>]*>25 × 12<\/span>/);
    expect(cell).toMatch(/data-slot="gloves-formula" class="[^"]*\bhidden fine:@min-\[6\.5rem\]:flex touch:@min-\[7\.5rem\]:flex/);
  });

  it("shows no sum while the inner boxes or the gloves are not known", () => {
    for (const row of [{ innerUnitsPerCase: null, innerUnits: null }, { gloves: null }]) {
      const html = render(props(STD_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, withQuantity(row)));
      expect(html).not.toContain("gloves-formula");
      expect(html).not.toContain("Gloves Taken per Inner Box − Put Back");
    }
  });

  it("totals the gloves put back, and neither the inner boxes per case, the gloves per inner box nor the code letter", () => {
    // SAFEDON_EG's M: 200 gloves from 15 inner packs is 14 a pack, 10 put back; the other sizes divide exactly.
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const totals = html.slice(html.indexOf('role="group" aria-label="Total"'));
    expect(totals).toMatch(figure("Put Back", "10"));
    expect(totals).not.toContain("Gloves Taken per Inner Box");
    expect(totals).not.toContain("Inner Box Taken per Case");
    expect(totals).not.toContain("Code Letter");
    expect(tagsWith(totals, "data-no-total")).toHaveLength(3);
    // The total of the inner boxes sampled stays: 10 + 25 + 15 + 10.
    expect(totals).toMatch(figure("Total # of Inner Box", "60"));
  });
});

describe("sampling_plan Capture's Code Letter (Kenneth, 27 October 2026)", () => {
  const REASON = "Consistent high-quality factory";

  /**
   * SAFEDON_EG's sizes at level I with their letters: XS at its lot's L, S at its lot's N, M lowered from N to M with
   * the reason, L with none yet.
   */
  function lettered(rows: Partial<Record<string, Partial<SamplingSize>>> = {}): InspectionData {
    const plan = samplingPlanData(SAFEDON_EG_EXAMPLE);
    const sizes = {
      XS: { ...plan.sizes.XS, codeLetter: "L", gloves: 200 },
      S: { ...plan.sizes.S, codeLetter: "N", gloves: 500 },
      M: { ...plan.sizes.M, codeLetter: "M", gloves: 315, codeLetterReason: REASON },
      L: { ...plan.sizes.L, codeLetter: null },
    } satisfies Record<string, SamplingSize>;
    const merged = Object.fromEntries(Object.entries(sizes).map(([size, row]) => [size, { ...row, ...rows[size] }]));
    return exampleData(SAFEDON_EG_EXAMPLE, { sampling_plan: { sizes: merged } });
  }

  /** The markup of one size's Code Letter cell. */
  const letterCell = (html: string, size: string) => {
    const start = html.indexOf(`data-code-letter="${size}"`);
    const open = html.lastIndexOf("<div", start);
    const next = html.indexOf('style="grid-row:', html.indexOf(">", start));
    return start === -1 ? "" : html.slice(open, html.lastIndexOf("<div", next));
  };

  /** A button's opening tag, by the start of its accessible name. */
  const button = (html: string, name: string) => new RegExp(`<button[^>]*aria-label="${name}[^"]*"[^>]*>`).exec(html)?.[0] ?? "";

  it("puts each size's letter right under # of Gloves Sample, the last row of Sampling Quantity, in bold", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered()));
    for (const size of ["XS", "S", "M"]) {
      expect(html.indexOf(`data-code-letter="${size}"`)).toBeGreaterThan(html.indexOf(`id="sampling-plan-${size}-gloves"`));
      expect(html.indexOf(`data-code-letter="${size}"`)).toBeLessThan(html.indexOf(`id="sampling-plan-${size}-glovesWatertightVisual"`));
    }
    expect(letterCell(html, "S")).toMatch(/<span data-slot="code-letter" class="[^"]*\bfont-bold\b[^"]*">N<\/span>/);
    expect(letterCell(html, "S")).toContain('<span class="sr-only">Code Letter: </span>');
    // No letter yet: a dash.
    expect(letterCell(html, "L")).toContain("data-empty");
  });

  it("gives every size its own Reduce and Raise, named with the size and the letter they step to", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered()));
    expect(tagsWith(html, 'aria-label="Reduce the code letter for size').map((tag) => /aria-label="([^"]+)"/.exec(tag)?.[1])).toEqual([
      "Reduce the code letter for size XS to K",
      "Reduce the code letter for size S to M",
      "Reduce the code letter for size M to L",
      "Reduce the code letter for size L",
    ]);
    expect(tagsWith(html, 'aria-label="Raise the code letter for size').map((tag) => /aria-label="([^"]+)"/.exec(tag)?.[1])).toEqual([
      "Raise the code letter for size XS",
      "Raise the code letter for size S",
      "Raise the code letter for size M back to N",
      "Raise the code letter for size L",
    ]);
    // Each pair sits in its size's own cell.
    for (const size of ["XS", "S", "M", "L"]) expect(letterCell(html, size).match(/<button\b/g)).toHaveLength(2);
    expect(button(html, "Reduce the code letter for size S to M")).toContain('aria-haspopup="dialog"');
  });

  it("disables Reduce without a letter and at A, and Raise at the lot's letter, above it, and while the lot is not known", () => {
    const disabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag);
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered()));
    expect(disabled(button(html, "Reduce the code letter for size S to M"))).toBe(false);
    expect(disabled(button(html, "Reduce the code letter for size L"))).toBe(true);
    expect(disabled(button(html, "Raise the code letter for size M back to N"))).toBe(false);
    expect(disabled(button(html, "Raise the code letter for size S"))).toBe(true);
    const atA = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered({ XS: { codeLetter: "A", gloves: 2 } })));
    expect(disabled(button(atA, "Reduce the code letter for size XS"))).toBe(true);
    // Without the gloves per case no lot is known: nothing to raise back to.
    const unknown = { ...lettered(), modules: { ...lettered().modules, packing_config: { glovesPerInner: null, innersPerCase: null, glovesPerCase: null } } };
    const noLot = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, unknown));
    expect(disabled(button(noLot, "Raise the code letter for size M"))).toBe(true);
    expect(disabled(button(noLot, "Reduce the code letter for size M to L"))).toBe(false);
  });

  it("says Reduced from N under a lowered letter, with an amber dot, the reason as its title and read after it", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered()));
    const lowered = letterCell(html, "M");
    expect(lowered).toContain('data-reduced="true"');
    expect(lowered).toMatch(
      new RegExp(`data-slot="reduced-from" title="Reduced from N: ${REASON}"[^>]*><span aria-hidden="true" class="[^"]*bg-warn-solid[^"]*"></span>Reduced from N<span class="sr-only">: ${REASON}</span>`),
    );
    // At its lot's letter, or with none, a letter says nothing more.
    for (const size of ["XS", "S", "L"]) expect(letterCell(html, size)).not.toContain("reduced-from");
    // A letter lowered without a reason (a reading's) still says so.
    const read = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered({ M: { codeLetterReason: null } })));
    expect(letterCell(read, "M")).toContain('title="Reduced from N"');
  });

  it("warns on the letter when # of Gloves Sample is not its sample: amber, read with the letter, listed under the table", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered({ M: { gloves: 300 } })));
    const cell = letterCell(html, "M");
    expect(cell).toMatch(/data-code-letter="M"[^>]*class="[^"]*\bbg-warn-tint\b/);
    expect(cell).toContain("Size M, Code Letter: # of Gloves Sample 300 is not code M&#x27;s 315.");
    // An issue link lands on the letter itself.
    expect(cell).toContain(`${pathAttribute(["sizes", "M", "codeLetter"])} tabindex="-1"`);
    expect(html).toMatch(/data-slot="sampling-issues"[\s\S]*Size M, Code Letter: # of Gloves Sample 300 is not code M&#x27;s 315\./);
    // The size is not blocked: a warning, never a red cell.
    expect(redCells(html)).toEqual([]);
    expect(letterCell(render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered())), "M")).not.toContain("bg-warn-tint");
  });

  it("is read-only for an approved inspection: the letter and its note, no buttons", () => {
    const html = render({ ...props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered()), readOnly: true });
    expect(html).not.toContain("Reduce the code letter");
    expect(html).not.toContain("Raise the code letter");
    expect(letterCell(html, "M")).toContain(">M</span>");
    expect(letterCell(html, "M")).toContain(">Reduced from N<");
  });

  it("sizes its buttons 28 px with a mouse and 44 px on any touchscreen, compact in the row (docs/DESIGN.md)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, lettered()));
    for (const name of ["Reduce the code letter for size S to M", "Raise the code letter for size M back to N"]) {
      const tag = button(html, name);
      expect(tag).toMatch(/\bsize-7\b/);
      expect(tag).toMatch(/\btouch:size-11\b/);
      expect(tag).toMatch(/\bfocus-ring-inset\b/);
    }
    // Where the cell is too narrow for the letter and both, they go under it.
    expect(letterCell(html, "S")).toMatch(/class="[^"]*\bflex-row-reverse flex-wrap\b/);
  });
});

describe("sampling_plan Capture writes (useDataUpdater, docs/CAPTURE_KIT.md)", () => {
  /**
   * The capture screen under the kit's updater: onChange replaces the data,
   * and every handler is the one made at the last render, as the Capture's
   * setCount is.
   */
  function screen(start: SamplingPlanData = emptySamplingPlan(), config: SamplingPlanConfig = LEVEL_I) {
    let data = start;
    const changes: SamplingPlanData[] = [];
    const updater = createDataUpdater(data, (next) => {
      changes.push(next);
      data = next;
    });
    const setCount = (size: string, column: SamplingColumn, value: number | null) =>
      updater.update((current) => withCount(current, size, column, value, config));
    // Reduce, as a size's dialog hands it over: the size's lot is code N (STD_EG's 5,800,000 gloves).
    const reduce = (size: string, reason: string) =>
      updater.update((current) => withCodeLetterStep(current, size, { direction: "down", lot: 5_800_000, lotLetter: "N", reason }, config));
    return { setCount, reduce, changes, data: () => data };
  }

  it("writes # of Gloves Sample typed into Watertight & Visual in the same change; one typed there holds until the gloves change", () => {
    const { setCount, changes, data } = screen();
    setCount("M", "gloves", 315);
    expect(changes).toHaveLength(1);
    expect(data().sizes.M).toMatchObject({ gloves: 315, glovesWatertightVisual: 315 });
    setCount("M", "glovesWatertightVisual", 200);
    expect(data().sizes.M).toMatchObject({ gloves: 315, glovesWatertightVisual: 200 });
    setCount("M", "gloves", 500);
    expect(data().sizes.M).toMatchObject({ gloves: 500, glovesWatertightVisual: 500 });
  });

  it("leaves Watertight & Visual alone while it is switched off", () => {
    const { setCount, data } = screen(withRowOff(emptySamplingPlan(), "glovesWatertightVisual", true));
    setCount("M", "gloves", 315);
    expect(data().sizes.M).toMatchObject({ gloves: 315, glovesWatertightVisual: null });
  });

  it("Reduce on size S changes S alone: its letter, gloves, Watertight & Visual and reason; M stays as it was", () => {
    const start = withCount(withCount(emptySamplingPlan(), "S", "gloves", 500, LEVEL_I), "M", "gloves", 500, LEVEL_I);
    const both = {
      sizes: {
        S: { ...start.sizes.S, codeLetter: "N" as const },
        M: { ...start.sizes.M, codeLetter: "N" as const },
      },
    };
    const { reduce, changes, data } = screen(both);
    reduce("S", "Consistent high-quality factory");
    expect(changes).toHaveLength(1);
    expect(data().sizes.S).toMatchObject({
      codeLetter: "M",
      gloves: 315,
      glovesWatertightVisual: 315,
      codeLetterReason: "Consistent high-quality factory",
    });
    expect(data().sizes.M).toEqual(both.sizes.M);
  });

  it("keeps both of two counts entered in one event, before the screen renders again", () => {
    const { setCount, changes, data } = screen();
    setCount("M", "cases", 50);
    setCount("M", "glovesWatertightVisual", 500);
    expect(changes).toHaveLength(2);
    expect(data().sizes.M).toMatchObject({ cases: 50, glovesWatertightVisual: 500 });
  });

  it("hands a pasted row of the report's table to onChange once, with every count in it", () => {
    const { setCount, changes, data } = screen(withCount(emptySamplingPlan(), "XS", "cases", 5));
    const row: [SamplingColumn, number][] = [
      ["cases", 50],
      ["innerUnits", 50],
      ["gloves", 500],
      ["glovesWatertightVisual", 500],
      ["glovesDimensions", 13],
      ["glovesPhysical", 13],
      ["innerUnitsDispensing", 13],
    ];
    // NumberField fills the run inside batchDataChanges, each field through its own handler.
    batchDataChanges(() => row.forEach(([column, value]) => setCount("M", column, value)));
    expect(changes).toHaveLength(1);
    expect(data().sizes.M).toMatchObject(Object.fromEntries(row));
    expect(data().sizes.XS.cases).toBe(5);
  });
});
