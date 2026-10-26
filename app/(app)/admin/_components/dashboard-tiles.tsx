// The dashboard's tiles. Open Inspections: what is not approved yet, each a
// link to the inspections list filtered to it. Activity: the period's
// inspections and their results, in the chart's order. Values keep
// proportional figures (tabular figures are for columns), and text keeps the
// text colours: a result's icon carries its colour. No hooks: the server
// renders them.
import Link from "next/link";
import { ArrowRightIcon, PencilLineIcon, RotateCcwIcon, SendIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StatusIcon } from "@/components/qc";
import { DASHBOARD_PERIOD_LABEL, RESULT_ORDER, type DashboardSummary, type ResultKey } from "@/lib/admin/dashboard";
import type { OpenCounts } from "@/lib/admin/dashboard-data";
import { STATUS_LABEL, STATUS_TEXT_CLASS } from "@/lib/design/status";
import { buildInspectionsHref } from "@/lib/inspections/search-params";
import { formatInspectionDate } from "@/lib/inspections/format";
import { cn } from "@/lib/utils";

const TILE = "flex min-w-0 flex-col gap-1 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6";

function Value({ children }: { children: number | null }) {
  return (
    <span className="text-3xl leading-tight font-semibold text-foreground">
      {children === null ? (
        // Not counted: a dash for the eye; the line under it says why.
        <span aria-hidden className="text-muted-foreground">
          —
        </span>
      ) : (
        children.toLocaleString("en-US")
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Open Inspections
 * ------------------------------------------------------------------ */

const OPEN: readonly { status: keyof OpenCounts; title: string; description: string; icon: LucideIcon }[] = [
  { status: "submitted", title: "Awaiting Approval", description: "Submitted, for you to approve or reopen.", icon: SendIcon },
  { status: "reopened", title: "Reopened", description: "Sent back to the inspector to change.", icon: RotateCcwIcon },
  { status: "draft", title: "Drafts", description: "Still being filled in.", icon: PencilLineIcon },
];

/** `counts` is null when they could not be read. */
export function OpenTiles({ counts }: { counts: OpenCounts | null }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3 xl:gap-6" data-testid="dashboard-open">
      {OPEN.map(({ status, title, description, icon: Icon }) => {
        const count = counts?.[status] ?? null;
        return (
          <li key={status}>
            <Link
              href={buildInspectionsHref({ status })}
              className={cn(
                TILE,
                // h-full: tiles in one row match height when one description wraps.
                "group h-full transition-colors hover:ring-brand-300 focus-ring",
                // Something to approve stands out.
                status === "submitted" && count !== null && count > 0 && "ring-brand-300",
              )}
            >
              <span className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="min-w-0 flex-1 font-display text-base font-bold text-foreground">{title}</span>
                <ArrowRightIcon aria-hidden className="size-5 shrink-0 text-slate-500 transition-colors group-hover:text-brand-600" />
              </span>
              <span className="mt-2">
                <Value>{count}</Value>
              </span>
              <span className="text-sm text-muted-foreground touch:text-base">
                {count === null ? "Could not be counted. Reload the page to try again." : description}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

function Tile({ label, value, sub, className }: { label: ReactNode; value: number; sub: string; className?: string }) {
  return (
    <div className={cn(TILE, className)}>
      <dt className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground touch:text-base">{label}</dt>
      <dd>
        <Value>{value}</Value>
      </dd>
      <dd className="text-sm text-muted-foreground">{sub}</dd>
    </div>
  );
}

/** "4 in the 30 days before", or since when inspections are counted. */
function comparison(summary: DashboardSummary): string {
  // Only Last 7, 30 and 90 days compare, so the period is the number of days.
  if (summary.previous !== null) return `${summary.previous.toLocaleString("en-US")} in the ${summary.period} days before`;
  return summary.since ? `Since ${formatInspectionDate(summary.since)}` : DASHBOARD_PERIOD_LABEL[summary.period];
}

function share(key: ResultKey, summary: DashboardSummary): string {
  const { totals } = summary;
  if (key === "not_done") return totals.not_done === 0 ? "Every inspection has a result" : "No result set yet";
  const decided = totals.total - totals.not_done;
  if (decided === 0) return "No results yet";
  return `${Math.round((totals[key] / decided) * 100)}% of ${decided.toLocaleString("en-US")} with a result`;
}

export function ActivityTiles({ summary }: { summary: DashboardSummary }) {
  return (
    // Below 1024 px the total takes a row of its own and the four results share the next, so no row has a gap.
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 xl:gap-6" data-testid="dashboard-tiles">
      <Tile label="Inspections" value={summary.totals.total} sub={comparison(summary)} className="col-span-2 md:col-span-4 lg:col-span-1" />
      {RESULT_ORDER.map((key) => (
        <Tile
          key={key}
          label={
            <>
              <StatusIcon status={key} className={cn("size-4 shrink-0", STATUS_TEXT_CLASS[key])} />
              {STATUS_LABEL[key]}
            </>
          }
          value={summary.totals[key]}
          sub={share(key, summary)}
        />
      ))}
    </dl>
  );
}
