import { describe, expect, it } from "vitest";
import { readingsBeyond, withGridColumn, withLabReport, withoutReadingsBeyond, withReadings } from "./edit";
import { emptyForceAtBreak, ForceAtBreakDataSchema, type ForceAtBreakData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";

const SAVED: ForceAtBreakData = {
  sizes: { M: { values: [6.47, 6.884, 6.301] }, XL: { values: [6.9] } },
  labReport: null,
};

describe("force_at_break edits", () => {
  it("replaces one size's readings, dropping blanks at the end and keeping every other size", () => {
    const next = withReadings(SAVED, "M", [6.5, null, 6.6, null, null]);
    expect(next).toEqual({ sizes: { M: { values: [6.5, null, 6.6] }, XL: { values: [6.9] } }, labReport: null });
    expect(withReadings(emptyForceAtBreak(), "S", [null, null])).toEqual({ sizes: { S: { values: [] } }, labReport: null });
    expect(SAVED.sizes.M.values).toEqual([6.47, 6.884, 6.301]);
  });

  it("writes the grid's column over the readings, keeping any reading past the grid", () => {
    const saved = withReadings(SAVED, "M", [6.1, 6.2, 6.3, 6.4, 6.5]);
    expect(withGridColumn(saved, "M", [7.1, 7.2, null], 3).sizes.M.values).toEqual([7.1, 7.2, null, 6.4, 6.5]);
    // A column shorter than the grid leaves the rest blank.
    expect(withGridColumn(SAVED, "M", [6.0], 3).sizes.M.values).toEqual([6.0]);
    expect(withGridColumn(SAVED, "S", [6.4, 6.5], 13).sizes.S.values).toEqual([6.4, 6.5]);
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
      withGridColumn(SAVED, "L", [6.5], 13),
      withoutReadingsBeyond(SAVED, "M", 1),
      withLabReport(SAVED, LAB_REPORT_ID),
    ]) {
      expect(ForceAtBreakDataSchema.parse(next)).toEqual(next);
    }
  });
});
