import { describe, expect, it } from "vitest";
import { describePlan, formatAql, formatCount } from "./format";
import { planFromSampleSize } from "./plan";
import type { Aql } from "./schema";
import { TABLE_2A_AQLS } from "./tables";

function plan(sampleSize: number, aql: Aql) {
  const result = planFromSampleSize({ sampleSize, aql });
  if (!result.ok) throw new Error(result.error.message);
  return result.plan;
}

describe("formatAql", () => {
  it("prints every Table 2-A AQL as the standard does", () => {
    expect(TABLE_2A_AQLS.map(formatAql)).toEqual([
      "0.010", "0.015", "0.025", "0.040", "0.065", "0.10", "0.15", "0.25", "0.40", "0.65", "1.0", "1.5", "2.5",
      "4.0", "6.5", "10", "15", "25", "40", "65", "100", "150", "250", "400", "650", "1000",
    ]);
  });

  it("prints the critical AQL as 0", () => {
    expect(formatAql(0)).toBe("0");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(80)).toBe("80");
    expect(formatCount(1_250)).toBe("1,250");
    expect(formatCount(5_800_000)).toBe("5,800,000");
  });
});

describe("describePlan", () => {
  it("states the plan in the cell", () => {
    expect(describePlan(plan(80, 1.5))).toBe("Code letter J (n 80), AQL 1.5: Accept 3, Reject 4.");
  });

  it("names the arrow followed and the plan it led to", () => {
    expect(describePlan(plan(500, 4.0))).toBe(
      "Code letter N (n 500), AQL 4.0: arrow up to code letter M (n 315), Accept 21, Reject 22.",
    );
    expect(describePlan(plan(8, 4.0))).toBe(
      "Code letter D (n 8), AQL 4.0: arrow down to code letter E (n 13), Accept 1, Reject 2.",
    );
  });

  it("states the critical plan", () => {
    expect(describePlan(plan(500, 0))).toBe("Code letter N (n 500), AQL 0: Accept 0, Reject 1.");
  });
});
