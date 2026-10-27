import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAiReview } from "@/lib/ai/__fixtures__/ai-review";
import { createFakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS } from "@/lib/export/__fixtures__/inspection";
import { decisionMessage, recordFindingDecision } from "./decisions";

const REVIEW_ID = "99999999-9999-4999-8999-000000000001";

function reviewRow(overrides: Record<string, unknown> = {}) {
  const review = makeAiReview();
  return {
    id: REVIEW_ID,
    inspection_id: IDS.inspection,
    inspection_updated_at: "2026-10-05T09:30:00.654321+00:00",
    status: "done",
    model: "mock",
    suggested_result: review.suggestedResult,
    confidence: review.confidence,
    summary: review.summary,
    findings: review.findings,
    questions: review.questions,
    created_at: "2026-10-06T01:00:00Z",
    updated_at: "2026-10-06T01:00:00Z",
    ...overrides,
  };
}

function fake(review: Record<string, unknown> = reviewRow()) {
  return createFakeSupabase({ tables: { ai_reviews: [review], ai_review_actions: [] } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordFindingDecision", () => {
  it("records agree in the admin's name and logs it", async () => {
    const db = fake();
    const result = await recordFindingDecision(db.client, { reviewId: REVIEW_ID, findingId: "F1", action: "agree", note: "  " });
    expect(result).toEqual({ ok: true, decision: { findingId: "F1", action: "agree", note: null } });
    // actor_id is left to the database default, auth.uid(), and RLS checks it.
    expect(db.tables.ai_review_actions).toEqual([
      expect.objectContaining({ ai_review_id: REVIEW_ID, finding_id: "F1", action: "agree", note: null }),
    ]);
    expect(db.tables.ai_review_actions[0]).not.toHaveProperty("actor_id");
    expect(db.rpcCalls).toEqual([
      {
        name: "log_inspection_event",
        args: {
          inspection_id: IDS.inspection,
          action: "ai_review.decision",
          changes: { reviewId: REVIEW_ID, findingId: "F1", action: "agree", note: null },
        },
      },
    ]);
    if (result.ok) expect(decisionMessage(result.decision)).toBe("Recorded: you agree with finding F1.");
  });

  it("needs a note to disagree", async () => {
    const db = fake();
    expect(await recordFindingDecision(db.client, { reviewId: REVIEW_ID, findingId: "F1", action: "disagree", note: "" })).toEqual({
      ok: false,
      message: "Add a note explaining why you disagree.",
      fieldErrors: { note: "Add a note explaining why you disagree." },
    });
    const saved = await recordFindingDecision(db.client, {
      reviewId: REVIEW_ID,
      findingId: "F1",
      action: "disagree",
      note: "The spec sheet gives 3.0 g.",
    });
    expect(saved).toEqual({ ok: true, decision: { findingId: "F1", action: "disagree", note: "The spec sheet gives 3.0 g." } });
  });

  it("records fixed with an optional note", async () => {
    const result = await recordFindingDecision(fake().client, {
      reviewId: REVIEW_ID,
      findingId: "F1",
      action: "fixed",
      note: "Reweighed on a calibrated scale.",
    });
    expect(result).toMatchObject({ ok: true, decision: { action: "fixed", note: "Reweighed on a calibrated scale." } });
    if (result.ok) expect(decisionMessage(result.decision)).toBe("Recorded: finding F1 is fixed.");
  });

  it("rejects anything but agree, disagree or fixed", async () => {
    const db = fake();
    expect(await recordFindingDecision(db.client, { reviewId: REVIEW_ID, findingId: "F1", action: "ignore", note: "" })).toMatchObject({
      ok: false,
      fieldErrors: { action: "Choose Agree, Disagree or Fixed." },
    });
    expect(db.queries).toEqual([]);
  });

  it("records decisions only on findings of a finished review", async () => {
    expect(await recordFindingDecision(fake().client, { reviewId: "nope", findingId: "F1", action: "agree", note: "" })).toMatchObject({
      ok: false,
      message: "That review could not be found. Reload the page.",
    });
    expect(
      await recordFindingDecision(fake().client, { reviewId: REVIEW_ID, findingId: "F9", action: "agree", note: "" }),
    ).toEqual({ ok: false, message: "This review has no finding F9. Reload the page." });
    expect(
      await recordFindingDecision(fake(reviewRow({ status: "pending", findings: [] })).client, {
        reviewId: REVIEW_ID,
        findingId: "F1",
        action: "agree",
        note: "",
      }),
    ).toEqual({ ok: false, message: "Decisions are recorded on finished reviews only." });
    const empty = createFakeSupabase({ tables: { ai_reviews: [] } });
    expect(
      await recordFindingDecision(empty.client, { reviewId: REVIEW_ID, findingId: "F1", action: "agree", note: "" }),
    ).toEqual({ ok: false, message: "That review could not be found. Reload the page." });
  });

  it("explains a refusal by the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createFakeSupabase({
      tables: { ai_reviews: [reviewRow()] },
      failQuery: (query) => (query.table === "ai_review_actions" ? { code: "42501", message: "new row violates row-level security" } : null),
    });
    expect(await recordFindingDecision(db.client, { reviewId: REVIEW_ID, findingId: "F1", action: "agree", note: "" })).toEqual({
      ok: false,
      message: "Your role does not allow deciding on Steri-AI's findings.",
    });
    expect(db.rpcCalls).toEqual([]);
  });
});
