import { describe, expect, it } from "vitest";
import { suggestionReasons, suggestResult, type SuggestionInput } from "./suggested-result";

const done: SuggestionInput[] = [
  { key: "header", status: "info" },
  { key: "glove_info", status: "info" },
  { key: "dimensions", status: "pass", title: "Dimension" },
  { key: "watertight", status: "pass" },
];

describe("suggestResult", () => {
  it("passes when every module that gives a verdict passes, with nothing to add to the result", () => {
    expect(suggestResult(done)).toEqual({ result: "pass", failed: [], notDone: [], warned: [], summary: "" });
  });

  it("still passes with warnings, and lists them (they go into the export)", () => {
    const result = suggestResult([...done, { key: "weight", status: "warn", title: "Weight (g)" }]);
    expect(result).toMatchObject({ result: "pass", warned: ["weight"], summary: "Warnings: Weight (g)." });
  });

  it("holds while a module is not done: missing data is never a pass", () => {
    const result = suggestResult([...done, { key: "force_at_break", status: "not_done" }]);
    expect(result).toMatchObject({ result: "hold", notDone: ["force_at_break"], summary: "Not done: force_at_break." });
  });

  it("fails when any module fails, even with others not done, and says all three", () => {
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
      summary: "Failed: Visual Inspection. Not done: labeling. Warnings: weight.",
    });
  });

  it("holds when nothing has been tested", () => {
    expect(suggestResult([{ key: "header", status: "info" }])).toMatchObject({
      result: "hold",
      summary: "No module has a result yet.",
    });
    expect(suggestResult([]).result).toBe("hold");
  });

  it("leaves the conclusion's own result out", () => {
    expect(suggestResult([...done, { key: "conclusion", status: "fail" }]).result).toBe("pass");
    expect(suggestResult([...done, { key: "conclusion", status: "not_done" }]).result).toBe("pass");
  });

  it("never restates the overall result in its summary: the pill beside it does", () => {
    const cases: SuggestionInput[][] = [
      done,
      [...done, { key: "weight", status: "warn" }],
      [...done, { key: "visual", status: "fail" }],
      [...done, { key: "labeling", status: "not_done" }],
      [{ key: "header", status: "info" }],
    ];
    for (const modules of cases) expect(suggestResult(modules).summary).not.toMatch(/\b(Pass|Fail|Hold|PASSED|FAILED|HOLD|On hold)\b/);
  });
});

describe("suggestionReasons", () => {
  it("is the summary, a line per reason, with the sections named by the caller", () => {
    const titles: Readonly<Record<string, string>> = { visual: "Visual Inspection", weight: "Weight (g)" };
    const suggestion = suggestResult([
      ...done,
      { key: "visual", status: "fail", title: titles.visual },
      { key: "weight", status: "warn", title: titles.weight },
    ]);
    expect(suggestionReasons(suggestion, (key) => key.toUpperCase())).toEqual(["Failed: VISUAL.", "Warnings: WEIGHT."]);
    expect(suggestionReasons(suggestion, (key) => titles[key] ?? key).join(" ")).toBe(suggestion.summary);
  });
});
