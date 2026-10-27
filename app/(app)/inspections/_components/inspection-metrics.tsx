// The counts above the list (Kenneth, 27 October 2026: "build a few metrics
// at the top of inspection"): one tile per workflow state, each a link that
// filters the list to it, then the inspections dated this month. They count
// what the user sees (Row Level Security) under the search, client and
// manufacturer filters, never the status filter, so a tile's count is what
// choosing it lists (countInspections in lib/inspections/query.ts). The
// chosen state's tile shows as chosen (aria-current); choosing it again lists
// every state. Links keep the other filters and start again at page 1.
//
// The admin dashboard's tiles (dashboard-tiles.tsx), smaller for a working
// list. Workflow states keep the status badge's icons in brand blue and
// slate, never the result colours; text keeps the text colours, and values
// proportional figures. No hooks: the server renders them.
import { CalendarDaysIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { InspectionCounts } from "@/lib/inspections/query";
import { buildInspectionsHref, type InspectionListFilters } from "@/lib/inspections/search-params";
import type { InspectionStatus } from "@/lib/schemas/common";
import { cn } from "@/lib/utils";
import { INSPECTION_STATUS_ICON } from "./inspection-status-badge";
import { ListLink } from "./list-link";

/** In the order of the workflow; icons in the badge's tones (inspection-status-badge.tsx). */
const STATUS_TILES: readonly { status: InspectionStatus; label: string; tone: string }[] = [
  { status: "draft", label: "Drafts", tone: "text-slate-500" },
  { status: "submitted", label: "Submitted", tone: "text-brand-600" },
  { status: "reopened", label: "Reopened", tone: "text-brand-600" },
  { status: "approved", label: "Approved", tone: "text-slate-500" },
];

// Short, so the table stays high on an iPad in landscape. h-full: the tiles
// in a row match heights when a label wraps. relative: it anchors the sr-only text.
const TILE = "relative flex h-full min-w-0 flex-col gap-1.5 rounded-xl px-4 py-3";

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** "October 2026" for 2026-10-01: a calendar month, so formatted in UTC and never shifted. */
function monthName(firstDay: string): string {
  const [year, month] = firstDay.split("-").map(Number);
  return MONTH.format(new Date(Date.UTC(year, month - 1, 1)));
}

function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground touch:text-base">
      {icon}
      {children}
    </span>
  );
}

function Value({ count }: { count: number | null }) {
  return (
    // leading-none: figures have no descenders, so the line needs no room below them.
    <span className="text-2xl leading-none font-semibold text-foreground">
      {count === null ? (
        // Not counted: a dash for the eye, the words for screen readers. The list still shows.
        <span title="Could not be counted. Reload the page to try again." className="text-muted-foreground">
          <span aria-hidden>—</span>
          <span className="sr-only">Not counted</span>
        </span>
      ) : (
        count.toLocaleString("en-US")
      )}
    </span>
  );
}

export function InspectionMetrics({ filters, counts }: { filters: InspectionListFilters; counts: InspectionCounts }) {
  const month = monthName(counts.month);
  return (
    <ul
      aria-label="Inspection counts"
      data-testid="inspection-metrics"
      className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:gap-4"
    >
      {STATUS_TILES.map(({ status, label, tone }) => {
        const Icon = INSPECTION_STATUS_ICON[status];
        const chosen = filters.status === status;
        return (
          <li key={status}>
            <ListLink
              href={buildInspectionsHref({ ...filters, status: chosen ? undefined : status, page: 1 })}
              scroll={false}
              aria-current={chosen ? "true" : undefined}
              data-status={status}
              className={cn(
                TILE,
                "transition-colors focus-ring",
                // Chosen: the pressed look of the app's toggles (secondary), with a heavier edge.
                chosen ? "bg-secondary ring-2 ring-brand-500" : "bg-card shadow-sm ring-1 ring-border hover:ring-brand-300",
              )}
            >
              <Label icon={<Icon aria-hidden className={cn("size-4 shrink-0", tone)} />}>
                <span className={cn(chosen && "text-foreground")}>{label}</span>
              </Label>
              <Value count={counts.byStatus[status]} />
            </ListLink>
          </li>
        );
      })}
      {/* A figure, not a filter (the list has no date filter), so flat on the ground where the
          filters are raised cards. Two columns below 768 px, so no row has a gap. */}
      <li className="col-span-2 md:col-span-1" title={`Inspections dated in ${month}`}>
        <div data-metric="this-month" className={cn(TILE, "ring-1 ring-border")}>
          <Label icon={<CalendarDaysIcon aria-hidden className="size-4 shrink-0 text-slate-500" />}>
            This Month
            <span className="sr-only">, {month}</span>
          </Label>
          <Value count={counts.thisMonth} />
        </div>
      </li>
    </ul>
  );
}
