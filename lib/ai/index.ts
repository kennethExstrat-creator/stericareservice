import "server-only";

// Public API of the AI layer (BUILD_SPEC 9). Server only: it reads keys and calls providers.
export { requestAiReview, REVIEW_WEBHOOK_TIMEOUT_MS, type RequestAiReviewOptions } from "./review";
export { requestAiReport, REPORT_WEBHOOK_TIMEOUT_MS, AiReportResponseSchema, type RequestAiReportOptions } from "./report";
export {
  getAiStatus,
  AI_REVIEW_NOT_CONNECTED,
  AI_REPORT_NOT_CONNECTED,
  type AiStatus,
  type AiReviewStatus,
  type AiReportStatus,
} from "./status";
export {
  readAiConfig,
  DEFAULT_REVIEW_MODEL,
  DEFAULT_REVIEW_EFFORT,
  DEFAULT_REVIEW_MAX_PHOTOS,
  type AiConfig,
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
