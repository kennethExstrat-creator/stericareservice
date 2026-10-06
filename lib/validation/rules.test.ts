import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FRAMEWORK_ISSUE_CODES,
  inspectorIssues,
  invalidConfigIssues,
  invalidDataIssues,
  notDoneIssues,
  restrictToOrderedSizes,
  sizeDuplicateIssues,
  sizeNotOrderedIssues,
} from "./rules";

describe("restrictToOrderedSizes (6.2 rule 4)", () => {
  it("keeps ordered sizes under their canonical key and lists the others", () => {
    const data = { unit: "g", sizes: { m: [2.9], XL: [3.4], "7": [9.1] } };
    expect(restrictToOrderedSizes(data, ["S", "M"])).toEqual({
      data: { unit: "g", sizes: { M: [2.9] } },
      ignored: ["XL", "7"],
      duplicates: [],
    });
  });

  it("prefers the canonical key when two spellings of a size are saved, and lists the other", () => {
    expect(restrictToOrderedSizes({ sizes: { "7": "variant", "7.0": "canonical" } }, ["7.0"])).toEqual({
      data: { sizes: { "7.0": "canonical" } },
      ignored: [],
      duplicates: ["7"],
    });
    expect(restrictToOrderedSizes({ sizes: { M: [3], m: [99] } }, ["M"])).toEqual({
      data: { sizes: { M: [3] } },
      ignored: [],
      duplicates: ["m"],
    });
    // Neither is canonical: the first saved is used.
    expect(restrictToOrderedSizes({ sizes: { "7": "first", "7,0": "second" } }, ["7.0"])).toEqual({
      data: { sizes: { "7.0": "first" } },
      ignored: [],
      duplicates: ["7,0"],
    });
  });

  it("leaves data without sizes alone", () => {
    const data = { colour: "Blue" };
    expect(restrictToOrderedSizes(data, ["M"])).toEqual({ data, ignored: [], duplicates: [] });
  });

  it("warns once per second spelling, with a link to it", () => {
    expect(sizeDuplicateIssues(["m"], "Weight (g)")).toEqual([
      {
        level: "warning",
        code: FRAMEWORK_ISSUE_CODES.sizeDuplicate,
        message: 'Weight (g): size M is also saved as "m". The values under "m" are left out of results and the export.',
        size: "M",
        path: ["sizes", "m"],
      },
    ]);
  });

  it("warns once per ignored size, with a link to it", () => {
    expect(sizeNotOrderedIssues(["l"], "Dimension")).toEqual([
      {
        level: "warning",
        code: FRAMEWORK_ISSUE_CODES.sizeNotOrdered,
        message: "Dimension: size l has data but is not in the order. It is left out of results and the export.",
        size: "L",
        path: ["sizes", "l"],
      },
    ]);
  });
});

describe("framework issues", () => {
  it("warn about a module that is not done (6.2 rule 5)", () => {
    expect(notDoneIssues("Glove Information", { status: "not_done", summary: "Missing: Glove colour." })).toEqual([
      expect.objectContaining({ level: "warning", message: "Glove Information is not done: Missing: Glove colour." }),
    ]);
    expect(notDoneIssues("Weight", { status: "pass", summary: "" })).toEqual([]);
  });

  it("block submit for a module required for submit, such as the conclusion", () => {
    expect(notDoneIssues("Conclusion", { status: "not_done", summary: "No final result." }, true)).toEqual([
      {
        level: "error",
        code: "module_not_done",
        message: "Conclusion must be complete before submit: No final result.",
        path: [],
      },
    ]);
    expect(notDoneIssues("Conclusion", { status: "warn", summary: "Final result: hold." }, true)).toEqual([]);
  });

  it("turn schema errors into errors with paths into the data", () => {
    const schema = z.strictObject({ sizes: z.record(z.string(), z.array(z.number())) });
    const parsed = schema.safeParse({ sizes: { M: [243, "2 42"] } });
    if (parsed.success) throw new Error("expected a schema error");
    expect(invalidDataIssues("Dimension", parsed.error)).toEqual([
      expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", 1] }),
    ]);
    expect(invalidConfigIssues("Dimension", parsed.error)[0].message).toContain("Ask an admin");
  });

  it("require an inspector (6.2 rule 11)", () => {
    expect(inspectorIssues(null)).toEqual([
      expect.objectContaining({ level: "error", moduleKey: "header", code: "inspector_missing" }),
    ]);
    expect(inspectorIssues({ id: "00000000-0000-4000-8000-000000000101" })).toEqual([]);
  });
});
