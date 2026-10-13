// Steri-AI Settings' address: which view shows (?view=) and the cost view's
// filters (?period=, ?currency=), so a reload, a bookmark or Back opens the
// same view. Anything unknown falls back to the default. The address leaves
// the default period out but always names the currency, so a link shows what
// its sender saw; one without it (a link from elsewhere) opens on the
// viewer's remembered currency, else ringgit (view-frame.tsx,
// cost-currency.ts). Pure: the page reads it, the view frame writes it.

import {
  COST_CURRENCIES,
  COST_PERIODS,
  DEFAULT_COST_CURRENCY,
  DEFAULT_COST_PERIOD,
  type CostCurrency,
  type CostPeriod,
} from "@/lib/schemas/ai-usage";

export { DEFAULT_COST_CURRENCY, DEFAULT_COST_PERIOD, type CostCurrency, type CostPeriod };

/** ADMIN_AI_PATH in components/shell/nav.ts (server only, so not imported here). */
const AI_PATH = "/admin/ai";

export const AI_VIEWS = ["general", "inspection", "cost"] as const;
export type AiView = (typeof AI_VIEWS)[number];

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

/** The address of a view: /admin/ai for General; only the cost view carries filters, its currency always. */
export function aiViewHref(state: AiViewState): string {
  if (state.view === "general") return AI_PATH;
  const query = new URLSearchParams({ view: state.view });
  if (state.view === "cost") {
    if (state.period !== DEFAULT_COST_PERIOD) query.set("period", state.period);
    query.set("currency", state.currency);
  }
  return `${AI_PATH}?${query}`;
}
