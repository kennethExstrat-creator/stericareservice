// Server-rendered markup of the carton table (Kenneth, 13 October 2026: "a 10
// row table by default to fill in, and do pagination"): each size's rows to
// fill in, 10 a page, a field on the numeric keypad in every row and a clear
// button on each row holding something; as many rows as the plan's cases, at
// least 10; a list saved before shown in its rows; calc's problems red with
// links; refused text kept in its row; read-only. Typing, Enter and paste run
// in a browser; the rules they follow are edit.ts's (edit.test.ts), and the
// writes below go through the kit's updater as the screen's do.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefusedEntryStoreContext, type RefusedEntryStore } from "@/components/qc";
import { createDataUpdater } from "@/components/qc/data-updater";
import { buildInspectionContext, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "@/modules/sampling_plan/__fixtures__/examples";
import { cartonList, SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE, type ExampleReport } from "@/tests/fixtures/examples";
import type { CartonSamplingComputed } from "./calc";
import Capture from "./Capture";
import { CARTON_SAMPLING_DEFAULT_CONFIG, CARTON_SAMPLING_LABELS } from "./config";
import {
  clearCartonRow,
  pastedCartons,
  pasteCartons,
  readTypedCarton,
  refusalMessage,
  setCartonRow,
  type CartonRefusal,
  type PastedCartons,
} from "./edit";
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

/** The opening tags holding `text`, in the order on screen. */
const tagsWith = (html: string, text: string): string[] =>
  Array.from(html.matchAll(/<[^>]*>/g), (match) => match[0]).filter((tag) => tag.includes(text));

const classesOf = (tag: string): string[] => /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];

const attributeOf = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

const pathAttribute = (path: readonly (string | number)[]) =>
  `data-issue-path="${JSON.stringify(path).replaceAll('"', "&quot;")}"`;

/** The rows' fields on the page shown, in order. */
const fields = (html: string): string[] => tagsWith(html, 'data-slot="carton-cell"');

/** What each field on the page shows. */
const values = (html: string): string[] => fields(html).map((tag) => attributeOf(tag, "value") ?? "");

/** The table body's rows, opening tag to closing tag. */
const rows = (html: string): string[] =>
  Array.from((/<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "").matchAll(/<tr[\s\S]*?<\/tr>/g), (match) => match[0]);

/** Rows marked red. */
const redRows = (html: string): string[] => rows(html).filter((row) => classesOf(row).includes("bg-fail-tint"));

const clearButtons = (html: string): string[] => tagsWith(html, "data-clear=");

/** The size's pages, as the nav names them. */
const pageButtons = (html: string): string[] => tagsWith(html, 'aria-label="Page ');

/** The element marked with calc's count issue's path, opening tag to its closing tag: the Sampling Quantity line. */
const countLine = (html: string, size = "M"): string | undefined => {
  const start = tagsWith(html, pathAttribute(["sizes", size, "cartonNumbers"]))[0];
  if (start === undefined) return undefined;
  const from = html.indexOf(start);
  return html.slice(from, html.indexOf("</p>", from) + "</p>".length);
};

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, offset) => from + offset);

describe("carton_sampling Capture", () => {
  it("shows a table of rows to fill in, 10 a page, a field on the numeric keypad in every row: the plan's 50 rows over 5 pages", () => {
    const html = render(props(STD_EG_EXAMPLE));
    const list = cartonList(STD_EG_EXAMPLE.cartons.M!);
    expect(html).toContain("<table");
    expect(html).toMatch(/<th[^>]*>No\.<\/th>/);
    expect(html).toMatch(/<th[^>]*>Carton Number<\/th>/);
    expect(html).toContain('<span class="sr-only">Clear</span>');
    // Page 1: rows 1 to 10, each holding its number, named by its No.
    const page = fields(html);
    expect(page).toHaveLength(10);
    expect(values(html)).toEqual(list.slice(0, 10).map(String));
    expect(page[0]).toContain('aria-label="M (Carton #), No. 1"');
    expect(page[0]).toContain('id="carton-sampling-M-0"');
    for (const field of page) {
      expect(field).toContain('inputMode="numeric"');
      expect(field).toContain('type="text"');
      // 44 px and 16 px text on touch, as the kit's cells.
      expect(classesOf(field)).toEqual(expect.arrayContaining(["touch:h-11", "touch:text-base"]));
    }
    expect(page[0]).toContain('enterKeyHint="next"');
    // Each field is its row's place in the stored list, where issue links land.
    expect(page[3]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 3]));
    // A clear button on each row holding a number, 44 px on touch.
    const buttons = clearButtons(html);
    expect(buttons).toHaveLength(10);
    expect(buttons[0]).toContain(`aria-label="Clear Carton ${list[0]}"`);
    expect(buttons[0]).toContain('title="Clear"');
    expect(classesOf(buttons[0])).toContain("touch:size-11");
    // The pages below: 1–10 of 50, five pages, the first one shown.
    expect(html).toContain("1–10 of 50");
    expect(pageButtons(html)).toHaveLength(5);
    expect(tagsWith(html, 'aria-current="page"')).toHaveLength(1);
    expect(html).toContain("Add 10 Rows</button>");
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ .*50/);
    // calc's count issue lands on the count's line: it takes the focus itself.
    expect(countLine(html)).toContain('tabindex="-1"');
    expect(countLine(html)).toMatch(/^<p /);
    // Nothing to explain once numbers are in.
    expect(html).not.toContain("Type each carton number in its row");
  });

  it("offers the plan's rows empty to fill in, with one line saying how; 10 rows while the plan has no cases", () => {
    const empty = render(props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: {} } })));
    expect(values(empty)).toEqual(Array.from({ length: 10 }, () => ""));
    expect(clearButtons(empty)).toEqual([]);
    expect(empty).toContain("1–10 of 50");
    expect(pageButtons(empty)).toHaveLength(5);
    expect(empty).toContain(
      "Type each carton number in its row; Enter moves to the next. Paste a list into a row to fill the rows below.",
    );
    expect(empty).toMatch(/Sampling Quantity <span[^>]*>.*0.* \/ .*50/);
    // No plan yet: 10 rows on one page, and the count stands alone.
    const noPlan = render(
      props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { sampling_plan: { sizes: {} }, carton_sampling: { sizes: {} } })),
    );
    expect(fields(noPlan)).toHaveLength(10);
    expect(noPlan).not.toContain(": pages");
    expect(fields(noPlan).at(-1)).toContain('enterKeyHint="done"');
    expect(noPlan).toMatch(/Sampling Quantity <span[^>]*>.*0.* \/ <span data-slot="figure" data-empty=""/);
  });

  it("offers at least 10 rows: past a plan of 5 cases they are shaded and said to be beyond it (SAFEDON_EG XS)", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(values(html)).toEqual([...cartonList(SAFEDON_EG_EXAMPLE.cartons.XS!).map(String), "", "", "", "", ""]);
    const table = rows(html);
    expect(table.map((row) => classesOf(row).includes("bg-slate-50"))).toEqual([false, false, false, false, false, true, true, true, true, true]);
    expect(fields(html)[5]).toContain('aria-describedby="carton-sampling-XS-beyond"');
    expect(fields(html)[4]).not.toContain("aria-describedby");
    expect(html).toContain('<span id="carton-sampling-XS-beyond" class="sr-only">Beyond the 5 cases sampled.</span>');
  });

  it("shows a list saved before in rows 1 to n, and a list saved from the grid with its blanks in their rows", () => {
    const compact = render(props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, 578, 1186] } } } })));
    expect(values(compact)).toEqual(["32", "578", "1186", "", "", "", "", "", "", ""]);
    expect(clearButtons(compact)).toHaveLength(3);
    const grid = render(
      props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, null, 578, null, null, 1186] } } } })),
    );
    expect(values(grid)).toEqual(["32", "", "578", "", "", "1186", "", "", "", ""]);
    expect(clearButtons(grid).map((tag) => attributeOf(tag, "aria-label"))).toEqual([
      "Clear Carton 32",
      "Clear Carton 578",
      "Clear Carton 1186",
    ]);
    expect(fields(grid)[5]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 5]));
    expect(grid).toMatch(/Sampling Quantity <span[^>]*>.*3.* \/ .*50/);
  });

  it("marks both rows of a carton entered twice red, with calc's message under each and a link below", () => {
    const twice = exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, 578, 32] } } } });
    const html = render(props(STD_EG_EXAMPLE, twice));
    const message = "Size M: Carton 32 is entered twice (No. 1, No. 3).";
    const red = redRows(html);
    expect(red).toHaveLength(2);
    expect(red[0]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 0]));
    expect(red[1]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 2]));
    for (const row of red) {
      expect(row).toContain('value="32"');
      expect(row).toContain(message);
    }
    // The number turns red, described by the message, and so is its clear button.
    const field = fields(html)[0];
    expect(classesOf(field)).toContain("text-fail");
    expect(field).toContain('aria-describedby="carton-sampling-M-0-message"');
    expect(field).not.toContain('aria-invalid="true"');
    expect(clearButtons(html)[0]).toContain('aria-describedby="carton-sampling-M-0-message"');
    // Listed below the table too, as a link to the row.
    expect(html).toMatch(new RegExp(`<button type="button" class="[^"]*">.*?<span>${message.replace(/[.()]/g, "\\$&")}</span></button>`));
  });

  it("marks a carton above the order quantity red, with a link to its row (6.2 rule 6)", () => {
    const data = exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, 9999, 578] } } } });
    const html = render(props(STD_EG_EXAMPLE, data));
    const red = redRows(html);
    expect(red).toHaveLength(1);
    expect(red[0]).toContain('value="9999"');
    expect(red[0]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 1]));
    expect(html).toContain("Size M: Carton 9999 is not between 1 and 2,900, the order quantity (No. 2).");
  });

  it("counts the rows filled against the plan's cases: 50 of 63, not done; a longer saved list shows every row", () => {
    const more = exampleData(STD_EG_EXAMPLE, {
      sampling_plan: { sizes: { M: { ...samplingPlanData(STD_EG_EXAMPLE).sizes.M, cases: 63 } } },
      carton_sampling: { sizes: { M: { cartonNumbers: range(1, 51) } } },
    });
    const input = props(STD_EG_EXAMPLE, more);
    expect(input.evaluation.result.perSize?.M).toEqual({ status: "not_done", summary: "50 of 63 carton numbers." });
    const html = render(input);
    expect(values(html)).toEqual(range(1, 11).map(String));
    expect(html).toContain("1–10 of 63");
    expect(pageButtons(html)).toHaveLength(7);
    expect(html).toMatch(/Sampling Quantity <span[^>]*>.*50.* \/ .*63/);

    // 63 saved against a plan of 50: all 63 rows, and the size fails on the count, its link on the count's line.
    const longer = props(
      STD_EG_EXAMPLE,
      exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: range(1, 64) } } } }),
    );
    expect(longer.evaluation.issues.map(({ code, path }) => [code, path])).toEqual([
      ["carton_count_above_cases", ["sizes", "M", "cartonNumbers"]],
    ]);
    const long = render(longer);
    expect(long).toContain("1–10 of 63");
    expect(long).toContain("Size M: 63 carton numbers, but the sampling plan has 50 cases.");
    expect(countLine(long)).toContain("Sampling Quantity");
  });

  it("shows only the ordered sizes and the table of the size on screen: SAFEDON_EG XS", () => {
    const html = render(props(SAFEDON_EG_EXAMPLE));
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["XS", "S", "M", "L"]);
    // Tabs: the first size's panel only.
    expect(html).toContain("XS (Carton #)");
    expect(fields(html)[0]).toContain('id="carton-sampling-XS-0"');
    expect(html).not.toContain('id="carton-sampling-S-0"');
  });

  it("shows each size's result at the kit's touch size: 16 px text on iPad", () => {
    for (const html of [render(props(STD_EG_EXAMPLE)), render(props(SAFEDON_EG_EXAMPLE))]) {
      const pills = tagsWith(html, 'data-slot="status-pill"');
      expect(pills.length).toBeGreaterThan(0);
      for (const pill of pills) expect(pill).toContain("touch:text-base");
    }
  });

  it("puts the template's wording in the caption and the rows' names, and fills in the size", () => {
    const labels = { ...CARTON_SAMPLING_LABELS, sizeCaption: "Carton # {size}", samplingQuantity: "Qty sampled" };
    const html = render(props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE), labels));
    expect(html).toContain("Carton # M");
    expect(fields(html)[0]).toContain('aria-label="Carton # M, No. 1"');
    expect(html).toContain('aria-label="Carton # M: pages"');
    expect(html).toContain("Qty sampled");
    expect(html).not.toContain("M (Carton #)");
  });

  it("brings back text a row refused, with its reason, after a page, size or section switch or a reload (the screen's store)", () => {
    const kept = { raw: "52.5", error: refusalMessage({ reason: "not_a_carton", raw: "52.5" }) };
    const asked: string[] = [];
    const store: RefusedEntryStore = {
      get: (path) => {
        asked.push(JSON.stringify(path));
        const key = JSON.stringify(path);
        // Row 3 is empty; row 1 holds 32, so what was refused there is no longer shown.
        return key === '["sizes","M","cartonNumbers",2]' || key === '["sizes","M","cartonNumbers",0]' ? kept : undefined;
      },
      set: noop,
    };
    const data = exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, 578] } } } });
    const html = renderToStaticMarkup(
      <RefusedEntryStoreContext.Provider value={store}>
        <Capture {...props(STD_EG_EXAMPLE, data)} />
      </RefusedEntryStoreContext.Provider>,
    );
    const row = fields(html)[2];
    expect(row).toContain('value="52.5"');
    expect(row).toContain('aria-invalid="true"');
    expect(row).toContain('aria-describedby="carton-sampling-M-2-message"');
    expect(html).toContain("“52.5” is not a carton number: whole numbers from 1 only.");
    expect(redRows(html)).toHaveLength(1);
    // Its clear button lets it go.
    expect(clearButtons(html).map((tag) => attributeOf(tag, "aria-label"))).toEqual(["Clear Carton 32", "Clear Carton 578", "Clear No. 3"]);
    // Row 1 holds a number: that wins.
    expect(fields(html)[0]).toContain('value="32"');
    expect(fields(html)[0]).not.toContain('aria-invalid="true"');
    expect(asked).toContain('["sizes","M","cartonNumbers",2]');
  });

  it("is read-only for an approved inspection: rows 1 to the last filled, 10 a page, no fields or buttons, issue links still landing", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), readOnly: true });
    const table = rows(html);
    expect(table).toHaveLength(10);
    expect(fields(html)).toEqual([]);
    expect(html).not.toContain("<input");
    expect(clearButtons(html)).toEqual([]);
    expect(html).not.toContain("Add 10 Rows");
    expect(html).not.toContain('<span class="sr-only">Clear</span>');
    expect(html).toContain("1–10 of 50");
    // The rows take an issue link's focus themselves; the count issue lands on the count's line.
    for (const row of table) expect(row).toContain('tabindex="-1"');
    expect(table[3]).toContain(pathAttribute(["sizes", "M", "cartonNumbers", 3]));
    expect(countLine(html)).toContain('tabindex="-1"');
    // An empty row of a list saved from the grid: a dash, read as No value. Rows end at the last filled.
    const grid = render({
      ...props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, null, 578] } } } })),
      readOnly: true,
    });
    expect(rows(grid)).toHaveLength(3);
    expect(rows(grid)[1]).toContain('<span aria-hidden="true">—</span><span class="sr-only">No value</span>');
    expect(grid).not.toContain(": pages");
    // Nothing entered: said so, no table.
    const empty = render({
      ...props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: {} } })),
      readOnly: true,
    });
    expect(empty).toContain("No carton numbers entered.");
    expect(empty).not.toContain("<table");
    expect(empty).not.toContain("Type each carton number");
  });

  it("counts rows to the last one filled: empty rows saved at the end of a list are not rows", () => {
    // Read-only: rows 1 to 3, not 5, and no pages.
    const readOnly = render({
      ...props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [32, null, 578, null, null] } } } })),
      readOnly: true,
    });
    expect(rows(readOnly)).toHaveLength(3);
    expect(readOnly).not.toContain(": pages");
    // To fill in: the plan's 50 rows, not the 62 places saved.
    const html = render(
      props(STD_EG_EXAMPLE, exampleData(STD_EG_EXAMPLE, { carton_sampling: { sizes: { M: { cartonNumbers: [...range(1, 13), ...Array<null>(50).fill(null)] } } } })),
    );
    expect(html).toContain("1–10 of 50");
    expect(pageButtons(html)).toHaveLength(5);
  });

  it("says so while no size is ordered", () => {
    const html = render({ ...props(STD_EG_EXAMPLE), context: makeTestContext(), evaluation: null });
    expect(html).toContain("No sizes ordered yet");
  });
});

describe("carton_sampling Capture writes (useDataUpdater, docs/CAPTURE_KIT.md)", () => {
  /**
   * The capture screen under the kit's updater: onChange replaces the data,
   * and every handler is the one made at the last render, as the table's
   * row writes, clear and paste are.
   */
  function screen(start: CartonSamplingData = emptyCartonSampling()) {
    let data = start;
    const changes: CartonSamplingData[] = [];
    const updater = createDataUpdater(data, (next) => {
      changes.push(next);
      data = next;
    });
    // As the table's write: update runs the change at once, so the refusal is known on return.
    const write = (size: string, index: number, carton: number | null): CartonRefusal | null => {
      const outcome: { refusal: CartonRefusal | null } = { refusal: null };
      updater.update((current) => {
        const change = setCartonRow(current, size, index, carton);
        outcome.refusal = change.refusal;
        return change.data;
      });
      return outcome.refusal;
    };
    const paste = (size: string, index: number, entries: readonly string[]): PastedCartons | undefined => {
      const outcome: { pasted?: PastedCartons } = {};
      updater.update((current) => {
        outcome.pasted = pasteCartons(current, size, index, entries);
        return outcome.pasted.data;
      });
      return outcome.pasted;
    };
    const clear = (size: string, index: number) => updater.update((current) => clearCartonRow(current, size, index));
    return { write, paste, clear, changes, data: () => data };
  }

  /** What Enter does with the text typed in a row. */
  const typed = (text: string): number | null => {
    const entry = readTypedCarton(text);
    if (entry.kind === "refused") throw new Error(`“${text}” is refused`);
    return entry.kind === "carton" ? entry.carton : null;
  };

  it("keeps both of two rows typed in one event, before the screen renders again", () => {
    const { write, changes, data } = screen();
    write("M", 0, typed("32"));
    write("M", 1, typed("578"));
    expect(changes).toHaveLength(2);
    expect(data().sizes.M.cartonNumbers).toEqual([32, 578]);
  });

  it("refuses a number another row holds, saving nothing, and stores it in another size", () => {
    const { write, changes, data } = screen({ sizes: { M: { cartonNumbers: [32, 525] } } });
    expect(write("M", 4, typed("525"))).toEqual({ reason: "listed", raw: "525", carton: 525, index: 1 });
    expect(changes).toEqual([]);
    expect(write("S", 0, typed("525"))).toBeNull();
    expect(data().sizes).toEqual({ M: { cartonNumbers: [32, 525] }, S: { cartonNumbers: [525] } });
  });

  it("hands a pasted list to onChange once, leaving out what another row holds or is no carton number", () => {
    const { paste, changes, data } = screen({ sizes: { XS: { cartonNumbers: [7] }, M: { cartonNumbers: [32] } } });
    const pasted = pastedCartons("578\n1186, 32; abc 2389\t578");
    if (!pasted) throw new Error("Not read as a list");
    const outcome = paste("M", 1, pasted);
    expect(changes).toHaveLength(1);
    expect(outcome?.placed.map(({ index, carton }) => [index, carton])).toEqual([
      [1, 578],
      [2, 1186],
      [3, 2389],
    ]);
    expect(outcome?.refused.map(({ reason, raw }) => [reason, raw])).toEqual([
      ["listed", "32"],
      ["not_a_carton", "abc"],
      ["listed", "578"],
    ]);
    expect(data().sizes.M.cartonNumbers).toEqual([32, 578, 1186, 2389]);
    expect(data().sizes.XS.cartonNumbers).toEqual([7]);
  });

  it("stores a pasted list longer than the cases sampled, and the size fails on the count, its link on the count's line (6.2 rule 6)", () => {
    // SAFEDON_EG XS: 5 cases sampled, no carton numbers yet.
    const { paste, changes, data } = screen();
    const pasted = [1, 12, 18, 25, 33, 41, 47, 52];
    paste("XS", 0, pastedCartons(pasted.join("\n")) ?? []);
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
    expect(values(html)).toEqual([...pasted.map(String), "", ""]);
    expect(countLine(html, "XS")).toContain("Sampling Quantity");
  });

  it("clears a row, the rows below keeping their place; a list saved from the grid keeps its blanks", () => {
    const { clear, write, changes, data } = screen({ sizes: { M: { cartonNumbers: [32, null, 578, null, 1186] } } });
    clear("M", 2);
    expect(data().sizes.M.cartonNumbers).toEqual([32, null, null, null, 1186]);
    // Cleared twice from a screen not yet rendered again: once only.
    clear("M", 2);
    expect(changes).toHaveLength(1);
    // Typed into the emptied row: back in its place, nothing moved.
    write("M", 2, typed("578"));
    expect(data().sizes.M.cartonNumbers).toEqual([32, null, 578, null, 1186]);
    // The text cleared and Enter: the row is emptied, the empty rows at the end go.
    write("M", 4, typed(""));
    expect(data().sizes.M.cartonNumbers).toEqual([32, null, 578]);
  });
});
