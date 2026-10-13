"use client";

// Steri-AI Cost's filter row: the period, and the RM | USD switch (Kenneth,
// 13 October 2026: "give me currency toggle i can toggle on my own"),
// ringgit first, above everything they scope. The switch also keeps the
// viewer's choice on the device for the next visit (cost-currency.ts). A
// change replaces the address in the view frame's transition
// (useCostFilters): the picker shows the choice at once, the view dims until
// the server has rendered it. What the numbers are sits at the right, under
// the pickers below 1024 px: an estimate, Anthropic's bill in dollars final,
// and in ringgit the rate it was worked out at, its day and its source.
import { InfoIcon } from "lucide-react";
import { startTransition, use, useOptimistic } from "react";
import { PillSwitch, type PillOption } from "@/components/ui/pill-switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatInspectionDate } from "@/lib/inspections/format";
import { COST_PERIOD_LABEL, COST_PERIODS, type CostCurrency, type CostPeriod, type MyrRate } from "@/lib/schemas/ai-usage";
import { CostCurrencyViewer, rememberCurrency } from "./cost-currency";
import { formatMyrRate } from "./money";
import { useCostFilters } from "./view-frame";

const CURRENCIES: readonly PillOption<CostCurrency>[] = [
  { value: "myr", label: "RM" },
  { value: "usd", label: "USD" },
];

/** BNM's terms for its data: free to use, shown with "Source: Bank Negara Malaysia" and a link to them. */
const BNM_TERMS = "https://www.bnm.gov.my/terms-of-use-bnm-datasets";

/** An inline link in the note: 44 px on a touchscreen, as the cost view's other inline links. */
const NOTE_LINK =
  "rounded-sm font-medium underline underline-offset-4 focus-ring touch:inline-flex touch:min-h-11 touch:items-center";

function isPeriod(value: string): value is CostPeriod {
  return (COST_PERIODS as readonly string[]).includes(value);
}

/** "Estimated from token use; …" in the currency shown, with when counting started. */
function estimateNote(currency: CostCurrency, countedSince: string | null): string {
  const estimate =
    currency === "myr"
      ? "Estimated from token use; Anthropic's bill, in US dollars, is final. Ringgit figures move with the rate."
      : "Estimated from token use; Anthropic's bill is final.";
  return `${estimate}${countedSince ? ` Counted since ${countedSince}.` : ""}`;
}

/**
 * "Converted at RM 4.0823 per US$1 · 12 Oct 2026 · Source: Bank Negara Malaysia", or "· set in the price
 * list"; with BNM's rate built into the app (BNM not reached), a sentence saying so.
 */
function RateLine({ rate }: { rate: MyrRate }) {
  return (
    <>
      <p data-testid="cost-rate">
        {`Converted at ${formatMyrRate(rate.myrPerUsd)} per US$1 · ${formatInspectionDate(rate.on)} · `}
        {rate.source === "price_list" ? (
          <a href="#price-list" className={NOTE_LINK}>
            set in the price list
          </a>
        ) : (
          <a href={BNM_TERMS} target="_blank" rel="noopener noreferrer" className={NOTE_LINK}>
            Source: Bank Negara Malaysia
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </p>
      {rate.source === "built_in" && (
        <p data-testid="cost-rate-built-in">Bank Negara Malaysia could not be reached: this is the rate built into the app.</p>
      )}
    </>
  );
}

export function CostFilters({
  period,
  currency,
  rate,
  countedSince,
}: {
  period: CostPeriod;
  /** The currency the figures are in (the address's). */
  currency: CostCurrency;
  /** The rate ringgit is worked out at (lib/ai/myr-rate.ts). */
  rate: MyrRate;
  /** "13 Oct 2026" when the period starts before the first recorded call. */
  countedSince: string | null;
}) {
  const change = useCostFilters();
  const viewerId = use(CostCurrencyViewer);
  const [filters, setFilters] = useOptimistic({ period, currency });

  function apply(next: { period: CostPeriod; currency: CostCurrency }) {
    if (next.period === filters.period && next.currency === filters.currency) return;
    startTransition(() => {
      setFilters(next);
      change(next);
    });
  }

  function choosePeriod(value: string) {
    if (isPeriod(value)) apply({ ...filters, period: value });
  }

  function chooseCurrency(value: CostCurrency) {
    rememberCurrency(viewerId, value);
    apply({ ...filters, currency: value });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3" data-testid="cost-filters">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.period} onValueChange={choosePeriod}>
          <SelectTrigger aria-label="Period" className="min-w-40">
            {/* The words given here also show before the browser has the picker's items (server render). */}
            <SelectValue>{COST_PERIOD_LABEL[filters.period]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COST_PERIODS.map((option) => (
              <SelectItem key={option} value={option}>
                {COST_PERIOD_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PillSwitch value={filters.currency} options={CURRENCIES} onValueChange={chooseCurrency} label="Currency" data-testid="cost-currency" />
      </div>
      <div className="flex gap-1.5 text-sm text-muted-foreground max-lg:basis-full lg:ml-auto">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p>{estimateNote(currency, countedSince)}</p>
          {currency === "myr" && <RateLine rate={rate} />}
        </div>
      </div>
    </div>
  );
}
