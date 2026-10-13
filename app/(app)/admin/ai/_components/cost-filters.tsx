"use client";

// Steri-AI Cost's filter row: the period, and the RM | USD switch (Kenneth,
// 13 October 2026: "give me currency toggle i can toggle on my own"),
// ringgit first, above everything they scope. The switch also keeps the
// viewer's choice on the device for the next visit (cost-currency.ts). A
// change replaces the address in the view frame's transition
// (useCostFilters): the picker shows the choice at once, the view dims until
// the server has rendered it. What the numbers are sits at the right, under
// the pickers below 1024 px, as one short line (Kenneth, 13 October 2026:
// "simplify this, too crowded"): in ringgit the rate, its day and its
// source, in dollars that the figures are estimates. The rest is behind the
// "i" button, as on the media categories: Anthropic's bill in dollars is
// final, ringgit moves with the rate, when counting started, and when Bank
// Negara Malaysia could not be reached.
import { InfoIcon } from "lucide-react";
import { startTransition, use, useOptimistic } from "react";
import { Button } from "@/components/ui/button";
import { PillSwitch, type PillOption } from "@/components/ui/pill-switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/** What the figures are, behind the "i": one sentence a line. */
export function costNoteDetails(currency: CostCurrency, countedSince: string | null, rate: MyrRate): string[] {
  return [
    "Estimated from token use. Anthropic's bill, in US dollars, is final.",
    ...(currency === "myr" ? ["Ringgit figures move with the exchange rate."] : []),
    ...(countedSince ? [`Counted since ${countedSince}.`] : []),
    ...(currency === "myr" && rate.source === "built_in"
      ? ["Bank Negara Malaysia could not be reached, so this is the rate built into the app."]
      : []),
  ];
}

/**
 * "US$1 = RM 4.0823 · 12 Oct 2026 · Source: Bank Negara Malaysia", or "· set in the price list"; with
 * the rate built into the app (BNM not reached), "built-in rate" before the source.
 */
function RateLine({ rate }: { rate: MyrRate }) {
  return (
    <p data-testid="cost-rate">
      {`US$1 = ${formatMyrRate(rate.myrPerUsd)} · ${formatInspectionDate(rate.on)} · `}
      {rate.source === "built_in" && <span data-testid="cost-rate-built-in">built-in rate · </span>}
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
  );
}

/** The "i" before the note's line: what the figures are, in a popover (as on the media categories). */
function NoteDetails({ sentences }: { sentences: readonly string[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative shrink-0 text-muted-foreground hover:text-foreground"
          data-testid="cost-note-info"
        >
          <InfoIcon aria-hidden />
          <span className="sr-only">About These Figures</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-80 gap-1.5 text-sm touch:text-base">
        {sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </PopoverContent>
    </Popover>
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
      <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground max-lg:basis-full lg:ml-auto" data-testid="cost-note">
        <NoteDetails sentences={costNoteDetails(currency, countedSince, rate)} />
        {currency === "myr" ? <RateLine rate={rate} /> : <p>Estimated from token use</p>}
      </div>
    </div>
  );
}
