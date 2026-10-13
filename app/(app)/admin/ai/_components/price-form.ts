// The price list as Edit Prices holds it (price-list.tsx): every value as
// typed, so a half-typed "0." survives, then read with the price list's own
// schema before anything is saved, and the fields it refuses highlighted.
// Pure, client-safe; the server action uses priceListMessage too.
import { AiPriceListSchema, DEFAULT_AI_PRICES, type AiPriceList, type TokenRates } from "@/lib/schemas/ai-prices";

export const RATE_KEYS = ["input", "output", "cacheWrite5m", "cacheWrite1h", "cacheRead"] as const;
export type RateKey = (typeof RATE_KEYS)[number];

export const RATE_LABEL: Readonly<Record<RateKey, string>> = {
  input: "Input",
  output: "Output",
  cacheWrite5m: "Cache Write (5 Min)",
  cacheWrite1h: "Cache Write (1 Hour)",
  cacheRead: "Cache Read",
};

/** "Prompts Over 100K Tokens": the long-prompt row's name (Claude Haiku 5.5), in the table and the form. */
export function longPromptLabel(aboveTokens: number): string {
  const size = aboveTokens % 1000 === 0 ? `${aboveTokens / 1000}K` : aboveTokens.toLocaleString("en-US");
  return `Prompts Over ${size} Tokens`;
}

export type RatesDraft = Record<RateKey, string>;

export type ModelDraft = {
  /** React's key: the id of one of the app's models, else "added-<n>". */
  key: string;
  model: string;
  /** One of the app's own models (DEFAULT_AI_PRICES): its id is fixed and it cannot be removed. */
  own: boolean;
  rates: RatesDraft;
  /** Rates for long prompts (Claude Haiku 5.5): above `aboveTokens`, the whole request. */
  longPrompt: { aboveTokens: number; rates: RatesDraft } | null;
};

export type PriceDraft = { checkedOn: string; myrPerUsd: string; myrRateOn: string; models: ModelDraft[] };

/** Field keys as the schema's paths, joined: "models.2.input", "models.2.longPrompt.input", "myrRateOn". */
export type DraftErrors = Readonly<Record<string, string>>;

export type DraftResult = { ok: true; list: AiPriceList } | { ok: false; message: string; errors: DraftErrors };

/** AiPriceListSchema's limit. */
export const MAX_MODELS = 30;

export const CHECK_PRICES = "Check the highlighted prices.";

const OWN_MODELS = new Set<string>(DEFAULT_AI_PRICES.models.map((entry) => entry.model));

const EMPTY_RATES: RatesDraft = { input: "", output: "", cacheWrite5m: "", cacheWrite1h: "", cacheRead: "" };

function ratesDraft(rates: TokenRates): RatesDraft {
  return {
    input: String(rates.input),
    output: String(rates.output),
    cacheWrite5m: String(rates.cacheWrite5m),
    cacheWrite1h: String(rates.cacheWrite1h),
    cacheRead: String(rates.cacheRead),
  };
}

export function toDraft(list: AiPriceList): PriceDraft {
  return {
    checkedOn: list.checkedOn,
    myrPerUsd: list.myrPerUsd === null ? "" : String(list.myrPerUsd),
    myrRateOn: list.myrRateOn ?? "",
    models: list.models.map((entry) => ({
      key: entry.model,
      model: entry.model,
      own: OWN_MODELS.has(entry.model),
      rates: ratesDraft(entry),
      longPrompt: entry.longPrompt ? { aboveTokens: entry.longPrompt.aboveTokens, rates: ratesDraft(entry.longPrompt) } : null,
    })),
  };
}

/** A row for a model the app does not offer (a fallback model, a dated snapshot), its id and prices empty. */
export function addModel(draft: PriceDraft, key: string): PriceDraft {
  if (draft.models.length >= MAX_MODELS) return draft;
  return { ...draft, models: [...draft.models, { key, model: "", own: false, rates: { ...EMPTY_RATES }, longPrompt: null }] };
}

/** Takes out an added model; the app's own stay. */
export function removeModel(draft: PriceDraft, key: string): PriceDraft {
  return { ...draft, models: draft.models.filter((entry) => entry.own || entry.key !== key) };
}

/** The 12 October list (DEFAULT_AI_PRICES) again, and the day it was checked; the admin's own rate stays as typed. */
export function withDefaultPrices(draft: PriceDraft): PriceDraft {
  const defaults = toDraft(DEFAULT_AI_PRICES);
  return { ...draft, checkedOn: defaults.checkedOn, models: defaults.models };
}

export function setModelId(draft: PriceDraft, key: string, model: string): PriceDraft {
  return { ...draft, models: draft.models.map((entry) => (entry.key === key && !entry.own ? { ...entry, model } : entry)) };
}

/** One price as typed; `longPrompt` for the long-prompt row. */
export function setRate(draft: PriceDraft, key: string, rate: RateKey, value: string, longPrompt = false): PriceDraft {
  return {
    ...draft,
    models: draft.models.map((entry) => {
      if (entry.key !== key) return entry;
      if (!longPrompt) return { ...entry, rates: { ...entry.rates, [rate]: value } };
      return entry.longPrompt ? { ...entry, longPrompt: { ...entry.longPrompt, rates: { ...entry.longPrompt.rates, [rate]: value } } } : entry;
    }),
  };
}

/** A typed number: blank is none (the schema asks for it); a decimal comma counts as a point. */
function toNumber(text: string): number {
  const value = text.trim().replace(",", ".");
  return value === "" ? Number.NaN : Number(value);
}

function rateNumbers(rates: RatesDraft): TokenRates {
  return {
    input: toNumber(rates.input),
    output: toNumber(rates.output),
    cacheWrite5m: toNumber(rates.cacheWrite5m),
    cacheWrite1h: toNumber(rates.cacheWrite1h),
    cacheRead: toNumber(rates.cacheRead),
  };
}

/** A zod issue, as much of it as the message needs. */
type Issue = { code: string; message: string; path: readonly PropertyKey[] };

/**
 * What the form and the server action say about a list the schema refused: a
 * model listed twice by its name, else "Check the highlighted prices.".
 */
export function priceListMessage(issues: readonly Issue[]): string {
  const twice = issues.find((issue) => issue.code === "custom" && issue.path[0] === "models" && issue.path[2] === "model");
  return twice?.message ?? CHECK_PRICES;
}

/**
 * RM per US$1 the admin's own rate may be, as lib/ai/myr-rate.ts takes Bank
 * Negara Malaysia's. The schema keeps up to 100 so a saved list always reads;
 * the form refuses a typo (40.86 for 4.086) that would show every cost ten
 * times over.
 */
const OWN_RATE_MIN = 1;
const OWN_RATE_MAX = 20;
const OWN_RATE_MESSAGE = "Enter a rate from 1 to 20, such as 4.09, or leave it blank.";

/** The draft as a price list, or what to fix: the message and each refused field's own words. */
export function parseDraft(draft: PriceDraft): DraftResult {
  const myrPerUsd = draft.myrPerUsd.trim() === "" ? null : toNumber(draft.myrPerUsd);
  const errors: Record<string, string> = {};
  if (myrPerUsd !== null && !(myrPerUsd >= OWN_RATE_MIN && myrPerUsd <= OWN_RATE_MAX)) errors.myrPerUsd = OWN_RATE_MESSAGE;
  const parsed = AiPriceListSchema.safeParse({
    checkedOn: draft.checkedOn,
    myrPerUsd,
    // A rate's date goes with the rate.
    myrRateOn: myrPerUsd === null ? null : draft.myrRateOn || null,
    models: draft.models.map((entry) => ({
      model: entry.model.trim(),
      ...rateNumbers(entry.rates),
      longPrompt: entry.longPrompt ? { aboveTokens: entry.longPrompt.aboveTokens, ...rateNumbers(entry.longPrompt.rates) } : null,
    })),
  });
  if (parsed.success) {
    return errors.myrPerUsd ? { ok: false, message: CHECK_PRICES, errors } : { ok: true, list: parsed.data };
  }
  for (const issue of parsed.error.issues) {
    const field = issue.path.join(".");
    errors[field] ??= fieldMessage(field, issue);
  }
  return { ok: false, message: priceListMessage(parsed.error.issues), errors };
}

/** The schema's own words, except where they are zod's ("Invalid input: expected number, received NaN"). */
function fieldMessage(field: string, issue: Issue): string {
  if (field === "myrPerUsd") return OWN_RATE_MESSAGE;
  if ((field === "checkedOn" || field === "myrRateOn") && issue.code !== "custom") return "Enter a date.";
  return issue.message;
}
