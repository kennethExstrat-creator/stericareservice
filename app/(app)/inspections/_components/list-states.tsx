// What the list shows instead of rows: nothing yet, nothing matching the
// filters, a page past the end, or a failed load. Each says what happened and
// offers the one useful next step. The heading is where focus lands when the
// control that had it goes away with the previous list (list-focus.tsx).
import { ClipboardListIcon, ListEndIcon, SearchXIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { InspectionScope } from "@/lib/auth/org";
import { INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import { buildInspectionsHref, INSPECTIONS_PATH, type InspectionListFilters } from "@/lib/inspections/search-params";
import { cn } from "@/lib/utils";
import { RESULTS_FOCUS_TARGET } from "./list-focus-target";
import { ListLink } from "./list-link";


function ListState({
  icon: Icon,
  tone = "neutral",
  title,
  children,
  action,
  state,
}: {
  icon: LucideIcon;
  tone?: "neutral" | "fail";
  title: string;
  children: ReactNode;
  action?: ReactNode;
  state: string;
}) {
  return (
    <Empty
      data-list-state={state}
      className={cn(
        "border bg-card px-6 py-12 md:py-16",
        tone === "fail" ? "border-solid border-fail-border" : "border-dashed border-slate-300",
      )}
    >
      <EmptyHeader className="max-w-md">
        <EmptyMedia
          variant="icon"
          className={cn("size-12 rounded-xl", tone === "fail" ? "bg-fail-tint text-fail" : "bg-brand-50 text-brand-600")}
        >
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          <h2 {...RESULTS_FOCUS_TARGET} className="text-lg font-bold text-foreground outline-none">
            {title}
          </h2>
        </EmptyTitle>
        <EmptyDescription className="text-base text-muted-foreground fine:text-sm">{children}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

const WHO_SEES_WHAT: Readonly<Record<InspectionScope, string>> = {
  all: "Inspections from every inspector will appear here, newest first, with who carried each one out. Inspectors see only their own.",
  team: "Inspections you and your team start will appear here, newest first, with who carried each one out. Your team's open read-only.",
  own: "Inspections you start will appear here, newest first. You see only your own; admins see everyone's.",
};

/** Nobody has inspections to show this user yet. Says who sees what. */
export function NoInspectionsYet({ scope }: { scope: InspectionScope }) {
  return (
    <ListState icon={ClipboardListIcon} title="No inspections yet" state="empty">
      <p>{WHO_SEES_WHAT[scope]}</p>
      <p className="mt-2">Start one with New inspection.</p>
    </ListState>
  );
}

/** Back to the whole list, with focus in the search box, ready for the next search. */
function ClearFiltersButton() {
  return (
    <Button asChild variant="outline">
      <ListLink href={INSPECTIONS_PATH} focusAfter="search">
        Clear filters
      </ListLink>
    </Button>
  );
}

/** The filters in words, so "no matches" says what was asked. */
function describeFilters(filters: InspectionListFilters, names: { client?: string; manufacturer?: string }): string[] {
  const parts: string[] = [];
  if (filters.q) parts.push(`“${filters.q}”`);
  if (filters.status) parts.push(`status ${INSPECTION_STATUS_LABEL[filters.status]}`);
  if (names.client) parts.push(`client ${names.client}`);
  if (names.manufacturer) parts.push(`manufacturer ${names.manufacturer}`);
  return parts;
}

/** The filters exclude everything. */
export function NoMatches({
  filters,
  names,
}: {
  filters: InspectionListFilters;
  names: { client?: string; manufacturer?: string };
}) {
  const asked = describeFilters(filters, names);
  return (
    <ListState icon={SearchXIcon} title="No inspections match" state="no-matches" action={<ClearFiltersButton />}>
      <p>Nothing matches {asked.join(", ")}.</p>
      {filters.q && <p className="mt-2">Search matches part of a ref or PO number, or a whole lot number.</p>}
    </ListState>
  );
}

/** A stale or hand-made link to a page that no longer exists. */
export function PastTheEnd({
  filters,
  total,
  pageCount,
}: {
  filters: InspectionListFilters;
  total: number;
  pageCount: number;
}) {
  return (
    <ListState
      icon={ListEndIcon}
      title={`There is no page ${filters.page}`}
      state="past-the-end"
      action={
        <Button asChild variant="outline">
          <ListLink href={buildInspectionsHref({ ...filters, page: pageCount })}>
            {pageCount === 1 ? "Go to the list" : `Go to page ${pageCount}`}
          </ListLink>
        </Button>
      }
    >
      <p>
        {total === 1 ? "There is 1 inspection" : `There are ${total} inspections`}
        {pageCount === 1 ? ", all on one page." : `, on ${pageCount} pages.`}
      </p>
    </ListState>
  );
}

/** The database did not answer. Details are in the server log, not on screen. */
export function LoadFailed({ retryHref }: { retryHref: string }) {
  return (
    <ListState
      icon={TriangleAlertIcon}
      tone="fail"
      title="The inspections could not be loaded"
      state="error"
      action={
        <Button asChild variant="outline">
          <ListLink href={retryHref}>Try again</ListLink>
        </Button>
      }
    >
      <p>Check the connection and try again. If it keeps happening, tell an admin.</p>
    </ListState>
  );
}
