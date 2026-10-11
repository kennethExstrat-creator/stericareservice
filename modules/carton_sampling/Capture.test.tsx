// Server-rendered markup of the carton list: each size's numbers as chips in
// the order entered, each with a remove button, and one field on the numeric
// keypad for the next; the template's caption; duplicates and numbers above
// the order quantity red with links; a list saved from the grid shown by its
// numbers; read-only. Typing, Enter and paste run in a browser; the rules they
// follow are edit.ts's (edit.test.ts), and the writes below go through the
// kit's updater as the screen's do.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefusedEntryStoreContext, type RefusedEntryStore } from "@/components/qc";
import { createDataUpdater } from "@/components/qc/data-updater";
import { buildInspectionContext, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "@/modules/sampling_plan/__fixtures__/examples";
import {
  cartonList,
  SAFEDON_EG_EXAMPLE,
  STD_EG_EXAMPLE,
  type ExampleReport,
} from "@/tests/fixtures/examples";
import type { CartonSamplingComputed } from "./calc";
import Capture from "./Capture";
import { CARTON_SAMPLING_DEFAULT_CONFIG, CARTON_SAMPLING_LABELS } from "./config";
import { addCartons, pastedCartons, readTypedCarton, refusalMessage, removeCarton, type AddedCartons } from "./edit";
import { emptyCartonSampling, type CartonSamplingData } from "./schema";

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

const classesOf = (tag: string): string[] => /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];

const pathAttribute = (path: readonly (string | number)[]) =>
  `data-issue-path="${JSON.stringify(path).replaceAll('"', "&quot;")}"`;

/** The rows' opening tags (one page: 15), in the order on screen. */
const chipTags = (html: string): string[] => tagsWith(html, "data-carton=");

/** The carton numbers in the rows, in the order on screen. */
const chips = (html: string): number[] => chipTags(html).map((tag) => Number(/data-carton="(\d+)"/.exec(tag)?.[1]));

/** Rows calc marked with an error. */
const redChips = (html: string): string[] => chipTags(html).filter((tag) => classesOf(tag).includes("bg-fail-tint"));

const removeButtons = (html: string): string[] => tagsWith(html, 'aria-label="Delete Carton ');

/** The size's field that adds a carton number. */
const field = (html: string, size: string): string | undefined => tagsWith(html, `id="carton-sampling-${size}-entry"`)[0];

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, offset) => from + offset);

describe("carton_sampling Capture", () => {
  it("lists the size's carton numbers in a table, 15 rows a page in the order entered, and a field on the numeric keypad for the next", () => {
    const html = render(props(STD_EG_EXAMPLE));
    const list = cartonList(STD_EG_EXAMPLE.cartons.M!);
    expect(html).toContain("<table");
    expect(html).toMatch(/<th[^>]*>No\.<\/th>/);
    expect(html).toMatch(/<th[^>]*>Carton Number<\/th>/);
    expect(chips(html)).toEqual(list.slice(0, 15));
    // Each row points at its place in the stored list and takes an issue link's focus itself.
    const tags = chipTags(html);
    expect(tags[3]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 3]));
    expect(tags[3]).toContain('id="carton-sampling-M-3"');
    for (const tag of tags) expect(tag).toContain('tabindex="-1"');
    // Each row with its delete button; the pages below: 1–15 of 50, four pages.
    const buttons = removeButtons(html);
    expect(buttons).toHaveLength(15);
    expect(buttons[0]).toContain(`aria-label="Delete Carton ${list[0]}"`);
    expect(html).toContain("1–15 of 50");
    expect(tagsWith(html, 'aria-label="Page ')).toHaveLength(4);
    expect(tagsWith(html, 'aria-current="page"')).toHaveLength(1);

    const entry = field(html, "M");
    expect(entry).toBeDefined();
    expect(entry).toContain('inputMode="numeric"');
    expect(entry).toContain('aria-label="M (Carton #): add"');
    expect(entry).toContain('placeholder="Carton number"');
    // Calc's count issue lands on the field.
    expect(entry).toContain(pathAttribute(["sizes", "M", "cartonNumbers"]));
    // The kit's field: 44 px and 16 px text on touch.
    expect(classesOf(entry!)).toEqual(expect.arrayContaining(["touch:h-11", "text-base"]));
    expect(html).toMatch(/<button[^>]*data-slot="button"[^>]*>.*?Add<\/button>/);
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ .*50/);
  });

  it("shows a list saved from the grid by its numbers only, each chip pointing at its place in the saved list", () => {
    const grid = exampleData(STD_EG_EXAMPLE, {
      carton_sampling: { sizes: { M: { cartonNumbers: [32, null, 578, null, null, 1186] } } },
    });
    const html = render(props(STD_EG_EXAMPLE, grid));
    expect(chips(html)).toEqual([32, 578, 1186]);
    expect(chipTags(html).map((tag) => /data-issue-path="([^"]*)"/.exec(tag)?.[1].replaceAll("&quot;", '"'))).toEqual([
      '["sizes","M","cartonNumbers",0]',
      '["sizes","M","cartonNumbers",2]',
      '["sizes","M","cartonNumbers",5]',
    ]);
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*3.* \/ .*50/);
  });

  it("marks both rows of a carton entered twice red, with the message linked below", () => {
    const twice = exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, 578, 32] } } } });
    const html = render(props(STD_EG_EXAMPLE, twice));
    const red = redChips(html);
    expect(red).toHaveLength(2);
    expect(red[0]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 0]));
    expect(red[1]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 2]));
    for (const row of red) expect(row).toContain('data-carton="32"');
    // On each row, read out with its delete button too.
    expect(red[0]).toContain('aria-describedby="carton-sampling-M-0-problem"');
    expect(html).toContain('id="carton-sampling-M-2-problem"');
  });

  it("marks a carton above the order quantity red, with a link to its chip (6.2 rule 6)", () => {
    const data = exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, 9999, 578] } } } });
    const html = render(props(STD_EG_EXAMPLE, data));
    const red = redChips(html);
    expect(red).toHaveLength(1);
    expect(red[0]).toContain('data-carton="9999"');
    expect(red[0]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 1]));
    expect(html).toContain("Size M: Carton 9999 is not between 1 and 2,900, the order quantity (row 1 column 2).");
  });

  it("counts the list against the plan's cases, however many the plan has: 50 of 63, not done", () => {
    const more = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, cases: 63 } } },
      carton_sampling: { sizes: { M: { cartonNumbers: range(1, 51) } } },
    });
    const input = props(STD_EG_EXAMPLE, more);
    expect(input.evaluation.result.perSize?.M).toEqual({ status: "not_done", summary: "50 of 63 carton numbers." });
    const html = render(input);
    expect(chips(html)).toEqual(range(1, 16));
    expect(html).toContain("1–15 of 50");
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ .*63/);
    // Until the plan gives the cases, the count stands alone.
    const noPlan = render(props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { sampling_plan: { sizes: {} } })));
    expect(chips(noPlan)).toHaveLength(15);
    expect(noPlan).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ <span data-slot="figure" data-empty=""/);
  });

  it("shows only the ordered sizes and the list of the size on screen: SAFEDON_EG XS", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["XS", "S", "M", "L"]);
    // Tabs: the first size's panel only.
    expect(chips(html)).toEqual(cartonList(SAFEDON_EG_EXAMPLE.cartons.XS!));
    expect(html).toContain("XS (Carton #)");
    expect(field(html, "XS")).toBeDefined();
    expect(field(html, "S")).toBeUndefined();
  });

  it("shows each size's result at the kit's touch size: 16 px text on iPad", () => {
    for (const html of [render(props(STD_EG_EXAMPLE)), render(props(SAFEDON_EG_EXAMPLE))]) {
      const pills = tagsWith(html, 'data-slot="status-pill"');
      expect(pills.length).toBeGreaterThan(0);
      for (const pill of pills) expect(pill).toContain("touch:text-base");
    }
  });

  it("puts the template's wording in the caption and the field's name, and fills in the size", () => {
    const labels = { ...CARTON_SAMPLING_LABELS, sizeCaption: "Carton # {size}", samplingQuantity: "Qty sampled" };
    const html = render(props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE), labels));
    expect(html).toContain("Carton # M");
    expect(field(html, "M")).toContain('aria-label="Carton # M: add"');
    expect(html).toContain("Qty sampled");
    expect(html).not.toContain("M (Carton #)");
  });

  it("explains the field while the size has no carton numbers yet", () => {
    const html = render(props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: {} } })));
    expect(chips(html)).toEqual([]);
    expect(html).not.toContain("<ol");
    expect(html).toContain("Type a carton number and press Enter, or paste a list to add several at once.");
    expect(field(html, "M")).toContain('aria-describedby="carton-sampling-M-hint"');
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*0.* \/ .*50/);
  });

  it("brings back text the field refused, with its message, after a size switch or a reload (the screen's store)", () => {
    const kept = { raw: "52.5", error: refusalMessage({ reason: "not_a_carton", raw: "52.5" }) };
    const asked: string[] = [];
    const store: RefusedEntryStore = {
      get: (path) => {
        asked.push(JSON.stringify(path));
        return JSON.stringify(path) === '["sizes","M","cartonNumbers"]' ? kept : undefined;
      },
      set: noop,
    };
    const html = renderToStaticMarkup(
      <RefusedEntryStoreContext.Provider value={store}>
        <Capture {...props(STD_EG_EXAMPLE)} />
      </RefusedEntryStoreContext.Provider>,
    );
    const entry = field(html, "M");
    expect(entry).toContain('value="52.5"');
    expect(entry).toContain('aria-invalid="true"');
    expect(entry).toContain('aria-describedby="carton-sampling-M-message"');
    expect(html).toContain("“52.5” is not a carton number: whole numbers from 1 only.");
    expect(asked).toContain('["sizes","M","cartonNumbers"]');
  });

  it("is read-only for an approved inspection: rows without delete buttons and no field, issue links still landing", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), readOnly: true });
    expect(chips(html)).toHaveLength(15);
    expect(removeButtons(html)).toEqual([]);
    expect(field(html, "M")).toBeUndefined();
    expect(html).not.toContain("Add</button>");
    // The rows still take an issue link's focus; the count issue lands on the table.
    for (const tag of chipTags(html)) expect(tag).toContain('tabindex="-1"');
    const table = (html.match(/<div[^>]*>/g) ?? []).find((tag) => tag.includes(pathAttribute(["sizes", "M", "cartonNumbers"])));
    expect(table).toContain('tabindex="-1"');
    // Nothing entered: said so, and that is where the link lands.
    const empty = render({
      ...props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: {} } })),
      readOnly: true,
    });
    expect(empty).toMatch(/<p [^>]*tabindex="-1"[^>]*>No carton numbers entered\.<\/p>/);
    expect(empty).not.toContain("Type a carton number");
  });

  it("says so while no size is ordered", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), context: makeTestContext(), evaluation: null });
    expect(html).toContain("No sizes ordered yet");
  });
});

describe("carton_sampling Capture writes (useDataUpdater, docs/CAPTURE_KIT.md)", () => {
  /**
   * The capture screen under the kit's updater: onChange replaces the data,
   * and every handler is the one made at the last render, as the Capture's
   * add and remove are.
   */
  function screen(start: CartonSamplingData = emptyCartonSampling()) {
    let data = start;
    const changes: CartonSamplingData[] = [];
    const updater = createDataUpdater(data, (next) => {
      changes.push(next);
      data = next;
    });
    // As Capture's add: update runs the change at once, so what it left out is known on return.
    const add = (size: string, entries: readonly string[]): AddedCartons => {
      let outcome: AddedCartons = { data, added: [], refused: [] };
      updater.update((current) => {
        outcome = addCartons(current, size, entries);
        return outcome.data;
      });
      return outcome;
    };
    const remove = (size: string, index: number, carton: number) =>
      updater.update((current) => removeCarton(current, size, index, carton));
    return { add, remove, changes, data: () => data };
  }

  /** What Enter does with the typed text. */
  const typed = (text: string): string[] => {
    const entry = readTypedCarton(text);
    if (entry.kind !== "entry") throw new Error(`“${text}” is not one entry`);
    return [entry.raw];
  };

  it("keeps both of two numbers added in one event, before the screen renders again", () => {
    const { add, changes, data } = screen();
    add("M", typed("32"));
    add("M", typed("578"));
    expect(changes).toHaveLength(2);
    expect(data().sizes.M.cartonNumbers).toEqual([32, 578]);
  });

  it("refuses a number the size already lists, saving nothing, and adds it to another size", () => {
    const { add, changes, data } = screen({ sizes: { M: { cartonNumbers: [32, 525] } } });
    expect(add("M", typed("525")).refused).toEqual([{ reason: "listed", raw: "525", carton: 525 }]);
    expect(changes).toEqual([]);
    expect(add("S", typed("525")).added).toEqual([525]);
    expect(data().sizes).toEqual({ M: { cartonNumbers: [32, 525] }, S: { cartonNumbers: [525] } });
  });

  it("hands a pasted list to onChange once, leaving out what is listed already or no carton number", () => {
    const { add, changes, data } = screen({ sizes: { XS: { cartonNumbers: [7] }, M: { cartonNumbers: [32] } } });
    const pasted = pastedCartons("578\n1186, 32; abc 2389\t578");
    if (!pasted) throw new Error("Not read as a list");
    const { added, refused } = add("M", pasted);
    expect(changes).toHaveLength(1);
    expect(added).toEqual([578, 1186, 2389]);
    expect(refused.map(({ reason, raw }) => [reason, raw])).toEqual([
      ["listed", "32"],
      ["not_a_carton", "abc"],
      ["listed", "578"],
    ]);
    expect(data().sizes.M.cartonNumbers).toEqual([32, 578, 1186, 2389]);
    expect(data().sizes.XS.cartonNumbers).toEqual([7]);
  });

  it("stores a pasted list longer than the cases sampled, and the size fails on the count, its link on the field (6.2 rule 6)", () => {
    // SAFEDON_EG XS: 5 cases sampled, no carton numbers yet.
    const { add, changes, data } = screen();
    const pasted = [1, 12, 18, 25, 33, 41, 47, 52];
    add("XS", pastedCartons(pasted.join("\n")) ?? []);
    expect(changes).toHaveLength(1);
    expect(data().sizes.XS.cartonNumbers).toEqual(pasted);

    const after = props(SAFEDON_EG_EXAMPLE, exampleData(SAFEDON_EG_EXAMPLE, { carton_sampling: data() }));
    expect(after.evaluation.result.perSize?.XS).toEqual({
      status: "fail",
      summary: "8 carton numbers, but the sampling plan has 5 cases.",
    });
    expect(after.evaluation.issues.map(({ code, size, path }) => [code, size, path])).toEqual([
      ["carton_count_above_cases", "XS", ["sizes", "XS", "cartonNumbers"]],
    ]);
    const html = render(after);
    expect(html).toContain("Size XS: 8 carton numbers, but the sampling plan has 5 cases.");
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*8.* \/ .*5/);
    expect(chips(html)).toEqual(pasted);
    expect(field(html, "XS")).toContain(pathAttribute(["sizes", "XS", "cartonNumbers"]));
  });

  it("takes a chip's carton off, and stores a list saved from the grid without its blanks", () => {
    const { remove, add, changes, data } = screen({ sizes: { M: { cartonNumbers: [32, null, 578, null, 1186] } } });
    remove("M", 2, 578);
    expect(data().sizes.M.cartonNumbers).toEqual([32, 1186]);
    // Taken off twice from a screen not yet rendered again: once only.
    remove("M", 2, 578);
    expect(changes).toHaveLength(1);
    add("M", typed("578"));
    expect(data().sizes.M.cartonNumbers).toEqual([32, 1186, 578]);
  });
});
