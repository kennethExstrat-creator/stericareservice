import { describe, expect, it } from "vitest";
import { makeAiReview } from "@/lib/ai/__fixtures__/ai-review";
import { FIXTURE_IDS, makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { AiReviewActionSchema, AiReviewSchema, findUnknownReferences, type AiReview } from "./ai-review";
import type { InspectionExport } from "./export";

function issuePaths(value: unknown): string[] {
  const result = AiReviewSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("AiReviewSchema", () => {
  it("accepts a full review", () => {
    expect(AiReviewSchema.parse(makeAiReview())).toEqual(makeAiReview());
  });

  it("accepts an empty review: no findings, no questions", () => {
    const review = { ...makeAiReview(), suggestedResult: "pass", confidence: 0.95, findings: [], questions: [] };
    expect(AiReviewSchema.safeParse(review).success).toBe(true);
  });

  it("defaults a missing evidence unit to null, so webhooks may leave it out", () => {
    const review = makeAiReview();
    const raw = JSON.parse(JSON.stringify(review));
    delete raw.findings[0].evidence.values[0].unit;
    expect(AiReviewSchema.parse(raw).findings[0].evidence.values[0].unit).toBeNull();
  });

  it.each([
    ["suggestedResult", { suggestedResult: "PASS" }],
    ["confidence", { confidence: 1.2 }],
    ["confidence", { confidence: -0.1 }],
    ["summary", { summary: "" }],
  ])("rejects a bad %s", (path, change) => {
    expect(issuePaths({ ...makeAiReview(), ...change })).toContain(path);
  });

  it("rejects bad findings", () => {
    const review = makeAiReview();
    Object.assign(review.findings[0], { severity: "high", message: "" });
    expect(issuePaths(review)).toEqual(expect.arrayContaining(["findings.0.severity", "findings.0.message"]));
  });

  it("requires every evidence list, even when empty", () => {
    const raw = JSON.parse(JSON.stringify(makeAiReview()));
    delete raw.findings[0].evidence.boxes;
    expect(issuePaths(raw)).toContain("findings.0.evidence.boxes");
  });

  it("rejects duplicate finding and question ids, which admin actions point at", () => {
    const review = makeAiReview();
    review.findings.push({ ...review.findings[0] });
    review.questions.push({ ...review.questions[0] });
    expect(issuePaths(review)).toEqual(expect.arrayContaining(["findings.1.id", "questions.1.id"]));
  });
});

describe("findUnknownReferences", () => {
  const UNKNOWN_PHOTO = "00000000-0000-4000-8000-00000000dead";

  function citing(module: string, photos: string[], questionModule: string | null = null): AiReview {
    const review = makeAiReview();
    review.findings[0] = { ...review.findings[0], module, evidence: { ...review.findings[0].evidence, photos } };
    review.questions[0] = { ...review.questions[0], module: questionModule };
    return review;
  }

  it("accepts a review that cites the export's own modules and photos", () => {
    expect(findUnknownReferences(makeAiReview(), makeStdEgExport())).toEqual([]);
  });

  it("names every module and photo the inspection does not have, by path", () => {
    const review = citing("tensile", [FIXTURE_IDS.photoScale, UNKNOWN_PHOTO], "no_such_module");
    expect(findUnknownReferences(review, makeStdEgExport())).toEqual([
      { path: ["findings", 0, "module"], message: '"tensile" is not a module of this inspection' },
      {
        path: ["findings", 0, "evidence", "photos", 1],
        message: `"${UNKNOWN_PHOTO}" is not a photo of this inspection`,
      },
      { path: ["questions", 0, "module"], message: '"no_such_module" is not a module of this inspection' },
    ]);
  });

  it("accepts excluded and custom modules, and the always-on header and conclusion", () => {
    const doc: InspectionExport = makeStdEgExport();
    doc.modules = doc.modules.filter((module) => module.key !== "conclusion" && module.key !== "header");
    doc.excludedModules.push({ key: "tensile", title: "Tensile", reason: "Not in this client's scope." });
    doc.custom.push({ key: "humidity", title: "Humidity", layout: "fields", fields: [], values: {} });

    for (const key of ["tensile", "humidity", "header", "conclusion"]) {
      expect(findUnknownReferences(citing(key, [], key), doc)).toEqual([]);
    }
  });

  it("does not check sizes or boxes, which a reviewer may rightly find missing from the data", () => {
    const review = makeAiReview();
    review.findings[0].size = "XXL";
    review.findings[0].evidence.boxes = ["9999"];
    expect(findUnknownReferences(review, makeStdEgExport())).toEqual([]);
  });

  it("shortens a long value in the message", () => {
    const [issue] = findUnknownReferences(citing("x".repeat(500), []), makeStdEgExport());
    expect(issue.message).toBe(`"${"x".repeat(57)}..." is not a module of this inspection`);
  });
});

describe("AiReviewActionSchema", () => {
  it("accepts agree and fixed without a note", () => {
    expect(AiReviewActionSchema.parse({ findingId: "F1", action: "agree" })).toEqual({
      findingId: "F1",
      action: "agree",
      note: null,
    });
    expect(AiReviewActionSchema.parse({ findingId: "F1", action: "fixed", note: "  " }).note).toBeNull();
  });

  it("requires a note to disagree", () => {
    for (const note of [undefined, null, "", "   "]) {
      const result = AiReviewActionSchema.safeParse({ findingId: "F1", action: "disagree", note });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["note"], message: "Add a note explaining why you disagree." });
    }
  });

  it("trims the note", () => {
    const action = AiReviewActionSchema.parse({ findingId: "F2", action: "disagree", note: "  Scale was recalibrated. " });
    expect(action.note).toBe("Scale was recalibrated.");
  });

  it("rejects unknown actions and a missing finding id", () => {
    expect(AiReviewActionSchema.safeParse({ findingId: "F1", action: "ignore" }).success).toBe(false);
    expect(AiReviewActionSchema.safeParse({ findingId: "", action: "agree" }).success).toBe(false);
  });
});
