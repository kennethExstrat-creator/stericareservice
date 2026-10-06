// The list itself. Compact 36 px rows with a mouse, 44 px rows and 16 px text
// on touch (docs/DESIGN.md). Columns come from lib/inspections/columns.ts. On
// the iPad, values without a column of their own fold under another one: the
// inspector's name (admins only) under the date, the product under the
// manufacturer; in portrait also the PO under the ref, and the manufacturer
// and product under the client.
//
// The table never scrolls sideways: its layout is fixed, the columns with
// content of a known size (ref, date, PO, the two pills, inspector) get set
// widths, and client, manufacturer and product share the rest. With a mouse a
// long name stays on one line with the full text in the tooltip; on touch,
// where nothing hovers, it wraps onto a second line.
//
// The ref opens the inspection (inspection-href.ts): a real link, so it takes
// Tab and Enter, opens in a new tab and reads as "INS-2026-0001, Draft". On
// touch it covers its whole cell, the PO folded under it included, so the
// target is the row's full height (at least 44 px). While the inspection
// opens, the list dims like it does for its own links (list-link.tsx).
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/qc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inspectionListColumns, type InspectionColumn, type InspectionColumnKey } from "@/lib/inspections/columns";
import { formatInspectionDate, INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import type { InspectionListRow } from "@/lib/inspections/query";
import type { Database } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { inspectionHref } from "./inspection-href";
import { InspectionStatusBadge } from "./inspection-status-badge";
import { PendingMarker } from "./list-link";

type UserRole = Database["public"]["Enums"]["user_role"];

const VISIBLE_FROM: Record<NonNullable<InspectionColumn["from"]>, string> = {
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

/** Set widths, larger on touch for the 16 px text and bigger pills. */
const WIDTH: Partial<Record<InspectionColumnKey, string>> = {
  ref: "w-40 fine:w-34",
  date: "w-32 fine:w-28",
  po: "w-36 fine:w-32",
  status: "w-36 fine:w-30",
  result: "w-32 fine:w-28",
  inspector: "w-40 fine:w-32",
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

/** A second line, on screens where the value has no column of its own. */
function Folded({ until, children }: { until: "lg" | "xl"; children: string }) {
  return (
    <span className={cn("mt-0.5 block text-sm text-muted-foreground", until === "lg" ? "lg:hidden" : "xl:hidden")}>
      <span className={LONG_TEXT} title={children}>
        {children}
      </span>
    </span>
  );
}

/**
 * The ref as the row's link: as wide as its text (cut short with an ellipsis
 * in a narrow column), brand-600 like every link. On touch its ::after covers
 * the cell, which is `relative`; the clipping of `truncate` does not reach it,
 * since its containing block is the cell.
 */
const REF_LINK = cn(
  "block w-fit max-w-full truncate rounded-sm font-semibold text-brand-600 tabular-nums underline-offset-4 hover:underline focus-ring",
  "touch:after:absolute touch:after:inset-0",
);

function RefLink({ row }: { row: InspectionListRow }) {
  return (
    <Link href={inspectionHref(row.id, row.status)} className={REF_LINK}>
      {row.refNo}
      {/* The link's name says where the inspection is, as the Status column does. */}
      <span className="sr-only">, {INSPECTION_STATUS_LABEL[row.status]}</span>
      <PendingMarker />
    </Link>
  );
}

function cell(key: InspectionColumnKey, row: InspectionListRow): ReactNode {
  switch (key) {
    case "ref":
      return (
        <>
          <RefLink row={row} />
          {row.po && <Folded until="lg">{`PO ${row.po}`}</Folded>}
        </>
      );
    case "date":
      return (
        <>
          <time dateTime={row.inspectionDate} className="block tabular-nums">
            {formatInspectionDate(row.inspectionDate)}
          </time>
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
      return <InspectionStatusBadge status={row.status} />;
    case "result":
      // The final result once the inspector sets it; until then Not done, never a pass.
      return (
        <StatusPill
          status={row.result ?? "not_done"}
          size="sm"
          className="touch:h-7 touch:gap-1.5 touch:px-2.5 touch:text-sm touch:[&>svg]:size-4"
        />
      );
    case "inspector":
      return <Text value={row.inspector} missing="Unknown inspector" />;
  }
}

export function InspectionTable({ rows, role, caption }: { rows: InspectionListRow[]; role: UserRole; caption: string }) {
  const columns = inspectionListColumns(role);
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
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-ref={row.refNo}>
              {columns.map((column) => {
                const className = cn(
                  "px-3 py-1.5 align-middle first:pl-4 last:pr-4 fine:px-2.5 touch:py-2.5",
                  visibility(column),
                );
                return column.key === "ref" ? (
                  // relative: the ref link's touch target and its spoken status are placed against the cell.
                  <TableHead key={column.key} scope="row" className={cn(className, "relative h-auto font-normal touch:h-auto")}>
                    {cell(column.key, row)}
                  </TableHead>
                ) : (
                  <TableCell key={column.key} className={className}>
                    {cell(column.key, row)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
