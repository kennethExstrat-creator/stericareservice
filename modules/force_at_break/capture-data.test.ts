import { describe, expect, it } from "vitest";
import { readingSummary } from "./capture-data";

describe("force_at_break grid footer", () => {
  it("shows calc's median, verdict and count, never the grid's own sums", () => {
    expect(readingSummary({ n: 13, entered: 13, median: 6.537, result: "pass" })).toEqual({
      statistic: 6.537,
      outcome: "pass",
      count: 13,
    });
    // A size calc says is not done (a reading of 0 N saved another way): no median, no verdict.
    expect(readingSummary({ n: 13, entered: 12, median: null, result: "not_done" })).toEqual({
      statistic: null,
      outcome: "not_done",
      count: 12,
    });
    // Before the first evaluation the grid summarises its cells itself.
    expect(readingSummary(undefined)).toBeUndefined();
  });
});
