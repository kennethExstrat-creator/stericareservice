// Server-rendered markup of the carton grid: one cell per case sampled, 10 to
// a row, then a shaded spare row; the template's caption, duplicates and
// out-of-range numbers red in their cells with links, read-only. Keys, paste
// and swipes are the kit's (components/qc), checked in a browser by the
// integrator; a paste's run over the cells uses the kit's own functions here.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { fillRun, planFieldPaste, type PasteResult } from "@/components/qc/field-navigation";
import { buildInspectionContext, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "@/modules/sampling_plan/__fixtures__/examples";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE, type ExampleReport } from "@/tests/fixtures/examples";
import type { CartonSamplingComputed } from "./calc";
import Capture from "./Capture";
import { CARTON_SAMPLING_DEFAULT_CONFIG, CARTON_SAMPLING_LABELS } from "./config";
import { emptyCartonSampling, withCartonNumber, type CartonSamplingData } from "./schema";

const noop = () => {};

function props(example: ExampleReport, data: InspectionData = exampleData(example), labels: Record<string, string> = CARTON_SAMPLING_LABELS) {
  const template = makeTestTemplate(ENGINE_REGISTRY, ["order_lots", "packing_config", "sampling_plan", { key: "carton_sampling", labels }]);
  const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
  const found = evaluateInspection({ template, data, context }, ENGINE_REGISTRY).modules.find(
    (entry) => entry.key === "carton_sampling",
  );
  if (!found) throw new Error("carton_sampling was not evaluated");
  return {
    data: data.modules.carton_sampling as CartonSamplingData,
    config: CARTON_SAMPLING_DEFAULT_CONFIG,
    title: "Finished Goods Sampling Information (carton number)",
    labels,
    context,
    evaluation: { ...found, computed: found.computed as CartonSamplingComputed },
    focusPath: null,
    readOnly: false,
    onChange: noop,
  };
}

const render = (input: Parameters<typeof Capture>[0]) => renderToStaticMarkup(<Capture {...input} />);

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

const pathAttribute = (path: readonly (string | number)[]) =>
  `data-issue-path="${JSON.stringify(path).replaceAll('"', "&quot;")}"`;

/** Cells calc marked with an error: `ring-fail` as a class of its own, not the `aria-invalid:` variant every cell has. */
const redCells = (html: string): string[] =>
  tagsWith(html, "data-enter-field").filter((tag) => /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/).includes("ring-fail"));

/** The grid positions of the shaded (spare) cells: the cell's <td> carries `bg-slate-50`. */
const spareCells = (html: string): number[] =>
  Array.from(html.matchAll(/<td class="([^"]*)"><div data-slot="number-field"/g), (match) => match[1])
    .map((classes, index) => (classes.split(/\s+/).includes("bg-slate-50") ? index : -1))
    .filter((index) => index >= 0);

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, offset) => from + offset);

describe("carton_sampling Capture", () => {
  it("offers one cell per case sampled, 10 to a row, then a shaded spare row, named by row and column as on the report", () => {
    const html = render(props(STD_EG_EXAMPLE));
    const cells = tagsWith(html, "data-enter-field");
    expect(cells).toHaveLength(60);
    expect(cells[0]).toContain('aria-label="M (Carton #), row 1 column 1"');
    expect(cells[20]).toContain('aria-label="M (Carton #), row 3 column 1"');
    expect(cells[49]).toContain('aria-label="M (Carton #), row 5 column 10"');
    expect(cells[50]).toContain('aria-label="M (Carton #), row 6 column 1, beyond the 50 cases sampled"');
    expect(spareCells(html)).toEqual(range(50, 60));
    for (const cell of cells) expect(cell).toContain('inputMode="decimal"');
    expect(html).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 20]));
    expect(html).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 59]));
    expect(html).toContain(pathAttribute(["sizes", "M", "cartonNumbers"]));
  });

  it("offers the report's 50 cells and a spare row until the sampling plan gives the cases, then the plan's rows and a spare row", () => {
    const noPlan = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: {} },
      carton_sampling: { sizes: { M: { cartonNumbers: [32, 578] } } },
    });
    const unplanned = render(props(STD_EG_EXAMPLE, noPlan));
    expect(tagsWith(unplanned, "data-enter-field")).toHaveLength(60);
    // No plan, nothing to be beyond.
    expect(spareCells(unplanned)).toEqual([]);
    expect(unplanned).not.toContain("beyond the");

    const more = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, cases: 63 } } },
    });
    const html = render(props(STD_EG_EXAMPLE, more));
    const cells = tagsWith(html, "data-enter-field");
    expect(cells).toHaveLength(80);
    expect(cells[62]).toContain('aria-label="M (Carton #), row 7 column 3"');
    expect(cells[63]).toContain('aria-label="M (Carton #), row 7 column 4, beyond the 63 cases sampled"');
    expect(spareCells(html)).toEqual(range(63, 80));
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ .*63/);

    // A list longer than the plan keeps its numbers in view, with a spare row after them.
    const longer = exampleData(SAFEDON_EG_EXAMPLE, {
      carton_sampling: { sizes: { XS: { cartonNumbers: range(1, 24) } } },
    });
    expect(tagsWith(render(props(SAFEDON_EG_EXAMPLE, longer)), "data-enter-field")).toHaveLength(40);
    // No case sampled: the spare row only.
    const none = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, cases: 0 } } },
      carton_sampling: { sizes: {} },
    });
    expect(spareCells(render(props(STD_EG_EXAMPLE, none)))).toEqual(range(0, 10));
  });

  it("shows only the ordered sizes and their sampled cases: SAFEDON_EG XS has 5 cells and the spare ones", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["XS", "S", "M", "L"]);
    // Tabs: the first size's panel only. 5 cases: the rest of row 1 and row 2 are spare.
    expect(tagsWith(html, "data-enter-field")).toHaveLength(20);
    expect(spareCells(html)).toEqual(range(5, 20));
    expect(html).toContain('aria-label="XS (Carton #), row 1 column 6, beyond the 5 cases sampled"');
    expect(html).toContain("XS (Carton #)");
  });

  it("shows each size's result at the kit's touch size: 16 px text on iPad", () => {
    for (const html of [render(props(STD_EG_EXAMPLE)), render(props(SAFEDON_EG_EXAMPLE))]) {
      const pills = tagsWith(html, 'data-slot="status-pill"');
      expect(pills.length).toBeGreaterThan(0);
      for (const pill of pills) expect(pill).toContain("touch:text-base");
    }
  });

  it("marks both cells of the carton entered twice red, with the message linked below (expected result B)", () => {
    const html = render(props(STD_EG_EXAMPLE));
    const red = redCells(html);
    expect(red).toHaveLength(2);
    expect(red[0]).toContain('aria-label="M (Carton #), row 2 column 10"');
    expect(red[1]).toContain('aria-label="M (Carton #), row 3 column 1"');
    expect(html).toContain("Size M: Carton 525 is entered twice (row 2 column 10, row 3 column 1).");
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ .*50/);
  });

  it("puts the template's wording in the caption and fills in the size", () => {
    const labels = { ...CARTON_SAMPLING_LABELS, sizeCaption: "Carton # {size}", samplingQuantity: "Qty sampled" };
    const html = render(props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE), labels));
    expect(html).toContain("Carton # M");
    expect(html).toContain('aria-label="Carton # M, row 1 column 1"');
    expect(html).toContain("Qty sampled");
    expect(html).not.toContain("M (Carton #)");
  });

  it("is read-only for an approved inspection, without the spare row: there is nothing to enter", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), readOnly: true });
    const cells = tagsWith(html, "data-enter-field");
    expect(cells).toHaveLength(50);
    for (const cell of cells) expect(cell).toContain("readOnly");
    // A plan that does not fill its last row keeps the rest of it shaded.
    const partial = render({ ...props(SAFEDON_EG_EXAMPLE), readOnly: true });
    expect(tagsWith(partial, "data-enter-field")).toHaveLength(10);
    expect(spareCells(partial)).toEqual(range(5, 10));
  });

  it("says so while no size is ordered", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), context: makeTestContext(), evaluation: null });
    expect(html).toContain("No sizes ordered yet");
  });
});

describe("carton_sampling Capture writes (useDataUpdater, docs/CAPTURE_KIT.md)", () => {
  /**
   * The capture screen under the kit's updater: onChange replaces the data,
   * and every cell's handler is the one made at the last render, as the
   * Capture's setCarton is.
   */
  function screen(start: CartonSamplingData = emptyCartonSampling()) {
    let data = start;
    const changes: CartonSamplingData[] = [];
    const updater = createDataUpdater(data, (next) => {
      changes.push(next);
      data = next;
    });
    const setCarton = (size: string, index: number, value: number | null) =>
      updater.update((current) => withCartonNumber(current, size, index, value));
    return { setCarton, changes, data: () => data };
  }

  it("keeps both of two numbers entered in one event, before the screen renders again", () => {
    const { setCarton, changes, data } = screen();
    setCarton("M", 0, 32);
    setCarton("M", 1, 578);
    expect(changes).toHaveLength(2);
    expect(data().sizes.M.cartonNumbers).toEqual([32, 578]);
  });

  it("hands a pasted column to onChange once, every number in its cell", () => {
    const { setCarton, changes, data } = screen(withCartonNumber(emptyCartonSampling(), "XS", 0, 7));
    const pasted = [1186, 2389, 2865, 32, 578];
    // Pasted into row 1 column 3: NumberField fills the cells after it inside batchDataChanges.
    batchDataChanges(() => pasted.forEach((carton, offset) => setCarton("M", 2 + offset, carton)));
    expect(changes).toHaveLength(1);
    expect(data().sizes.M.cartonNumbers).toEqual([null, null, ...pasted]);
    expect(data().sizes.XS.cartonNumbers).toEqual([7]);
  });

  it("stores a pasted list longer than the cases sampled, in the spare cells, and the size fails (6.2 rule 6)", () => {
    // SAFEDON_EG XS: 5 cases sampled, no carton numbers yet.
    const start = exampleData(SAFEDON_EG_EXAMPLE, { carton_sampling: { sizes: {} } });
    const cells = tagsWith(render(props(SAFEDON_EG_EXAMPLE, start)), "data-enter-field").map((_, index) => index);
    const { setCarton, changes, data } = screen();
    const pasted = [1, 12, 18, 25, 33, 41, 47, 52];
    // Pasted into row 1 column 1, as NumberField does it: one value per cell on screen, while there is one.
    const plan = planFieldPaste(pasted.join("\n"), { column: false });
    if (!plan) throw new Error("Not read as a paste of several values");
    let result: PasteResult | null = null;
    batchDataChanges(() => {
      result = fillRun(plan.values, cells, 0, (index, raw) => {
        setCarton("XS", index, Number(raw));
        return true;
      });
    });
    expect(result).toEqual({ filled: 8, rejected: 0, skipped: 0 });
    expect(changes).toHaveLength(1);
    expect(data().sizes.XS.cartonNumbers).toEqual(pasted);

    const after = props(SAFEDON_EG_EXAMPLE, exampleData(SAFEDON_EG_EXAMPLE, { carton_sampling: data() }));
    expect(after.evaluation.result.perSize?.XS).toEqual({
      status: "fail",
      summary: "8 carton numbers, but the sampling plan has 5 cases.",
    });
    expect(after.evaluation.issues.map(({ code, size }) => [code, size])).toEqual([["carton_count_above_cases", "XS"]]);
    const html = render(after);
    expect(html).toContain("Size XS: 8 carton numbers, but the sampling plan has 5 cases.");
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*8.* \/ .*5/);
    expect(spareCells(html)).toEqual(range(5, 20));
  });
});
