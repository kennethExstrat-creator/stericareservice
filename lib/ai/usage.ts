import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { BATCH_MULTIPLIER, priceFor, US_INFERENCE_MULTIPLIER, type AiPriceList } from "@/lib/schemas/ai-prices";
import type { AiUsageFeature, AiUsageOutcome } from "@/lib/schemas/ai-usage";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { loadAiPrices } from "./settings";

/*
 * What each Claude call cost (docs/AI.md, "Steri-AI Cost"). Every call the
 * app makes to Claude reports itself (OnAiCall: the readers through
 * createMessage, the second opinion from reviewWithClaude) with the tokens
 * Anthropic billed, and is recorded here as one ai_usage row (migration
 * 20261013120000), priced with the list in force at that moment, so editing
 * the prices never rewrites the past. Recording never blocks or fails the
 * user's action: server actions record after the response
 * (recordAiUsageLater), and nothing here throws.
 */

/** The tokens of one billed attempt, at the model that answered it. */
export type AiAttemptTokens = {
  model: string;
  /** Uncached input: the tokens after the last cache breakpoint. */
  input: number;
  /** Thinking included. */
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

/** One call as it ended. */
export type AiCall = {
  /** message.model, else the model asked for. */
  model: string;
  outcome: AiUsageOutcome;
  /** Why no answer came back; null with an answer. */
  errorType: string | null;
  durationMs: number;
  /** Empty when no answer came back. */
  attempts: AiAttemptTokens[];
  inferenceGeo: string | null;
  serviceTier: string | null;
};

/** Who the call was for and what it did, from the server action that made it. */
export type AiUsageContext = {
  feature: AiUsageFeature;
  /** Null before the inspection exists (New Inspection). */
  inspectionId: string | null;
  actorId: string | null;
  /** Documents read (1), photos and videos sent to Auto-Sort, or reviews (1). */
  itemCount: number;
};

export type OnAiCall = (call: AiCall) => void;

type IterationUsage = {
  type: string;
  model?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
};

/** The part of a Messages API answer that says what it cost (BetaMessage and the review's ClaudeReviewMessage fit). */
export type MessageUsageLike = {
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
    iterations?: ReadonlyArray<IterationUsage> | null;
    inference_geo?: string | null;
    service_tier?: string | null;
  };
};

/** Iterations Anthropic bills as a model's attempt at the answer (a fallback model's included). */
const BILLED_ITERATIONS = new Set(["message", "fallback_message"]);

/** A token count as stored: a whole number from 0. */
function tokens(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function attemptOf(
  model: string,
  usage: Pick<MessageUsageLike["usage"], "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens" | "cache_creation">,
): AiAttemptTokens {
  const cacheWrite1h = tokens(usage.cache_creation?.ephemeral_1h_input_tokens);
  const cacheWrite5m = usage.cache_creation
    ? tokens(usage.cache_creation.ephemeral_5m_input_tokens)
    : Math.max(0, tokens(usage.cache_creation_input_tokens) - cacheWrite1h);
  return {
    model,
    input: tokens(usage.input_tokens),
    output: tokens(usage.output_tokens),
    cacheWrite5m,
    cacheWrite1h,
    cacheRead: tokens(usage.cache_read_input_tokens),
  };
}

function outcomeOf(stopReason: string | null): AiUsageOutcome {
  if (stopReason === "refusal") return "refused";
  if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") return "cut_off";
  return "ok";
}

function durationOf(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}

/**
 * A call that came back with an answer, whatever its stop reason: refused and
 * cut-off answers are billed too. With a server-side fallback, the top-level
 * counts describe only the attempt that produced the answer, so each billed
 * attempt is taken from usage.iterations, at its own model.
 */
export function callFromMessage(message: MessageUsageLike, startedAt: number, endedAt: number = Date.now()): AiCall {
  const { usage } = message;
  const billed = (usage.iterations ?? []).filter((entry) => BILLED_ITERATIONS.has(entry.type));
  const attempts =
    billed.length > 0
      ? billed.map((entry) => attemptOf(entry.model ?? message.model, entry))
      : [attemptOf(message.model, usage)];
  return {
    model: message.model,
    outcome: outcomeOf(message.stop_reason),
    errorType: null,
    durationMs: durationOf(startedAt, endedAt),
    attempts,
    inferenceGeo: usage.inference_geo ?? null,
    serviceTier: usage.service_tier ?? null,
  };
}

/** Tells `onCall` about a call; whatever goes wrong there is logged, never thrown, so the call's own outcome stands. */
export function reportAiCall(onCall: OnAiCall | undefined, call: () => AiCall): void {
  if (!onCall) return;
  try {
    onCall(call());
  } catch (error) {
    console.error("[ai usage] could not report a call", error);
  }
}

/** The error type in an Anthropic error body: { type: "error", error: { type: "rate_limit_error", … } }. */
function bodyErrorType(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const inner: unknown = body.error;
  if (typeof inner !== "object" || inner === null || !("type" in inner)) return null;
  return typeof inner.type === "string" && inner.type ? inner.type : null;
}

function errorTypeOf(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.APIUserAbortError) return "aborted";
  if (error instanceof Anthropic.APIConnectionError) return "connection";
  if (error instanceof Anthropic.APIError) {
    const type = error.type ?? bodyErrorType(error.error);
    if (type) return type;
    return error.status === undefined ? "unknown" : `http_${error.status}`;
  }
  return "unknown";
}

/** A call that ended without an answer: nothing billed that the app can see. */
export function callFromError(error: unknown, model: string, startedAt: number, endedAt: number = Date.now()): AiCall {
  return {
    model,
    outcome: "failed",
    errorType: errorTypeOf(error).slice(0, 60),
    durationMs: durationOf(startedAt, endedAt),
    attempts: [],
    inferenceGeo: null,
    serviceTier: null,
  };
}

/**
 * USD for the call at these prices: each attempt's tokens at its model's
 * rates (the long-prompt rates for a prompt over their threshold, cache
 * writes and reads at their own rates), then x1.1 for US-only inference and
 * x0.5 for the Batch API. Six decimals. Null when an attempt's model has no
 * price; 0 for a call with no attempts.
 */
export function costOfCall(call: Pick<AiCall, "attempts" | "inferenceGeo" | "serviceTier">, prices: AiPriceList): number | null {
  let cost = 0;
  for (const attempt of call.attempts) {
    const prompt = attempt.input + attempt.cacheWrite5m + attempt.cacheWrite1h + attempt.cacheRead;
    const rates = priceFor(prices, attempt.model, prompt);
    if (!rates) return null;
    cost +=
      (attempt.input * rates.input +
        attempt.cacheWrite5m * rates.cacheWrite5m +
        attempt.cacheWrite1h * rates.cacheWrite1h +
        attempt.cacheRead * rates.cacheRead +
        attempt.output * rates.output) /
      1_000_000;
  }
  if (call.inferenceGeo === "us") cost *= US_INFERENCE_MULTIPLIER;
  if (call.serviceTier === "batch") cost *= BATCH_MULTIPLIER;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

const INT_MAX = 2_147_483_647;
/** Postgres foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = "23503";

function usageRow(context: AiUsageContext, call: AiCall, costUsd: number | null): TablesInsert<"ai_usage"> {
  const total = (pick: (attempt: AiAttemptTokens) => number) =>
    Math.min(INT_MAX, call.attempts.reduce((sum, attempt) => sum + pick(attempt), 0));
  return {
    feature: context.feature,
    model: call.model.trim(),
    inspection_id: context.inspectionId,
    actor_id: context.actorId,
    item_count: Math.min(1000, Math.max(0, Math.round(context.itemCount))),
    input_tokens: total((attempt) => attempt.input),
    output_tokens: total((attempt) => attempt.output),
    cache_write_5m_tokens: total((attempt) => attempt.cacheWrite5m),
    cache_write_1h_tokens: total((attempt) => attempt.cacheWrite1h),
    cache_read_tokens: total((attempt) => attempt.cacheRead),
    duration_ms: Math.min(INT_MAX, durationOf(0, call.durationMs)),
    outcome: call.outcome,
    error_type: call.errorType?.slice(0, 60) ?? null,
    cost_usd: costUsd,
  };
}

/** The row without the link a foreign key refused (both when the error does not say which). */
function withoutGoneLink(row: TablesInsert<"ai_usage">, message: string): TablesInsert<"ai_usage"> {
  const actor = message.includes("actor_id");
  const inspection = message.includes("inspection_id");
  return {
    ...row,
    ...(inspection || !actor ? { inspection_id: null } : {}),
    ...(actor || !inspection ? { actor_id: null } : {}),
  };
}

/**
 * Stores one call: its tokens, summed over its attempts, and its cost at the
 * price list in force now. Written with the secret key, once the server
 * action has checked the caller was allowed to make the call. Without
 * SUPABASE_SECRET_KEY nothing is recorded. When the inspection or the person
 * was deleted meanwhile (23503), the row goes in without that link, so the
 * spend stays counted. Never throws: a failure is logged and dropped.
 */
export async function recordAiUsage(context: AiUsageContext, call: AiCall): Promise<void> {
  try {
    if (!isAdminClientConfigured()) return;
    const prices = await loadAiPrices();
    let row = usageRow(context, call, costOfCall(call, prices));
    const db = createAdminClient();
    for (let attempt = 0; ; attempt++) {
      const { error } = await db.from("ai_usage").insert(row);
      if (!error) return;
      if (error.code === FOREIGN_KEY_VIOLATION && attempt < 2 && (row.inspection_id || row.actor_id)) {
        row = withoutGoneLink(row, `${error.message} ${error.details ?? ""}`);
        continue;
      }
      console.error("[ai usage] could not record", error.code, error.message);
      return;
    }
  } catch (error) {
    console.error("[ai usage] could not record", error);
  }
}

/**
 * What a server action passes as a reader's onCall: each call is recorded
 * once the response has gone (after()), so the user never waits for it.
 * Outside a request (a script), it is recorded at once, without waiting.
 */
export function recordAiUsageLater(context: AiUsageContext): OnAiCall {
  return (call) => {
    try {
      after(() => recordAiUsage(context, call));
    } catch {
      void recordAiUsage(context, call);
    }
  };
}
