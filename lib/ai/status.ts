import "server-only";
import { readAiConfig, type AiEnv, type ReviewTarget } from "./config";

/* ------------------------------------------------------------------ *
 * What the UI may know about the AI second opinion's hand-off. No URLs,
 * keys or secrets: this object can be passed to client components.
 * ------------------------------------------------------------------ */

/** The not-connected state as a sentence starts it: "Steri-AI second opinion not connected." (its messages). */
export const AI_REVIEW_NOT_CONNECTED = "Steri-AI second opinion not connected";

/** The same state as a label (Title Case, docs/DESIGN.md Capitalisation): the AI panel's title for it. */
export const AI_REVIEW_NOT_CONNECTED_LABEL = "Steri-AI Second Opinion Not Connected";
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

export interface AiStatus {
  review: AiReviewStatus;
}

export function getAiStatus(env: AiEnv = process.env): AiStatus {
  const config = readAiConfig(env);
  return { review: reviewStatus(config.review) };
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

/**
 * Why the second opinion cannot run while not connected, as a message: a
 * sentence ("Steri-AI second opinion not connected.", or "…: configuration
 * error. <what to fix>"), where the status's label is the Title Case title.
 */
export function reviewNotConnectedMessage(status: AiReviewStatus): string {
  return notConnectedMessage(AI_REVIEW_NOT_CONNECTED, status);
}

function notConnectedMessage(words: string, status: AiReviewStatus): string {
  const head = status.provider === "misconfigured" ? `${words}: configuration error` : words;
  return status.detail ? `${head}. ${status.detail}` : `${head}.`;
}
