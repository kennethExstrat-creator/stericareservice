import "server-only";
import { z } from "zod";
import type { ExportClient } from "@/lib/export";
import { AiFindingSchema, AiReviewActionSchema, type AiReviewAction } from "@/lib/schemas/ai-review";
import { logInspectionEvent } from "./audit";
import type { AiActionField } from "./types";

/* ------------------------------------------------------------------ *
 * The admin's decision on one finding (BUILD_SPEC 9.2): agree, disagree
 * with a note, or fixed. Each decision is a new ai_review_actions row in
 * the admin's own name, so changing one's mind keeps the earlier
 * decision; the panel shows the latest. Also written to the audit log.
 * ------------------------------------------------------------------ */

export const DecisionTargetSchema = z.object({ reviewId: z.uuid() });

export type RecordDecisionResult =
  | { ok: true; decision: AiReviewAction }
  | { ok: false; message: string; fieldErrors?: Partial<Record<AiActionField, string>> };

const ACTION_MESSAGES: Readonly<Record<AiReviewAction["action"], (finding: string) => string>> = {
  agree: (finding) => `Recorded: you agree with ${finding}.`,
  disagree: (finding) => `Recorded: you disagree with ${finding}.`,
  fixed: (finding) => `Recorded: ${finding} is fixed.`,
};

export function decisionMessage(decision: AiReviewAction): string {
  return ACTION_MESSAGES[decision.action](`finding ${decision.findingId}`);
}

/**
 * @param fields the submitted reviewId, findingId, action and note
 * @param client the admin's own client: RLS stores the decision in their name only
 */
export async function recordFindingDecision(
  client: ExportClient,
  fields: { reviewId: unknown; findingId: unknown; action: unknown; note: unknown },
): Promise<RecordDecisionResult> {
  const target = DecisionTargetSchema.safeParse({ reviewId: fields.reviewId });
  const parsed = AiReviewActionSchema.safeParse({
    findingId: fields.findingId,
    action: fields.action,
    note: fields.note,
  });
  if (!target.success) return { ok: false, message: "That review could not be found. Reload the page." };
  if (!parsed.success) {
    const fieldErrors: Partial<Record<AiActionField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "note" && !fieldErrors.note) fieldErrors.note = issue.message;
      if (field === "action" && !fieldErrors.action) fieldErrors.action = "Choose Agree, Disagree or Fixed.";
    }
    if (fieldErrors.note || fieldErrors.action) {
      return { ok: false, message: fieldErrors.action ?? fieldErrors.note ?? "Check the decision.", fieldErrors };
    }
    return { ok: false, message: "That finding could not be found. Reload the page." };
  }
  const decision = parsed.data;

  const { data: review, error } = await client
    .from("ai_reviews")
    .select("id, inspection_id, status, findings")
    .eq("id", target.data.reviewId)
    .maybeSingle();
  if (error) {
    console.error("[ai decisions] reading the review failed", { code: error.code, message: error.message });
    return { ok: false, message: "Could not read the review. Try again." };
  }
  if (!review) return { ok: false, message: "That review could not be found. Reload the page." };
  if (review.status !== "done") return { ok: false, message: "Decisions are recorded on finished reviews only." };

  const findings = z.array(AiFindingSchema).safeParse(review.findings);
  if (!findings.success || !findings.data.some((finding) => finding.id === decision.findingId)) {
    return { ok: false, message: `This review has no finding ${decision.findingId}. Reload the page.` };
  }

  const inserted = await client
    .from("ai_review_actions")
    .insert({ ai_review_id: review.id, finding_id: decision.findingId, action: decision.action, note: decision.note })
    .select("id")
    .single();
  if (inserted.error) {
    console.error("[ai decisions] saving the decision failed", {
      code: inserted.error.code,
      message: inserted.error.message,
    });
    // Row level security: deciding is the role's Steri-AI Second Opinion (migration 20261027150000).
    const refused = inserted.error.code === "42501";
    return {
      ok: false,
      message: refused ? "Your role does not allow deciding on Steri-AI's findings." : "Could not save the decision. Try again.",
    };
  }

  await logInspectionEvent(client, review.inspection_id, "ai_review.decision", {
    reviewId: review.id,
    findingId: decision.findingId,
    action: decision.action,
    note: decision.note,
  });
  return { ok: true, decision };
}
