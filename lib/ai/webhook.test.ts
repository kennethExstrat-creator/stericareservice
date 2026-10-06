import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { postWebhook, signWebhookBody, verifySignature, WEBHOOK_HEADERS, type PostWebhookOptions } from "./webhook";

const SECRET = "whsec_test_0123456789abcdef";
const BODY = '{"refNo":"INS-2024-0001"}';
const TIMESTAMP = 1_720_000_000;
// Cross-checked with: printf '%s' '1720000000.{"refNo":"INS-2024-0001"}' | openssl dgst -sha256 -hmac 'whsec_test_0123456789abcdef'
const SIGNATURE = "sha256=5157e5af21b53cbd68da3b5566c0cf2eb0c3214c8a86d3493feb6821b1fc2335";

describe("signWebhookBody", () => {
  it("is sha256= plus hex HMAC-SHA256 of `${timestamp}.${body}`", () => {
    expect(signWebhookBody(SECRET, TIMESTAMP, BODY)).toBe(SIGNATURE);
  });
});

describe("verifySignature", () => {
  const valid = { secret: SECRET, body: BODY, timestamp: String(TIMESTAMP), signature: SIGNATURE, now: TIMESTAMP + 10 };

  it("accepts a fresh, matching signature", () => {
    expect(verifySignature(valid)).toEqual({ ok: true });
    expect(verifySignature({ ...valid, signature: SIGNATURE.toUpperCase().replace("SHA256=", "sha256=") })).toEqual({
      ok: true,
    });
  });

  it("rejects a tampered body", () => {
    expect(verifySignature({ ...valid, body: BODY.replace("0001", "0002") })).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects the wrong secret", () => {
    expect(verifySignature({ ...valid, secret: "whsec_other_0123456789abcdef" })).toMatchObject({ reason: "mismatch" });
  });

  it("rejects a timestamp outside the 5-minute window, both ways", () => {
    expect(verifySignature({ ...valid, now: TIMESTAMP + 300 })).toEqual({ ok: true });
    expect(verifySignature({ ...valid, now: TIMESTAMP + 301 })).toMatchObject({ ok: false, reason: "expired" });
    expect(verifySignature({ ...valid, now: TIMESTAMP - 301 })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects a replayed signature with a new timestamp", () => {
    expect(verifySignature({ ...valid, timestamp: String(TIMESTAMP + 5) })).toMatchObject({ reason: "mismatch" });
  });

  it("rejects missing and malformed headers", () => {
    expect(verifySignature({ ...valid, signature: null })).toMatchObject({ reason: "missing" });
    expect(verifySignature({ ...valid, timestamp: null })).toMatchObject({ reason: "missing" });
    expect(verifySignature({ ...valid, timestamp: "1720000000.5" })).toMatchObject({ reason: "malformed" });
    expect(verifySignature({ ...valid, signature: SIGNATURE.slice("sha256=".length) })).toMatchObject({
      reason: "malformed",
    });
    expect(verifySignature({ ...valid, signature: `${SIGNATURE}00` })).toMatchObject({ reason: "malformed" });
  });
});

describe("postWebhook", () => {
  const ResponseSchema = z.object({ reportUrl: z.url() });
  type Result = z.infer<typeof ResponseSchema>;
  const payload = { refNo: "INS-2024-0001", modules: [] };

  function options(fetchImpl: typeof fetch, overrides: Partial<PostWebhookOptions<Result>> = {}) {
    return {
      url: "https://reports.example.com/hook",
      secret: SECRET,
      event: "ai.report.requested",
      payload,
      responseSchema: ResponseSchema,
      timeoutMs: 1_000,
      fetch: fetchImpl,
      ...overrides,
    } satisfies PostWebhookOptions<Result>;
  }

  function respond(body: BodyInit | null, init?: ResponseInit) {
    return vi.fn<typeof fetch>(async () => new Response(body, init));
  }

  it("POSTs the signed export and returns the validated answer", async () => {
    const fetchImpl = respond(JSON.stringify({ reportUrl: "https://reports.example.com/r/1.pdf" }), { status: 200 });
    const result = await postWebhook(options(fetchImpl));

    expect(result).toMatchObject({ ok: true, data: { reportUrl: "https://reports.example.com/r/1.pdf" }, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://reports.example.com/hook");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", body: JSON.stringify(payload) });

    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get(WEBHOOK_HEADERS.event)).toBe("ai.report.requested");
    expect(headers.get(WEBHOOK_HEADERS.delivery)).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get(WEBHOOK_HEADERS.delivery)).toBe(result.deliveryId);
    const timestamp = headers.get(WEBHOOK_HEADERS.timestamp);
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(5);
    expect(
      verifySignature({
        secret: SECRET,
        body: String(init?.body),
        timestamp,
        signature: headers.get(WEBHOOK_HEADERS.signature),
      }),
    ).toEqual({ ok: true });
  });

  it("sends no signature without a secret", async () => {
    const fetchImpl = respond(JSON.stringify({ reportUrl: "https://reports.example.com/r/1.pdf" }));
    await postWebhook(options(fetchImpl, { secret: null }));
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).has(WEBHOOK_HEADERS.signature)).toBe(false);
  });

  it("reports a non-2xx answer, including a redirect, as an HTTP error", async () => {
    expect(await postWebhook(options(respond("boom", { status: 500 })))).toMatchObject({
      ok: false,
      reason: "http_error",
      status: 500,
      message: "The webhook answered HTTP 500.",
    });
    const redirect = respond(null, { status: 307, headers: { location: "https://elsewhere.example.com/" } });
    expect(await postWebhook(options(redirect))).toMatchObject({ ok: false, reason: "http_error", status: 307 });
  });

  it("rejects an answer that is not JSON", async () => {
    expect(await postWebhook(options(respond("<html>Not found</html>")))).toMatchObject({
      ok: false,
      reason: "invalid_response",
      message: "The webhook response is not JSON.",
    });
  });

  it("rejects JSON that does not match the schema, naming the field", async () => {
    const result = await postWebhook(options(respond(JSON.stringify({ reportUrl: "not a url" }))));
    expect(result).toMatchObject({ ok: false, reason: "invalid_response" });
    expect(!result.ok && result.message).toContain("reportUrl");
  });

  it("rejects an answer over 1 MB, declared or streamed", async () => {
    const declared = respond("{}", { headers: { "content-length": String(2 * 1024 * 1024) } });
    expect(await postWebhook(options(declared))).toMatchObject({ reason: "invalid_response" });

    const chunk = new Uint8Array(512 * 1024).fill(32);
    const streamed = vi.fn<typeof fetch>(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 3; i++) controller.enqueue(chunk);
          controller.close();
        },
      });
      return new Response(stream);
    });
    expect(await postWebhook(options(streamed))).toMatchObject({
      reason: "invalid_response",
      message: "The webhook response is larger than 1 MB.",
    });
  });

  it("times out when the receiver does not answer", async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    expect(await postWebhook(options(hanging, { timeoutMs: 20 }))).toMatchObject({
      ok: false,
      reason: "timeout",
      message: "The webhook did not answer within 20 ms.",
    });
  });

  it("reports a cancelled request and an unreachable host as network errors", async () => {
    const controller = new AbortController();
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const pending = postWebhook(options(hanging, { signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "network_error", message: "The webhook request was cancelled." });

    const unreachable = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await postWebhook(options(unreachable))).toMatchObject({
      ok: false,
      reason: "network_error",
      message: "Could not reach the webhook.",
    });
  });
});
