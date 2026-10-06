import "server-only";
import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import type {
  BetaRefusalStopDetails,
  BetaStopReason,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { InspectionExport } from "@/lib/schemas";
import type { ClaudeSettings } from "../config";
import type { AiReviewFailure, AiReviewOutcome, AiUsage } from "../types";
import { parseAiReviewText } from "./claude-format";
import { buildReviewRequest, CLAUDE_MAX_TOKENS, selectReviewPhotos, type ClaudeReviewParams } from "./claude-request";

/* ------------------------------------------------------------------ *
 * AI second opinion on Claude (Messages API, beta namespace for the
 * server-side refusal fallbacks). Never throws for expected failures.
 *
 * The request is streamed: a review can think for many minutes, and a
 * stream carries the answer as it is written instead of one response at
 * the very end. The SDK does not retry (maxRetries 0), because it would
 * rerun a timed-out review from the start. This module retries only
 * failures that come back before Claude writes anything (429, 5xx, a
 * connection that never opened), so a review is never paid for twice.
 * ------------------------------------------------------------------ */

/**
 * Time for the whole review, retries included. The SDK budgets an hour per
 * 128K output tokens: 7.5 minutes for 16K, 30 for 64K. Never under 10 minutes.
 */
export function claudeTimeoutMs(maxTokens: number): number {
  return Math.max(10 * 60_000, Math.ceil((maxTokens * 60 * 60_000) / 128_000));
}

/** Retries after a 429, a 5xx or a connection that failed before the stream opened. */
export const CLAUDE_MAX_RETRIES = 2;
/** Longest wait for a retry. A longer retry-after is reported instead of waited out. */
export const CLAUDE_MAX_RETRY_WAIT_MS = 60_000;

/** The part of the final (streamed) beta message this provider reads. */
export interface ClaudeReviewMessage {
  model: string;
  stop_reason: BetaStopReason | null;
  stop_details: Pick<BetaRefusalStopDetails, "category" | "explanation"> | null;
  usage: Pick<BetaUsage, "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens">;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** The slice of the Anthropic client this provider uses, so tests can pass a fake. */
export interface ClaudeReviewClient {
  beta: {
    messages: {
      stream(
        params: ClaudeReviewParams,
        options?: Anthropic.RequestOptions,
      ): { finalMessage(): PromiseLike<ClaudeReviewMessage> };
    };
  };
}

export interface ClaudeClientOptions {
  apiKey: string;
  /** The SDK's per-attempt limit. On a stream it covers the wait until the stream opens. */
  timeout: number;
  maxRetries: number;
}

export type ClaudeClientFactory = (options: ClaudeClientOptions) => ClaudeReviewClient;

/** Built per review, so importing this module needs no API key. */
export const createAnthropicClient: ClaudeClientFactory = (options) => new Anthropic(options);

export interface ClaudeReviewOptions {
  createClient?: ClaudeClientFactory;
  /** The whole review, retries included. Defaults to claudeTimeoutMs for the effort's max_tokens. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Waits before a retry. Tests pass a fake. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

interface Deadline {
  /** Fires when the review's own time is up. */
  signal: AbortSignal;
  timeoutMs: number;
  startedAt: number;
}

export async function reviewWithClaude(
  doc: InspectionExport,
  settings: ClaudeSettings,
  options: ClaudeReviewOptions = {},
): Promise<AiReviewOutcome> {
  const maxTokens = CLAUDE_MAX_TOKENS[settings.effort];
  const timeoutMs = options.timeoutMs ?? claudeTimeoutMs(maxTokens);
  const deadline: Deadline = { signal: AbortSignal.timeout(timeoutMs), timeoutMs, startedAt: Date.now() };
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  const wait = options.wait ?? sleep;

  const createClient = options.createClient ?? createAnthropicClient;
  const client = createClient({ apiKey: settings.apiKey, timeout: timeoutMs, maxRetries: 0 });

  const send = async (params: ClaudeReviewParams): Promise<ClaudeReviewMessage> => {
    for (let retry = 0; ; retry++) {
      try {
        return await client.beta.messages.stream(params, { signal }).finalMessage();
      } catch (error) {
        const delay = retry < CLAUDE_MAX_RETRIES ? retryDelayMs(error, retry) : null;
        if (delay === null || !fitsBeforeDeadline(delay, deadline)) throw error;
        await wait(delay, signal);
      }
    }
  };

  const photos = selectReviewPhotos(doc.photos, settings.maxPhotos);
  try {
    let message: ClaudeReviewMessage;
    try {
      message = await send(buildReviewRequest(doc, settings, photos));
    } catch (error) {
      // A photo link the API cannot fetch (expired, unsupported format) fails the whole
      // request with a 400. A review without photos is still worth having.
      if (!(error instanceof Anthropic.BadRequestError) || photos.length === 0) throw error;
      message = await send(buildReviewRequest(doc, settings, []));
    }
    return toOutcome(message, maxTokens);
  } catch (error) {
    return describeError(error, deadline, options.signal);
  }
}

/**
 * How long to wait before trying again, or null when the failure is final.
 * Retried: 429 and 5xx answers (unless x-should-retry says no) and
 * connections that failed before a response. Never retried: a timeout, or
 * an error after the stream opened, when Claude may already be writing.
 */
export function retryDelayMs(error: unknown, retry: number): number | null {
  const backoff = Math.min(1_000 * 2 ** retry, 8_000);
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) return null;
  if (error instanceof Anthropic.APIConnectionError) return backoff;
  if (!(error instanceof Anthropic.APIError) || error.status === undefined) return null;
  const shouldRetry = error.headers?.get("x-should-retry");
  if (shouldRetry === "false") return null;
  if (shouldRetry !== "true" && error.status !== 429 && error.status < 500) return null;
  return retryAfterMs(error.headers) ?? backoff;
}

/** retry-after-ms, or retry-after in seconds or as an HTTP date; null when absent or not in the future. */
function retryAfterMs(headers: Headers | undefined): number | null {
  const millis = Number.parseFloat(headers?.get("retry-after-ms") ?? "");
  if (millis > 0) return millis;
  const value = headers?.get("retry-after");
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  const delay = Number.isNaN(seconds) ? Date.parse(value) - Date.now() : seconds * 1_000;
  return delay > 0 ? delay : null;
}

function fitsBeforeDeadline(delay: number, deadline: Deadline): boolean {
  return delay <= CLAUDE_MAX_RETRY_WAIT_MS && Date.now() - deadline.startedAt + delay < deadline.timeoutMs;
}

/** Resolves after ms; rejects like a cancelled request when the signal fires first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Anthropic.APIUserAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Anthropic.APIUserAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function toOutcome(message: ClaudeReviewMessage, maxTokens: number): AiReviewOutcome {
  // stop_reason first: a refusal or a cut-off answer has no usable content.
  switch (message.stop_reason) {
    case "refusal":
      return failure("refused", refusalMessage(message.stop_details));
    case "max_tokens":
      return failure(
        "invalid_response",
        `Claude's answer was cut off at the ${maxTokens.toLocaleString("en")}-token limit, ` +
          "which covers its thinking too. Lower AI_REVIEW_EFFORT and try again.",
      );
    case "model_context_window_exceeded":
      return failure("error", "The inspection export is too large for the model's context window.");
  }

  // The last text block: when a fallback model took over mid-stream, the declined model's partial text comes first.
  const text = message.content.findLast((block) => block.type === "text")?.text;
  const parsed = text === undefined ? null : parseAiReviewText(text);
  if (!parsed?.review) {
    const problem = parsed?.problem ?? "no answer text";
    return failure("invalid_response", `Claude's answer did not match the review format (${problem}).`);
  }
  return { ok: true, review: parsed.review, provider: "claude", model: message.model, usage: usageOf(message.usage) };
}

function refusalMessage(details: ClaudeReviewMessage["stop_details"]): string {
  const category = details?.category ? ` (${details.category.replaceAll("_", " ")})` : "";
  const explanation = details?.explanation ? ` ${details.explanation}` : "";
  return `Claude declined to review this inspection${category}, and no fallback model completed it.${explanation}`;
}

function usageOf(usage: ClaudeReviewMessage["usage"]): AiUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Typed SDK errors, most specific first. Anything else is a bug and is rethrown. */
function describeError(error: unknown, deadline: Deadline, callerSignal?: AbortSignal): AiReviewFailure {
  const timedOut =
    error instanceof Anthropic.APIConnectionTimeoutError ||
    (error instanceof Anthropic.APIUserAbortError && deadline.signal.aborted);
  if (timedOut) {
    return failure(
      "timeout",
      `Claude did not finish the review within ${formatDuration(deadline.timeoutMs)}. Try again, or lower AI_REVIEW_EFFORT.`,
    );
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return isTimeoutReason(callerSignal?.reason)
      ? failure("timeout", "The AI review ran out of time.")
      : failure("error", "The AI review was cancelled.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return failure("error", "Could not reach the Claude API.");
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return failure("misconfigured", `ANTHROPIC_API_KEY was rejected${requestRef(error)}.`);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return failure("misconfigured", `The API key may not use this model${requestRef(error)}.`);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return failure("misconfigured", `Model not found: check AI_REVIEW_MODEL${requestRef(error)}.`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return failure("error", `Claude's rate limit was reached; try again in a few minutes${requestRef(error)}.`);
  }
  if (error instanceof Anthropic.BadRequestError) {
    const detail = apiMessage(error);
    return failure("error", `Claude rejected the request${requestRef(error)}${detail ? `: ${detail}` : "."}`);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return failure("error", `Claude is temporarily unavailable (HTTP ${error.status})${requestRef(error)}.`);
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === undefined) {
      // An error event inside the stream: Claude had started, so it is not retried.
      const details = [error.type?.replaceAll("_", " "), error.requestID && `request ${error.requestID}`].filter(Boolean);
      const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
      return failure("error", `Claude broke off the review with an error${suffix}. Try again.`);
    }
    return failure("error", `The Claude API answered HTTP ${error.status}${requestRef(error)}.`);
  }
  if (error instanceof Anthropic.AnthropicError) {
    // The SDK could not read the stream: it ended early or arrived out of order.
    return failure("invalid_response", "Claude's answer broke off or could not be read.");
  }
  throw error;
}

function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "TimeoutError";
}

/** "10 minutes", "45 seconds", "300 ms". */
function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 120_000) return `${Math.round(ms / 1_000)} seconds`;
  return `${Math.round(ms / 60_000)} minutes`;
}

function requestRef(error: APIError): string {
  return error.requestID ? ` (request ${error.requestID})` : "";
}

/** The API's own explanation, from a body shaped { error: { message } }. */
function apiMessage(error: APIError): string | null {
  const body: unknown = error.error;
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const inner: unknown = body.error;
  if (typeof inner !== "object" || inner === null || !("message" in inner)) return null;
  return typeof inner.message === "string" ? inner.message : null;
}

function failure(reason: AiReviewFailure["reason"], message: string): AiReviewFailure {
  return { ok: false, reason, message, provider: "claude" };
}
