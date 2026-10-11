// The list itself: one line per inspection (Kenneth: one neat row each, and
// scroll sideways for more columns). Compact 36 px rows with a mouse, 44 px
// rows and 16 px text on touch (docs/DESIGN.md). Every column from
// lib/inspections/columns.ts shows at every size, each value in its own
// column and on one line. When the row is wider than the card, the card
// scrolls sideways (table-scroller.tsx) with the Ref pinned on the left and
// the row's actions pinned on the right; an edge shadow shows on a pinned
// column while some of the table is hidden behind it.
//
// Columns of known content (ref, date, the pills, the actions) take their
// content's width and no more; client, manufacturer, product, PO and
// inspector share whatever room is left on a wide screen. A name longer
// than 24rem (rare) is cut with an ellipsis, the full text in its tooltip.
//
// The pinned cells use separate borders (border-separate): with collapsed
// borders a sticky cell's border stays behind while it moves.
//
// The ref heads the row as plain text: the row's actions sit in its last
// column (Kenneth: buttons at the end of each row, not a clickable ref). The
// main action (row-actions.ts) is a real link, so it takes Tab and Enter and
// opens in a new tab, named "Continue INS-2026-0001"; while the inspection
// opens, the list dims like it does for its own links (list-link.tsx).
// Delete, where allowed, asks first (delete-inspection.tsx).
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inspectionListColumns, type InspectionColumnKey } from "@/lib/inspections/columns";
import { formatInspectionDate } from "@/lib/inspections/format";
import type { InspectionListRow } from "@/lib/inspections/query";
import { cn } from "@/lib/utils";
import { DeleteInspectionButton } from "./delete-inspection";
import { InspectionStatusBadge } from "./inspection-status-badge";
import { PendingMarker } from "./list-link";
import { rowActions, type ListViewer } from "./row-actions";
import { TableScroller } from "./table-scroller";

/** Columns that take their content's width: the rest share the room left over. */
const SNUG: ReadonlySet<InspectionColumnKey> = new Set(["ref", "date", "status", "result", "actions"]);

/**
 * The pinned columns: opaque, above the cells scrolling under them, with an
 * edge shadow while some of the table is hidden behind them. Hovered rows
 * use the same opaque grey (slate-50 is muted at 50% on white).
 */
const PINNED_LEFT =
  "sticky left-0 z-10 group-data-scrolled/scroller:shadow-[6px_0_6px_-6px_rgb(15_23_42/0.18)]";
const PINNED_RIGHT =
  "sticky right-0 z-10 group-data-more/scroller:shadow-[-6px_0_6px_-6px_rgb(15_23_42/0.18)]";
const PINNED_BODY = "bg-card group-hover/row:bg-slate-50";

function Missing({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** One line; past 24rem cut with an ellipsis, the full text in the tooltip. */
function Text({ value, missing }: { value: string | null; missing: string }) {
  if (!value) return <Missing label={missing} />;
  return (
    <span className="block max-w-96 truncate" title={value}>
      {value}
    </span>
  );
}

function InspectionDate({ value }: { value: string }) {
  return (
    <time dateTime={value} className="tabular-nums">
      {formatInspectionDate(value)}
    </time>
  );
}

/** On touch as tall as the workflow badge, and 14 px like it: the two read as a pair. */
function ResultPill({ result }: { result: InspectionListRow["result"] }) {
  // The final result once the inspector sets it; until then Not Done, never a pass.
  return (
    <StatusPill
      status={result ?? "not_done"}
      size="sm"
      className="touch:h-7 touch:gap-1.5 touch:px-2.5 touch:text-sm touch:[&>svg]:size-4"
    />
  );
}

/**
 * The main action and, where allowed, Delete. The main action keeps one
 * width (as wide as "Continue"), so the Delete buttons line up down the list.
 */
function RowActionsCell({
  row,
  index,
  next,
  viewer,
}: {
  row: InspectionListRow;
  index: number;
  next: InspectionListRow | undefined;
  viewer: ListViewer;
}) {
  const { primary, deleteName } = rowActions(row, viewer);
  return (
    <div className="flex items-center gap-1.5 touch:gap-2">
      <Button
        asChild
        size="sm"
        variant={primary.kind === "view" ? "outline" : "secondary"}
        className="min-w-21 touch:min-w-25 touch:text-base"
      >
        <Link href={primary.href} aria-label={primary.name} data-row-action="primary" data-action={primary.kind}>
          {primary.label}
          <PendingMarker />
        </Link>
      </Button>
      {deleteName && (
        <DeleteInspectionButton
          name={deleteName}
          request={{
            id: row.id,
            refNo: row.refNo,
            about: [row.client, formatInspectionDate(row.inspectionDate)].filter(Boolean).join(" · "),
            index,
            nextId: next?.id ?? null,
          }}
        />
      )}
    </div>
  );
}

function cell(key: InspectionColumnKey, row: InspectionListRow): ReactNode {
  switch (key) {
    case "ref":
      return <span className="font-semibold tabular-nums">{row.refNo}</span>;
    case "date":
      return <InspectionDate value={row.inspectionDate} />;
    case "client":
      return <Text value={row.client} missing="No Client" />;
    case "manufacturer":
      return <Text value={row.manufacturer} missing="No manufacturer yet" />;
    case "product":
      return <Text value={row.product} missing="No product yet" />;
    case "po":
      return <Text value={row.po} missing="No PO yet" />;
    case "status":
      return <InspectionStatusBadge status={row.status} />;
    case "result":
      return <ResultPill result={row.result} />;
    case "inspector":
      return <Text value={row.inspector} missing="Unknown inspector" />;
    case "actions":
      // Rendered by RowActionsCell, which needs the row's neighbours.
      return null;
  }
}

export function InspectionTable({
  rows,
  viewer,
  caption,
}: {
  rows: InspectionListRow[];
  viewer: ListViewer;
  caption: string;
}) {
  const columns = inspectionListColumns(viewer);
  const pad = "px-3 first:pl-4 last:pr-4 fine:px-2.5";

  return (
    <TableScroller label={caption}>
      <table
        data-slot="table"
        className="w-max min-w-full border-separate border-spacing-0 text-sm whitespace-nowrap touch:text-base"
      >
        <caption className="sr-only">{caption}</caption>
        <TableHeader className="bg-slate-50 [&_tr]:border-b-0">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                scope="col"
                className={cn(
                  "h-9 border-b border-border text-sm font-medium text-muted-foreground touch:h-11",
                  pad,
                  SNUG.has(column.key) && "w-px",
                  column.key === "ref" && cn(PINNED_LEFT, "bg-slate-50"),
                  column.key === "actions" && cn(PINNED_RIGHT, "bg-slate-50"),
                )}
              >
                {column.srOnlyLabel ? <span className="sr-only">{column.label}</span> : column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={row.id}
              data-id={row.id}
              data-ref={row.refNo}
              className="group/row border-b-0 hover:bg-slate-50 [&:last-child>*]:border-b-0"
            >
              {columns.map((column) => {
                const className = cn("border-b border-border py-1.5 align-middle touch:py-2.5", pad);
                switch (column.key) {
                  case "ref":
                    return (
                      <TableHead
                        key={column.key}
                        scope="row"
                        className={cn(className, "h-auto font-normal touch:h-auto", PINNED_LEFT, PINNED_BODY)}
                      >
                        {cell(column.key, row)}
                      </TableHead>
                    );
                  case "actions":
                    // With a mouse the 32 px buttons keep the row at 36 px.
                    return (
                      <TableCell key={column.key} className={cn(className, "fine:py-0.5", PINNED_RIGHT, PINNED_BODY)}>
                        <RowActionsCell row={row} index={index} next={rows[index + 1]} viewer={viewer} />
                      </TableCell>
                    );
                  default:
                    return (
                      <TableCell key={column.key} className={className}>
                        {cell(column.key, row)}
                      </TableCell>
                    );
                }
              })}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </TableScroller>
  );
}
