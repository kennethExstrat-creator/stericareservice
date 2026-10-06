import { describe, expect, it } from "vitest";
import type { ModuleResult } from "@/lib/schemas/module-result";
import {
  combinePerSize,
  enforceResultRules,
  NO_DATA_SUMMARY,
  NO_SIZES_SUMMARY,
  notDone,
  perSizeResults,
  resultFromSizes,
  worstStatus,
} from "./results";

describe("worstStatus", () => {
  it("ranks fail over not done over warn over pass over info", () => {
    expect(worstStatus(["pass", "info"])).toBe("pass");
    expect(worstStatus(["pass", "warn", "info"])).toBe("warn");
    expect(worstStatus(["warn", "not_done", "pass"])).toBe("not_done");
    expect(worstStatus(["not_done", "fail"])).toBe("fail");
  });

  it("is not done for nothing: never a pass on no data", () => {
    expect(worstStatus([])).toBe("not_done");
    expect(worstStatus([], "info")).toBe("info");
  });
});

describe("per-size helpers", () => {
  it("build results in size order and combine them", () => {
    const perSize = perSizeResults(["S", "M"], (size) => (size === "M" ? { status: "warn", summary: "17% below" } : { status: "pass" }));
    expect(Object.keys(perSize)).toEqual(["S", "M"]);
    expect(combinePerSize(perSize)).toBe("warn");
    expect(combinePerSize({})).toBe("not_done");
    expect(notDone()).toEqual({ status: "not_done", summary: "Not done." });
  });

  it("make a per-size module's result that keeps its sizes", () => {
    const perSize = { S: { status: "pass" as const }, M: { status: "fail" as const, summary: "Hole" } };
    expect(resultFromSizes(perSize, "Size M failed.")).toEqual({ status: "fail", summary: "Size M failed.", perSize });
  });
});

describe("enforceResultRules (BUILD_SPEC 6.2 rules 4 and 5)", () => {
  const pass: ModuleResult = { status: "pass", summary: "All good." };

  it("makes a module without data not done, whatever calc said", () => {
    expect(enforceResultRules(pass, { perSize: false, sizes: ["M"], hasData: false })).toEqual({
      status: "not_done",
      summary: NO_DATA_SUMMARY,
    });
    expect(enforceResultRules(notDone("Missing: Glove colour."), { perSize: false, sizes: [], hasData: false })).toEqual({
      status: "not_done",
      summary: "Missing: Glove colour.",
    });
    expect(enforceResultRules(pass, { perSize: true, sizes: ["S", "M"], hasData: false })).toEqual({
      status: "not_done",
      summary: NO_DATA_SUMMARY,
      perSize: { S: { status: "not_done" }, M: { status: "not_done" } },
    });
  });

  it("keeps a per-size module not done until a size is ordered", () => {
    expect(enforceResultRules(pass, { perSize: true, sizes: [], hasData: true })).toEqual({
      status: "not_done",
      summary: NO_SIZES_SUMMARY,
      perSize: {},
    });
  });

  it("shows ordered sizes only and fills in the ones calc left out as not done", () => {
    const result: ModuleResult = {
      status: "pass",
      summary: "Passed.",
      perSize: { M: { status: "pass" }, XL: { status: "pass" }, s: { status: "pass" } },
    };
    expect(enforceResultRules(result, { perSize: true, sizes: ["S", "M", "L"], hasData: true })).toEqual({
      status: "not_done",
      summary: "Not done for size L.",
      perSize: { S: { status: "pass" }, M: { status: "pass" }, L: { status: "not_done", summary: "No result." } },
    });
  });

  it("never reports a module better than its worst size", () => {
    const result: ModuleResult = { status: "pass", summary: "", perSize: { M: { status: "fail" }, L: { status: "pass" } } };
    expect(enforceResultRules(result, { perSize: true, sizes: ["M", "L"], hasData: true })).toMatchObject({
      status: "fail",
      summary: "Failed for size M.",
    });
  });

  it("leaves a consistent result alone", () => {
    const result: ModuleResult = { status: "warn", summary: "Size M 17% below.", perSize: { M: { status: "warn" } } };
    expect(enforceResultRules(result, { perSize: true, sizes: ["M"], hasData: true })).toEqual(result);
    const info: ModuleResult = { status: "info", summary: "Recorded." };
    expect(enforceResultRules(info, { perSize: false, sizes: ["M"], hasData: true })).toBe(info);
  });

  it("drops unordered sizes from a module that is not per size, without inventing others", () => {
    const result: ModuleResult = { status: "info", summary: "Order.", perSize: { M: { status: "info" }, XL: { status: "info" } } };
    expect(enforceResultRules(result, { perSize: false, sizes: ["M", "L"], hasData: true })).toEqual({
      status: "info",
      summary: "Order.",
      perSize: { M: { status: "info" } },
    });
  });
});
