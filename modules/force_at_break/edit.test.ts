import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { calcForceAtBreak } from "./calc";
import { FORCE_AT_BREAK_DEFAULT_CONFIG, FORCE_AT_BREAK_LABELS, FORCE_AT_BREAK_TITLE } from "./config";
import {
  pastedPastGrid,
  readingsBeyond,
  withLabReport,
  withoutReadingsBeyond,
  withReadingChanges,
  withReadings,
  withReadingsFrom,
} from "./edit";
import { emptyForceAtBreak, ForceAtBreakDataSchema, type ForceAtBreakData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";

const SAVED: ForceAtBreakData = {
  sizes: { M: { values: [6.47, 6.884, 6.301] }, XL: { values: [6.9] } },
  labReport: null,
};

/** MeasurementGrid's onCellsChange: the cells a change touched, row by row. */
function cells(changes: Record<number, number | null>) {
  return Object.entries(changes).map(([row, value]) => ({ row: Number(row), value }));
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
    expect(withReadingChanges(saved, "M", cells({ 0: 7.1, 2: null })).sizes.M.values).toEqual([7.1, 6.2, null, 6.4, 6.5]);
    // A size with nothing saved yet; cells past the last reading are padded with blanks.
    expect(withReadingChanges(SAVED, "S", cells({ 2: 6.4 })).sizes.S.values).toEqual([null, null, 6.4]);
    // A cleared last cell drops the blank end.
    expect(withReadingChanges(SAVED, "M", cells({ 2: null })).sizes.M.values).toEqual([6.47, 6.884]);
    // Nothing changed: the same data back, so no change is saved.
    expect(withReadingChanges(SAVED, "M", cells({ 1: 6.884 }))).toBe(SAVED);
    expect(withReadingChanges(SAVED, "M", [])).toBe(SAVED);
  });

  it("keeps two grid edits made before the screen renders again, through the kit's updater (docs/CAPTURE_KIT.md)", () => {
    const changes: ForceAtBreakData[] = [];
    const updater = createDataUpdater(SAVED, (next) => changes.push(next));
    updater.update((current) => withReadingChanges(current, "M", cells({ 3: 6.537 })));
    updater.update((current) => withReadingChanges(current, "M", cells({ 4: 6.65 })));
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
      updater.update((current) => withReadingChanges(current, "M", pasted.map((value, row) => ({ row, value }))));
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].sizes.M.values).toEqual(pasted);
  });

  describe("a pasted column longer than the grid", () => {
    const LAB = [6.47, 6.884, 6.301, 6.537, 6.65, 6.214, 6.79];

    it("finds the values that run past the grid's last row, from the row pasted into", () => {
      const text = LAB.join("\n");
      expect(pastedPastGrid(text, 0, 5)).toEqual([6.214, 6.79]);
      expect(pastedPastGrid(text, 3, 5)).toEqual([6.301, 6.537, 6.65, 6.214, 6.79]);
      expect(pastedPastGrid(text, 0, 13)).toEqual([]);
      expect(pastedPastGrid(text, 6, 13)).toEqual([]);
      // Windows line ends and a last newline, as a spreadsheet copies a column.
      expect(pastedPastGrid("6.1\r\n6.2\r\n6.3\r\n", 0, 2)).toEqual([6.3]);
      expect(pastedPastGrid("6.1\r\n6.2\r\n6.3\r\n", 1, 2)).toEqual([6.2, 6.3]);
      // One value, or one row across columns, never runs past the last row.
      expect(pastedPastGrid("6.1", 4, 5)).toEqual([]);
      expect(pastedPastGrid("6.1\t6.2\t6.3", 4, 5)).toEqual([]);
      // A block's first column, as the grid takes it. Text is never stored;
      // 0 is kept, for calc to report.
      expect(pastedPastGrid("6.1\t1\n6.2\t2\nn/a\t3\n0\t4\n\t5", 0, 1)).toEqual([6.2, null, 0, null]);
    });

    it("writes them past the grid over the latest readings; the same data back when nothing changes", () => {
      const saved = withReadings(SAVED, "M", [6.1, 6.2]);
      const next = withReadingsFrom(saved, "M", 5, [6.6, null, 6.8]);
      expect(next.sizes).toEqual({ M: { values: [6.1, 6.2, null, null, null, 6.6, null, 6.8] }, XL: { values: [6.9] } });
      expect(withReadingsFrom(saved, "M", 5, [])).toBe(saved);
      expect(withReadingsFrom(saved, "M", 5, [null, null])).toBe(saved);
      expect(withReadingsFrom(saved, "M", 1, [6.2])).toBe(saved);
      expect(ForceAtBreakDataSchema.parse(next)).toEqual(next);
    });

    it("saves the lab's 7 readings pasted into a plan of 5 in one change, and calc reports the 2 past it", () => {
      const changes: ForceAtBreakData[] = [];
      const updater = createDataUpdater(emptyForceAtBreak(), (next) => changes.push(next));
      // What the capture body does with the grid's change: the grid's 5 rows, then the rest of the paste.
      const past = pastedPastGrid(LAB.join("\n"), 0, 5);
      const grid = LAB.slice(0, 5).map((value, row) => ({ row, value }));
      updater.update((current) => withReadingsFrom(withReadingChanges(current, "M", grid), "M", 5, past));
      expect(changes).toHaveLength(1);
      expect(changes[0].sizes.M.values).toEqual(LAB);

      const output = calcForceAtBreak({
        data: changes[0],
        config: FORCE_AT_BREAK_DEFAULT_CONFIG,
        title: FORCE_AT_BREAK_TITLE,
        labels: FORCE_AT_BREAK_LABELS,
        context: makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ physical: 5 }) } }),
        results: {},
        hasData: true,
      });
      expect(output.issues).toEqual([
        expect.objectContaining({
          code: "force_readings_beyond_plan",
          message: "Size M: 2 readings are entered beyond the 5 gloves tested. Clear them or correct the sampling plan.",
          path: ["sizes", "M", "values", 5],
        }),
      ]);
    });
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
      withReadingChanges(SAVED, "L", cells({ 4: 6.5 })),
      withoutReadingsBeyond(SAVED, "M", 1),
      withLabReport(SAVED, LAB_REPORT_ID),
    ]) {
      expect(ForceAtBreakDataSchema.parse(next)).toEqual(next);
    }
  });
});
