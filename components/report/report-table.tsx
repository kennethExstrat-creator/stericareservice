// The report's table (the design: Results by Check, the order lots and sampling
// plan, the measurements by glove, the per-box results): grey column
// headers over a dark rule, optional header groups in blue over their
// columns, hairlines between rows, zebra rows or neither (page 6's defect
// tables, with group headings in the body), numbers right-aligned in
// tabular figures, and a totals row tinted blue.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TYPE } from "./theme";

export type ReportColumn = {
  key: string;
  label: ReactNode;
  align?: "left" | "right" | "center";
  /** A number column: right-aligned (unless `align` says otherwise), tabular figures. */
  numeric?: boolean;
  /** As CSS: "23%", "18mm". */
  width?: string;
  /** Bold cells: the row's name. */
  strong?: boolean;
  /** Grey cells: a criterion, a note. */
  muted?: boolean;
  /** A hairline at its left, down the header, the rows and the totals: the first column of a header group (TG35 page 7's sizes). */
  divided?: boolean;
};

/** A header over several columns: "Order" over Cases, Gloves and Share. A blank label leaves a gap. */
export type ReportColumnGroup = { label?: ReactNode; span: number };

export type ReportRow = {
  key: string;
  cells: Readonly<Record<string, ReactNode>>;
  /** A row that stands out as the design's Median row does: tinted blue, bold. */
  emphasis?: boolean;
  /**
   * Cells that run down over the rows under this one, by column key: how
   * many rows each covers, its own included (TG35 page 7's one result for
   * the aged gloves). The rows it covers leave that column out.
   */
  rowSpans?: Readonly<Record<string, number>>;
  /** A group's heading inside the body ("Major · AQL 2.5", TG35 page 6): its first column's cell across every column, in blue over a blue rule. */
  group?: boolean;
};

export type ReportTableProps = {
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  groups?: readonly ReportColumnGroup[];
  /** The totals row, tinted blue and bold, under the rows. */
  totals?: Readonly<Record<string, ReactNode>>;
  /** Alternate rows tinted, for long tables of readings; hairlines between rows otherwise. */
  zebra?: boolean;
  /** Smaller cells and rows, for the dense tables (readings, per box). */
  dense?: boolean;
  /** No hairlines between rows, each a line tall, and a rule over an emphasised row (a total): the defect tables of TG35 page 6. */
  plain?: boolean;
  /** What a screen reader hears the table called. */
  caption?: string;
  className?: string;
};

const alignOf = (column: ReportColumn) => column.align ?? (column.numeric ? "right" : "left");
const ALIGN_CLASS = { left: "text-left", right: "text-right", center: "text-center" } as const;
/** A divided column's hairline: its left edge's own colour, so the header's dark rule keeps its own. */
const DIVIDER = "border-l-[0.25mm] border-l-slate-200";

/** For each row, the columns a cell of a row above it still covers (rowSpans). */
function coveredColumns(rows: readonly ReportRow[]): ReadonlySet<string>[] {
  const left = new Map<string, number>();
  return rows.map((row) => {
    const covered = new Set<string>();
    for (const [key, count] of left) {
      if (count <= 0) continue;
      covered.add(key);
      left.set(key, count - 1);
    }
    for (const [key, span] of Object.entries(row.rowSpans ?? {})) {
      if (span > 1 && !covered.has(key)) left.set(key, span - 1);
    }
    return covered;
  });
}

export function ReportTable({ columns, rows, groups, totals, zebra = false, dense = false, plain = false, caption, className }: ReportTableProps) {
  // A row of the design's Results by Check is about 6.5 mm; a dense row of readings about 5 mm; a plain row about 4.8 mm.
  const cell = plain ? "px-[1.6mm] py-[0.5mm]" : dense ? "px-[1.6mm] py-[0.7mm]" : "px-[2mm] py-[0.85mm]";
  const text = dense ? TYPE.small : cn(TYPE.body, plain ? "leading-[1.2]" : "leading-[1.45]");
  const covered = coveredColumns(rows);
  return (
    <table data-slot="report-table" className={cn("relative w-full table-fixed border-collapse", text, className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={column.width ? { width: column.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        {groups && groups.length > 0 && (
          <tr data-slot="report-table-groups">
            {groups.map((group, index) => (
              <th
                key={index}
                colSpan={group.span}
                scope={group.label ? "colgroup" : undefined}
                className={cn(
                  "px-[2mm] pb-[1.2mm] text-center font-semibold text-brand-600",
                  TYPE.small,
                  group.label ? "border-b-[0.3mm] border-brand-200" : "",
                )}
              >
                {group.label}
              </th>
            ))}
          </tr>
        )}
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cn(
                "border-b-[0.4mm] border-slate-900 align-bottom font-medium text-slate-600",
                plain ? "px-[1.6mm] pt-[1mm] pb-[1.2mm]" : dense ? "px-[1.6mm] pt-[1.4mm] pb-[1mm]" : "px-[2mm] pt-[2mm] pb-[1.4mm]",
                TYPE.small,
                ALIGN_CLASS[alignOf(column)],
                column.divided && DIVIDER,
              )}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) =>
          row.group ? (
            <tr key={row.key} data-row={row.key} data-kind="group" className="border-b-[0.3mm] border-brand-200">
              <th
                colSpan={columns.length}
                scope="rowgroup"
                className={cn(plain ? "px-[1.6mm] pt-[1.4mm] pb-[0.5mm]" : cell, "text-left align-bottom font-semibold text-brand-700")}
              >
                {columns[0] ? row.cells[columns[0].key] : null}
              </th>
            </tr>
          ) : (
            <tr
              key={row.key}
              data-row={row.key}
              className={cn(
                row.emphasis ? "bg-brand-50 font-semibold" : zebra && index % 2 === 1 ? "bg-slate-50" : "",
                plain ? row.emphasis && "border-t-[0.3mm] border-slate-300" : !zebra && "border-b-[0.25mm] border-slate-200",
              )}
            >
              {columns.map((column, columnIndex) => {
                if (covered[index].has(column.key)) return null;
                const Cell = columnIndex === 0 ? "th" : "td";
                const span = row.rowSpans?.[column.key] ?? 1;
                return (
                  <Cell
                    key={column.key}
                    scope={columnIndex === 0 ? "row" : undefined}
                    rowSpan={span > 1 ? span : undefined}
                    className={cn(
                      cell,
                      "align-middle [overflow-wrap:anywhere]",
                      ALIGN_CLASS[alignOf(column)],
                      column.numeric && "tabular-nums",
                      column.strong || row.emphasis ? "font-semibold text-slate-900" : column.muted ? "font-normal text-slate-600" : "font-normal text-slate-900",
                      column.divided && DIVIDER,
                    )}
                  >
                    {row.cells[column.key]}
                  </Cell>
                );
              })}
            </tr>
          ),
        )}
      </tbody>
      {totals && (
        <tfoot>
          <tr data-row="totals" className="border-t-[0.4mm] border-slate-900 bg-brand-50 font-semibold text-slate-900">
            {columns.map((column, columnIndex) => {
              const Cell = columnIndex === 0 ? "th" : "td";
              return (
                <Cell
                  key={column.key}
                  scope={columnIndex === 0 ? "row" : undefined}
                  className={cn(cell, ALIGN_CLASS[alignOf(column)], column.numeric && "tabular-nums", column.divided && DIVIDER)}
                >
                  {totals[column.key]}
                </Cell>
              );
            })}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
