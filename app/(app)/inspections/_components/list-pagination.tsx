// Previous and next page links, 50 rows a page. Real links, so a page can be
// opened in a new tab or shared like any other filtered view.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildInspectionsHref, type InspectionListFilters } from "@/lib/inspections/search-params";
import { ListLink } from "./list-link";

export function ListPagination({ filters, pageCount }: { filters: InspectionListFilters; pageCount: number }) {
  if (pageCount <= 1) return null;
  const { page } = filters;

  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        Page {page} of {pageCount}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <ListLink href={buildInspectionsHref({ ...filters, page: page - 1 })} rel="prev">
              <ChevronLeftIcon aria-hidden />
              Previous
            </ListLink>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeftIcon aria-hidden />
            Previous
          </Button>
        )}
        {page < pageCount ? (
          <Button asChild variant="outline" size="sm">
            <ListLink href={buildInspectionsHref({ ...filters, page: page + 1 })} rel="next">
              Next
              <ChevronRightIcon aria-hidden />
            </ListLink>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRightIcon aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}
