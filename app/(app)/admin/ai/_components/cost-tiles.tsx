// Steri-AI Cost's three headline numbers: the period's total, the cost of an
// inspection, and a month at this rate. Big values keep proportional figures
// (tabular figures are for columns). No hooks: the server renders them.
import type { CostTotals } from "@/lib/schemas/ai-usage";
import { countOf, formatCost, type Money } from "./money";

/** perMonthUsd needs this many days counted (lib/ai/cost-report.ts). */
const DAYS_FOR_MONTH_RATE = 7;

function Tile({ label, value, sub }: { label: string; value: string | null; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6">
      <dt className="text-sm font-medium text-muted-foreground touch:text-base">{label}</dt>
      <dd className="text-3xl leading-tight font-semibold text-foreground">
        {value ?? (
          // No value yet: a dash for the eye; the line under it says why.
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
        )}
      </dd>
      <dd className="text-sm text-muted-foreground">{sub}</dd>
    </div>
  );
}

export function CostTiles({ totals, money }: { totals: CostTotals; money: Money }) {
  const calls = [
    countOf(totals.calls, "call", "calls"),
    totals.failed > 0 && `${totals.failed.toLocaleString("en-US")} failed`,
    totals.unpricedCalls > 0 && `${totals.unpricedCalls.toLocaleString("en-US")} with no price`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <dl className="grid gap-4 sm:grid-cols-3" data-testid="cost-kpis">
      <Tile label="Total Cost" value={formatCost(totals.costUsd, money)} sub={calls} />
      <Tile
        label="Per Inspection"
        value={totals.perInspectionUsd === null ? null : formatCost(totals.perInspectionUsd, money)}
        sub={totals.inspections > 0 ? countOf(totals.inspections, "inspection", "inspections") : "No inspections yet"}
      />
      <Tile
        label="Per Month"
        value={totals.perMonthUsd === null ? null : formatCost(totals.perMonthUsd, money)}
        sub={totals.perMonthUsd === null ? `After ${DAYS_FOR_MONTH_RATE} days of use` : "At this rate"}
      />
    </dl>
  );
}
