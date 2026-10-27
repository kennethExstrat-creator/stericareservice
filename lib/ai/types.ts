import type { AiReview } from "@/lib/schemas";

export type AiReviewProvider = "webhook" | "claude" | "mock";

export type AiReviewFailureReason =
  | "not_connected"
  | "misconfigured"
  | "refused"
  | "invalid_response"
  | "timeout"
  | "error";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface AiReviewSuccess {
  ok: true;
  review: AiReview;
  provider: AiReviewProvider;
  /** The model that wrote the review (a fallback model if Claude's fallback served it); null for webhooks. */
  model: string | null;
  usage?: AiUsage;
}

export interface AiReviewFailure {
  ok: false;
  reason: AiReviewFailureReason;
  /** Safe to show to an admin: no keys, URLs or raw provider bodies. */
  message: string;
  provider?: AiReviewProvider;
}

export type AiReviewOutcome = AiReviewSuccess | AiReviewFailure;
