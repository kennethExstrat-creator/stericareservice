import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  describeDataPath,
  fieldIssues,
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

  it("keep the not-done issue, which only links to a field, out of the issues shown beside fields", () => {
    const linked = notDoneIssues("Conclusion", { status: "not_done", summary: "No final result." }, true, ["finalResult"]);
    const differs = { level: "warning", code: "final_result_differs", message: "Differs.", path: ["finalResult"] };
    expect(fieldIssues([...linked, differs])).toEqual([differs]);
    expect(fieldIssues(undefined)).toEqual([]);
  });

  it("link a not-done module to the field it names", () => {
    expect(notDoneIssues("Conclusion", { status: "not_done", summary: "No final result." }, true, ["finalResult"])).toEqual([
      expect.objectContaining({ level: "error", code: "module_not_done", path: ["finalResult"] }),
    ]);
    expect(notDoneIssues("Tensile", { status: "not_done", summary: "" }, false, ["labReport"])).toEqual([
      expect.objectContaining({ level: "warning", message: "Tensile is not done.", path: ["labReport"] }),
    ]);
  });

  it("name the module and the field of a value the schema rejects, in plain words", () => {
    const schema = z.strictObject({
      sizes: z.record(
        z.string(),
        z.strictObject({
          qtyCases: z.number().int().min(0).nullable(),
          lotNumbers: z.array(z.string().max(200)),
          note: z.string(),
          when: z.iso.date().nullable(),
        }),
      ),
    });
    const parsed = schema.safeParse({
      sizes: { M: { qtyCases: 2.5, lotNumbers: ["L".repeat(201)], when: "12/07/2024", colour: "blue" } },
    });
    if (parsed.success) throw new Error("expected a schema error");
    const labels = { qtyCases: "Qty (cases)", lotNumbers: "Lot Number" };
    const messages = invalidDataIssues("Order", parsed.error, [], {
      describe: (path) => describeDataPath(path, labels),
      consequence: "Until it is corrected, the other sections use the rest.",
    }).map((issue) => [issue.path, issue.message]);
    expect(messages).toEqual([
      [["sizes", "M", "qtyCases"], "Order: size M, Qty (cases) is not a whole number. Until it is corrected, the other sections use the rest."],
      [
        ["sizes", "M", "lotNumbers", 0],
        "Order: size M, Lot Number no. 1 is longer than 200 characters. Until it is corrected, the other sections use the rest.",
      ],
      [["sizes", "M", "note"], "Order: size M, note is missing. Until it is corrected, the other sections use the rest."],
      [["sizes", "M", "when"], "Order: size M, when is not a date (YYYY-MM-DD). Until it is corrected, the other sections use the rest."],
      [["sizes", "M", "colour"], "Order: size M, colour is not a field of this section. Until it is corrected, the other sections use the rest."],
    ]);
  });

  it("describe a place in a module's data by its labels", () => {
    const labels = { lotNumbers: "Lot Number", iso13485: "ISO 13485", expiryDate: "Expiry date" };
    expect(describeDataPath(["sizes", "M", "lotNumbers", 1], labels)).toBe("size M, Lot Number no. 2");
    expect(describeDataPath(["items", "iso13485", "expiryDate"], labels)).toBe("ISO 13485, Expiry date");
    expect(describeDataPath(["sizes", "XL", 12])).toBe("size XL no. 13");
    expect(describeDataPath(["labReport"])).toBe("labReport");
    expect(describeDataPath([])).toBe("");
  });

  it("name the hand under a size in a hand-split module's data", () => {
    const labels = { holes: "Pin hole" };
    expect(describeDataPath(["sizes", "M", "R", "holes", "hole_finger"], labels)).toBe("size M, right hand, Pin hole, hole_finger");
    expect(describeDataPath(["sizes", "M", "L"], labels)).toBe("size M, left hand");
    // R and L are hands only right under a size.
    expect(describeDataPath(["R", "holes"], labels)).toBe("Pin hole");
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
