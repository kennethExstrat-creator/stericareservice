import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { readingsBeyond, withGridEdits, withLabReport, withoutReadingsBeyond, withReadings } from "./edit";
import { emptyForceAtBreak, ForceAtBreakDataSchema, type ForceAtBreakData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";

const SAVED: ForceAtBreakData = {
  sizes: { M: { values: [6.47, 6.884, 6.301] }, XL: { values: [6.9] } },
  labReport: null,
};

/** MeasurementGrid's onValuesChange: its whole column of `rows` cells, built from the readings it rendered. */
function gridColumn(rendered: readonly (number | null)[], rows: number, cells: Record<number, number | null>) {
  return Array.from({ length: rows }, (_, row) => (row in cells ? cells[row] : (rendered[row] ?? null)));
}

describe("force_at_break edits", () => {
  it("replaces one size's readings, dropping blanks at the end and keeping every other size", () => {
    const next = withReadings(SAVED, "M", [6.5, null, 6.6, null, null]);
    expect(next).toEqual({ sizes: { M: { values: [6.5, null, 6.6] }, XL: { values: [6.9] } }, labReport: null });
    expect(withReadings(emptyForceAtBreak(), "S", [null, null])).toEqual({ sizes: { S: { values: [] } }, labReport: null });
    expect(SAVED.sizes.M.values).toEqual([6.47, 6.884, 6.301]);
  });

  it("writes the cells the grid changed over the readings, keeping any reading past the grid", () => {
    const saved = withReadings(SAVED, "M", [6.1, 6.2, 6.3, 6.4, 6.5]);
    const shown = saved.sizes.M.values;
    expect(withGridEdits(saved, "M", shown, gridColumn(shown, 3, { 0: 7.1, 2: null }), 3).sizes.M.values).toEqual([
      7.1, 6.2, null, 6.4, 6.5,
    ]);
    // A size with nothing saved yet; cells past the last reading are padded with blanks.
    expect(withGridEdits(SAVED, "S", [], gridColumn([], 13, { 2: 6.4 }), 13).sizes.S.values).toEqual([null, null, 6.4]);
    // A cleared last cell drops the blank end.
    expect(withGridEdits(SAVED, "M", SAVED.sizes.M.values, gridColumn(SAVED.sizes.M.values, 3, { 2: null }), 3).sizes.M.values).toEqual([
      6.47, 6.884,
    ]);
    // Nothing changed: the same data back, so no change is saved.
    expect(withGridEdits(SAVED, "M", SAVED.sizes.M.values, gridColumn(SAVED.sizes.M.values, 3, {}), 3)).toBe(SAVED);
  });

  it("keeps two grid edits made before the screen renders again, through the kit's updater (docs/CAPTURE_KIT.md)", () => {
    const changes: ForceAtBreakData[] = [];
    const updater = createDataUpdater(SAVED, (next) => changes.push(next));
    // Both columns come from the render that showed SAVED: each cell's edit starts from the latest data.
    const shown = SAVED.sizes.M.values;
    updater.update((current) => withGridEdits(current, "M", shown, gridColumn(shown, 13, { 3: 6.537 }), 13));
    updater.update((current) => withGridEdits(current, "M", shown, gridColumn(shown, 13, { 4: 6.65 }), 13));
    expect(changes.at(-1)?.sizes.M.values).toEqual([6.47, 6.884, 6.301, 6.537, 6.65]);
    // A clear in the same event starts from those edits too.
    updater.update((current) => withoutReadingsBeyond(current, "M", 4));
    expect(changes.at(-1)?.sizes).toEqual({ M: { values: [6.47, 6.884, 6.301, 6.537] }, XL: { values: [6.9] } });
  });

  it("hands a pasted column to the screen in one change", () => {
    const changes: ForceAtBreakData[] = [];
    const updater = createDataUpdater(emptyForceAtBreak(), (next) => changes.push(next));
    const pasted = [6.47, 6.884, 6.301, 6.537, 6.65, 6.214, 6.79, 6.512, 6.611, 6.42, 6.702, 6.388, 6.58];
    batchDataChanges(() => {
      updater.update((current) => withGridEdits(current, "M", [], pasted, 13));
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].sizes.M.values).toEqual(pasted);
  });

  it("finds and clears the readings past the gloves tested", () => {
    const values = [6.1, 6.2, null, 6.4, null, 6.6];
    expect(readingsBeyond(values, 3)).toEqual([
      { index: 3, value: 6.4 },
      { index: 5, value: 6.6 },
    ]);
    expect(readingsBeyond(values, 6)).toEqual([]);
    const saved = withReadings(SAVED, "M", values);
    expect(withoutReadingsBeyond(saved, "M", 3).sizes.M.values).toEqual([6.1, 6.2]);
    expect(withoutReadingsBeyond(saved, "M", 3).sizes.XL).toEqual({ values: [6.9] });
    // Nothing past the gloves tested: nothing to save.
    expect(withoutReadingsBeyond(SAVED, "M", 13)).toBe(SAVED);
  });

  it("attaches and detaches the lab report by its file id", () => {
    const attached = withLabReport(SAVED, LAB_REPORT_ID);
    expect(attached.labReport).toBe(LAB_REPORT_ID);
    expect(attached.sizes).toBe(SAVED.sizes);
    expect(withLabReport(attached, null).labReport).toBeNull();
  });

  it("always gives data the schema accepts", () => {
    for (const next of [
      withReadings(SAVED, "M", [6.5, null]),
      withGridEdits(SAVED, "L", [], gridColumn([], 13, { 4: 6.5 }), 13),
      withoutReadingsBeyond(SAVED, "M", 1),
      withLabReport(SAVED, LAB_REPORT_ID),
    ]) {
      expect(ForceAtBreakDataSchema.parse(next)).toEqual(next);
    }
  });
});
