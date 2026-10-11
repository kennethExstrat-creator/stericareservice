import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { InspectionResultSchema, InspectionStatusSchema } from "@/lib/schemas/common";
import { morePosLabel, RESULT_SEVERITY, STATUS_PROGRESS, summedResult, summedStatus } from "./part-summary";

describe("summedStatus", () => {
  it("is the parts' status when they agree, an inspection of one PO included", () => {
    for (const status of InspectionStatusSchema.options) {
      expect(summedStatus([status])).toEqual({ value: status, mixed: false });
      expect(summedStatus([status, status, status])).toEqual({ value: status, mixed: false });
    }
  });

  it("is the least advanced when they differ, and says so", () => {
    expect(summedStatus(["reopened", "draft"])).toEqual({ value: "draft", mixed: true });
    expect(summedStatus(["submitted", "reopened"])).toEqual({ value: "reopened", mixed: true });
    expect(summedStatus(["approved", "submitted", "approved"])).toEqual({ value: "submitted", mixed: true });
    // Whichever part is first.
    expect(summedStatus(["draft", "approved"])).toEqual({ value: "draft", mixed: true });
  });

  it("orders every status", () => {
    expect([...STATUS_PROGRESS].sort()).toEqual([...InspectionStatusSchema.options].sort());
  });
});

describe("summedResult", () => {
  it("is the parts' result when they agree, Not Done included", () => {
    for (const result of [...InspectionResultSchema.options, null]) {
      expect(summedResult([result, result])).toEqual({ value: result, mixed: false });
    }
  });

  it("is the worst when they differ: Failed, then On Hold, then Not Done, then Passed", () => {
    expect(summedResult(["pass", "fail", "pass"])).toEqual({ value: "fail", mixed: true });
    expect(summedResult(["hold", "fail"])).toEqual({ value: "fail", mixed: true });
    expect(summedResult(["pass", "hold"])).toEqual({ value: "hold", mixed: true });
    expect(summedResult([null, "hold"])).toEqual({ value: "hold", mixed: true });
    // Passed only once every PO has passed.
    expect(summedResult(["pass", null])).toEqual({ value: null, mixed: true });
  });

  it("orders every result and Not Done", () => {
    expect(RESULT_SEVERITY).toHaveLength(InspectionResultSchema.options.length + 1);
    expect(new Set(RESULT_SEVERITY)).toEqual(new Set([...InspectionResultSchema.options, null]));
  });

  it("needs at least one part", () => {
    expect(() => summedResult([])).toThrow();
    expect(() => summedStatus([])).toThrow();
  });
});

describe("morePosLabel", () => {
  it("counts the POs after the first, in Title Case", () => {
    expect(morePosLabel(1)).toBe("+1 PO");
    expect(morePosLabel(2)).toBe("+2 POs");
    expect(morePosLabel(11)).toBe("+11 POs");
    expect(lowerCaseWords(morePosLabel(2))).toEqual([]);
  });
});
