import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));
vi.mock("./settings", () => ({ loadAiPrices: vi.fn() }));

import { after } from "next/server";
import { DEFAULT_AI_PRICES, type AiPriceList } from "@/lib/schemas/ai-prices";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createMessage } from "./document-reader";
import { loadAiPrices } from "./settings";
import {
  callFromError,
  callFromMessage,
  costOfCall,
  recordAiUsage,
  recordAiUsageLater,
  type AiCall,
  type AiUsageContext,
  type MessageUsageLike,
} from "./usage";

const STARTED = 1_000_000;

function message(usage: Partial<MessageUsageLike["usage"]> = {}, overrides: Partial<MessageUsageLike> = {}): MessageUsageLike {
  return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0, ...usage }, ...overrides };
}

const call = (attempts: AiCall["attempts"], extra: Partial<AiCall> = {}): AiCall => ({
  model: attempts[0]?.model ?? "claude-opus-5-5",
  outcome: "ok",
  errorType: null,
  durationMs: 10,
  attempts,
  inferenceGeo: null,
  serviceTier: null,
  ...extra,
});

const opus = (tokens: Partial<AiCall["attempts"][number]>) => ({
  model: "claude-opus-5-5",
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  ...tokens,
});

describe("callFromMessage", () => {
  it("takes one attempt from the top-level usage, with the answer's model and how long it took", () => {
    const result = callFromMessage(
      message({ input_tokens: 20_000, output_tokens: 4_000, cache_read_input_tokens: 3_000, cache_creation_input_tokens: 0, inference_geo: "global", service_tier: "standard" }),
      STARTED,
      STARTED + 1_234.4,
    );
    expect(result).toEqual({
      model: "claude-opus-5-5",
      outcome: "ok",
      errorType: null,
      durationMs: 1_234,
      attempts: [opus({ input: 20_000, output: 4_000, cacheRead: 3_000 })],
      inferenceGeo: "global",
      serviceTier: "standard",
    });
  });

  it("splits cache writes by their life, and reads them as 5-minute writes without the breakdown", () => {
    const split = callFromMessage(
      message({ cache_creation_input_tokens: 1_500, cache_creation: { ephemeral_5m_input_tokens: 1_200, ephemeral_1h_input_tokens: 300 } }),
      STARTED,
    );
    expect(split.attempts[0]).toMatchObject({ cacheWrite5m: 1_200, cacheWrite1h: 300 });
    const total = callFromMessage(message({ cache_creation_input_tokens: 1_500, cache_creation: null }), STARTED);
    expect(total.attempts[0]).toMatchObject({ cacheWrite5m: 1_500, cacheWrite1h: 0 });
  });

  it("sums a server-side fallback's attempts, each at its own model (the top level holds only the last)", () => {
    const fallback = callFromMessage(
      message(
        {
          input_tokens: 2_100,
          output_tokens: 800,
          iterations: [
            { type: "message", model: "claude-opus-5-5", input_tokens: 2_000, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
            { type: "compaction", input_tokens: 9_999, output_tokens: 9_999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
            {
              type: "fallback_message",
              model: "claude-opus-4-8",
              input_tokens: 2_100,
              output_tokens: 800,
              cache_read_input_tokens: 400,
              cache_creation_input_tokens: 0,
              cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            },
          ],
        },
        { model: "claude-opus-4-8" },
      ),
      STARTED,
    );
    expect(fallback.model).toBe("claude-opus-4-8");
    expect(fallback.attempts).toEqual([
      opus({ input: 2_000, output: 150 }),
      { model: "claude-opus-4-8", input: 2_100, output: 800, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 400 },
    ]);

    const priced: AiPriceList = {
      ...DEFAULT_AI_PRICES,
      models: [...DEFAULT_AI_PRICES.models, { model: "claude-opus-4-8", input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, longPrompt: null }],
    };
    // 2,000 x $4 + 150 x $20, then 2,100 x $5 + 400 x $0.50 + 800 x $25, per million tokens.
    expect(costOfCall(fallback, priced)).toBe(0.0417);
    // The review's fallback models are priced without the admin adding them (FALLBACK_MODEL_PRICES).
    expect(costOfCall(fallback, DEFAULT_AI_PRICES)).toBe(0.0417);
  });

  it.each([
    ["end_turn", "ok"],
    ["refusal", "refused"],
    ["max_tokens", "cut_off"],
    ["model_context_window_exceeded", "cut_off"],
    [null, "ok"],
  ] as const)("reads stop reason %s as %s", (stopReason, outcome) => {
    expect(callFromMessage(message({ input_tokens: 10 }, { stop_reason: stopReason }), STARTED).outcome).toBe(outcome);
  });
});

describe("callFromError", () => {
  const apiError = (status: number | undefined, type: string | null) => {
    const body = type ? { type: "error", error: { type, message: "x" } } : { detail: "x" };
    // An error event inside a stream has no status (the SDK's streaming.js); an HTTP answer has one.
    return status === undefined
      ? new Anthropic.APIError(undefined, body, undefined, new Headers(), type as never)
      : Anthropic.APIError.generate(status, body, undefined, new Headers());
  };

  it.each([
    ["a timeout", new Anthropic.APIConnectionTimeoutError(), "timeout"],
    ["a cancelled request", new Anthropic.APIUserAbortError(), "aborted"],
    ["no connection", new Anthropic.APIConnectionError({ message: "offline" }), "connection"],
    ["a rate limit", apiError(429, "rate_limit_error"), "rate_limit_error"],
    ["an overload inside the stream", apiError(undefined, "overloaded_error"), "overloaded_error"],
    ["a bare 503", apiError(503, null), "http_503"],
    ["anything else", new Error("boom"), "unknown"],
  ])("names %s", (_label, error, errorType) => {
    expect(callFromError(error, "claude-opus-5-5", STARTED, STARTED + 50)).toEqual({
      model: "claude-opus-5-5",
      outcome: "failed",
      errorType,
      durationMs: 50,
      attempts: [],
      inferenceGeo: null,
      serviceTier: null,
    });
  });

  it("keeps an error type to 60 characters", () => {
    expect(callFromError(apiError(400, "x".repeat(80)), "claude-opus-5-5", STARTED).errorType).toBe("x".repeat(60));
  });
});

describe("costOfCall", () => {
  it("prices Opus 5.5: 20,000 input + 3,000 cache read + 4,000 output is $0.1606", () => {
    expect(costOfCall(call([opus({ input: 20_000, cacheRead: 3_000, output: 4_000 })]), DEFAULT_AI_PRICES)).toBe(0.1606);
  });

  it("prices cache writes and reads at their own rates: the first file writes the cache, the next reads it", () => {
    expect(costOfCall(call([opus({ input: 1_000, cacheWrite5m: 30_000, output: 2_000 })]), DEFAULT_AI_PRICES)).toBe(0.194);
    expect(costOfCall(call([opus({ input: 1_000, cacheRead: 30_000, output: 2_000 })]), DEFAULT_AI_PRICES)).toBe(0.05);
    expect(costOfCall(call([opus({ cacheWrite1h: 10_000 })]), DEFAULT_AI_PRICES)).toBe(0.08);
  });

  it("prices a whole Haiku 5.5 request at the higher rates once its prompt is over 100,000 tokens, output included", () => {
    const haiku = (input: number) => call([{ model: "claude-haiku-5-5", input, output: 1_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 20_000 }]);
    expect(costOfCall(haiku(80_000), DEFAULT_AI_PRICES)).toBe(0.0087);
    expect(costOfCall(haiku(90_000), DEFAULT_AI_PRICES)).toBe(0.0485);
  });

  it("adds 10% for US-only inference and halves a batch", () => {
    const attempts = [opus({ input: 20_000, cacheRead: 3_000, output: 4_000 })];
    expect(costOfCall(call(attempts, { inferenceGeo: "us" }), DEFAULT_AI_PRICES)).toBe(0.17666);
    expect(costOfCall(call(attempts, { serviceTier: "batch" }), DEFAULT_AI_PRICES)).toBe(0.0803);
  });

  it("prices a dated snapshot as its model, and nothing else it does not list", () => {
    const tokens = { input: 20_000, cacheRead: 3_000, output: 4_000 };
    expect(costOfCall(call([opus({ ...tokens, model: "claude-opus-5-5-20260922" })]), DEFAULT_AI_PRICES)).toBe(0.1606);
    expect(costOfCall(call([opus({ ...tokens, model: "claude-opus-5-5-fast" })]), DEFAULT_AI_PRICES)).toBeNull();
    expect(costOfCall(call([opus({ ...tokens, model: "claude-mystery-1" })]), DEFAULT_AI_PRICES)).toBeNull();
  });

  it("costs nothing for a call that brought no answer", () => {
    expect(costOfCall(call([]), DEFAULT_AI_PRICES)).toBe(0);
  });
});

describe("createMessage", () => {
  function fakeClient(...results: Array<object | Error>) {
    const create = vi.fn(async () => {
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
  }
  const params = { model: "claude-opus-5-5", max_tokens: 100, messages: [], output_config: { effort: "low" } } as never;

  it("reports every answer once, a refused one included", async () => {
    const onCall = vi.fn();
    const { client } = fakeClient({ model: "claude-opus-5-5", stop_reason: "refusal", usage: { input_tokens: 900, output_tokens: 5 }, content: [] });
    await createMessage(client, params, onCall);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall.mock.calls[0][0]).toMatchObject({ outcome: "refused", attempts: [{ input: 900, output: 5 }] });
  });

  it("reports the retry without effort, not the 400 before it, and a failure before rethrowing it", async () => {
    const onCall = vi.fn();
    const effort = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "effort is not supported" } }, "effort is not supported", new Headers());
    const retried = fakeClient(effort, { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 }, content: [] });
    await createMessage(retried.client, params, onCall);
    expect(retried.create).toHaveBeenCalledTimes(2);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall.mock.calls[0][0]).toMatchObject({ outcome: "ok" });

    onCall.mockClear();
    const failing = fakeClient(new Anthropic.APIConnectionTimeoutError());
    await expect(createMessage(failing.client, params, onCall)).rejects.toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
    expect(onCall.mock.calls).toEqual([[expect.objectContaining({ outcome: "failed", errorType: "timeout", model: "claude-opus-5-5" })]]);
  });

  it("never lets a recording problem reach the reader", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [] });
    const answer = await createMessage(client, params, () => {
      throw new Error("recorder broke");
    });
    expect(answer).toMatchObject({ stop_reason: "end_turn" });
  });
});

describe("recordAiUsage", () => {
  const context: AiUsageContext = { feature: "source_document_read", inspectionId: "insp-1", actorId: "user-1", itemCount: 1 };
  const answered = call([opus({ input: 20_000, cacheRead: 3_000, output: 4_000 }), opus({ input: 100, output: 10 })], { durationMs: 2_500.6 });
  let insert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    insert = vi.fn(async () => ({ error: null }));
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => ({ insert })) } as never);
    vi.mocked(loadAiPrices).mockResolvedValue(DEFAULT_AI_PRICES);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("stores the call's tokens over its attempts and its cost at today's prices", async () => {
    await recordAiUsage(context, answered);
    expect(insert).toHaveBeenCalledWith({
      feature: "source_document_read",
      model: "claude-opus-5-5",
      inspection_id: "insp-1",
      actor_id: "user-1",
      item_count: 1,
      input_tokens: 20_100,
      output_tokens: 4_010,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
      cache_read_tokens: 3_000,
      duration_ms: 2_501,
      outcome: "ok",
      error_type: null,
      cost_usd: 0.1612,
    });
  });

  it("stores no cost for a model without a price, and records nothing without the secret key", async () => {
    await recordAiUsage(context, call([opus({ model: "claude-sonnet-4-9", input: 10 })]));
    expect(insert.mock.calls[0][0]).toMatchObject({ model: "claude-sonnet-4-9", cost_usd: null });

    insert.mockClear();
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    await recordAiUsage(context, answered);
    expect(insert).not.toHaveBeenCalled();
  });

  it("goes in without the link when the inspection was deleted meanwhile", async () => {
    insert
      .mockResolvedValueOnce({
        error: { code: "23503", message: 'insert or update on table "ai_usage" violates foreign key constraint "ai_usage_inspection_id_fkey"', details: null },
      })
      .mockResolvedValueOnce({ error: null });
    await recordAiUsage(context, answered);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).toMatchObject({ inspection_id: null, actor_id: "user-1" });
  });

  it("logs and drops anything else, and never throws", async () => {
    insert.mockResolvedValue({ error: { code: "42501", message: "permission denied for table ai_usage" } });
    await expect(recordAiUsage(context, answered)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[ai usage] could not record", "42501", "permission denied for table ai_usage");

    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error("no client");
    });
    await expect(recordAiUsage(context, answered)).resolves.toBeUndefined();
  });

  it("records after the response, or at once outside a request", async () => {
    let scheduled: (() => unknown) | undefined;
    vi.mocked(after).mockImplementation((task) => {
      scheduled = typeof task === "function" ? task : undefined;
    });
    recordAiUsageLater(context)(answered);
    expect(insert).not.toHaveBeenCalled();
    await scheduled?.();
    expect(insert).toHaveBeenCalledTimes(1);

    vi.mocked(after).mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    recordAiUsageLater(context)(answered);
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(2));
  });
});
