// Steri-AI Cost by inspection: the period's costliest inspections (at most 50,
// lib/ai/cost-report.ts), each linked to its review once submitted, else to
// capture, in the inspections list's words. Below 1024 px (iPad portrait) the
// date and the counts fold under the ref, so the table never scrolls
// sideways. A server component.
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { inspectionHref } from "@/lib/admin/defects";
import { formatInspectionDate } from "@/lib/inspections/format";
import type { AiCostReport, InspectionCost } from "@/lib/schemas/ai-usage";
import { cn } from "@/lib/utils";
import { countOf, formatCost, type Money } from "./money";

const CELL =
  "border-t border-border px-3 py-2 align-middle first:pl-5 last:pr-5 touch:py-0 touch:first:pl-6 touch:last:pr-6";

/** Shown at 1024 px and up; folded under the ref below. */
const WIDE = "max-lg:hidden";

function Head({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 px-3 text-left text-sm font-medium whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5 touch:h-11 touch:first:pl-6 touch:last:pr-6",
        className,
      )}
    >
      {children}
    </th>
  );
}

/** "10 Oct 2026 · 4 documents · 36 media · 1 review", leaving out what is none. */
function foldedLine(row: InspectionCost): string {
  return [
    formatInspectionDate(row.inspectionDate),
    row.documents > 0 && countOf(row.documents, "document", "documents"),
    row.mediaItems > 0 && `${row.mediaItems.toLocaleString("en-US")} media`,
    row.reviews > 0 && countOf(row.reviews, "review", "reviews"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

export function CostByInspection({
  inspections,
  unlinkedCostUsd,
  money,
}: {
  inspections: AiCostReport["inspections"];
  unlinkedCostUsd: number;
  money: Money;
}) {
  const id = useId();
  const { rows, total } = inspections;
  const numeric = "text-right tabular-nums whitespace-nowrap";

  return (
    <section
      aria-labelledby={id}
      data-testid="cost-by-inspection"
      className="relative min-w-0 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border"
    >
      <div className="flex flex-col gap-1 px-5 pt-5 pb-4 touch:px-6 touch:pt-6">
        <h2 id={id} className="text-lg leading-tight font-bold text-foreground">
          Cost by Inspection
        </h2>
        {total > rows.length && (
          <p className="text-sm text-muted-foreground">
            The {rows.length} costliest of {count(total)}.
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground touch:px-6 touch:pb-6 touch:text-base">
          No inspection used Steri-AI in this period.
        </p>
      ) : (
        <table className="w-full text-sm touch:text-base">
          <caption className="sr-only">Steri-AI cost by inspection, costliest first</caption>
          <thead className="bg-slate-50">
            <tr>
              <Head>Ref</Head>
              <Head>PO</Head>
              <Head className={WIDE}>Date</Head>
              <Head className={cn(WIDE, "text-right")}>Documents</Head>
              <Head className={cn(WIDE, "text-right")}>Media Sorted</Head>
              <Head className={cn(WIDE, "text-right")}>Reviews</Head>
              <Head className="text-right">Cost</Head>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.inspectionId} className="hover:bg-slate-50" data-ref={row.refNo}>
                <th scope="row" className={cn(CELL, "text-left font-normal")}>
                  <Link
                    href={inspectionHref(row.inspectionId, row.status)}
                    className="rounded-sm font-semibold whitespace-nowrap text-brand-600 tabular-nums underline-offset-4 hover:underline focus-ring touch:inline-flex touch:min-h-11 touch:items-center"
                  >
                    {row.refNo}
                  </Link>
                  <p className="text-sm text-muted-foreground lg:hidden touch:pb-2">{foldedLine(row)}</p>
                </th>
                <td className={CELL}>
                  {row.poNo ? (
                    <span className="block max-w-56 truncate" title={row.poNo}>
                      {row.poNo}
                    </span>
                  ) : (
                    <>
                      <span aria-hidden className="text-muted-foreground">
                        —
                      </span>
                      <span className="sr-only">No PO</span>
                    </>
                  )}
                </td>
                <td className={cn(CELL, WIDE, "whitespace-nowrap")}>
                  <time dateTime={row.inspectionDate} className="tabular-nums">
                    {formatInspectionDate(row.inspectionDate)}
                  </time>
                </td>
                <td className={cn(CELL, WIDE, numeric)}>{count(row.documents)}</td>
                <td className={cn(CELL, WIDE, numeric)}>{count(row.mediaItems)}</td>
                <td className={cn(CELL, WIDE, numeric)}>{count(row.reviews)}</td>
                <td className={cn(CELL, numeric)}>{formatCost(row.costUsd, money)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {unlinkedCostUsd > 0 && (
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground touch:px-6">
          New Inspection reads and deleted drafts: {formatCost(unlinkedCostUsd, money)}.
        </p>
      )}
    </section>
  );
}
