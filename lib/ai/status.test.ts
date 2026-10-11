import { describe, expect, it } from "vitest";
import {
  AI_REPORT_NOT_CONNECTED,
  AI_REPORT_NOT_CONNECTED_LABEL,
  AI_REVIEW_NOT_CONNECTED,
  AI_REVIEW_NOT_CONNECTED_LABEL,
  getAiStatus,
  reportNotConnectedMessage,
  reviewNotConnectedMessage,
} from "./status";
import { lowerCaseWords } from "@/lib/design/capitalisation";

const API_KEY = "sk-ant-test-key-000";
const SECRET = "whsec_test_0123456789abcdef";

describe("getAiStatus", () => {
  it("says not connected when nothing is configured", () => {
    expect(getAiStatus({})).toEqual({
      review: { connected: false, provider: "off", label: "Steri-AI Second Opinion Not Connected" },
      report: { connected: false, provider: "off", label: "Steri-AI Not Connected" },
    });
    // The labels (the panel's title, the report's pill) in Title Case; messages start with the sentence words.
    expect(AI_REVIEW_NOT_CONNECTED_LABEL).toBe("Steri-AI Second Opinion Not Connected");
    expect(AI_REPORT_NOT_CONNECTED_LABEL).toBe("Steri-AI Not Connected");
    expect(AI_REVIEW_NOT_CONNECTED).toBe("Steri-AI second opinion not connected");
    expect(AI_REPORT_NOT_CONNECTED).toBe("Steri-AI not connected");
  });

  it("tells AI_REVIEW_PROVIDER=off apart from nothing set up", () => {
    expect(getAiStatus({ AI_REVIEW_PROVIDER: "off", ANTHROPIC_API_KEY: API_KEY }).review).toEqual({
      connected: false,
      provider: "off",
      label: "Steri-AI Second Opinion Not Connected",
      switchedOff: true,
    });
    expect(getAiStatus({ AI_REVIEW_PROVIDER: "auto" }).review).not.toHaveProperty("switchedOff");
    expect(getAiStatus({ AI_REVIEW_PROVIDER: "" }).review).not.toHaveProperty("switchedOff");
  });

  it("names the Claude model", () => {
    expect(getAiStatus({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MODEL: "claude-opus-5" }).review).toEqual({
      connected: true,
      provider: "claude",
      model: "claude-opus-5",
      label: "Steri-AI Second Opinion Connected (Claude, claude-opus-5)",
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
      label: "Steri-AI Second Opinion: Mock Reviewer (Test Data Only)",
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
      label: "Steri-AI Second Opinion Not Connected: Configuration Error",
      detail: expect.stringContaining("AI_REVIEW_WEBHOOK_URL"),
    });
    expect(status.report).toMatchObject({
      connected: false,
      provider: "misconfigured",
      label: "Steri-AI Not Connected: Configuration Error",
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

describe("the labels and the messages", () => {
  const configured = {
    AI_REVIEW_WEBHOOK_URL: "https://ai.example.com/review",
    AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook",
    AI_WEBHOOK_SECRET: SECRET,
  };

  it("writes every label in Title Case (docs/DESIGN.md, Capitalisation)", () => {
    const labels = [
      getAiStatus({}).review.label,
      getAiStatus({}).report.label,
      getAiStatus(configured).review.label,
      getAiStatus(configured).report.label,
      getAiStatus({ AI_REVIEW_PROVIDER: "mock" }).review.label,
      getAiStatus({ AI_REVIEW_PROVIDER: "webhook", AI_REPORT_WEBHOOK_URL: "not a url" }).review.label,
      getAiStatus({ AI_REVIEW_PROVIDER: "webhook", AI_REPORT_WEBHOOK_URL: "not a url" }).report.label,
    ];
    expect(labels).toEqual([
      "Steri-AI Second Opinion Not Connected",
      "Steri-AI Not Connected",
      "Steri-AI Second Opinion Connected (Webhook)",
      "Steri-AI Report Connected (Webhook)",
      "Steri-AI Second Opinion: Mock Reviewer (Test Data Only)",
      "Steri-AI Second Opinion Not Connected: Configuration Error",
      "Steri-AI Not Connected: Configuration Error",
    ]);
    for (const label of labels) expect(lowerCaseWords(label)).toEqual([]);
  });

  it("words a message as a sentence, with what to fix after it", () => {
    expect(reviewNotConnectedMessage(getAiStatus({}).review)).toBe("Steri-AI second opinion not connected.");
    expect(reportNotConnectedMessage(getAiStatus({}).report)).toBe("Steri-AI not connected.");
    const misconfigured = getAiStatus({ AI_REVIEW_PROVIDER: "webhook", AI_REPORT_WEBHOOK_URL: "not a url" });
    expect(reviewNotConnectedMessage(misconfigured.review)).toMatch(
      /^Steri-AI second opinion not connected: configuration error\. .*AI_REVIEW_WEBHOOK_URL/,
    );
    expect(reportNotConnectedMessage(misconfigured.report)).toMatch(/^Steri-AI not connected: configuration error\. .*AI_REPORT_WEBHOOK_URL/);
  });
});
