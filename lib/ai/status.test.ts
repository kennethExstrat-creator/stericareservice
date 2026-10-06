import { describe, expect, it } from "vitest";
import { AI_REPORT_NOT_CONNECTED, AI_REVIEW_NOT_CONNECTED, getAiStatus } from "./status";

const API_KEY = "sk-ant-test-key-000";
const SECRET = "whsec_test_0123456789abcdef";

describe("getAiStatus", () => {
  it("says not connected when nothing is configured", () => {
    expect(getAiStatus({})).toEqual({
      review: { connected: false, provider: "off", label: "AI second opinion not connected" },
      report: { connected: false, provider: "off", label: "AI not connected" },
    });
    expect(AI_REVIEW_NOT_CONNECTED).toBe("AI second opinion not connected");
    expect(AI_REPORT_NOT_CONNECTED).toBe("AI not connected");
  });

  it("names the Claude model", () => {
    expect(getAiStatus({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MODEL: "claude-opus-5" }).review).toEqual({
      connected: true,
      provider: "claude",
      model: "claude-opus-5",
      label: "AI second opinion connected (Claude, claude-opus-5)",
    });
  });

  it("reports webhooks and the mock reviewer as connected", () => {
    const status = getAiStatus({
      AI_REVIEW_WEBHOOK_URL: "https://ai.example.com/review",
      AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook",
    });
    expect(status.review).toMatchObject({ connected: true, provider: "webhook" });
    expect(status.report).toMatchObject({ connected: true, provider: "webhook" });
    expect(getAiStatus({ AI_REVIEW_PROVIDER: "mock" }).review).toMatchObject({
      connected: true,
      provider: "mock",
      label: expect.stringContaining("mock"),
    });
  });

  it("explains a misconfiguration without leaking secrets", () => {
    const status = getAiStatus({
      AI_REVIEW_PROVIDER: "webhook",
      ANTHROPIC_API_KEY: API_KEY,
      AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook?token=url-secret-token",
      AI_WEBHOOK_SECRET: "too-short",
    });
    expect(status.review).toMatchObject({
      connected: false,
      provider: "misconfigured",
      label: "AI second opinion not connected: configuration error",
      detail: expect.stringContaining("AI_REVIEW_WEBHOOK_URL"),
    });
    expect(status.report).toMatchObject({
      connected: false,
      provider: "misconfigured",
      detail: expect.stringContaining("AI_WEBHOOK_SECRET"),
    });

    const text = JSON.stringify(status);
    for (const secret of [API_KEY, "url-secret-token", "too-short", "reports.example.com"]) {
      expect(text).not.toContain(secret);
    }
  });

  it.each([
    ["AI_REVIEW_PROVIDER", { AI_REVIEW_PROVIDER: "sk-ant-api03-LEAKED-SECRET" }],
    ["AI_REVIEW_PROVIDER", { AI_REVIEW_PROVIDER: "https://hooks.example.com/x?token=LEAKED-SECRET" }],
    ["AI_REVIEW_MODEL", { ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MODEL: "ANTHROPIC_API_KEY=sk-ant-api03-LEAKED-SECRET" }],
    ["AI_REVIEW_MODEL", { ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MODEL: "LEAKED-SECRET-0123456789abcdef" }],
    ["AI_REVIEW_EFFORT", { ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_EFFORT: "sk-ant-api03-LEAKED-SECRET" }],
  ])("names %s without showing a secret pasted into it", (name, env) => {
    const status = getAiStatus(env);
    expect(status.review).toMatchObject({
      connected: false,
      provider: "misconfigured",
      detail: expect.stringContaining(name),
    });
    expect(status.review).not.toHaveProperty("model");
    expect(JSON.stringify(status)).not.toContain("LEAKED-SECRET");
  });

  it("never includes keys, secrets or URLs when connected", () => {
    const text = JSON.stringify(
      getAiStatus({
        AI_REVIEW_WEBHOOK_URL: "https://ai.example.com/review?token=url-secret-token",
        AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook",
        AI_WEBHOOK_SECRET: SECRET,
        ANTHROPIC_API_KEY: API_KEY,
      }),
    );
    for (const secret of [API_KEY, SECRET, "url-secret-token", "example.com"]) {
      expect(text).not.toContain(secret);
    }
  });
});
