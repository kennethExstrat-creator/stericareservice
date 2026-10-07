import { describe, expect, it } from "vitest";
import { summarizeColumn } from "./column";

const lengths = [243, 245, 242, 244, 246, 243, 241, 244, 245, 243, 242, 244, 243];

describe("summarizeColumn", () => {
  it("is Not Done with no statistic before any value is entered", () => {
    expect(summarizeColumn([], 13, "median", { kind: "min", min: 240 }, 0)).toEqual({
      count: 0,
      statistic: null,
      complete: false,
      outcome: "not_done",
    });
  });

  it("shows a running statistic but no verdict while the column is incomplete", () => {
    const partial = [243, 245, null, 244];
    const summary = summarizeColumn(partial, 13, "median", { kind: "min", min: 240 }, 0);
    expect(summary.count).toBe(3);
    expect(summary.statistic).toBe(244);
    expect(summary.outcome).toBe("not_done");
  });

  it("passes and fails a complete column against its spec", () => {
    expect(summarizeColumn(lengths, 13, "median", { kind: "min", min: 240 }, 0).outcome).toBe("pass");
    expect(summarizeColumn(lengths, 13, "median", { kind: "min", min: 250 }, 0).outcome).toBe("fail");
  });

  it("uses the template's statistic", () => {
    const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 14];
    expect(summarizeColumn(values, 13, "median", undefined, 0).statistic).toBe(1);
    expect(summarizeColumn(values, 13, "average", undefined, 0).statistic).toBe(2);
  });

  it("judges the value as displayed", () => {
    // Average 0.0496 shows as 0.05 at two decimals, so it meets ≥ 0.05.
    const values = [0.0496, 0.0496];
    const summary = summarizeColumn(values, 2, "average", { kind: "min", min: 0.05 }, 2);
    expect(summary.outcome).toBe("pass");
  });

  it("has no verdict without a spec", () => {
    expect(summarizeColumn(lengths, 13, "median", undefined, 0).outcome).toBe("na");
    expect(summarizeColumn(lengths, 13, "median", { kind: "na" }, 0).outcome).toBe("na");
  });

  it("ignores values beyond the configured rows", () => {
    const summary = summarizeColumn([1, 2, 3, 100], 3, "average", undefined, undefined);
    expect(summary.statistic).toBe(2);
    expect(summary.complete).toBe(true);
  });
});
