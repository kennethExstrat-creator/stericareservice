"use client";

// The dashboard's Activity section: its heading with the period picker
// beside it, above everything the period scopes (the tiles, the chart, the
// breakdowns). A choice replaces the address (?period=, no history entry
// per choice): the picker shows it at once, and what is below stays, dimmed,
// until the server has rendered the new period. No skeleton, nothing jumps,
// as on Steri-AI Cost.
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DASHBOARD_PERIOD_LABEL,
  DASHBOARD_PERIODS,
  dashboardHref,
  isDashboardPeriod,
  type DashboardPeriod,
} from "@/lib/admin/dashboard";
import { cn } from "@/lib/utils";

export function DashboardFrame({
  id,
  title,
  period,
  children,
}: {
  /** The heading's id, which names the section. */
  id: string;
  title: string;
  period: DashboardPeriod;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(period);

  function choose(value: string) {
    if (!isDashboardPeriod(value) || value === shown) return;
    startTransition(() => {
      setShown(value);
      router.replace(dashboardHref(value), { scroll: false });
    });
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        <Select value={shown} onValueChange={choose}>
          <SelectTrigger aria-label="Period" className="min-w-40" data-testid="dashboard-period">
            {/* The words given here also show before the browser has the picker's items (server render). */}
            <SelectValue>{DASHBOARD_PERIOD_LABEL[shown]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DASHBOARD_PERIODS.map((option) => (
              <SelectItem key={option} value={option}>
                {DASHBOARD_PERIOD_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div aria-busy={pending || undefined} className={cn("flex min-w-0 flex-col gap-6 transition-opacity", pending && "opacity-60")}>
        {children}
      </div>
    </section>
  );
}
