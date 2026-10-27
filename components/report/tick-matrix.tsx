// Checks across sizes (the design's page 8, the results matrix): a row per check, a
// column per size, a solid status tick in each cell (a green disc with a
// check for passed, a red one with a cross for failed), a dash where the
// check did not apply to the size.
import type { Status } from "@/lib/design/status";
import { STATUS_LABEL } from "@/lib/design/status";
import { cn } from "@/lib/utils";
import { StatusTick } from "./status-chip";
import { TYPE } from "./theme";

export type TickMatrixRow = {
  key: string;
  /** "Dimensions (Length & Width)". */
  label: string;
  /** One per column, in column order; null where the check does not apply. */
  cells: readonly (Status | null)[];
};

export type TickMatrixProps = {
  /** The sizes as the template shows them. */
  columns: readonly string[];
  rows: readonly TickMatrixRow[];
  /** The first column's header. */
  heading?: string;
  caption?: string;
  /** Each size column's width as CSS ("10.5%", TG35 page 8's); 16% each when left out. */
  columnWidth?: string;
  className?: string;
};

export function TickMatrix({ columns, rows, heading = "Check", caption, columnWidth, className }: TickMatrixProps) {
  return (
    <table data-slot="report-tick-matrix" className={cn("relative w-full border-collapse", TYPE.body, className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>
          <th scope="col" className={cn("border-b-[0.4mm] border-slate-900 px-[2mm] pt-[2mm] pb-[1.4mm] text-left font-medium text-slate-600", TYPE.small)}>
            {heading}
          </th>
          {columns.map((column) => (
            <th
              key={column}
              scope="col"
              style={columnWidth ? { width: columnWidth } : undefined}
              className={cn(
                !columnWidth && "w-[16%]",
                "border-b-[0.4mm] border-slate-900 px-[2mm] pt-[2mm] pb-[1.4mm] text-center font-medium text-slate-600",
                TYPE.small,
              )}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-row={row.key} className="border-b-[0.25mm] border-slate-200">
            <th scope="row" className="px-[2mm] py-[1.8mm] text-left font-normal text-slate-900">
              {row.label}
            </th>
            {columns.map((column, index) => {
              const status = row.cells[index] ?? null;
              return (
                <td key={column} data-cell={status ?? "none"} className="relative px-[2mm] py-[1.2mm] text-center">
                  {status ? (
                    <StatusTick status={status} size={5.2} label={`${row.label}, ${column}: ${STATUS_LABEL[status]}`} className="align-middle" />
                  ) : (
                    <>
                      <span aria-hidden className="text-slate-400">
                        —
                      </span>
                      <span className="sr-only">Not applicable</span>
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
