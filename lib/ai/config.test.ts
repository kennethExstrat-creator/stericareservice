import { describe, expect, it } from "vitest";
import { readAiConfig, type AiEnv, type ReviewTarget } from "./config";

const WEBHOOK_URL = "https://ai.example.com/review?token=url-secret-token";
const API_KEY = "sk-ant-test-key-000";
const SECRET = "whsec_test_0123456789abcdef";

function review(env: AiEnv): ReviewTarget {
  return readAiConfig(env).review;
}

function problemsOf(target: { provider: string; problems?: string[] }): string {
  expect(target.provider).toBe("misconfigured");
  return (target.problems ?? []).join(" ");
}

describe("review provider resolution", () => {
  type Expected = ReviewTarget["provider"];
  const providers: Record<string, (hasUrl: boolean, hasKey: boolean) => Expected> = {
    "(unset)": (hasUrl, hasKey) => (hasUrl ? "webhook" : hasKey ? "claude" : "off"),
    auto: (hasUrl, hasKey) => (hasUrl ? "webhook" : hasKey ? "claude" : "off"),
    webhook: (hasUrl) => (hasUrl ? "webhook" : "misconfigured"),
    claude: (_hasUrl, hasKey) => (hasKey ? "claude" : "misconfigured"),
    mock: () => "mock",
    off: () => "off",
    openai: () => "misconfigured",
  };

  const cases = Object.entries(providers).flatMap(([provider, expected]) =>
    [false, true].flatMap((hasUrl) =>
      [false, true].map((hasKey) => ({ provider, hasUrl, hasKey, expected: expected(hasUrl, hasKey) })),
    ),
  );

  it.each(cases)(
    "AI_REVIEW_PROVIDER=$provider, webhook URL $hasUrl, API key $hasKey -> $expected",
    ({ provider, hasUrl, hasKey, expected }) => {
      const env: AiEnv = {
        AI_REVIEW_PROVIDER: provider === "(unset)" ? undefined : provider,
        AI_REVIEW_WEBHOOK_URL: hasUrl ? WEBHOOK_URL : undefined,
        ANTHROPIC_API_KEY: hasKey ? API_KEY : undefined,
      };
      expect(review(env).provider).toBe(expected);
    },
  );

  it("treats empty and blank strings as unset, as a copied .env.example has them", () => {
    const env = { AI_REVIEW_PROVIDER: "", AI_REVIEW_WEBHOOK_URL: "  ", ANTHROPIC_API_KEY: "", AI_REVIEW_MODEL: "" };
    expect(review(env)).toEqual({ provider: "off" });
    expect(readAiConfig(env).report).toEqual({ provider: "off" });
  });

  it("marks AI_REVIEW_PROVIDER=off as switched off on purpose, whatever else is set", () => {
    expect(review({ AI_REVIEW_PROVIDER: "off", ANTHROPIC_API_KEY: API_KEY })).toEqual({ provider: "off", switchedOff: true });
    expect(review({ AI_REVIEW_PROVIDER: "OFF" })).toEqual({ provider: "off", switchedOff: true });
    expect(review({ AI_REVIEW_PROVIDER: "auto" })).toEqual({ provider: "off" });
  });

  it("reads provider and effort case-insensitively and trims values", () => {
    const target = review({ AI_REVIEW_PROVIDER: " Claude ", ANTHROPIC_API_KEY: ` ${API_KEY} `, AI_REVIEW_EFFORT: "MAX" });
    expect(target).toEqual({
      provider: "claude",
      claude: { apiKey: API_KEY, model: "claude-opus-5-5", effort: "max", maxPhotos: 6 },
    });
  });

  it("defaults Claude to claude-opus-5-5 at high effort with 6 photos", () => {
    expect(review({ ANTHROPIC_API_KEY: API_KEY })).toEqual({
      provider: "claude",
      claude: { apiKey: API_KEY, model: "claude-opus-5-5", effort: "high", maxPhotos: 6 },
    });
  });

  it("passes the webhook URL and signing secret through", () => {
    expect(review({ AI_REVIEW_WEBHOOK_URL: WEBHOOK_URL, AI_WEBHOOK_SECRET: SECRET })).toEqual({
      provider: "webhook",
      webhook: { url: WEBHOOK_URL, secret: SECRET },
    });
  });

  it("names the variable to fix for every bad Claude setting", () => {
    const problems = problemsOf(
      review({
        ANTHROPIC_API_KEY: API_KEY,
        AI_REVIEW_MODEL: "claude opus",
        AI_REVIEW_EFFORT: "extreme",
        AI_REVIEW_MAX_PHOTOS: "100",
      }),
    );
    expect(problems).toContain("AI_REVIEW_MODEL");
    expect(problems).toContain("AI_REVIEW_EFFORT");
    expect(problems).toContain("AI_REVIEW_MAX_PHOTOS");
  });

  it("catches an API key pasted into AI_REVIEW_MODEL without echoing it", () => {
    const problems = problemsOf(review({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MODEL: "sk-ant-api03-pasted-here" }));
    expect(problems).toContain("AI_REVIEW_MODEL holds an API key");
    expect(problems).not.toContain("pasted-here");
  });

  it.each(["claude-opus-5-5", "claude-sonnet-4-5-20250929", "claude-2.1", "claude-opus-4-1@20250805"])(
    "accepts the model id %s",
    (model) => {
      expect(review({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MODEL: model })).toMatchObject({ claude: { model } });
    },
  );

  it.each(["opus", "Claude-Opus-5-5", "gpt-5", "anthropic.claude-opus-5-5"])("rejects the model id %s", (model) => {
    expect(problemsOf(review({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MODEL: model }))).toBe(
      "AI_REVIEW_MODEL must be a Claude model id, e.g. claude-opus-5-5.",
    );
  });

  it("lists the accepted values for the provider and the effort", () => {
    expect(problemsOf(review({ AI_REVIEW_PROVIDER: "openai" }))).toBe(
      "AI_REVIEW_PROVIDER must be one of auto, webhook, claude, mock or off.",
    );
    expect(problemsOf(review({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_EFFORT: "extreme" }))).toBe(
      "AI_REVIEW_EFFORT must be one of low, medium, high, xhigh or max.",
    );
  });

  it.each(["-1", "2.5", "lots"])("rejects AI_REVIEW_MAX_PHOTOS=%s", (value) => {
    expect(problemsOf(review({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MAX_PHOTOS: value }))).toContain(
      "AI_REVIEW_MAX_PHOTOS",
    );
  });

  it("allows AI_REVIEW_MAX_PHOTOS=0 for text-only reviews", () => {
    expect(review({ ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_MAX_PHOTOS: "0" })).toMatchObject({ claude: { maxPhotos: 0 } });
  });

  it("does not use Claude settings when the webhook wins in auto mode", () => {
    const env = { AI_REVIEW_WEBHOOK_URL: WEBHOOK_URL, ANTHROPIC_API_KEY: API_KEY, AI_REVIEW_EFFORT: "extreme" };
    expect(review(env).provider).toBe("webhook");
  });
});

describe("webhook URLs and the signing secret", () => {
  it.each([
    ["not a URL", "not a url"],
    ["another scheme", "ftp://ai.example.com/review"],
    ["embedded credentials", "https://user:pass@ai.example.com/review"],
  ])("rejects %s", (_label, url) => {
    expect(problemsOf(review({ AI_REVIEW_WEBHOOK_URL: url }))).toContain("AI_REVIEW_WEBHOOK_URL");
  });

  it("requires https in production, except on this machine", () => {
    const production = { NODE_ENV: "production" };
    expect(problemsOf(review({ ...production, AI_REVIEW_WEBHOOK_URL: "http://ai.example.com/review" }))).toContain(
      "https",
    );
    expect(review({ ...production, AI_REVIEW_WEBHOOK_URL: "http://localhost:3000/api/dev/mock-ai-review" }).provider).toBe(
      "webhook",
    );
    expect(review({ AI_REVIEW_WEBHOOK_URL: "http://192.168.1.20:5678/webhook" }).provider).toBe("webhook");
  });

  it("rejects a short secret for both hand-offs", () => {
    const config = readAiConfig({
      AI_REVIEW_WEBHOOK_URL: WEBHOOK_URL,
      AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook",
      AI_WEBHOOK_SECRET: "changeme",
    });
    expect(problemsOf(config.review)).toContain("AI_WEBHOOK_SECRET");
    expect(problemsOf(config.report)).toContain("AI_WEBHOOK_SECRET");
    expect(config.webhookSecret.ok).toBe(false);
  });

  it("never echoes URLs, keys or secrets in problems", () => {
    const config = readAiConfig({
      AI_REVIEW_PROVIDER: "claude",
      ANTHROPIC_API_KEY: API_KEY,
      AI_REVIEW_EFFORT: "extreme",
      AI_REPORT_WEBHOOK_URL: "https://user:url-secret-token@reports.example.com/hook",
      AI_WEBHOOK_SECRET: "short-secret",
    });
    const text = JSON.stringify([config.review, config.report]);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("url-secret-token");
    expect(text).not.toContain("short-secret");
  });
});

describe("a secret pasted on the wrong line", () => {
  // Problems reach the UI through getAiStatus(), so none may repeat the value it is about.
  const LEAKED = "LEAKED-SECRET";
  const values: Record<string, { value: string; isKey: boolean }> = {
    "an API key": { value: `sk-ant-api03-${LEAKED}`, isKey: true },
    "a quoted API key": { value: `"sk-ant-api03-${LEAKED}"`, isKey: true },
    "a KEY=value line": { value: `ANTHROPIC_API_KEY=sk-ant-api03-${LEAKED}`, isKey: true },
    "a URL with a token": { value: `https://hooks.example.com/x?token=${LEAKED}`, isKey: false },
    "a webhook secret": { value: `${LEAKED}-0123456789abcdef0123456789abcdef`, isKey: false },
  };
  const cases = ["AI_REVIEW_PROVIDER", "AI_REVIEW_MODEL", "AI_REVIEW_EFFORT"].flatMap((name) =>
    Object.entries(values).map(([label, { value, isKey }]) => ({ name, label, value, isKey })),
  );

  it.each(cases)("$name holding $label is misconfigured, named and never repeated", ({ name, value, isKey }) => {
    const target = review({ ANTHROPIC_API_KEY: API_KEY, [name]: value });
    const problems = problemsOf(target);
    expect(problems).toContain(name);
    expect(problems.includes(`${name} holds an API key`)).toBe(isKey);
    expect(JSON.stringify(target)).not.toContain(LEAKED);
  });
});

describe("report resolution", () => {
  it("is off without a URL and a webhook with one", () => {
    expect(readAiConfig({}).report).toEqual({ provider: "off" });
    expect(readAiConfig({ AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook" }).report).toEqual({
      provider: "webhook",
      webhook: { url: "https://reports.example.com/hook", secret: null },
    });
  });

  it("resolves independently of a misconfigured review", () => {
    const config = readAiConfig({ AI_REVIEW_PROVIDER: "bogus", AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook" });
    expect(config.review.provider).toBe("misconfigured");
    expect(config.report.provider).toBe("webhook");
  });
});

describe("mock reviewer", () => {
  it("is allowed outside production", () => {
    expect(readAiConfig({ NODE_ENV: "development" }).mockEnabled).toBe(true);
    expect(review({ NODE_ENV: "test", AI_REVIEW_PROVIDER: "mock" })).toEqual({ provider: "mock" });
  });

  it("is blocked in production unless ENABLE_MOCK_AI=true", () => {
    expect(readAiConfig({ NODE_ENV: "production" }).mockEnabled).toBe(false);
    expect(problemsOf(review({ NODE_ENV: "production", AI_REVIEW_PROVIDER: "mock" }))).toContain("ENABLE_MOCK_AI");
    expect(review({ NODE_ENV: "production", AI_REVIEW_PROVIDER: "mock", ENABLE_MOCK_AI: "true" })).toEqual({
      provider: "mock",
    });
    expect(readAiConfig({ NODE_ENV: "production", ENABLE_MOCK_AI: "yes" }).mockEnabled).toBe(false);
  });
});
