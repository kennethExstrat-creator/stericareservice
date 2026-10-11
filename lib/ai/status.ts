import "server-only";
import { readAiConfig, type AiEnv, type ReportTarget, type ReviewTarget } from "./config";

/* ------------------------------------------------------------------ *
 * What the UI may know about the AI hand-offs. No URLs, keys or secrets:
 * this object can be passed to client components.
 * ------------------------------------------------------------------ */

/** The not-connected states as a sentence starts them: "AI not connected." (the hand-offs' messages). */
export const AI_REVIEW_NOT_CONNECTED = "Steri-AI second opinion not connected";
export const AI_REPORT_NOT_CONNECTED = "Steri-AI not connected";

/**
 * The same states as labels (Title Case, docs/DESIGN.md Capitalisation): the
 * AI panel's title for the second opinion and the AI Report's pill.
 */
export const AI_REVIEW_NOT_CONNECTED_LABEL = "Steri-AI Second Opinion Not Connected";
export const AI_REPORT_NOT_CONNECTED_LABEL = "Steri-AI Not Connected";
const CONFIGURATION_ERROR_LABEL = "Configuration Error";

export interface AiReviewStatus {
  connected: boolean;
  provider: ReviewTarget["provider"];
  /** The Claude model, when the review runs on Claude. */
  model?: string;
  label: string;
  /** Why a hand-off is misconfigured, naming the variable to fix. */
  detail?: string;
  /**
   * Not connected because AI_REVIEW_PROVIDER is off on purpose, set up or
   * not; absent when nothing is set up, so the hint can say which to change.
   */
  switchedOff?: true;
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
      return { connected: true, provider: "webhook", label: "Steri-AI Second Opinion Connected (Webhook)" };
    case "claude":
      return {
        connected: true,
        provider: "claude",
        model: target.claude.model,
        label: `Steri-AI Second Opinion Connected (Claude, ${target.claude.model})`,
      };
    case "mock":
      return { connected: true, provider: "mock", label: "Steri-AI Second Opinion: Mock Reviewer (Test Data Only)" };
    case "off":
      return {
        connected: false,
        provider: "off",
        label: AI_REVIEW_NOT_CONNECTED_LABEL,
        ...(target.switchedOff ? { switchedOff: true as const } : {}),
      };
    case "misconfigured":
      return {
        connected: false,
        provider: "misconfigured",
        label: `${AI_REVIEW_NOT_CONNECTED_LABEL}: ${CONFIGURATION_ERROR_LABEL}`,
        detail: target.problems.join(" "),
      };
  }
}

function reportStatus(target: ReportTarget): AiReportStatus {
  switch (target.provider) {
    case "webhook":
      return { connected: true, provider: "webhook", label: "Steri-AI Report Connected (Webhook)" };
    case "off":
      return { connected: false, provider: "off", label: AI_REPORT_NOT_CONNECTED_LABEL };
    case "misconfigured":
      return {
        connected: false,
        provider: "misconfigured",
        label: `${AI_REPORT_NOT_CONNECTED_LABEL}: ${CONFIGURATION_ERROR_LABEL}`,
        detail: target.problems.join(" "),
      };
  }
}

/**
 * Why a hand-off that is not connected cannot run, as a message: a sentence
 * ("AI not connected.", or "AI not connected: configuration error. <what to
 * fix>"), where the status's label is the Title Case pill or title.
 */
export function reviewNotConnectedMessage(status: AiReviewStatus): string {
  return notConnectedMessage(AI_REVIEW_NOT_CONNECTED, status);
}

export function reportNotConnectedMessage(status: AiReportStatus): string {
  return notConnectedMessage(AI_REPORT_NOT_CONNECTED, status);
}

function notConnectedMessage(words: string, status: AiReviewStatus | AiReportStatus): string {
  const head = status.provider === "misconfigured" ? `${words}: configuration error` : words;
  return status.detail ? `${head}. ${status.detail}` : `${head}.`;
}
