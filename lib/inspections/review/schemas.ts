// What the review actions accept (BUILD_SPEC 5, status flow). A form names
// the inspection and the version the admin looked at; the rest comes from
// the database. Shared by the Server Actions and the dialogs, so the reason's
// limit is the same on both sides.
import { z } from "zod";

/** Longest reopen reason, the same limit as a module switched off for one inspection. */
export const REOPEN_REASON_MAX = 500;

/**
 * The audit action that records why an admin reopened an inspection, logged
 * with log_inspection_event() right after the status change. The database's
 * own `status_changed` row has no room for a reason.
 */
export const REOPEN_EVENT = "review.reopened";

export const REVIEW_MESSAGES = {
  notFound: "This inspection could not be found. It may have been deleted.",
  staleForm: "The page is out of date. Reload it and try again.",
  reasonMissing: "Say what the inspector should change.",
  reasonTooLong: `Keep the reason to ${REOPEN_REASON_MAX} characters or fewer.`,
  unexpected: "Something went wrong. Try again, and tell a developer if it keeps happening.",
} as const;

/**
 * An inspection and the version the admin reviewed: its `updated_at`, passed
 * through exactly as Postgres returned it (microseconds included), so the
 * status change applies only to what was on screen.
 */
export const ReviewTargetSchema = z.object({
  inspectionId: z.uuid({ error: REVIEW_MESSAGES.notFound }),
  version: z.iso.datetime({ offset: true, error: REVIEW_MESSAGES.staleForm }),
});
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>;

/**
 * `\n` line ends. A form sends a textarea's line breaks as `\r\n`, while the
 * field's own limit counted each as one character: normalised first, the
 * limit here counts the same, and the audit log stores plain `\n`.
 */
export function normaliseLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** An inspection to send back to its inspector, and what they should change. */
export const ReopenInputSchema = z.object({
  inspectionId: ReviewTargetSchema.shape.inspectionId,
  reason: z
    .string({ error: REVIEW_MESSAGES.reasonMissing })
    .overwrite(normaliseLineBreaks)
    .trim()
    .min(1, { error: REVIEW_MESSAGES.reasonMissing })
    .max(REOPEN_REASON_MAX, { error: REVIEW_MESSAGES.reasonTooLong }),
});
export type ReopenInput = z.infer<typeof ReopenInputSchema>;

/** The reason stored with a reopen event, or null when the row holds none. */
export function reopenReasonOf(changes: unknown): string | null {
  if (typeof changes !== "object" || changes === null || Array.isArray(changes)) return null;
  const reason = (changes as Record<string, unknown>).reason;
  return typeof reason === "string" && reason.trim() !== "" ? normaliseLineBreaks(reason.trim()) : null;
}
