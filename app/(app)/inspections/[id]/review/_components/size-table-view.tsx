// A module's results with the sizes side by side (layout A, Kenneth, 27
// October 2026): its measures down the side, one column per ordered size,
// a value in each cell with its own spec or limit under it where sizes
// differ, and the size's result in the last row. A cell to look at is
// tinted: amber for a label the template does not list, red for a value
// outside its spec. Equal size columns, so tables line up from module to
// module; a narrow screen scrolls the table, never the page.
import { StatusPill } from "@/components/qc";
import type { Status } from "@/lib/design/status";
import type { SizeTable } from "@/lib/inspections/review/size-table";
import { cn } from "@/lib/utils";
import { Missing } from "./review-section";

export type SizeColumn = { size: string; label: string };

export function SizeTableView({
  title,
  table,
  sizes,
  results,
}: {
  /** The module's title, for the table's caption. */
  title: string;
  table: SizeTable;
  sizes: readonly SizeColumn[];
  /** The result per size, in `sizes` order; no Result row without them. */
  results?: readonly (Status | null)[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border">
      <table className="w-full min-w-[34rem] table-fixed border-collapse text-base tabular-nums fine:text-sm">
        <caption className="sr-only">{title}, sizes side by side</caption>
        <colgroup>
          <col className="w-[30%] max-w-64" />
          {sizes.map((column) => (
            <col key={column.size} />
          ))}
        </colgroup>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-muted-foreground">
              {table.corner ?? <span className="sr-only">Measure</span>}
            </th>
            {sizes.map((column) => (
              <th
                key={column.size}
                scope="col"
                className="border-l border-border px-3 py-2 text-center text-sm font-semibold text-muted-foreground"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key} className="border-t border-border">
              <th scope="row" className="px-3 py-2 text-left align-top font-medium text-foreground">
                {row.label}
                {row.spec && <span className="block text-sm font-normal text-muted-foreground fine:text-xs">{row.spec}</span>}
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={sizes[index]?.size ?? index}
                  className={cn(
                    "border-l border-border px-3 py-2 text-center align-top [overflow-wrap:anywhere]",
                    cell.tone === "warn" && "bg-warn-tint",
                    cell.tone === "fail" && "bg-fail-tint",
                  )}
                >
                  <span className={cn("font-semibold", cell.tone === "fail" ? "text-fail" : "text-foreground")}>
                    {cell.text ?? <Missing label="Not entered" />}
                  </span>
                  {cell.note && (
                    <span
                      className={cn(
                        "block text-sm fine:text-xs",
                        cell.tone === "warn" ? "font-semibold text-warn" : cell.tone === "fail" ? "text-fail" : "text-muted-foreground",
                      )}
                    >
                      {cell.note}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
          {results && (
            <tr className="border-t border-border bg-slate-50">
              <th scope="row" className="px-3 py-2 text-left font-semibold text-foreground">
                Result
              </th>
              {results.map((status, index) => (
                <td key={sizes[index]?.size ?? index} className="border-l border-border px-3 py-2 text-center">
                  {status ? <StatusPill status={status} size="sm" className="mx-auto" /> : <Missing label="No result" />}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
