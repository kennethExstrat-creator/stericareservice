import { describe, expect, it } from "vitest";
import type { ModuleOverrides } from "@/lib/schemas/template";
import type { ValidationIssue } from "@/lib/validation";
import { filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import {
  blockedSubmitMessage,
  countIssues,
  describePending,
  groupIssues,
  issueKey,
  issueTarget,
  taskText,
  unseenIssues,
} from "./issues";
import { captureSections } from "./sections";

function evaluated(overrides: ModuleOverrides = {}) {
  const data = filledData();
  const evaluation = evaluateCapture({ template: testTemplate(), overrides, data, meta: TEST_META }, TEST_REGISTRY);
  return { ...evaluation, sections: captureSections(evaluation.template, evaluation.report, data) };
}

describe("groupIssues", () => {
  it("groups issues under their section's title in screen order, errors apart from warnings", () => {
    const { report, sections } = evaluated();
    const groups = groupIssues(report.issues, sections);
    expect(groups.map((group) => group.key)).toEqual(["site_notes", "packing_config", "weight", "size_checks", "conclusion"]);
    const conclusion = groups.find((group) => group.key === "conclusion");
    expect(conclusion).toMatchObject({ title: "Conclusion", linkable: true, warnings: [] });
    expect(conclusion?.errors[0]).toMatchObject({ code: "module_not_done", level: "error" });
    expect(groups.find((group) => group.key === "packing_config")?.warnings[0].code).toBe("module_not_done");
  });

  it("marks issues of a section that is not on screen as not linkable", () => {
    const { sections } = evaluated({
      packing_config: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
    });
    const stray: ValidationIssue[] = [
      { level: "warning", moduleKey: "packing_config", code: "x", message: "Old.", path: [] },
      { level: "error", moduleKey: "nowhere", code: "y", message: "Lost.", path: [] },
    ];
    expect(groupIssues(stray, sections)).toEqual([
      expect.objectContaining({ key: "packing_config", title: "Packing configuration", linkable: false }),
      expect.objectContaining({ key: "nowhere", title: "nowhere", linkable: false }),
    ]);
  });
});

describe("counts and links", () => {
  it("counts errors and warnings, and words them as tasks: all to do, and what submit needs", () => {
    const { report } = evaluated();
    const counts = countIssues(report.issues);
    expect(counts.errors).toBeGreaterThan(0);
    expect(describePending({ errors: 0, warnings: 0 })).toBe("Nothing pending");
    expect(describePending({ errors: 0, warnings: 1 })).toBe("1 to do");
    expect(describePending({ errors: 1, warnings: 12 })).toBe("13 to do · 1 needed before you submit");
    expect(describePending({ errors: 2, warnings: 0 })).toBe("2 to do · 2 needed before you submit");
    expect(describePending({ errors: 1, warnings: 2 }, ", ")).toBe("3 to do, 1 needed before you submit");
  });

  it("says what submit needs when it is refused", () => {
    expect(blockedSubmitMessage(1)).toBe("1 item is needed before you can submit.");
    expect(blockedSubmitMessage(3)).toBe("3 items are needed before you can submit.");
  });

  it("links an issue to its section and path, with a stable key", () => {
    const issue: ValidationIssue = {
      level: "error",
      moduleKey: "weight",
      code: "carton_duplicate",
      message: "Carton 578 twice.",
      size: "M",
      path: ["sizes", "M", 3],
    };
    expect(issueTarget(issue)).toEqual({ sectionKey: "weight", path: ["sizes", "M", 3] });
    expect(issueKey(issue)).toBe(issueKey({ ...issue }));
    expect(issueKey(issue)).not.toBe(issueKey({ ...issue, path: ["sizes", "M", 4] }));
  });
});

describe("taskText", () => {
  const notDone = (message: string, level: ValidationIssue["level"] = "warning"): ValidationIssue => ({
    level,
    moduleKey: "glove_info",
    code: "module_not_done",
    message,
    path: [],
  });

  it("leaves the section's own words out of its not-done task: the heading says them", () => {
    expect(taskText(notDone("Glove Information is not done: Missing: Glove colour, Glove length."), "Glove Information")).toBe(
      "Missing: Glove colour, Glove length.",
    );
    expect(taskText(notDone("Conclusion must be complete before submit: No final result.", "error"), "Conclusion")).toBe(
      "No final result.",
    );
    expect(taskText(notDone("Tensile is not done: size S: not entered."), "Tensile")).toBe("Size S: not entered.");
  });

  it("says Not done yet. when the section gave nothing more", () => {
    expect(taskText(notDone("Tensile is not done."), "Tensile")).toBe("Not done yet.");
    expect(taskText(notDone("Conclusion must be complete before submit.", "error"), "Conclusion")).toBe("Not done yet.");
  });

  it("keeps the whole message under another title, and for every other issue", () => {
    expect(taskText(notDone("Weight is not done: Missing: values."), "Glove Information")).toBe("Weight is not done: Missing: values.");
    const required: ValidationIssue = {
      level: "error",
      moduleKey: "site_notes",
      code: "custom_required",
      message: "Container seal intact is required.",
      path: ["sealIntact"],
    };
    expect(taskText(required, "Site notes")).toBe("Container seal intact is required.");
  });

  it("strips the not-done messages lib/validation writes", () => {
    const { report, sections } = evaluated();
    const groups = groupIssues(report.issues, sections);
    const tasks = groups.flatMap((group) =>
      [...group.errors, ...group.warnings]
        .filter((issue) => issue.code === "module_not_done")
        .map((issue) => taskText(issue, group.title)),
    );
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) expect(task).not.toMatch(/is not done|must be complete before submit/);
  });
});

describe("unseenIssues", () => {
  it("lists what the server found with a section switched back on elsewhere, and nothing once the screen follows", () => {
    const off = { packing_config: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } };
    // The screen still has packing switched off; the server checked with it back on.
    const onScreen = evaluated(off).report.issues;
    const found = evaluated().report.issues;
    const unseen = unseenIssues(found, onScreen);
    expect(unseen.length).toBeGreaterThan(0);
    expect(unseen.every((issue) => issue.moduleKey === "packing_config")).toBe(true);
    // Once the screen takes the server's overrides over, it lists them itself.
    expect(unseenIssues(found, evaluated().report.issues)).toEqual([]);
  });

  it("has nothing to add without a refused submit", () => {
    expect(unseenIssues(null, [])).toEqual([]);
    expect(unseenIssues([], evaluated().report.issues)).toEqual([]);
  });
});
