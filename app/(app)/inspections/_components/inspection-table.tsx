// The list itself. Compact 36 px rows with a mouse, 44 px rows and 16 px text
// on touch (docs/DESIGN.md). Columns come from lib/inspections/columns.ts:
// every column side by side only in the desktop layout. In the iPad layout
// (every touch screen) values without a column of their own fold under
// another one: the PO under the ref, the inspector's name (admins only)
// under the date, the product under the manufacturer and the result under
// the status; in portrait also the date and the inspector's name under the
// ref, and the manufacturer and product under the client.
//
// The table never scrolls sideways: its layout is fixed, the columns with
// content of a known size (ref, date, PO, the pills, inspector, actions) get
// set widths, and client, manufacturer and product share the rest. With a
// mouse a long name stays on one line with the full text in the tooltip; on
// touch, where nothing hovers, it wraps onto a second line.
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inspectionListColumns, type InspectionColumn, type InspectionColumnKey } from "@/lib/inspections/columns";
import { formatInspectionDate } from "@/lib/inspections/format";
import type { InspectionListRow } from "@/lib/inspections/query";
import { cn } from "@/lib/utils";
import { DeleteInspectionButton } from "./delete-inspection";
import { InspectionStatusBadge } from "./inspection-status-badge";
import { PendingMarker } from "./list-link";
import { rowActions, type ListViewer } from "./row-actions";

const VISIBLE_FROM: Record<NonNullable<InspectionColumn["from"]>, string> = {
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  // Wide desktops only: a mouse or trackpad as well, like xl.
  "2xl": "hidden 2xl:fine:table-cell",
};

/** Set widths, larger on touch for the 16 px text, bigger pills and 44 px buttons. */
const WIDTH: Partial<Record<InspectionColumnKey, string>> = {
  ref: "w-40 fine:w-32",
  date: "w-32 fine:w-26",
  po: "w-36 fine:w-28",
  status: "w-36 fine:w-30",
  result: "w-32 fine:w-28",
  inspector: "w-40 fine:w-28",
  actions: "w-46 fine:w-37",
};

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

/**
 * One line and a tooltip with a mouse; up to two lines on touch. Never on an
 * element that a breakpoint hides: `touch:line-clamp-2` sets `display` and
 * would show it again.
 */
const LONG_TEXT = "block truncate touch:line-clamp-2 touch:whitespace-normal touch:break-words";

function Text({ value, missing }: { value: string | null; missing: string }) {
  if (!value) return <Missing label={missing} />;
  return (
    <span className={LONG_TEXT} title={value}>
      {value}
    </span>
  );
}

const FOLDED_UNTIL = { lg: "lg:hidden", xl: "xl:hidden" } as const;

/** A second line, on screens where the value has no column of its own. */
function Folded({ until, children }: { until: "lg" | "xl"; children: string }) {
  return (
    <span className={cn("mt-0.5 block text-sm text-muted-foreground", FOLDED_UNTIL[until])}>
      <span className={LONG_TEXT} title={children}>
        {children}
      </span>
    </span>
  );
}

function InspectionDate({ value, className }: { value: string; className?: string }) {
  return (
    <time dateTime={value} className={cn("block tabular-nums", className)}>
      {formatInspectionDate(value)}
    </time>
  );
}

/** Touch: the same height as the workflow badge beside it, 14 px like it. */
function ResultPill({ result }: { result: InspectionListRow["result"] }) {
  // The final result once the inspector sets it; until then Not done, never a pass.
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
function RowActionsCell({ row, index, next, viewer }: { row: InspectionListRow; index: number; next: InspectionListRow | undefined; viewer: ListViewer }) {
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
      return (
        <>
          <span className="block font-semibold tabular-nums">{row.refNo}</span>
          {row.po && <Folded until="xl">{`PO ${row.po}`}</Folded>}
          {/* iPad portrait: the date column is hidden. */}
          <span className="mt-0.5 block text-sm text-muted-foreground lg:hidden">
            <InspectionDate value={row.inspectionDate} />
          </span>
          {row.inspector && <Folded until="lg">{row.inspector}</Folded>}
        </>
      );
    case "date":
      return (
        <>
          <InspectionDate value={row.inspectionDate} />
          {row.inspector && <Folded until="xl">{row.inspector}</Folded>}
        </>
      );
    case "client":
      // iPad portrait: the manufacturer and product columns are hidden.
      return (
        <>
          <Text value={row.client} missing="No client yet" />
          {row.manufacturer && <Folded until="lg">{row.manufacturer}</Folded>}
          {row.product && <Folded until="lg">{row.product}</Folded>}
        </>
      );
    case "manufacturer":
      // iPad landscape: the product column is hidden.
      return (
        <>
          <Text value={row.manufacturer} missing="No manufacturer yet" />
          {row.product && <Folded until="xl">{row.product}</Folded>}
        </>
      );
    case "product":
      return <Text value={row.product} missing="No product yet" />;
    case "po":
      return <Text value={row.po} missing="No PO yet" />;
    case "status":
      // iPad: the result column is hidden, so the result sits under the status.
      return (
        <span className="flex flex-col items-start gap-1">
          <InspectionStatusBadge status={row.status} />
          <span className="relative block xl:hidden">
            <span className="sr-only">Result: </span>
            <ResultPill result={row.result} />
          </span>
        </span>
      );
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
  const columns = inspectionListColumns(viewer.role);
  const visibility = (column: InspectionColumn) => column.from && VISIBLE_FROM[column.from];

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <Table className="table-fixed text-sm touch:text-base">
        <caption className="sr-only">{caption}</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                scope="col"
                className={cn(
                  "h-9 px-3 text-sm font-medium text-muted-foreground first:pl-4 last:pr-4 fine:px-2.5 touch:h-11",
                  WIDTH[column.key],
                  visibility(column),
                )}
              >
                {column.srOnlyLabel ? <span className="sr-only">{column.label}</span> : column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.id} data-id={row.id} data-ref={row.refNo}>
              {columns.map((column) => {
                const className = cn(
                  "px-3 py-1.5 align-middle first:pl-4 last:pr-4 fine:px-2.5 touch:py-2.5",
                  visibility(column),
                );
                switch (column.key) {
                  case "ref":
                    return (
                      <TableHead key={column.key} scope="row" className={cn(className, "h-auto font-normal touch:h-auto")}>
                        {cell(column.key, row)}
                      </TableHead>
                    );
                  case "actions":
                    // With a mouse the 32 px buttons keep the row at 36 px.
                    return (
                      <TableCell key={column.key} className={cn(className, "fine:py-0.5")}>
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
      </Table>
    </div>
  );
}
