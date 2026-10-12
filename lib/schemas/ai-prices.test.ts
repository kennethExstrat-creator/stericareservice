import { describe, expect, it } from "vitest";
import { AiPriceListSchema, DEFAULT_AI_PRICES, priceFor, withDefaultModels, type AiPriceList, type ModelPrice } from "./ai-prices";
import { CLAUDE_MODELS } from "./ai-settings";

const issues = (list: unknown) => {
  const parsed = AiPriceListSchema.safeParse(list);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
};

const extra: ModelPrice = {
  model: "claude-opus-4-8",
  input: 5,
  output: 25,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
  cacheRead: 0.5,
  longPrompt: null,
};

describe("the price list", () => {
  it("starts with Anthropic's prices for every model the app offers", () => {
    expect(AiPriceListSchema.parse(DEFAULT_AI_PRICES)).toEqual(DEFAULT_AI_PRICES);
    expect(DEFAULT_AI_PRICES.models.map((entry) => entry.model)).toEqual(CLAUDE_MODELS.map((entry) => entry.id));
  });

  it("refuses a model listed twice, a MYR rate without its date and prices out of range", () => {
    const opus = DEFAULT_AI_PRICES.models[0];
    expect(issues({ ...DEFAULT_AI_PRICES, models: [...DEFAULT_AI_PRICES.models, opus] })).toEqual([
      { path: ["models", 3, "model"], message: '"claude-opus-5-5" is in the list twice.' },
    ]);
    expect(issues({ ...DEFAULT_AI_PRICES, myrPerUsd: 4.72 })).toEqual([{ path: ["myrRateOn"], message: "Enter the date of the MYR rate." }]);
    expect(issues({ ...DEFAULT_AI_PRICES, myrPerUsd: 4.72, myrRateOn: "2026-10-01" })).toEqual([]);
    expect(issues({ ...DEFAULT_AI_PRICES, models: [{ ...opus, input: -1, output: 1001 }] })).toEqual([
      { path: ["models", 0, "input"], message: "A price cannot be below 0." },
      { path: ["models", 0, "output"], message: "Check this price: over 1,000 USD per million tokens." },
    ]);
    expect(issues({ ...DEFAULT_AI_PRICES, models: [{ ...opus, model: "gpt-5" }] })).toHaveLength(1);
  });

  it("keeps the app's own models in a saved list, saved prices winning, and the models an admin added after them", () => {
    const saved: AiPriceList = {
      ...DEFAULT_AI_PRICES,
      checkedOn: "2026-11-01",
      models: [extra, { ...DEFAULT_AI_PRICES.models[0], input: 3 }],
    };
    const list = withDefaultModels(saved);
    expect(list.checkedOn).toBe("2026-11-01");
    expect(list.models.map((entry) => entry.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-4-8"]);
    expect(list.models[0].input).toBe(3);
    expect(withDefaultModels(DEFAULT_AI_PRICES)).toEqual(DEFAULT_AI_PRICES);
  });

  it("finds a model's rates: exact, a dated snapshot, the long-prompt rates over their threshold, else none", () => {
    expect(priceFor(DEFAULT_AI_PRICES, "claude-sonnet-5-5", 1_000)).toEqual({ input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 });
    expect(priceFor(DEFAULT_AI_PRICES, "claude-sonnet-5-5-20260928", 1_000)?.input).toBe(2);
    expect(priceFor(DEFAULT_AI_PRICES, "claude-haiku-5-5", 100_000)?.input).toBe(0.1);
    expect(priceFor(DEFAULT_AI_PRICES, "claude-haiku-5-5", 100_001)).toEqual({ input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 });
    // Another version is not a snapshot: it needs its own price.
    expect(priceFor({ ...DEFAULT_AI_PRICES, models: [{ ...extra, model: "claude-opus-4" }] }, "claude-opus-4-8", 10)).toBeNull();
    expect(priceFor(DEFAULT_AI_PRICES, "claude-opus-4-8", 10)).toBeNull();
  });
});
