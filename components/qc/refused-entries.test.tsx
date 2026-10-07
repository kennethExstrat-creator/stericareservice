// Refused entries kept outside the field (refused-entries.ts): a grid or a
// field that comes back (another size, another section, a reload) shows what
// it refused, red, with its reason and its link, from the screen's store;
// and a value set since supersedes it. Server-rendered markup: what a field
// shows when it mounts. Where the entries go when a field refuses or lets go
// is exercised in a browser by e2e/capture.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { cellFocusProps } from "./counter-table";
import { issuePathKey, type IssuePath } from "./issue-path";
import { MeasurementGrid } from "./measurement-grid";
import { NumberField } from "./number-field";
import type { InvalidEntry } from "./numeric-entry";
import { RefusedEntryStoreContext, sameInvalidEntry, type RefusedEntryStore } from "./refused-entries";
import { SizeTabs } from "./size-tabs";

const noop = () => {};
const REFUSED: InvalidEntry = { raw: "2 42", error: "One number per cell, e.g. 2.42." };

function storeOf(entries: Readonly<Record<string, InvalidEntry>>): RefusedEntryStore {
  const kept = new Map(Object.entries(entries));
  return { get: (path: IssuePath) => kept.get(issuePathKey(path)), set: vi.fn() };
}

const measures = [
  { key: "length", label: "Length", decimals: 0 },
  { key: "width", label: "Width", decimals: 0 },
];

function grid(store: RefusedEntryStore | null, values: Record<string, (number | null)[]> = {}, withPaths = true) {
  return renderToStaticMarkup(
    <RefusedEntryStoreContext.Provider value={store}>
      <MeasurementGrid
        caption="Dimension - Size S"
        measures={measures}
        rows={4}
        values={values}
        onCellsChange={noop}
        statistic="median"
        cellIssuePath={withPaths ? ({ row, measure }) => ["sizes", "S", "gloves", row, measure] : undefined}
      />
    </RefusedEntryStoreContext.Provider>,
  );
}

/** The opening tag of the input named `name`. */
const inputNamed = (html: string, name: string) =>
  new RegExp(`<input[^>]*aria-label="${name}"[^>]*>`).exec(html)?.[0] ?? "";

describe("MeasurementGrid with the screen's refused entries", () => {
  const store = storeOf({ [issuePathKey(["sizes", "S", "gloves", 2, "length"])]: REFUSED });

  it("shows a kept entry as it was refused: the text, red, with its reason and a link back to the cell", () => {
    const html = grid(store);
    const cell = inputNamed(html, "Length, No. 3");
    expect(cell).toContain('value="2 42"');
    expect(cell).toContain('aria-invalid="true"');
    expect(cell).toMatch(/aria-describedby="[^"]+-error-length-2"/);
    expect(html).toContain("No. 3, Length");
    expect(html).toContain("“2 42” is not stored. One number per cell, e.g. 2.42.");
    // The other cells are untouched.
    expect(inputNamed(html, "Length, No. 2")).not.toContain('aria-invalid="true"');
  });

  it("lets a value set since supersede the entry", () => {
    const html = grid(store, { length: [null, null, 242, null] });
    expect(inputNamed(html, "Length, No. 3")).toContain('value="242"');
    expect(inputNamed(html, "Length, No. 3")).not.toContain('aria-invalid="true"');
    expect(html).not.toContain("is not stored");
  });

  it("keeps its own entries without a store or without cell paths: a fresh grid has none", () => {
    expect(grid(null)).not.toContain("is not stored");
    expect(grid(store, {}, false)).not.toContain("is not stored");
  });

  it("brings the entry back with its size's grid when SizeTabs shows that size again", () => {
    const tabs = (size: string) =>
      renderToStaticMarkup(
        <RefusedEntryStoreContext.Provider value={store}>
          <SizeTabs sizes={["S", "M"]} value={size} onValueChange={noop}>
            {(shown) => (
              <MeasurementGrid
                caption={`Dimension - Size ${shown}`}
                measures={measures}
                rows={4}
                values={{}}
                onCellsChange={noop}
                statistic="median"
                cellIssuePath={({ row, measure }) => ["sizes", shown, "gloves", row, measure]}
              />
            )}
          </SizeTabs>
        </RefusedEntryStoreContext.Provider>,
      );
    expect(tabs("M")).not.toContain("is not stored");
    expect(inputNamed(tabs("S"), "Length, No. 3")).toContain('value="2 42"');
  });
});

describe("NumberField with the screen's refused entries", () => {
  const path = ["sizes", "M", "values", 0];
  const store = storeOf({ [issuePathKey(path)]: { raw: "3,2,1", error: "Numbers only." } });
  const field = (value: number | null, issuePath?: IssuePath) =>
    renderToStaticMarkup(
      <RefusedEntryStoreContext.Provider value={store}>
        <NumberField id="w" label="Weight, size M" unit="g" value={value} onValueChange={noop} issuePath={issuePath} />
      </RefusedEntryStoreContext.Provider>,
    );

  it("shows the entry kept for its issue path, with its reason", () => {
    const html = field(null, path);
    expect(html).toContain('value="3,2,1"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("“3,2,1” is not stored. Numbers only.");
  });

  it("shows the stored value once one is set, and nothing without a path", () => {
    expect(field(3.2, path)).not.toContain("is not stored");
    expect(field(3.2, path)).toContain('value="3.2"');
    expect(field(null)).not.toContain("is not stored");
  });
});

describe("helpers", () => {
  it("tells entries apart by their text and reason", () => {
    expect(sameInvalidEntry(null, undefined)).toBe(true);
    expect(sameInvalidEntry(REFUSED, { ...REFUSED })).toBe(true);
    expect(sameInvalidEntry(REFUSED, { ...REFUSED, raw: "2,42," })).toBe(false);
    expect(sameInvalidEntry(REFUSED, null)).toBe(false);
  });

  it("reports a count's cell when it is pressed, not only when it takes the focus (WebKit never focuses a tapped button)", () => {
    const onCellFocus = vi.fn();
    const cell = { row: "thin_spot", column: "M", hand: "R" as const };
    const props = cellFocusProps(onCellFocus, cell);
    props.onClick?.();
    props.onFocus?.();
    expect(onCellFocus.mock.calls).toEqual([[cell], [cell]]);
    expect(cellFocusProps(undefined, cell)).toEqual({});
  });
});
