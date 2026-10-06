import { describe, expect, it } from "vitest";
import { suggestResult, type SuggestionInput } from "./suggested-result";

const done: SuggestionInput[] = [
  { key: "header", status: "info" },
  { key: "glove_info", status: "info" },
  { key: "dimensions", status: "pass", title: "Dimension" },
  { key: "watertight", status: "pass" },
];

describe("suggestResult", () => {
  it("passes when every module that gives a verdict passes", () => {
    expect(suggestResult(done)).toEqual({ result: "pass", failed: [], notDone: [], warned: [], summary: "Pass." });
  });

  it("still passes with warnings, and lists them (they go into the export)", () => {
    const result = suggestResult([...done, { key: "weight", status: "warn", title: "Weight (g)" }]);
    expect(result).toMatchObject({ result: "pass", warned: ["weight"], summary: "Pass. Warnings: Weight (g)." });
  });

  it("holds while a module is not done: missing data is never a pass", () => {
    const result = suggestResult([...done, { key: "force_at_break", status: "not_done" }]);
    expect(result).toMatchObject({ result: "hold", notDone: ["force_at_break"], summary: "Hold: not done: force_at_break." });
  });

  it("fails when any module fails, even with others not done", () => {
    const result = suggestResult([
      ...done,
      { key: "visual", status: "fail", title: "Visual Inspection" },
      { key: "labeling", status: "not_done" },
      { key: "weight", status: "warn" },
    ]);
    expect(result).toEqual({
      result: "fail",
      failed: ["visual"],
      notDone: ["labeling"],
      warned: ["weight"],
      summary: "Fail: Visual Inspection. Warnings: weight.",
    });
  });

  it("holds when nothing has been tested", () => {
    expect(suggestResult([{ key: "header", status: "info" }]).result).toBe("hold");
    expect(suggestResult([]).result).toBe("hold");
  });

  it("leaves the conclusion's own result out", () => {
    expect(suggestResult([...done, { key: "conclusion", status: "fail" }]).result).toBe("pass");
    expect(suggestResult([...done, { key: "conclusion", status: "not_done" }]).result).toBe("pass");
  });
});
