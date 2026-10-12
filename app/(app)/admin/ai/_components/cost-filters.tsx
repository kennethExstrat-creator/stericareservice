"use client";

// Steri-AI Cost's filter row: the period, and the currency once the price
// list has a MYR rate, above everything they scope. A change replaces the
// address in the view frame's transition (useCostFilters): the picker shows
// the choice at once, the view dims until the server has rendered it. The
// one sentence on what the numbers are sits at the right, under the pickers
// below 1024 px.
import { InfoIcon } from "lucide-react";
import { startTransition, useOptimistic } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COST_PERIOD_LABEL, COST_PERIODS, type CostCurrency, type CostPeriod } from "@/lib/schemas/ai-usage";
import { useCostFilters } from "./view-frame";

const CURRENCY_LABEL: Readonly<Record<CostCurrency, string>> = { usd: "USD", myr: "MYR" };

function isPeriod(value: string): value is CostPeriod {
  return (COST_PERIODS as readonly string[]).includes(value);
}

export function CostFilters({
  period,
  currency,
  hasMyrRate,
  countedSince,
}: {
  period: CostPeriod;
  currency: CostCurrency;
  /** The price list has a MYR rate, so costs can show in ringgit. */
  hasMyrRate: boolean;
  /** "13 Oct 2026" when the period starts before the first recorded call. */
  countedSince: string | null;
}) {
  const change = useCostFilters();
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

  function chooseCurrency(value: string) {
    if (value === "usd" || value === "myr") apply({ ...filters, currency: value });
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
        {hasMyrRate && (
          <Select value={filters.currency} onValueChange={chooseCurrency}>
            <SelectTrigger aria-label="Currency" className="min-w-24">
              <SelectValue>{CURRENCY_LABEL[filters.currency]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["usd", "myr"] as const).map((option) => (
                <SelectItem key={option} value={option}>
                  {CURRENCY_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="flex gap-1.5 text-sm text-muted-foreground max-lg:basis-full lg:ml-auto">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{`Estimated from token use; Anthropic's bill is final.${countedSince ? ` Counted since ${countedSince}.` : ""}`}</span>
      </p>
    </div>
  );
}
