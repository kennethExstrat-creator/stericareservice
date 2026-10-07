// Words typed on the review and not sent yet: the reason for reopening an
// inspection, and a decision on an AI finding with its note. They stay in
// the tab until they are sent or cancelled (lib/drafts/tab-draft.ts: per
// user, safe for server rendering and hydration); these are their keys and
// their shapes as stored.
import { z } from "zod";
import { parseDraft } from "@/lib/drafts/tab-draft";
import { AiReviewActionKindSchema } from "@/lib/schemas/ai-review";

/** The hooks the review's fields keep their drafts with. */
export { useStoredDraft, useTabDraft } from "@/lib/drafts/tab-draft";

const PREFIX = "stericare:review-draft:";

/** The reason an admin is writing for reopening this inspection. */
export function reopenDraftKey(userId: string, inspectionId: string): string {
  return `${PREFIX}reopen:${userId}:${inspectionId}`;
}

/** An admin's half-made decision on one finding of one second opinion: finding ids repeat from one opinion to the next. */
export function decisionDraftKey(userId: string, reviewId: string, findingId: string): string {
  return `${PREFIX}ai-decision:${userId}:${reviewId}:${encodeURIComponent(findingId)}`;
}

/* ------------------------------------------------------------------ *
 * The drafts' shapes, stored as JSON
 * ------------------------------------------------------------------ */

const ReopenDraftSchema = z.object({ v: z.literal(1), reason: z.string() });

/** The reason as typed; null when there is none or it cannot be read. */
export function readReopenDraft(raw: string | null): string | null {
  const parsed = parseDraft(ReopenDraftSchema, raw);
  return parsed ? parsed.reason : null;
}

export function writeReopenDraft(reason: string): string {
  return JSON.stringify({ v: 1, reason });
}

const DecisionDraftSchema = z.object({
  v: z.literal(1),
  /** Empty until a decision is chosen: a note can come first. */
  action: z.union([AiReviewActionKindSchema, z.literal("")]),
  note: z.string(),
});

export type DecisionDraft = Omit<z.infer<typeof DecisionDraftSchema>, "v">;

export function readDecisionDraft(raw: string | null): DecisionDraft | null {
  const parsed = parseDraft(DecisionDraftSchema, raw);
  return parsed ? { action: parsed.action, note: parsed.note } : null;
}

export function writeDecisionDraft(draft: DecisionDraft): string {
  return JSON.stringify({ v: 1, action: draft.action, note: draft.note });
}
