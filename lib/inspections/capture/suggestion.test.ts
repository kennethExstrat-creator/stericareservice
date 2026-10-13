import { describe, expect, it } from "vitest";
import { suggestResult } from "@/lib/validation";
import { submitReasons, suggestionReasons } from "./suggestion";

/** The screen's sections as captureSections names them: the template's title, and the short name. */
const SECTIONS = [
  { key: "carton_sampling", title: "Finished Goods Sampling Information (Carton Number)", shortTitle: "Carton Numbers" },
  { key: "weight", title: "Weight (g) - Average of 13 Gloves per Size", shortTitle: "Weight" },
  { key: "watertight", title: "Freedom From Holes by Watertight Test", shortTitle: "Watertight Test" },
  { key: "visual", title: "Visual Inspection", shortTitle: "Visual Inspection" },
] as const;

describe("submitReasons (the submit confirmation)", () => {
  it("adds nothing to a clean pass: the pill says it", () => {
    const clean = suggestResult([
      { key: "weight", status: "pass" },
      { key: "visual", status: "pass" },
    ]);
    expect(clean.result).toBe("pass");
    expect(submitReasons(clean, SECTIONS)).toEqual([]);
  });

  it("names the warned sections of a pass in the Conclusion section's words, without a result word", () => {
    const warned = suggestResult([
      { key: "weight", status: "warn" },
      { key: "visual", status: "pass" },
    ]);
    expect(warned.result).toBe("pass");
    expect(submitReasons(warned, SECTIONS)).toEqual(["Warnings: Weight."]);
  });

  it("says what failed, what is not done and what warned, one line each, each section by its short name", () => {
    const failed = suggestResult([
      { key: "carton_sampling", status: "fail" },
      { key: "watertight", status: "fail" },
      { key: "visual", status: "not_done" },
      { key: "weight", status: "warn" },
    ]);
    expect(failed.result).toBe("fail");
    const reasons = submitReasons(failed, SECTIONS);
    expect(reasons).toEqual(["Failed: Carton Numbers, Watertight Test.", "Not done: Visual Inspection.", "Warnings: Weight."]);
    for (const reason of reasons) expect(reason).not.toMatch(/^(Pass|Fail|Hold)\b/);
    // The review keeps the template's wording: the same lines, named by the titles.
    expect(suggestionReasons(failed, (key) => SECTIONS.find((section) => section.key === key)?.title ?? key)).toEqual([
      "Failed: Finished Goods Sampling Information (Carton Number), Freedom From Holes by Watertight Test.",
      "Not done: Visual Inspection.",
      "Warnings: Weight (g) - Average of 13 Gloves per Size.",
    ]);
  });

  it("names a module the screen does not list by its module's short name", () => {
    const failed = suggestResult([{ key: "dispensing_packing", status: "fail" }]);
    expect(submitReasons(failed, SECTIONS)).toEqual(["Failed: Packing Check."]);
  });

  it("says why it is on hold when nothing has a result yet", () => {
    const nothing = suggestResult([{ key: "visual", status: "info" }]);
    expect(nothing.result).toBe("hold");
    expect(submitReasons(nothing, SECTIONS)).toEqual(["No module has a result yet."]);
    const missing = suggestResult([{ key: "visual", status: "not_done" }]);
    expect(submitReasons(missing, SECTIONS)).toEqual(["Not done: Visual Inspection."]);
  });
});
