// Server-rendered markup of the Sampling Plan body: one table with a column
// per ordered size (Kenneth, 26 October 2026), the template's wording, the
// order and lot beside the counts, warnings in place, issue links and
// read-only. Keys and paste are the kit's (components/qc): here, the run
// order they follow; they are checked in a browser by the integrator.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { buildInspectionContext, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE, type ExampleReport } from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "./__fixtures__/examples";
import type { SamplingPlanComputed } from "./calc";
import Capture from "./Capture";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingColumn, type SamplingPlanConfig } from "./config";
import { emptySamplingPlan, withCount, type SamplingPlanData } from "./schema";

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
    expect(inputs).toHaveLength(4 * 7);
    for (const input of inputs) expect(input).toContain('inputMode="decimal"');
  });

  it("runs the cells size by size, top to bottom: Enter and a pasted row or column go down a size's column, then on", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const fields = tagsWith(html, "data-enter-field");
    expect(fields.slice(0, 8).map((field) => /id="([^"]+)"/.exec(field)?.[1])).toEqual([
      "sampling-plan-XS-cases",
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

  it("reads every label from the template's wording and never offers it for editing (6.2 rule 11)", () => {
    // SAFEDON_EG's words for its inner unit, the plastic pack, wherever STD_EG says Inner Box.
    const labels = {
      ...SAMPLING_PLAN_LABELS,
      innerUnits: "Inner Pack",
      glovesPhysical: "# Gloves for Tensile",
      innerUnitsDispensing: "# Inner Packs for Packaging & Dispensing Inspection",
    };
    const html = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, labels));
    expect(html).toContain("# Gloves for Tensile");
    expect(html).toContain('aria-label="Inner Pack, Size XS"');
    expect(html).not.toContain("# Gloves for FAB");
    expect(html).not.toContain("Inner Box");
    expect(html).toContain("Sampling Quantity");
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
    // No inspection level, code letter or plan sample size on the card (Kenneth, 26 October 2026).
    expect(html).not.toContain("Inspection Level");
    expect(html).not.toContain("Code Letter");
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
    expect(html).toContain("Size M, Case: 3,000 cases sampled, more than the 2,900 cases ordered.");
    const red = redCells(html);
    expect(red).toHaveLength(1);
    expect(red[0]).toContain('aria-label="Case, Size M"');
  });

  it("names each size's column and its cells with the size, Title Case as a label is", () => {
    const html = render(props(STD_EG_EXAMPLE));
    expect(html).toContain('role="group" aria-label="Size M"');
    // A refused entry's link in the problem list repeats the cell's name.
    expect(html).toContain('aria-label="Case, Size M"');
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
    const order = ["Case", "Inner Box", "Pouches", "# Gloves", "# Gloves for Dimension"];
    const positions = order.map((name) => html.indexOf(`aria-label="${name}, Size M"`));
    expect(positions.every((position) => position > group)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).not.toContain('aria-label="Gloves, Size M"');
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

describe("sampling_plan Capture writes (useDataUpdater, docs/CAPTURE_KIT.md)", () => {
  /**
   * The capture screen under the kit's updater: onChange replaces the data,
   * and every handler is the one made at the last render, as the Capture's
   * setCount is.
   */
  function screen(start: SamplingPlanData = emptySamplingPlan()) {
    let data = start;
    const changes: SamplingPlanData[] = [];
    const updater = createDataUpdater(data, (next) => {
      changes.push(next);
      data = next;
    });
    const setCount = (size: string, column: SamplingColumn, value: number | null) =>
      updater.update((current) => withCount(current, size, column, value));
    return { setCount, changes, data: () => data };
  }

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
