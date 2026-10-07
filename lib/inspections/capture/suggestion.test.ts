import { describe, expect, it } from "vitest";
import { suggestResult } from "@/lib/validation";
import { suggestionReasons } from "./suggestion";

const TITLES: Readonly<Record<string, string>> = {
  weight: "Weight (g) - average of 13 gloves per size",
  watertight: "Freedom from Holes by watertight test",
  visual: "Visual Inspection",
};
const titleOf = (key: string) => TITLES[key] ?? key;

describe("suggestionReasons (the submit confirmation)", () => {
  it("adds nothing to a clean pass: the pill says it", () => {
    const clean = suggestResult([
      { key: "weight", status: "pass" },
      { key: "visual", status: "pass" },
    ]);
    expect(clean.result).toBe("pass");
    expect(suggestionReasons(clean, titleOf)).toEqual([]);
  });

  it("names the warned sections of a pass in the Conclusion section's words, without a result word", () => {
    const warned = suggestResult([
      { key: "weight", status: "warn" },
      { key: "visual", status: "pass" },
    ]);
    expect(warned.result).toBe("pass");
    expect(suggestionReasons(warned, titleOf)).toEqual(["Warnings: Weight (g) - average of 13 gloves per size."]);
  });

  it("says what failed, what is not done and what warned, one line each", () => {
    const failed = suggestResult([
      { key: "watertight", status: "fail" },
      { key: "visual", status: "not_done" },
      { key: "weight", status: "warn" },
    ]);
    expect(failed.result).toBe("fail");
    expect(suggestionReasons(failed, titleOf)).toEqual([
      "Failed: Freedom from Holes by watertight test.",
      "Not done: Visual Inspection.",
      "Warnings: Weight (g) - average of 13 gloves per size.",
    ]);
    for (const reason of suggestionReasons(failed, titleOf)) expect(reason).not.toMatch(/^(Pass|Fail|Hold)\b/);
  });

  it("says why it is on hold when nothing has a result yet", () => {
    const nothing = suggestResult([{ key: "visual", status: "info" }]);
    expect(nothing.result).toBe("hold");
    expect(suggestionReasons(nothing, titleOf)).toEqual(["No module has a result yet."]);
    const missing = suggestResult([{ key: "visual", status: "not_done" }]);
    expect(suggestionReasons(missing, titleOf)).toEqual(["Not done: Visual Inspection."]);
  });
});
