import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as mockReviewReceiver } from "@/app/api/dev/mock-ai-review/route";
import { makeAiReview } from "./__fixtures__/ai-review";
import { makeStdEgExport } from "./__fixtures__/std-eg-export";
import type { ClaudeClientFactory, ClaudeReviewMessage } from "./providers/claude";
import { mockReview } from "./providers/mock";
import { requestAiReview } from "./review";
import { WEBHOOK_HEADERS } from "./webhook";

const SECRET = "whsec_test_0123456789abcdef";
const WEBHOOK_ENV = { AI_REVIEW_WEBHOOK_URL: "https://ai.example.com/review", AI_WEBHOOK_SECRET: SECRET };

// requestAiReview gets its env explicitly; the mock receiver reads process.env, so pin it.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENABLE_MOCK_AI", "");
  vi.stubEnv("AI_WEBHOOK_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function answering(response: () => Response) {
  return vi.fn<typeof fetch>(async () => response());
}

/** Routes the webhook POST straight into the mock receiver's route handler. */
const toMockReceiver: typeof fetch = async (input, init) => mockReviewReceiver(new Request(input, init));

function claudeAnswering(answer: () => ClaudeReviewMessage): ClaudeClientFactory {
  return () => ({ beta: { messages: { parse: async () => answer() } } });
}

describe("requestAiReview", () => {
  it("is not connected when nothing is configured", async () => {
    expect(await requestAiReview(makeStdEgExport(), { env: {} })).toEqual({
      ok: false,
      reason: "not_connected",
      message: "AI second opinion not connected.",
    });
  });

  it("reports a misconfiguration and names the variable", async () => {
    const outcome = await requestAiReview(makeStdEgExport(), { env: { AI_REVIEW_PROVIDER: "claude" } });
    expect(outcome).toMatchObject({ ok: false, reason: "misconfigured" });
    expect(!outcome.ok && outcome.message).toContain("ANTHROPIC_API_KEY");
  });

  it("never repeats a secret pasted into the wrong variable", async () => {
    const outcome = await requestAiReview(makeStdEgExport(), {
      env: { AI_REVIEW_PROVIDER: "https://hooks.example.com/x?token=LEAKED-SECRET" },
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "misconfigured",
      message: "AI_REVIEW_PROVIDER must be one of auto, webhook, claude, mock or off.",
    });
  });

  it("returns the deterministic mock review", async () => {
    expect(await requestAiReview(makeStdEgExport(), { env: { AI_REVIEW_PROVIDER: "mock" } })).toEqual({
      ok: true,
      review: mockReview(makeStdEgExport()),
      provider: "mock",
      model: null,
    });
  });

  it("never sends an export that breaks the contract", async () => {
    const fetchSpy = answering(() => Response.json(makeAiReview()));
    const doc = makeStdEgExport();
    doc.photos[0].url = "javascript:alert(1)";
    const outcome = await requestAiReview(doc, { env: WEBHOOK_ENV, fetch: fetchSpy });
    expect(outcome).toMatchObject({ ok: false, reason: "error" });
    expect(!outcome.ok && outcome.message).toContain("photos.0.url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the export to the review webhook and returns its validated answer", async () => {
    const fetchSpy = answering(() => Response.json(makeAiReview()));
    const outcome = await requestAiReview(makeStdEgExport(), { env: WEBHOOK_ENV, fetch: fetchSpy });

    expect(outcome).toEqual({ ok: true, review: makeAiReview(), provider: "webhook", model: null });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://ai.example.com/review");
    expect(new Headers(init?.headers).get(WEBHOOK_HEADERS.event)).toBe("ai.review.requested");
    expect(JSON.parse(String(init?.body))).toEqual(makeStdEgExport());
  });

  it("sends an export with photos and files that are not tagged with a module", async () => {
    const doc = makeStdEgExport();
    doc.photos[2].moduleKey = null;
    doc.files[0].moduleKey = null;
    const fetchSpy = answering(() => Response.json(makeAiReview()));
    expect(await requestAiReview(doc, { env: WEBHOOK_ENV, fetch: fetchSpy })).toMatchObject({ ok: true });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual(doc);
  });

  it.each([
    ["an HTTP error", () => new Response("down", { status: 503 }), "error"],
    ["a body that is not JSON", () => new Response("<html>"), "invalid_response"],
    ["JSON that is not a review", () => Response.json({ verdict: "looks fine" }), "invalid_response"],
  ] as const)("maps %s from the webhook", async (_label, response, reason) => {
    const outcome = await requestAiReview(makeStdEgExport(), { env: WEBHOOK_ENV, fetch: answering(response) });
    expect(outcome).toMatchObject({ ok: false, reason, provider: "webhook" });
  });

  it("times out a webhook that does not answer", async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const outcome = await requestAiReview(makeStdEgExport(), { env: WEBHOOK_ENV, fetch: hanging, timeoutMs: 20 });
    expect(outcome).toMatchObject({ ok: false, reason: "timeout", provider: "webhook" });
  });

  it("runs on Claude through the injected client", async () => {
    const review = makeAiReview();
    const createClaudeClient = claudeAnswering(() => ({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      stop_details: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      content: [{ type: "text", text: JSON.stringify(review) }],
      parsed_output: review,
    }));
    const outcome = await requestAiReview(makeStdEgExport(), {
      env: { ANTHROPIC_API_KEY: "sk-ant-test-key-000" },
      createClaudeClient,
    });
    expect(outcome).toMatchObject({ ok: true, provider: "claude", model: "claude-opus-5-5", review });
  });

  it("never throws: an unexpected error is logged and reported", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const createClaudeClient = claudeAnswering(() => {
      throw new TypeError("bug in a provider");
    });
    const outcome = await requestAiReview(makeStdEgExport(), {
      env: { ANTHROPIC_API_KEY: "sk-ant-test-key-000" },
      createClaudeClient,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "error",
      message: "Unexpected error while requesting the AI review.",
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it("completes a signed round trip through the mock receiver", async () => {
    vi.stubEnv("AI_WEBHOOK_SECRET", SECRET);
    const outcome = await requestAiReview(makeStdEgExport(), {
      env: { ...WEBHOOK_ENV, AI_REVIEW_WEBHOOK_URL: "http://localhost:3000/api/dev/mock-ai-review" },
      fetch: toMockReceiver,
    });
    expect(outcome).toEqual({ ok: true, review: mockReview(makeStdEgExport()), provider: "webhook", model: null });
  });

  it("is rejected by the receiver when the secrets differ", async () => {
    vi.stubEnv("AI_WEBHOOK_SECRET", "whsec_receiver_0123456789abcdef");
    const outcome = await requestAiReview(makeStdEgExport(), {
      env: { ...WEBHOOK_ENV, AI_REVIEW_WEBHOOK_URL: "http://localhost:3000/api/dev/mock-ai-review" },
      fetch: toMockReceiver,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "error",
      provider: "webhook",
      message: "The webhook answered HTTP 401.",
    });
  });
});
