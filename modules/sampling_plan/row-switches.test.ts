import { describe, expect, it } from "vitest";
import { emptySamplingPlan, rowsOff, SamplingPlanDataSchema, withRowOff } from "./schema";

describe("the sampling plan's test-row switches (Kenneth, 26 October 2026)", () => {
  it("reads data saved before the switches as every row on", () => {
    const old = SamplingPlanDataSchema.parse({ sizes: { M: { cases: 50 } } });
    expect(rowsOff(old).size).toBe(0);
    expect(rowsOff(emptySamplingPlan()).size).toBe(0);
  });

  it("switches a row off and on again, in the rows' order, the same data when nothing changes", () => {
    const empty = emptySamplingPlan();
    const dispensing = withRowOff(empty, "innerUnitsDispensing", true);
    const both = withRowOff(dispensing, "glovesWatertightVisual", true);
    expect(both.rowsOff).toEqual(["glovesWatertightVisual", "innerUnitsDispensing"]);
    expect(withRowOff(both, "innerUnitsDispensing", true)).toBe(both);
    expect(withRowOff(both, "glovesWatertightVisual", false).rowsOff).toEqual(["innerUnitsDispensing"]);
    expect(withRowOff(empty, "innerUnitsDispensing", false)).toBe(empty);
  });

  it("takes only the test rows: never the cases, inner units or gloves", () => {
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, rowsOff: ["glovesDimensions"] }).success).toBe(true);
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, rowsOff: ["cases"] }).success).toBe(false);
  });

  it("still loads the weight row switched off, saved before the row went (Kenneth, 26 October 2026), and keeps it", () => {
    const saved = SamplingPlanDataSchema.parse({ sizes: {}, rowsOff: ["glovesWeight"] });
    expect(withRowOff(saved, "glovesDimensions", true).rowsOff).toEqual(["glovesDimensions", "glovesWeight"]);
  });
});
