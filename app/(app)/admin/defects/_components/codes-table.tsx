"use client";

import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOf, oneLine, type DefectCodeItem } from "@/lib/admin/defects";
import { cn } from "@/lib/utils";
import { CodeStatusBadge } from "./badges";
import { ListCard } from "./list-parts";

// Compact rows with a mouse (docs/DESIGN.md, Density): about 36 px around the
// 32 px Edit button. Touch keeps 44 px controls and more room.
const HEAD = "h-9 px-3 text-sm font-medium text-muted-foreground first:pl-4 last:pr-4 touch:h-11";
const CELL = "px-3 py-1.5 align-middle first:pl-4 last:pr-4 fine:py-0.5 touch:py-2.5";

/**
 * "STD_EG and SAFEDON_EG", or that no template maps a label to it. One line
 * with a mouse (the whole list in the tooltip); on touch, where nothing
 * hovers, it wraps.
 */
function UsedBy({ templates }: { templates: readonly string[] }) {
  if (templates.length === 0) return <span className="text-muted-foreground">No template</span>;
  const list = listOf(templates);
  return (
    <span className="block fine:truncate touch:whitespace-normal touch:[overflow-wrap:anywhere]" title={list}>
      {list}
    </span>
  );
}

/**
 * The codes, one line each on desktop (1280 px and wider): code, name,
 * description, the templates that use it, status. On iPad the description
 * folds under the name, and in portrait the templates too, so rows keep
 * their 44 px controls without scrolling sideways.
 */
export function CodesTable({
  rows,
  selectedCode,
  onEdit,
}: {
  rows: readonly DefectCodeItem[];
  selectedCode: string | null;
  onEdit: (code: string) => void;
}) {
  return (
    <ListCard>
      <Table className="table-fixed text-sm touch:text-base">
        <caption className="sr-only">Defect codes, active first</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={cn(HEAD, "w-44 touch:w-48")}>
              Code
            </TableHead>
            <TableHead scope="col" className={HEAD}>
              Name
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "hidden xl:table-cell")}>
              Description
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "hidden w-48 lg:table-cell")}>
              Used in
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-28 touch:w-32")}>
              Status
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-24 touch:w-28")}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.code}
              data-code={row.code}
              data-state={row.code === selectedCode ? "selected" : undefined}
              className="cursor-pointer"
              onClick={() => onEdit(row.code)}
            >
              <TableHead scope="row" className={cn(CELL, "h-auto font-normal whitespace-normal touch:h-auto")}>
                <span
                  className={cn(
                    "font-mono text-[0.8125rem] [overflow-wrap:anywhere] touch:text-sm",
                    row.active ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {row.code}
                </span>
              </TableHead>
              <TableCell className={cn(CELL, "whitespace-normal")}>
                <span className="block font-medium text-foreground [overflow-wrap:anywhere]">{row.name}</span>
                {/* One line here; the panel (tap or click the row) shows all of it. */}
                {row.description && (
                  <span
                    className="mt-0.5 line-clamp-1 text-sm text-muted-foreground [overflow-wrap:anywhere] xl:hidden"
                    title={row.description}
                  >
                    {oneLine(row.description)}
                  </span>
                )}
                {row.usedBy.length > 0 && (
                  <span className="mt-0.5 block text-sm text-muted-foreground lg:hidden">Used in {listOf(row.usedBy)}</span>
                )}
              </TableCell>
              <TableCell className={cn(CELL, "hidden xl:table-cell")}>
                {row.description ? (
                  <span className="block truncate text-muted-foreground" title={row.description}>
                    {oneLine(row.description)}
                  </span>
                ) : (
                  <span className="sr-only">No description</span>
                )}
              </TableCell>
              <TableCell className={cn(CELL, "hidden lg:table-cell")}>
                <UsedBy templates={row.usedBy} />
              </TableCell>
              <TableCell className={CELL}>
                <CodeStatusBadge active={row.active} />
              </TableCell>
              <TableCell className={cn(CELL, "text-right")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${row.code}`}
                  onClick={(event) => {
                    // The row opens the same panel; one opening is enough.
                    event.stopPropagation();
                    onEdit(row.code);
                  }}
                >
                  <PencilIcon aria-hidden />
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListCard>
  );
}
