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
    const weight = withRowOff(empty, "glovesWeight", true);
    const both = withRowOff(weight, "glovesWatertightVisual", true);
    expect(both.rowsOff).toEqual(["glovesWatertightVisual", "glovesWeight"]);
    expect(withRowOff(both, "glovesWeight", true)).toBe(both);
    expect(withRowOff(both, "glovesWatertightVisual", false).rowsOff).toEqual(["glovesWeight"]);
    expect(withRowOff(empty, "glovesWeight", false)).toBe(empty);
  });

  it("takes only the test rows: never the cases, inner units or gloves", () => {
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, rowsOff: ["glovesWeight"] }).success).toBe(true);
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, rowsOff: ["cases"] }).success).toBe(false);
  });
});
