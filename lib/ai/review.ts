import "server-only";
import { AiReviewSchema, ExportSchema, type InspectionExport } from "@/lib/schemas";
import { readAiConfig, type AiEnv, type WebhookTarget } from "./config";
import { summarizeIssues } from "./issues";
import { reviewWithClaude, type ClaudeClientFactory } from "./providers/claude";
import { mockReview } from "./providers/mock";
import { AI_REVIEW_NOT_CONNECTED } from "./status";
import type { AiReviewOutcome } from "./types";
import { handoffFailureReason, postWebhook } from "./webhook";

/* ------------------------------------------------------------------ *
 * AI second opinion (BUILD_SPEC 9.2). Suggests only: nothing here
 * changes an inspection. The caller stores the outcome in ai_reviews.
 * ------------------------------------------------------------------ */

export const REVIEW_WEBHOOK_TIMEOUT_MS = 90_000;

export interface RequestAiReviewOptions {
  /** Defaults to process.env. */
  env?: AiEnv;
  /** Overrides the provider's timeout (webhook 90 s, Claude 300 s per attempt). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Webhook transport; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Claude client; defaults to the Anthropic SDK. */
  createClaudeClient?: ClaudeClientFactory;
}

/** Never throws: every failure comes back as { ok: false, reason, message }. */
export async function requestAiReview(
  exportDoc: InspectionExport,
  options: RequestAiReviewOptions = {},
): Promise<AiReviewOutcome> {
  try {
    return await dispatch(exportDoc, options);
  } catch (error) {
    console.error("[ai] Unexpected error while requesting an AI review", error);
    return { ok: false, reason: "error", message: "Unexpected error while requesting the AI review." };
  }
}

async function dispatch(exportDoc: InspectionExport, options: RequestAiReviewOptions): Promise<AiReviewOutcome> {
  const target = readAiConfig(options.env).review;
  if (target.provider === "off") {
    return { ok: false, reason: "not_connected", message: `${AI_REVIEW_NOT_CONNECTED}.` };
  }
  if (target.provider === "misconfigured") {
    return { ok: false, reason: "misconfigured", message: target.problems.join(" ") };
  }

  // Receivers and the model rely on the contract, so a malformed export is never sent.
  const parsed = ExportSchema.safeParse(exportDoc);
  if (!parsed.success) {
    return { ok: false, reason: "error", message: `The inspection export is invalid (${summarizeIssues(parsed.error)}).` };
  }
  const doc = parsed.data;

  switch (target.provider) {
    case "mock":
      return { ok: true, review: mockReview(doc), provider: "mock", model: null };
    case "webhook":
      return reviewViaWebhook(doc, target.webhook, options);
    case "claude":
      return reviewWithClaude(doc, target.claude, {
        createClient: options.createClaudeClient,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
  }
}

async function reviewViaWebhook(
  doc: InspectionExport,
  webhook: WebhookTarget,
  options: RequestAiReviewOptions,
): Promise<AiReviewOutcome> {
  const result = await postWebhook({
    url: webhook.url,
    secret: webhook.secret,
    event: "ai.review.requested",
    payload: doc,
    responseSchema: AiReviewSchema,
    timeoutMs: options.timeoutMs ?? REVIEW_WEBHOOK_TIMEOUT_MS,
    fetch: options.fetch,
    signal: options.signal,
  });
  if (!result.ok) {
    return { ok: false, reason: handoffFailureReason(result.reason), message: result.message, provider: "webhook" };
  }
  return { ok: true, review: result.data, provider: "webhook", model: null };
}
