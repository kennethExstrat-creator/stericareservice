import { describe, expect, it } from "vitest";
import {
  errorIssue,
  exportIssuesOf,
  partitionIssues,
  sortIssues,
  stampIssues,
  toExportIssue,
  ValidationIssueSchema,
  warningIssue,
  type ValidationIssue,
} from "./issues";

describe("issue builders", () => {
  it("build module issues; the framework stamps the module key", () => {
    const duplicate = errorIssue("carton_duplicate", "Carton 578 is entered twice for size M.", {
      size: "M",
      path: ["sizes", "M", 12],
    });
    expect(duplicate).toEqual({
      level: "error",
      code: "carton_duplicate",
      message: "Carton 578 is entered twice for size M.",
      size: "M",
      path: ["sizes", "M", 12],
    });
    expect(warningIssue("weight_deviation", "17% below.")).toEqual({
      level: "warning",
      code: "weight_deviation",
      message: "17% below.",
      path: [],
    });
    const [stamped] = stampIssues("carton_sampling", [duplicate]);
    expect(ValidationIssueSchema.parse(stamped)).toEqual({ ...duplicate, moduleKey: "carton_sampling" });
  });

  it("require snake case codes, a message and a module", () => {
    const issue = { level: "error", moduleKey: "weight", code: "Weight-Deviation", message: "x", path: [] };
    expect(ValidationIssueSchema.safeParse(issue).success).toBe(false);
    expect(ValidationIssueSchema.safeParse({ ...issue, code: "weight_deviation", message: "" }).success).toBe(false);
    expect(ValidationIssueSchema.safeParse({ ...issue, code: "weight_deviation", level: "info" }).success).toBe(false);
  });
});

describe("issue lists", () => {
  const issues: ValidationIssue[] = [
    { level: "warning", moduleKey: "weight", code: "weight_deviation", message: "w1", path: [] },
    { level: "error", moduleKey: "carton_sampling", code: "carton_duplicate", message: "e1", size: "M", path: [] },
    { level: "warning", moduleKey: "custom_notes", code: "required", message: "w2", path: [] },
    { level: "error", moduleKey: "weight", code: "invalid_data", message: "e2", path: [] },
    { level: "warning", moduleKey: "carton_sampling", code: "module_not_done", message: "w3", path: [] },
  ];

  it("split into errors (block submit) and warnings (exported)", () => {
    const { errors, warnings } = partitionIssues(issues);
    expect(errors.map((issue) => issue.message)).toEqual(["e1", "e2"]);
    expect(warnings.map((issue) => issue.message)).toEqual(["w1", "w2", "w3"]);
  });

  it("sort by module order, errors first within a module, unknown modules last", () => {
    const sorted = sortIssues(issues, ["header", "carton_sampling", "weight"]);
    expect(sorted.map((issue) => issue.message)).toEqual(["e1", "w3", "e2", "w1", "w2"]);
  });

  it("become export issues per module", () => {
    expect(toExportIssue(issues[1])).toEqual({ code: "carton_duplicate", message: "e1", size: "M" });
    expect(exportIssuesOf(issues, "weight")).toEqual({
      warnings: [{ code: "weight_deviation", message: "w1" }],
      errors: [{ code: "invalid_data", message: "e2" }],
    });
  });
});
