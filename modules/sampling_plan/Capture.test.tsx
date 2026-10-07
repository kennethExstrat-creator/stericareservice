// Server-rendered markup of the Sampling Plan body: the template's wording,
// only the ordered sizes, the plan beside the counts, warnings in place,
// issue links and read-only. Keys, paste and swipes are the kit's
// (components/qc), checked in a browser by the integrator.
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
  it("shows a tab and a panel per ordered size only, each count a whole-number cell (6.2 rules 1 and 4)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const tabs = tagsWith(html, 'role="tab"');
    expect(tabs.map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["XS", "S", "M", "L"]);
    expect(tagsWith(html, 'role="tabpanel"')).toHaveLength(4);
    const inputs = tagsWith(html, "data-enter-field");
    expect(inputs).toHaveLength(4 * 7);
    for (const input of inputs) expect(input).toContain('inputMode="decimal"');
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

  it("shows the order, the lot in gloves and the level's plan beside the counts, computed not typed (6.2 rule 2)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    for (const text of ["Order Qty (Case)", "Lot Size (Gloves)", "Inspection Level", "Code Letter", "Sample Size by Plan"]) {
      expect(html).toContain(text);
    }
    for (const value of ["120,000", "1,700,000", "1,120,000", "200", "500"]) expect(html).toContain(value);
    // No level: no plan to show.
    const plain = render(props(SAFEDON_EG_EXAMPLE, SAMPLING_PLAN_DEFAULT_CONFIG));
    expect(plain).not.toContain("Sample Size by Plan");
  });

  it("puts the below-plan warning under the cell it concerns, and links issues to the cells (BUILD_SPEC 6.1, 6.2)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(html).toContain("80 gloves sampled; inspection level I needs 200 (lot 120,000 gloves, code L).");
    expect(html).toContain("200 gloves sampled; inspection level I needs 500 (lot 1,700,000 gloves, code N).");
    expect(html).toContain(pathAttribute(["sizes", "XS", "glovesWatertightVisual"]));
    expect(html).toContain(pathAttribute(["sizes", "L", "cases"]));
    // Warnings are amber notes, not red cells.
    expect(redCells(html)).toEqual([]);
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

  it("names each size's table and its cells with the size as its tab words it, Title Case as a label is", () => {
    const html = render(props(STD_EG_EXAMPLE));
    expect(html).toContain('<caption class="sr-only">Sampling Plan, Size M</caption>');
    // A refused entry's link in the problem list repeats the cell's name.
    expect(html).toContain('aria-label="Case, Size M"');
    expect(html).not.toContain(", size M");
  });

  it("shows each size's result at the kit's touch size: 16 px text on iPad", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    const pills = tagsWith(html, 'data-slot="status-pill"');
    expect(pills).toHaveLength(4);
    for (const pill of pills) expect(pill).toContain("touch:text-base");
    // An empty size says so in a few words.
    const empty = render(props(SAFEDON_EG_EXAMPLE, LEVEL_I, SAMPLING_PLAN_LABELS, exampleData(SAFEDON_EG_EXAMPLE, { sampling_plan: { sizes: {} } })));
    expect(empty.match(/Not started\./g)).toHaveLength(4);
    expect(empty).not.toContain("Missing:");
  });

  it("totals the columns over the sizes, as the onsite forms' Total: row", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(html).toContain("Total:");
    expect(html).toContain("1,530");
    expect(html).toContain("560");
    // One size: the row is its own total.
    expect(render(props(STD_EG_EXAMPLE))).not.toContain("Total:");
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

  it("is read-only for an approved inspection: cells become text, tabs still work", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), readOnly: true });
    for (const input of tagsWith(html, "data-enter-field")) expect(input).toContain("readOnly");
    expect(tagsWith(html, 'role="tab"')).toHaveLength(1);
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
