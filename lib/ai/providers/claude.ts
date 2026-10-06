import "server-only";
import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import type {
  BetaRefusalStopDetails,
  BetaStopReason,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AiReviewSchema, type AiReview, type InspectionExport } from "@/lib/schemas";
import type { ClaudeSettings } from "../config";
import type { AiReviewFailure, AiReviewOutcome, AiUsage } from "../types";
import { parseAiReviewText } from "./claude-format";
import { buildReviewRequest, CLAUDE_MAX_TOKENS, selectReviewPhotos, type ClaudeReviewParams } from "./claude-request";

/* ------------------------------------------------------------------ *
 * AI second opinion on Claude (Messages API, beta namespace for the
 * server-side refusal fallbacks). Never throws for expected failures.
 * ------------------------------------------------------------------ */

/** Per attempt. A high-effort review usually finishes well inside this. */
export const CLAUDE_TIMEOUT_MS = 300_000;
/** One retry for 429, 5xx and dropped connections; the SDK honours retry-after. */
export const CLAUDE_MAX_RETRIES = 1;

/** The part of a parsed beta message this provider reads. */
export interface ClaudeReviewMessage {
  model: string;
  stop_reason: BetaStopReason | null;
  stop_details: Pick<BetaRefusalStopDetails, "category" | "explanation"> | null;
  usage: Pick<BetaUsage, "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens">;
  content: ReadonlyArray<{ type: string; text?: string }>;
  parsed_output: AiReview | null;
}

/** The slice of the Anthropic client this provider uses, so tests can pass a fake. */
export interface ClaudeReviewClient {
  beta: {
    messages: {
      parse(params: ClaudeReviewParams, options?: Anthropic.RequestOptions): PromiseLike<ClaudeReviewMessage>;
    };
  };
}

export interface ClaudeClientOptions {
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

export type ClaudeClientFactory = (options: ClaudeClientOptions) => ClaudeReviewClient;

/** Built per review, so importing this module needs no API key. */
export const createAnthropicClient: ClaudeClientFactory = (options) => new Anthropic(options);

export interface ClaudeReviewOptions {
  createClient?: ClaudeClientFactory;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function reviewWithClaude(
  doc: InspectionExport,
  settings: ClaudeSettings,
  options: ClaudeReviewOptions = {},
): Promise<AiReviewOutcome> {
  const createClient = options.createClient ?? createAnthropicClient;
  const client = createClient({
    apiKey: settings.apiKey,
    timeout: options.timeoutMs ?? CLAUDE_TIMEOUT_MS,
    maxRetries: CLAUDE_MAX_RETRIES,
  });
  const send = (params: ClaudeReviewParams) => client.beta.messages.parse(params, { signal: options.signal });
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
    return toOutcome(message);
  } catch (error) {
    return describeError(error, options.signal);
  }
}

function toOutcome(message: ClaudeReviewMessage): AiReviewOutcome {
  // stop_reason first: a refusal or a cut-off answer has no usable content.
  switch (message.stop_reason) {
    case "refusal":
      return failure("refused", refusalMessage(message.stop_details));
    case "max_tokens":
      return failure(
        "invalid_response",
        `Claude's answer was cut off at the ${CLAUDE_MAX_TOKENS.toLocaleString("en")}-token limit, ` +
          "which covers its thinking too. Lower AI_REVIEW_EFFORT and try again.",
      );
    case "model_context_window_exceeded":
      return failure("error", "The inspection export is too large for the model's context window.");
  }

  const parsed = AiReviewSchema.safeParse(message.parsed_output);
  if (message.parsed_output === null || !parsed.success) {
    return failure("invalid_response", `Claude's answer did not match the review format (${unreadableReason(message)}).`);
  }
  return { ok: true, review: parsed.data, provider: "claude", model: message.model, usage: usageOf(message.usage) };
}

function refusalMessage(details: ClaudeReviewMessage["stop_details"]): string {
  const category = details?.category ? ` (${details.category.replaceAll("_", " ")})` : "";
  const explanation = details?.explanation ? ` ${details.explanation}` : "";
  return `Claude declined to review this inspection${category}, and no fallback model completed it.${explanation}`;
}

function unreadableReason(message: ClaudeReviewMessage): string {
  const text = message.content.findLast((block) => block.type === "text")?.text;
  if (text === undefined) return "no answer text";
  return parseAiReviewText(text).problem ?? "unexpected structure";
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
function describeError(error: unknown, signal?: AbortSignal): AiReviewFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return failure("timeout", "Claude did not answer in time. Try again, or lower AI_REVIEW_EFFORT.");
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return signal?.reason instanceof DOMException && signal.reason.name === "TimeoutError"
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
    return failure("error", `The Claude API answered HTTP ${error.status ?? "without a status"}${requestRef(error)}.`);
  }
  if (error instanceof Anthropic.AnthropicError) {
    return failure("invalid_response", "Claude's answer could not be read.");
  }
  throw error;
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
