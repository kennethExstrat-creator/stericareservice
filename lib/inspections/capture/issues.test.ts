import { describe, expect, it } from "vitest";
import type { ModuleOverrides } from "@/lib/schemas/template";
import type { ValidationIssue } from "@/lib/validation";
import { filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import { countIssues, describeIssueCounts, groupIssues, issueKey, issueTarget } from "./issues";
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
  it("counts errors and warnings and words them", () => {
    const { report } = evaluated();
    const counts = countIssues(report.issues);
    expect(counts.errors).toBeGreaterThan(0);
    expect(describeIssueCounts({ errors: 0, warnings: 0 })).toBe("No issues");
    expect(describeIssueCounts({ errors: 1, warnings: 0 })).toBe("1 error");
    expect(describeIssueCounts({ errors: 2, warnings: 5 })).toBe("2 errors and 5 warnings");
    expect(describeIssueCounts({ errors: 0, warnings: 1 })).toBe("1 warning");
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
