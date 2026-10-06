import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { mockReview } from "@/lib/ai/providers/mock";
import { signWebhookBody, WEBHOOK_HEADERS } from "@/lib/ai/webhook";
import { AiReviewSchema } from "@/lib/schemas";
import { POST } from "./route";

const ENDPOINT = "http://localhost:3000/api/dev/mock-ai-review";
const SECRET = "whsec_test_0123456789abcdef";
const BODY = JSON.stringify(makeStdEgExport());

// The handler reads process.env; start every test from a known state, whatever the shell exports.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENABLE_MOCK_AI", "");
  vi.stubEnv("AI_WEBHOOK_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function post(body: string, headers: Record<string, string> = {}) {
  return POST(new Request(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }));
}

function signed(body: string, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  return {
    [WEBHOOK_HEADERS.timestamp]: String(timestamp),
    [WEBHOOK_HEADERS.signature]: signWebhookBody(secret, timestamp, body),
  };
}

describe("POST /api/dev/mock-ai-review", () => {
  it("answers a valid export with the mock review", async () => {
    const response = await post(BODY);
    expect(response.status).toBe(200);
    const review = await response.json();
    expect(AiReviewSchema.parse(review)).toEqual(mockReview(makeStdEgExport()));
  });

  it("is hidden in production unless ENABLE_MOCK_AI=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(BODY)).status).toBe(404);

    vi.stubEnv("ENABLE_MOCK_AI", "true");
    expect((await post(BODY)).status).toBe(200);
  });

  describe("with AI_WEBHOOK_SECRET set", () => {
    it("accepts a correctly signed request", async () => {
      vi.stubEnv("AI_WEBHOOK_SECRET", SECRET);
      expect((await post(BODY, signed(BODY))).status).toBe(200);
    });

    it.each([
      ["no signature", () => ({})],
      ["a signature over a different body", () => signed(BODY.replace(makeStdEgExport().refNo, "INS-2099-0002"))],
      ["the wrong secret", () => signed(BODY, { secret: "whsec_other_0123456789abcdef" })],
      ["a stale timestamp", () => signed(BODY, { timestamp: Math.floor(Date.now() / 1000) - 600 })],
    ])("rejects %s with 401", async (_label, headers) => {
      vi.stubEnv("AI_WEBHOOK_SECRET", SECRET);
      const response = await post(BODY, headers());
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "invalid_signature" });
    });

    it("refuses to run with a secret that is too short", async () => {
      vi.stubEnv("AI_WEBHOOK_SECRET", "short");
      const response = await post(BODY, signed(BODY, { secret: "short" }));
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: "misconfigured" });
    });
  });

  it("rejects a body that is not JSON", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_json" });
  });

  it("rejects an export that breaks the schema, listing the issues", async () => {
    const doc = makeStdEgExport();
    Object.assign(doc, { schemaVersion: "2" });
    Object.assign(doc.modules[0].result, { status: "passed" });
    const response = await post(JSON.stringify(doc));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("invalid_export");
    expect(body.issues.map((issue: { path: string }) => issue.path)).toEqual(
      expect.arrayContaining(["schemaVersion", "modules.0.result.status"]),
    );
  });
});
