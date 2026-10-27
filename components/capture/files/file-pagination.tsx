"use client";

// Under a list of files longer than a page (Source Documents, ten a page;
// Kenneth, 27 October 2026): "Showing 11–20 of 23", then Previous, the page
// numbers with an ellipsis for those left out, and Next, in the app's pill
// buttons: 44 px on any touchscreen, compact with a mouse. Nothing while the
// files fit on one page. At the first or the last page Previous or Next
// greys out but stays focusable (aria-disabled), so the focus is not lost
// when Next reaches the end.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAGE_GAP, pageCountOf, pageNumbers, pageSpan } from "./file-pages";

/** One page of a list of files at a time, the pages under its rows. */
export type FilePaging = {
  page: number;
  pageSize: number;
  /** The pages' name for a screen reader: "Pages of files". */
  label: string;
  onPageChange: (page: number) => void;
};

/** 16 px text on a touchscreen, as the rows' data. */
const BUTTON = "touch:text-base";

/** Previous or Next at the end: greyed but focusable, as the signature pad's Undo (docs/DESIGN.md). */
const AT_END =
  "aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:border-input aria-disabled:hover:bg-card aria-disabled:hover:text-slate-400";

export function FilePagination({ total, page, pageSize, label, onPageChange }: FilePaging & { total: number }) {
  const count = pageCountOf(total, pageSize);
  if (count <= 1) return null;
  const { from, to } = pageSpan(page, total, pageSize);
  const first = page <= 1;
  const last = page >= count;
  return (
    // relative: anchors the buttons' sr-only words (docs/DESIGN.md).
    <nav aria-label={label} data-slot="file-pagination" className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
        {`Showing ${from}–${to} of ${total}`}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={first || undefined}
          className={cn(BUTTON, AT_END)}
          onClick={() => {
            if (!first) onPageChange(page - 1);
          }}
        >
          <ChevronLeftIcon aria-hidden />
          Previous<span className="sr-only"> Page</span>
        </Button>
        {pageNumbers(page, count).map((item, index) =>
          item === PAGE_GAP ? (
            <span
              key={`gap-${index}`}
              aria-hidden
              className="inline-flex size-8 items-center justify-center text-sm text-muted-foreground touch:size-11"
            >
              …
            </span>
          ) : (
            <Button
              key={item}
              type="button"
              variant={item === page ? "secondary" : "ghost"}
              size="icon-sm"
              aria-current={item === page ? "page" : undefined}
              className={cn(BUTTON, "tabular-nums")}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={last || undefined}
          className={cn(BUTTON, AT_END)}
          onClick={() => {
            if (!last) onPageChange(page + 1);
          }}
        >
          Next<span className="sr-only"> Page</span>
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
