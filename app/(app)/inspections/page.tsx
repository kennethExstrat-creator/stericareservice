import type { Metadata } from "next";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { inspectionScope, type InspectionScope } from "@/lib/auth/org";
import { requireUser } from "@/lib/auth/session";
import { countInspections, listInspections, loadFilterOptions } from "@/lib/inspections/query";
import {
  buildInspectionsHref,
  dropUnknownReferences,
  hasActiveFilters,
  INSPECTIONS_PATH,
  pageCount,
  pageRange,
  parseInspectionSearchParams,
  type InspectionListFilters,
} from "@/lib/inspections/search-params";
import { createClient } from "@/lib/supabase/server";
import { InspectionResults } from "./_components/delete-inspection";
import { InspectionFilters } from "./_components/inspection-filters";
import { InspectionMetrics } from "./_components/inspection-metrics";
import { InspectionTable } from "./_components/inspection-table";
import { ListFocusScope } from "./_components/list-focus";
import { RESULTS_FOCUS_TARGET } from "./_components/list-focus-target";
import { ListLink } from "./_components/list-link";
import { ListPagination } from "./_components/list-pagination";
import { LoadFailed, NoInspectionsYet, NoMatches, PastTheEnd } from "./_components/list-states";
import { NewInspectionButton } from "./_components/new-inspection-button";
import { PruneLocalCopies } from "./_components/prune-local-copies";

export const metadata: Metadata = {
  title: "Inspections",
};

/** The eyebrow above the title and the table's caption, by whose inspections the user sees. */
const HEADING: Readonly<Record<InspectionScope, { eyebrow: string; caption: string }>> = {
  all: { eyebrow: "All Inspectors", caption: "Inspections by every inspector, newest first" },
  team: { eyebrow: "Your Team", caption: "Your team's inspections and your own, newest first" },
  own: { eyebrow: "Your Inspections", caption: "Your inspections, newest first" },
};

/**
 * The inspections list (BUILD_SPEC 10): inspectors see their own, lead
 * inspectors their own and their team's (read-only), admins everyone's; the
 * last two with an Inspector in Charge column. Row Level Security does the scoping;
 * this page only reads through the signed-in user's client. Filters live in
 * the URL (lib/inspections/search-params.ts), so a view can be shared. Above
 * them, the counts per status, each a link to that status, and this month's
 * (inspection-metrics.tsx); they follow every filter but the status. Each
 * row ends with its actions: Continue, Review or View, and Delete on a draft
 * (./actions.ts, which re-renders this page once the draft is gone).
 */
export default async function InspectionsPage({ searchParams }: PageProps<"/inspections">) {
  const user = await requireUser();
  const requested = parseInspectionSearchParams(await searchParams);
  const supabase = await createClient();

  // The options, the list and the counts above it load together. A client or
  // manufacturer id that matches nothing the user can see is dropped like any
  // other invalid value, which needs the options, so in that rare case the
  // list and the counts load again.
  const [options, firstTry, firstCounts] = await Promise.all([
    loadFilterOptions(supabase),
    listInspections(supabase, requested, user),
    countInspections(supabase, requested),
  ]);
  const filters = options.ok ? dropUnknownReferences(requested, options) : requested;
  const [list, counts] =
    filters === requested
      ? [firstTry, firstCounts]
      : await Promise.all([listInspections(supabase, filters, user), countInspections(supabase, filters)]);

  const scope = inspectionScope(user);
  const filtered = hasActiveFilters(filters);
  const failed = !options.ok || list.kind === "error";
  const nothingYet = !failed && list.kind === "rows" && list.total === 0 && !filtered;
  const view = failed
    ? "error"
    : list.kind === "out-of-range"
      ? "past-the-end"
      : list.kind === "rows" && list.total === 0
        ? filtered
          ? "no-matches"
          : "empty"
        : "rows";
  const announcement = failed
    ? "The inspections could not be loaded."
    : list.kind === "out-of-range"
      ? `There is no page ${filters.page}.`
      : list.kind === "rows"
        ? describeCount(filters, list.total, list.rows.length)
        : "";

  // No padding of its own: the app shell's <main> sets the page margins.
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeader
        eyebrow={HEADING[scope].eyebrow}
        title="Inspections"
        actions={<NewInspectionButton />}
      />

      <ListFocusScope href={buildInspectionsHref(filters)} view={view} className="group/list flex flex-col gap-4">
        {/* Inside the scope: a tile's link dims the results while the list loads, as the filters do. */}
        {!failed && !nothingYet && <InspectionMetrics filters={filters} counts={counts} />}

        {options.ok && !nothingYet && (
          <InspectionFilters filters={filters} clients={options.clients} manufacturers={options.manufacturers} />
        )}

        <InspectionResults
          listKey={list.kind === "rows" ? list.rows.map((row) => `${row.id}:${row.status}`).join(" ") : view}
          viewerId={user.id}
          className="flex flex-col gap-3 transition-opacity group-has-data-pending/list:opacity-60"
        >
          {/* Always rendered, so screen readers hear each new outcome after a search. */}
          <p role="status" className="sr-only">
            {announcement}
          </p>
          {failed ? (
            <LoadFailed retryHref={buildInspectionsHref(filters)} />
          ) : list.kind === "out-of-range" ? (
            <PastTheEnd filters={filters} total={list.total} pageCount={pageCount(list.total)} />
          ) : list.kind === "rows" && list.total === 0 ? (
            filtered ? (
              <NoMatches filters={filters} names={selectedNames(filters, options.ok ? options : null)} />
            ) : (
              <NoInspectionsYet scope={scope} />
            )
          ) : list.kind === "rows" ? (
            <>
              <ListSummary filters={filters} total={list.total} shown={list.rows.length} />
              <InspectionTable
                rows={list.rows}
                viewer={{ id: user.id, role: user.role, isLead: user.isLead }}
                caption={HEADING[scope].caption}
              />
              <ListPagination filters={filters} pageCount={pageCount(list.total)} />
            </>
          ) : null}
        </InspectionResults>
      </ListFocusScope>

      {/* Removes this device's old local copies once per tab (docs/OFFLINE.md). */}
      <PruneLocalCopies />
    </div>
  );
}

/** "No inspections yet", "12 inspections", "3 inspections match", "123 inspections · showing 51–100". */
function describeCount(filters: InspectionListFilters, total: number, shown: number): string {
  const filtered = hasActiveFilters(filters);
  if (total === 0) return filtered ? "No inspections match." : "No inspections yet.";
  const { from, to } = pageRange(filters.page, total);
  const counted = `${total} ${total === 1 ? "inspection" : "inspections"}`;
  const matched = filtered ? `${counted} ${total === 1 ? "matches" : "match"}` : counted;
  return shown < total ? `${matched} · showing ${from}–${to}` : matched;
}

/**
 * The count above the table, with Clear Filters when the list is filtered.
 * The count is where focus lands after a link in the list goes away; Clear
 * Filters sends it to the search box, ready for the next search.
 */
function ListSummary({ filters, total, shown }: { filters: InspectionListFilters; total: number; shown: number }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p {...RESULTS_FOCUS_TARGET} className="text-sm text-muted-foreground tabular-nums outline-none">
        {describeCount(filters, total, shown)}
      </p>
      {hasActiveFilters(filters) && (
        <Button asChild variant="link" size="sm" className="px-0 touch:px-0">
          <ListLink href={INSPECTIONS_PATH} focusAfter="search">
            Clear Filters
          </ListLink>
        </Button>
      )}
    </div>
  );
}

function selectedNames(
  filters: InspectionListFilters,
  options: { clients: { id: string; label: string }[]; manufacturers: { id: string; label: string }[] } | null,
): { client?: string; manufacturer?: string } {
  return {
    client: options?.clients.find((client) => client.id === filters.client)?.label,
    manufacturer: options?.manufacturers.find((manufacturer) => manufacturer.id === filters.manufacturer)?.label,
  };
}
