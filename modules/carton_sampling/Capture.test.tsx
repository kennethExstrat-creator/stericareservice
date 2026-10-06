// Server-rendered markup of the carton grid: one cell per case sampled, 10 to
// a row, the template's caption, duplicates and out-of-range numbers red in
// their cells with links, read-only. Keys, paste and swipes are the kit's
// (components/qc), checked in a browser by the integrator.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
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

describe("carton_sampling Capture", () => {
  it("offers one cell per case sampled, 10 to a row, named by row and column as on the report", () => {
    const html = render(props(STD_EG_EXAMPLE));
    const cells = tagsWith(html, "data-enter-field");
    expect(cells).toHaveLength(50);
    expect(cells[0]).toContain('aria-label="M (Carton #), row 1 column 1"');
    expect(cells[20]).toContain('aria-label="M (Carton #), row 3 column 1"');
    expect(cells[49]).toContain('aria-label="M (Carton #), row 5 column 10"');
    for (const cell of cells) expect(cell).toContain('inputMode="decimal"');
    expect(html).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 20]));
    expect(html).toContain(pathAttribute(["sizes", "M", "cartonNumbers"]));
  });

  it("offers the report's 50 cells until the sampling plan gives the cases, then one per case sampled", () => {
    const noPlan = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: {} },
      carton_sampling: { sizes: { M: { cartonNumbers: [32, 578] } } },
    });
    expect(tagsWith(render(props(STD_EG_EXAMPLE, noPlan)), "data-enter-field")).toHaveLength(50);
    const more = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, cases: 63 } } },
    });
    const html = render(props(STD_EG_EXAMPLE, more));
    const cells = tagsWith(html, "data-enter-field");
    expect(cells).toHaveLength(63);
    expect(cells[62]).toContain('aria-label="M (Carton #), row 7 column 3"');
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ .*63/);
  });

  it("shows only the ordered sizes and their sampled cases: SAFEDON_EG XS has 5 cells", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["XS", "S", "M", "L"]);
    // Tabs: the first size's panel only.
    expect(tagsWith(html, "data-enter-field")).toHaveLength(5);
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

  it("is read-only for an approved inspection", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), readOnly: true });
    for (const cell of tagsWith(html, "data-enter-field")) expect(cell).toContain("readOnly");
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
});
