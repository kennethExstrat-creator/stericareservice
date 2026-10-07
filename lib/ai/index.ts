import "server-only";

// Public API of the AI layer (BUILD_SPEC 9). Server only: it reads keys and calls providers.
// The resolved configuration (readAiConfig in ./config) holds the API key and the webhook
// secret, so it stays inside lib/ai: getAiStatus() is the view the UI gets.
export { requestAiReview, REVIEW_WEBHOOK_TIMEOUT_MS, type RequestAiReviewOptions } from "./review";
export { requestAiReport, REPORT_WEBHOOK_TIMEOUT_MS, type RequestAiReportOptions } from "./report";
/** Defined in lib/schemas (safe on the client); re-exported here for existing imports. */
export { AiReportResponseSchema, type AiReportResponse } from "@/lib/schemas";
export {
  getAiStatus,
  reviewNotConnectedMessage,
  reportNotConnectedMessage,
  AI_REVIEW_NOT_CONNECTED,
  AI_REPORT_NOT_CONNECTED,
  AI_REVIEW_NOT_CONNECTED_LABEL,
  AI_REPORT_NOT_CONNECTED_LABEL,
  type AiStatus,
  type AiReviewStatus,
  type AiReportStatus,
} from "./status";
export {
  DEFAULT_REVIEW_MODEL,
  DEFAULT_REVIEW_EFFORT,
  DEFAULT_REVIEW_MAX_PHOTOS,
  type AiEnv,
  type AiReviewEffort,
} from "./config";
export {
  verifySignature,
  signWebhookBody,
  WEBHOOK_HEADERS,
  SIGNATURE_TOLERANCE_SECONDS,
  type SignatureCheck,
  type WebhookEvent,
} from "./webhook";
export { mockReview } from "./providers/mock";
export type { ClaudeClientFactory, ClaudeReviewClient } from "./providers/claude";
export type {
  AiReviewOutcome,
  AiReviewSuccess,
  AiReviewFailure,
  AiReviewFailureReason,
  AiReviewProvider,
  AiReportOutcome,
  AiReportFailureReason,
  AiUsage,
} from "./types";
