import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { summarizeIssues } from "./issues";

/* ------------------------------------------------------------------ *
 * Signed webhook hand-offs (docs/AI.md, "Webhook contract")
 *
 * Body: the export JSON. Signature: "sha256=" + hex HMAC-SHA256 of
 * `${timestamp}.${body}` with AI_WEBHOOK_SECRET, sent only when the
 * secret is set. Receivers check it with verifySignature().
 * ------------------------------------------------------------------ */

export const WEBHOOK_HEADERS = {
  event: "X-SteriCare-Event",
  delivery: "X-SteriCare-Delivery",
  timestamp: "X-SteriCare-Timestamp",
  signature: "X-SteriCare-Signature",
} as const;

export type WebhookEvent = "ai.review.requested" | "ai.report.requested";

/** Receivers reject a timestamp further than this from their own clock (replay protection). */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** An AI review is a few kilobytes; anything near this is a misconfigured endpoint. */
export const MAX_WEBHOOK_RESPONSE_BYTES = 1024 * 1024;

export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return `sha256=${hmac(secret, String(timestamp), body).toString("hex")}`;
}

function hmac(secret: string, timestamp: string, body: string): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch"; message: string };

export interface VerifySignatureInput {
  secret: string;
  /** The raw request body, byte for byte as received. Do not re-serialise parsed JSON. */
  body: string;
  timestamp: string | null;
  signature: string | null;
  /** Unix seconds. Defaults to the current time. */
  now?: number;
  toleranceSeconds?: number;
}

export function verifySignature(input: VerifySignatureInput): SignatureCheck {
  const { secret, body, timestamp, signature } = input;
  if (!timestamp || !signature) {
    return rejected("missing", `${WEBHOOK_HEADERS.signature} or ${WEBHOOK_HEADERS.timestamp} is missing.`);
  }
  if (!/^\d{1,12}$/.test(timestamp)) {
    return rejected("malformed", `${WEBHOOK_HEADERS.timestamp} is not a Unix time in seconds.`);
  }
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature);
  if (!match) {
    return rejected("malformed", `${WEBHOOK_HEADERS.signature} is not "sha256=" followed by 64 hex characters.`);
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamp)) > tolerance) {
    return rejected("expired", `${WEBHOOK_HEADERS.timestamp} is more than ${tolerance} seconds from the receiver's clock.`);
  }

  // Both are 32 bytes here, which timingSafeEqual requires.
  const expected = hmac(secret, timestamp, body);
  const received = Buffer.from(match[1], "hex");
  if (!timingSafeEqual(expected, received)) {
    return rejected("mismatch", "The signature does not match the body.");
  }
  return { ok: true };
}

function rejected(reason: Exclude<SignatureCheck, { ok: true }>["reason"], message: string): SignatureCheck {
  return { ok: false, reason, message };
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

export interface PostWebhookOptions<T> {
  url: string;
  secret: string | null;
  event: WebhookEvent;
  payload: unknown;
  responseSchema: z.ZodType<T>;
  timeoutMs: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export type WebhookFailureReason = "timeout" | "http_error" | "network_error" | "invalid_response";

export type WebhookResult<T> =
  | { ok: true; data: T; status: number; deliveryId: string }
  | { ok: false; reason: WebhookFailureReason; message: string; status?: number; deliveryId: string };

/** How a webhook failure reads in an AI review or report outcome. */
export function handoffFailureReason(reason: WebhookFailureReason): "timeout" | "invalid_response" | "error" {
  switch (reason) {
    case "timeout":
      return "timeout";
    case "invalid_response":
      return "invalid_response";
    case "http_error":
    case "network_error":
      return "error";
  }
}

/**
 * POSTs the payload as JSON and validates the answer. Network and response
 * problems come back as failures; it throws only if the payload cannot be
 * serialised, which ExportSchema (JSON values only) rules out.
 */
export async function postWebhook<T>(options: PostWebhookOptions<T>): Promise<WebhookResult<T>> {
  const { url, secret, event, payload, responseSchema, timeoutMs } = options;
  const fetchImpl = options.fetch ?? fetch;
  const deliveryId = randomUUID();
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
    [WEBHOOK_HEADERS.event]: event,
    [WEBHOOK_HEADERS.delivery]: deliveryId,
    [WEBHOOK_HEADERS.timestamp]: String(timestamp),
  });
  if (secret) headers.set(WEBHOOK_HEADERS.signature, signWebhookBody(secret, timestamp, body));

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  const failure = (reason: WebhookFailureReason, message: string, status?: number): WebhookResult<T> => ({
    ok: false,
    reason,
    message,
    status,
    deliveryId,
  });
  const interrupted = (): WebhookResult<T> | null => {
    if (timeout.aborted) return failure("timeout", `The webhook did not answer within ${formatDuration(timeoutMs)}.`);
    if (options.signal?.aborted) return failure("network_error", "The webhook request was cancelled.");
    return null;
  };

  let response: Response;
  try {
    // Redirects are not followed: a 307 would resend the inspection data to another host.
    response = await fetchImpl(url, { method: "POST", headers, body, signal, redirect: "manual" });
  } catch {
    return interrupted() ?? failure("network_error", "Could not reach the webhook.");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failure("http_error", `The webhook answered HTTP ${response.status}.`, response.status);
  }

  let text: string | null;
  try {
    text = await readText(response, MAX_WEBHOOK_RESPONSE_BYTES);
  } catch {
    return interrupted() ?? failure("network_error", "The webhook response was cut off.", response.status);
  }
  if (text === null) {
    return failure("invalid_response", "The webhook response is larger than 1 MB.", response.status);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return failure("invalid_response", "The webhook response is not JSON.", response.status);
  }

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    return failure(
      "invalid_response",
      `The webhook response does not match the expected format (${summarizeIssues(parsed.error)}).`,
      response.status,
    );
  }
  return { ok: true, data: parsed.data, status: response.status, deliveryId };
}

/** The body as text, or null when it is larger than maxBytes. */
async function readText(response: Response, maxBytes: number): Promise<string | null> {
  if (Number(response.headers.get("content-length")) > maxBytes) return null;
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}
