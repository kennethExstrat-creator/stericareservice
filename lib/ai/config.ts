import "server-only";
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * AI configuration from the environment (.env.example, "AI hand-offs")
 *
 * Read on every call, never at import: a missing or invalid variable
 * resolves to "off" or "misconfigured" for that hand-off instead of
 * crashing the app. The review and the report resolve independently.
 *
 * Problems name the variable and what it accepts but never repeat its
 * value: they reach the UI through getAiStatus(), and a key or a URL
 * with a token pasted on the wrong line must not.
 * ------------------------------------------------------------------ */

export type AiEnv = Readonly<Record<string, string | undefined>>;

export const AI_REVIEW_PROVIDERS = ["auto", "webhook", "claude", "mock", "off"] as const;
export const AI_REVIEW_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiReviewEffort = (typeof AI_REVIEW_EFFORTS)[number];

export const DEFAULT_REVIEW_MODEL = "claude-opus-5-5";
export const DEFAULT_REVIEW_EFFORT: AiReviewEffort = "high";
/** Photos attached to a Claude review, include-in-report ones first. Each costs input tokens. */
export const DEFAULT_REVIEW_MAX_PHOTOS = 6;
export const REVIEW_MAX_PHOTOS_LIMIT = 20;
const MIN_SECRET_LENGTH = 16;

const ProviderSchema = z.enum(AI_REVIEW_PROVIDERS);
const EffortSchema = z.enum(AI_REVIEW_EFFORTS);
/**
 * A Claude API model id (claude-opus-5-5, claude-sonnet-4-5-20250929). The
 * status label shows it, so a secret pasted here must not pass as one.
 */
const ModelSchema = z.string().max(100).regex(/^claude-[a-z0-9][a-z0-9.:@_-]*$/);

export interface WebhookTarget {
  url: string;
  /** Signs requests when set (X-SteriCare-Signature). */
  secret: string | null;
}

export interface ClaudeSettings {
  apiKey: string;
  model: string;
  effort: AiReviewEffort;
  maxPhotos: number;
}

export type ReviewTarget =
  | { provider: "webhook"; webhook: WebhookTarget }
  | { provider: "claude"; claude: ClaudeSettings }
  | { provider: "mock" }
  | { provider: "off" }
  | { provider: "misconfigured"; problems: string[] };

export type ReportTarget =
  | { provider: "webhook"; webhook: WebhookTarget }
  | { provider: "off" }
  | { provider: "misconfigured"; problems: string[] };

export type WebhookSecret = { ok: true; value: string | null } | { ok: false; problem: string };

export interface AiConfig {
  review: ReviewTarget;
  report: ReportTarget;
  webhookSecret: WebhookSecret;
  /** The mock reviewer and the /api/dev mock receivers: off in production unless ENABLE_MOCK_AI=true. */
  mockEnabled: boolean;
}

export function readAiConfig(env: AiEnv = process.env): AiConfig {
  const production = read(env, "NODE_ENV") === "production";
  const mockEnabled = !production || read(env, "ENABLE_MOCK_AI")?.toLowerCase() === "true";
  const webhookSecret = readSecret(env);
  const context: ResolveContext = { env, production, webhookSecret };
  return {
    review: resolveReview(context, mockEnabled),
    report: resolveReport(context),
    webhookSecret,
    mockEnabled,
  };
}

interface ResolveContext {
  env: AiEnv;
  production: boolean;
  webhookSecret: WebhookSecret;
}

function resolveReview(context: ResolveContext, mockEnabled: boolean): ReviewTarget {
  const { env } = context;
  const rawProvider = read(env, "AI_REVIEW_PROVIDER") ?? "auto";
  const provider = ProviderSchema.safeParse(rawProvider.toLowerCase());
  if (!provider.success) {
    return misconfigured(invalidValue("AI_REVIEW_PROVIDER", oneOf(AI_REVIEW_PROVIDERS), rawProvider));
  }

  const webhookUrl = read(env, "AI_REVIEW_WEBHOOK_URL");
  const apiKey = read(env, "ANTHROPIC_API_KEY");

  switch (provider.data) {
    case "off":
      return { provider: "off" };
    case "mock":
      return mockEnabled
        ? { provider: "mock" }
        : misconfigured(
            "AI_REVIEW_PROVIDER=mock is disabled in production. Set ENABLE_MOCK_AI=true to allow it on a preview deployment.",
          );
    case "webhook":
      return webhookUrl
        ? reviewWebhook(context, webhookUrl)
        : misconfigured("AI_REVIEW_PROVIDER is webhook but AI_REVIEW_WEBHOOK_URL is not set.");
    case "claude":
      return apiKey
        ? reviewClaude(env, apiKey)
        : misconfigured("AI_REVIEW_PROVIDER is claude but ANTHROPIC_API_KEY is not set.");
    case "auto":
      if (webhookUrl) return reviewWebhook(context, webhookUrl);
      if (apiKey) return reviewClaude(env, apiKey);
      return { provider: "off" };
  }
}

function reviewWebhook(context: ResolveContext, rawUrl: string): ReviewTarget {
  const target = webhookTarget(context, "AI_REVIEW_WEBHOOK_URL", rawUrl);
  return target.ok ? { provider: "webhook", webhook: target.webhook } : misconfigured(...target.problems);
}

function reviewClaude(env: AiEnv, apiKey: string): ReviewTarget {
  const problems: string[] = [];

  const rawModel = read(env, "AI_REVIEW_MODEL") ?? DEFAULT_REVIEW_MODEL;
  if (!ModelSchema.safeParse(rawModel).success) {
    problems.push(invalidValue("AI_REVIEW_MODEL", `a Claude model id, e.g. ${DEFAULT_REVIEW_MODEL}`, rawModel));
  }

  const rawEffort = read(env, "AI_REVIEW_EFFORT") ?? DEFAULT_REVIEW_EFFORT;
  const effort = EffortSchema.safeParse(rawEffort.toLowerCase());
  if (!effort.success) {
    problems.push(invalidValue("AI_REVIEW_EFFORT", oneOf(AI_REVIEW_EFFORTS), rawEffort));
  }

  const rawMaxPhotos = read(env, "AI_REVIEW_MAX_PHOTOS");
  const maxPhotos = rawMaxPhotos === undefined ? DEFAULT_REVIEW_MAX_PHOTOS : Number(rawMaxPhotos);
  if (!Number.isInteger(maxPhotos) || maxPhotos < 0 || maxPhotos > REVIEW_MAX_PHOTOS_LIMIT) {
    problems.push(`AI_REVIEW_MAX_PHOTOS must be a whole number from 0 to ${REVIEW_MAX_PHOTOS_LIMIT}.`);
  }

  if (problems.length > 0 || !effort.success) return misconfigured(...problems);
  return { provider: "claude", claude: { apiKey, model: rawModel, effort: effort.data, maxPhotos } };
}

function resolveReport(context: ResolveContext): ReportTarget {
  const rawUrl = read(context.env, "AI_REPORT_WEBHOOK_URL");
  if (!rawUrl) return { provider: "off" };
  const target = webhookTarget(context, "AI_REPORT_WEBHOOK_URL", rawUrl);
  return target.ok ? { provider: "webhook", webhook: target.webhook } : misconfigured(...target.problems);
}

type WebhookTargetResult = { ok: true; webhook: WebhookTarget } | { ok: false; problems: string[] };

function webhookTarget(context: ResolveContext, name: string, rawUrl: string): WebhookTargetResult {
  const problems: string[] = [];
  const url = parseWebhookUrl(name, rawUrl, context.production);
  if (!url.ok) problems.push(url.problem);
  if (!context.webhookSecret.ok) problems.push(context.webhookSecret.problem);
  if (!url.ok || !context.webhookSecret.ok) return { ok: false, problems };
  return { ok: true, webhook: { url: url.value, secret: context.webhookSecret.value } };
}

function parseWebhookUrl(
  name: string,
  raw: string,
  production: boolean,
): { ok: true; value: string } | { ok: false; problem: string } {
  // Values are never echoed back: a webhook URL can carry an access token.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: `${name} is not a valid URL.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, problem: `${name} must be an https:// URL.` };
  }
  // fetch() rejects URLs with credentials; AI_WEBHOOK_SECRET authenticates instead.
  if (url.username || url.password) {
    return { ok: false, problem: `${name} must not contain a user name or password.` };
  }
  if (production && url.protocol === "http:" && !isLoopback(url.hostname)) {
    return { ok: false, problem: `${name} must use https:// in production.` };
  }
  return { ok: true, value: url.toString() };
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function readSecret(env: AiEnv): WebhookSecret {
  const value = read(env, "AI_WEBHOOK_SECRET");
  if (value === undefined) return { ok: true, value: null };
  if (value.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      problem: `AI_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters, e.g. the output of \`openssl rand -hex 32\`.`,
    };
  }
  return { ok: true, value };
}

function misconfigured(...problems: string[]): { provider: "misconfigured"; problems: string[] } {
  return { provider: "misconfigured", problems };
}

/** What to fix, without the value itself (see the header comment). */
function invalidValue(name: string, expected: string, raw: string): string {
  return looksLikeApiKey(raw)
    ? `${name} holds an API key. Move the key to ANTHROPIC_API_KEY and set ${name} to ${expected}.`
    : `${name} must be ${expected}.`;
}

/** An sk- key, also when quoted or pasted with its variable name. */
function looksLikeApiKey(value: string): boolean {
  return /(?:^|[^A-Za-z0-9])sk-/.test(value);
}

/** "one of low, medium, high, xhigh or max" */
function oneOf(values: readonly string[]): string {
  return `one of ${values.slice(0, -1).join(", ")} or ${values.at(-1)}`;
}

/** Trimmed value; empty strings count as unset. */
function read(env: AiEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}
