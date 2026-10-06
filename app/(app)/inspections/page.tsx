import type { Metadata } from "next";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { listInspections, loadFilterOptions } from "@/lib/inspections/query";
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
import { InspectionFilters } from "./_components/inspection-filters";
import { InspectionTable } from "./_components/inspection-table";
import { ListLink } from "./_components/list-link";
import { ListPagination } from "./_components/list-pagination";
import { LoadFailed, NoInspectionsYet, NoMatches, PastTheEnd } from "./_components/list-states";
import { NewInspectionButton } from "./_components/new-inspection-button";

export const metadata: Metadata = {
  title: "Inspections",
};

/**
 * The inspections list (BUILD_SPEC 10): inspectors see their own, admins see
 * everyone's with an Inspector column. Row Level Security does the scoping;
 * this page only reads through the signed-in user's client. Filters live in
 * the URL (lib/inspections/search-params.ts), so a view can be shared.
 */
export default async function InspectionsPage({ searchParams }: PageProps<"/inspections">) {
  const user = await requireUser();
  const requested = parseInspectionSearchParams(await searchParams);
  const supabase = await createClient();

  // The options and the list load together. A client or manufacturer id that
  // matches nothing the user can see is dropped like any other invalid value,
  // which needs the options, so in that rare case the list loads again.
  const [options, firstTry] = await Promise.all([
    loadFilterOptions(supabase),
    listInspections(supabase, requested, user.role),
  ]);
  const filters = options.ok ? dropUnknownReferences(requested, options) : requested;
  const list = filters === requested ? firstTry : await listInspections(supabase, filters, user.role);

  const isAdmin = user.role === "admin";
  const filtered = hasActiveFilters(filters);
  const failed = !options.ok || list.kind === "error";
  const nothingYet = !failed && list.kind === "rows" && list.total === 0 && !filtered;

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8 xl:px-8">
      <PageHeader
        eyebrow={isAdmin ? "All inspectors" : "Your inspections"}
        title="Inspections"
        description={
          isAdmin
            ? "Every inspection, newest first. Search by ref, PO or lot number."
            : "Your inspections, newest first. Search by ref, PO or lot number."
        }
        actions={<NewInspectionButton />}
      />

      <div className="group/list flex flex-col gap-4">
        {options.ok && !nothingYet && (
          <InspectionFilters filters={filters} clients={options.clients} manufacturers={options.manufacturers} />
        )}

        <section
          aria-label="Inspections"
          className="flex flex-col gap-3 transition-opacity group-has-data-pending/list:opacity-60"
        >
          {failed ? (
            <LoadFailed retryHref={buildInspectionsHref(filters)} />
          ) : list.kind === "out-of-range" ? (
            <PastTheEnd filters={filters} total={list.total} pageCount={pageCount(list.total)} />
          ) : list.kind === "rows" && list.total === 0 ? (
            filtered ? (
              <NoMatches filters={filters} names={selectedNames(filters, options.ok ? options : null)} />
            ) : (
              <NoInspectionsYet role={user.role} />
            )
          ) : list.kind === "rows" ? (
            <>
              <ListSummary filters={filters} total={list.total} shown={list.rows.length} />
              <InspectionTable
                rows={list.rows}
                role={user.role}
                caption={isAdmin ? "Inspections by every inspector, newest first" : "Your inspections, newest first"}
              />
              <ListPagination filters={filters} pageCount={pageCount(list.total)} />
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/**
 * "12 inspections", "3 inspections match", "123 inspections · showing 51–100",
 * with Clear filters when filtered. A status region, so the new count is read
 * out after each search.
 */
function ListSummary({ filters, total, shown }: { filters: InspectionListFilters; total: number; shown: number }) {
  const filtered = hasActiveFilters(filters);
  const { from, to } = pageRange(filters.page, total);
  const counted = `${total} ${total === 1 ? "inspection" : "inspections"}`;
  const matched = filtered ? `${counted} ${total === 1 ? "matches" : "match"}` : counted;

  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p role="status" className="text-sm text-muted-foreground tabular-nums">
        {shown < total ? `${matched} · showing ${from}–${to}` : matched}
      </p>
      {filtered && (
        <Button asChild variant="link" size="sm" className="px-0 touch:px-0">
          <ListLink href={INSPECTIONS_PATH}>Clear filters</ListLink>
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
