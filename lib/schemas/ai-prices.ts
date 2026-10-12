// Steri-AI's price list (docs/AI.md, "Steri-AI Cost"): what each Claude model
// costs per million tokens, so each call's cost can be worked out when it is
// made (lib/ai/usage.ts). Kept in ai_settings.prices, edited in Steri-AI
// Settings > Steri-AI Cost; null there means DEFAULT_AI_PRICES. Client-safe.
import { z } from "zod";
import { ClaudeModelIdSchema } from "./ai-settings";
import { IsoDateSchema } from "./common";

/** USD per million tokens. */
const RateSchema = z
  .number({ error: "Enter a price in USD." })
  .min(0, { error: "A price cannot be below 0." })
  .max(1000, { error: "Check this price: over 1,000 USD per million tokens." });

/** One model's prices for each kind of token, USD per million tokens. */
export const TokenRatesSchema = z.object({
  input: RateSchema,
  output: RateSchema,
  /** Writing the prompt cache with a 5-minute life (1.25x input). */
  cacheWrite5m: RateSchema,
  /** Writing the prompt cache with a 1-hour life (2x input). */
  cacheWrite1h: RateSchema,
  /** Reading the prompt cache. */
  cacheRead: RateSchema,
});
export type TokenRates = z.infer<typeof TokenRatesSchema>;

export const ModelPriceSchema = TokenRatesSchema.extend({
  model: ClaudeModelIdSchema,
  /** Rates for a whole request whose prompt (input + cache writes + cache reads) is over aboveTokens, output included. Claude Haiku 5.5 only today. */
  longPrompt: TokenRatesSchema.extend({ aboveTokens: z.number().int().positive() }).nullable(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const AiPriceListSchema = z
  .object({
    /** The day an admin last checked the prices against Anthropic's pricing page. */
    checkedOn: IsoDateSchema,
    models: z.array(ModelPriceSchema).min(1).max(30),
    /** Ringgit per US dollar, to show costs in MYR; null shows USD only. */
    myrPerUsd: z.number().positive().max(100).nullable(),
    myrRateOn: IsoDateSchema.nullable(),
  })
  .superRefine((list, context) => {
    const seen = new Set<string>();
    list.models.forEach((entry, index) => {
      if (seen.has(entry.model)) {
        context.addIssue({ code: "custom", path: ["models", index, "model"], message: `"${entry.model}" is in the list twice.` });
      }
      seen.add(entry.model);
    });
    if (list.myrPerUsd !== null && list.myrRateOn === null) {
      context.addIssue({ code: "custom", path: ["myrRateOn"], message: "Enter the date of the MYR rate." });
    }
  });
export type AiPriceList = z.infer<typeof AiPriceListSchema>;

/*
 * Anthropic's prices for the models the app offers (CLAUDE_MODELS), read on
 * 12 October 2026 (UTC) from https://platform.claude.com/docs/en/about-claude/pricing
 * and checked against each model's page (/docs/en/models/opus-5-5/overview,
 * sonnet-5-5, haiku-5-5) and https://claude.com/pricing. USD per million
 * tokens, Claude API, standard (global) inference.
 *
 * Cache writes cost 1.25x input (5 minutes) and 2x input (1 hour). Cache
 * reads cost 0.05x input on Opus and Sonnet 5.5, 0.1x on Haiku 5.5. Haiku
 * 5.5 prices a whole request at the higher rates when its prompt is over
 * 100,000 tokens. Do not copy the bundled claude-api skill's Sonnet 5.5
 * cache read (0.20): the live pages say 0.10.
 */
export const DEFAULT_AI_PRICES: AiPriceList = {
  checkedOn: "2026-10-12",
  myrPerUsd: null,
  myrRateOn: null,
  models: [
    { model: "claude-opus-5-5", input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, longPrompt: null },
    { model: "claude-sonnet-5-5", input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, longPrompt: null },
    {
      model: "claude-haiku-5-5",
      input: 0.1,
      output: 0.5,
      cacheWrite5m: 0.125,
      cacheWrite1h: 0.2,
      cacheRead: 0.01,
      longPrompt: { aboveTokens: 100_000, input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 },
    },
  ],
};

/** usage.inference_geo 'us' bills every token category 1.1x; the Batch API 0.5x (never used today). */
export const US_INFERENCE_MULTIPLIER = 1.1;
export const BATCH_MULTIPLIER = 0.5;

/**
 * A saved list plus any default model it lacks (new code defaults appear;
 * saved values win). The app's own models cannot be removed: they come
 * first, in DEFAULT_AI_PRICES' order, then the models an admin added.
 */
export function withDefaultModels(list: AiPriceList): AiPriceList {
  const saved = new Map(list.models.map((entry) => [entry.model, entry]));
  const defaults = DEFAULT_AI_PRICES.models.map((entry) => saved.get(entry.model) ?? entry);
  const own = new Set(DEFAULT_AI_PRICES.models.map((entry) => entry.model));
  return { ...list, models: [...defaults, ...list.models.filter((entry) => !own.has(entry.model))] };
}

/** A dated snapshot of a listed model: the listed id, "-" and the date (claude-opus-5-5-20260922). */
const SNAPSHOT_SUFFIX = /^-\d{8}$/;

/**
 * The rates for `model` at this prompt size: the exact id first, else the
 * longest listed id it is a dated snapshot of (claude-opus-5-5-20260922
 * takes claude-opus-5-5's prices; claude-opus-4-8 never takes claude-opus-4's);
 * the long-prompt rates when promptTokens is over their aboveTokens. Null
 * when the model has no price.
 */
export function priceFor(list: AiPriceList, model: string, promptTokens: number): TokenRates | null {
  const exact = list.models.find((entry) => entry.model === model);
  const entry =
    exact ??
    list.models
      .filter((candidate) => model.startsWith(candidate.model) && SNAPSHOT_SUFFIX.test(model.slice(candidate.model.length)))
      .sort((a, b) => b.model.length - a.model.length)[0];
  if (!entry) return null;
  const rates = entry.longPrompt && promptTokens > entry.longPrompt.aboveTokens ? entry.longPrompt : entry;
  return {
    input: rates.input,
    output: rates.output,
    cacheWrite5m: rates.cacheWrite5m,
    cacheWrite1h: rates.cacheWrite1h,
    cacheRead: rates.cacheRead,
  };
}
