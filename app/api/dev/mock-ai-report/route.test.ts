import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { signWebhookBody, WEBHOOK_HEADERS } from "@/lib/ai/webhook";
import { AiReportResponseSchema } from "@/lib/schemas";
import { GET, POST } from "./route";

const ORIGIN = "http://localhost:3000";
const SECRET = "whsec_test_0123456789abcdef";
const EXPORT = makeStdEgExport();
const BODY = JSON.stringify(EXPORT);

// The handlers read process.env; start every test from a known state, whatever the shell exports.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENABLE_MOCK_AI", "");
  vi.stubEnv("AI_WEBHOOK_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new Request(`${ORIGIN}/api/dev/mock-ai-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    }),
  );
}

describe("POST /api/dev/mock-ai-report", () => {
  it("answers like a report service, with a placeholder URL on this app", async () => {
    const response = await post(BODY);
    expect(response.status).toBe(200);
    const body = AiReportResponseSchema.parse(await response.json());
    expect(body.reportUrl).toBe(`${ORIGIN}/api/dev/mock-ai-report?ref=${EXPORT.refNo}`);
  });

  it("verifies the signature when a secret is set", async () => {
    vi.stubEnv("AI_WEBHOOK_SECRET", SECRET);
    expect((await post(BODY)).status).toBe(401);

    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      [WEBHOOK_HEADERS.timestamp]: String(timestamp),
      [WEBHOOK_HEADERS.signature]: signWebhookBody(SECRET, timestamp, BODY),
    };
    expect((await post(BODY, headers)).status).toBe(200);
  });

  it("rejects an invalid export", async () => {
    expect((await post(JSON.stringify({ refNo: "INS-2024-0001" }))).status).toBe(422);
  });

  it("is hidden in production unless ENABLE_MOCK_AI=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(BODY)).status).toBe(404);
    vi.stubEnv("ENABLE_MOCK_AI", "true");
    expect((await post(BODY)).status).toBe(200);
  });
});

describe("GET /api/dev/mock-ai-report", () => {
  it("serves a plain-text placeholder naming the inspection", async () => {
    const response = await GET(new Request(`${ORIGIN}/api/dev/mock-ai-report?ref=INS-2024-0001`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("Mock AI report for inspection INS-2024-0001.");
  });

  it("never serves the echoed ref as markup", async () => {
    const ref = encodeURIComponent("<script>alert(1)</script>");
    const response = await GET(new Request(`${ORIGIN}/api/dev/mock-ai-report?ref=${ref}`));
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
  });

  it("is hidden in production unless ENABLE_MOCK_AI=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(new Request(`${ORIGIN}/api/dev/mock-ai-report?ref=x`))).status).toBe(404);
  });
});
