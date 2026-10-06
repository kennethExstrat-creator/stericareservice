import { describe, expect, it } from "vitest";
import { makeAiReview } from "@/lib/ai/__fixtures__/ai-review";
import {
  aiReviewSource,
  aiReviewSourceLabel,
  isStale,
  parseStoredReview,
  sameInstant,
  STALE_REVIEW_MS,
  type AiReviewRow,
} from "./stored";

function row(overrides: Partial<AiReviewRow> = {}): AiReviewRow {
  const review = makeAiReview();
  return {
    id: "99999999-9999-4999-8999-000000000001",
    inspection_id: "11111111-1111-4111-8111-111111111111",
    inspection_updated_at: "2026-10-05T09:30:00.654321+00:00",
    status: "done",
    model: "mock",
    suggested_result: review.suggestedResult,
    confidence: review.confidence,
    summary: review.summary,
    findings: review.findings,
    questions: review.questions,
    created_at: "2026-10-05T10:00:00+00:00",
    updated_at: "2026-10-05T10:00:05+00:00",
    ...overrides,
  };
}

describe("parseStoredReview", () => {
  it("reads a finished review", () => {
    const review = parseStoredReview(row());
    expect(review).toMatchObject({
      status: "done",
      model: "mock",
      suggestedResult: "hold",
      confidence: 0.7,
      readable: true,
      inspectionUpdatedAt: "2026-10-05T09:30:00.654321+00:00",
    });
    expect(review.findings.map((finding) => finding.id)).toEqual(["F1"]);
    expect(review.questions.map((question) => question.id)).toEqual(["Q1"]);
  });

  it("marks findings it cannot read instead of showing half of them", () => {
    const review = parseStoredReview(row({ findings: [{ id: "F1" }], suggested_result: null, confidence: null }));
    expect(review).toMatchObject({ readable: false, findings: [], suggestedResult: null, confidence: null });
    expect(review.questions).toHaveLength(1);
  });
});

describe("isStale", () => {
  const created = "2026-10-05T10:00:00Z";
  it("gives up on a pending review after the longest a provider may take", () => {
    expect(STALE_REVIEW_MS).toBeGreaterThan(30 * 60_000);
    const at = Date.parse(created);
    expect(isStale({ status: "pending", createdAt: created }, at + STALE_REVIEW_MS - 1)).toBe(false);
    expect(isStale({ status: "pending", createdAt: created }, at + STALE_REVIEW_MS + 1)).toBe(true);
    expect(isStale({ status: "done", createdAt: created }, at + STALE_REVIEW_MS * 2)).toBe(false);
  });
});

describe("who wrote a review", () => {
  it("stores the model, or the kind of reviewer, so a mock review is never taken for a real one", () => {
    expect(aiReviewSource("claude", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(aiReviewSource("webhook", null)).toBe("webhook");
    expect(aiReviewSource("mock", null)).toBe("mock");
    expect(aiReviewSourceLabel("mock")).toBe("Mock reviewer (test data only)");
    expect(aiReviewSourceLabel("webhook")).toBe("Review service (webhook)");
    expect(aiReviewSourceLabel("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(aiReviewSourceLabel(null)).toBeNull();
  });
});

describe("sameInstant", () => {
  it("matches one instant however Postgres or JavaScript spells it", () => {
    expect(sameInstant("2026-10-05T09:30:00.654321+00:00", "2026-10-05T09:30:00.654321Z")).toBe(true);
    expect(sameInstant("2026-10-05T09:30:00.65+00:00", "2026-10-05T09:30:00.650000+00:00")).toBe(true);
    expect(sameInstant("2026-10-05T17:30:00.654321+08:00", "2026-10-05T09:30:00.654321+00:00")).toBe(true);
    expect(sameInstant("2026-10-05 09:30:00+00", "2026-10-05T09:30:00Z")).toBe(true);
  });

  it("keeps microseconds apart, so two saves in one millisecond are two versions", () => {
    expect(sameInstant("2026-10-05T09:30:00.654321+00:00", "2026-10-05T09:30:00.654322+00:00")).toBe(false);
    expect(sameInstant("2026-10-05T09:30:00.654321+00:00", "2026-10-05T09:30:01.654321+00:00")).toBe(false);
  });

  it("never matches something that is not a timestamp", () => {
    expect(sameInstant("yesterday", "yesterday")).toBe(false);
  });
});
