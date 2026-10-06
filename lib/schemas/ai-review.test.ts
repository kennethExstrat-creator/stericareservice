import { describe, expect, it } from "vitest";
import { makeAiReview } from "@/lib/ai/__fixtures__/ai-review";
import { AiReviewActionSchema, AiReviewSchema } from "./ai-review";

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
