// Steri-AI Settings' address: which view shows (?view=) and the cost view's
// filters (?period=, ?currency=), so a reload, a bookmark or Back opens the
// same view. Anything unknown falls back to the default, and the address
// leaves defaults out. Pure: the page reads it, the view frame writes it.

import { COST_PERIODS, DEFAULT_COST_PERIOD, type CostCurrency, type CostPeriod } from "@/lib/schemas/ai-usage";

export { DEFAULT_COST_PERIOD, type CostCurrency, type CostPeriod };

/** ADMIN_AI_PATH in components/shell/nav.ts (server only, so not imported here). */
const AI_PATH = "/admin/ai";

export const AI_VIEWS = ["general", "inspection", "cost"] as const;
export type AiView = (typeof AI_VIEWS)[number];

/** The currency the cost view shows amounts in: US dollars, as Anthropic bills, or ringgit (once the price list has a rate). */
const COST_CURRENCIES: readonly CostCurrency[] = ["usd", "myr"];
export const DEFAULT_COST_CURRENCY: CostCurrency = "usd";

export type CostFilters = { period: CostPeriod; currency: CostCurrency };

export type AiViewState = { view: "general" | "inspection" } | ({ view: "cost" } & CostFilters);

type SearchParams = Record<string, string | string[] | undefined>;

function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return allowed.find((option) => option === value) ?? fallback;
}

/** The view an address asks for: General unless ?view= names another. */
export function parseAiViewState(params: SearchParams): AiViewState {
  const view = pick(params.view, AI_VIEWS, "general");
  if (view !== "cost") return { view };
  return {
    view,
    period: pick(params.period, COST_PERIODS, DEFAULT_COST_PERIOD),
    currency: pick(params.currency, COST_CURRENCIES, DEFAULT_COST_CURRENCY),
  };
}

/** The address of a view: /admin/ai for General; only the cost view carries filters. */
export function aiViewHref(state: AiViewState): string {
  if (state.view === "general") return AI_PATH;
  const query = new URLSearchParams({ view: state.view });
  if (state.view === "cost") {
    if (state.period !== DEFAULT_COST_PERIOD) query.set("period", state.period);
    if (state.currency !== DEFAULT_COST_CURRENCY) query.set("currency", state.currency);
  }
  return `${AI_PATH}?${query}`;
}
