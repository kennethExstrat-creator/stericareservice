import "server-only";
import { readAiConfig, type AiEnv, type ReportTarget, type ReviewTarget } from "./config";

/* ------------------------------------------------------------------ *
 * What the UI may know about the AI hand-offs. No URLs, keys or secrets:
 * this object can be passed to client components.
 * ------------------------------------------------------------------ */

export const AI_REVIEW_NOT_CONNECTED = "AI second opinion not connected";
export const AI_REPORT_NOT_CONNECTED = "AI not connected";

export interface AiReviewStatus {
  connected: boolean;
  provider: ReviewTarget["provider"];
  /** The Claude model, when the review runs on Claude. */
  model?: string;
  label: string;
  /** Why a hand-off is misconfigured, naming the variable to fix. */
  detail?: string;
}

export interface AiReportStatus {
  connected: boolean;
  provider: ReportTarget["provider"];
  label: string;
  detail?: string;
}

export interface AiStatus {
  review: AiReviewStatus;
  report: AiReportStatus;
}

export function getAiStatus(env: AiEnv = process.env): AiStatus {
  const config = readAiConfig(env);
  return { review: reviewStatus(config.review), report: reportStatus(config.report) };
}

function reviewStatus(target: ReviewTarget): AiReviewStatus {
  switch (target.provider) {
    case "webhook":
      return { connected: true, provider: "webhook", label: "AI second opinion connected (webhook)" };
    case "claude":
      return {
        connected: true,
        provider: "claude",
        model: target.claude.model,
        label: `AI second opinion connected (Claude, ${target.claude.model})`,
      };
    case "mock":
      return { connected: true, provider: "mock", label: "AI second opinion: mock reviewer (test data only)" };
    case "off":
      return { connected: false, provider: "off", label: AI_REVIEW_NOT_CONNECTED };
    case "misconfigured":
      return {
        connected: false,
        provider: "misconfigured",
        label: `${AI_REVIEW_NOT_CONNECTED}: configuration error`,
        detail: target.problems.join(" "),
      };
  }
}

function reportStatus(target: ReportTarget): AiReportStatus {
  switch (target.provider) {
    case "webhook":
      return { connected: true, provider: "webhook", label: "AI report connected (webhook)" };
    case "off":
      return { connected: false, provider: "off", label: AI_REPORT_NOT_CONNECTED };
    case "misconfigured":
      return {
        connected: false,
        provider: "misconfigured",
        label: `${AI_REPORT_NOT_CONNECTED}: configuration error`,
        detail: target.problems.join(" "),
      };
  }
}
