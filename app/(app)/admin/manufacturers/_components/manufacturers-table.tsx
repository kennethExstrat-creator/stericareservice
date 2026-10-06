"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { manufacturerLabel, oneLine, type ManufacturerItem } from "@/lib/admin/reference";
import { cn } from "@/lib/utils";
import { CELL, EditButton, HEAD, ListCard, NoValue, UsageText, rowEditButton } from "./reference-list";

/**
 * The manufacturers, one compact line each on desktop (1280 px and wider).
 * On iPad the factory sits under the name and the address drops out (the
 * panel shows it), so rows keep 44 px controls without scrolling sideways.
 */
export function ManufacturersTable({
  rows,
  selectedId,
  onEdit,
}: {
  rows: readonly ManufacturerItem[];
  selectedId: string | null;
  /** Opens the row's panel; `opener` gets the focus back when it closes. */
  onEdit: (id: string, opener: HTMLElement | null) => void;
}) {
  return (
    <ListCard>
      <Table className="touch:text-base">
        <caption className="sr-only">Manufacturers</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn("pl-4", HEAD)}>Name</TableHead>
            <TableHead className={cn("hidden xl:table-cell", HEAD)}>Factory</TableHead>
            <TableHead className={HEAD}>Country</TableHead>
            <TableHead className={cn("hidden xl:table-cell", HEAD)}>Address</TableHead>
            <TableHead className={HEAD}>In use</TableHead>
            <TableHead className={cn("w-0 pr-4", HEAD)}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.id === selectedId ? "selected" : undefined}
              className="cursor-pointer"
              onClick={(event) => onEdit(row.id, rowEditButton(event.currentTarget))}
            >
              <TableCell className={cn("pl-4 whitespace-normal", CELL)}>
                <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
                  <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.name}</span>
                  {row.factoryName && (
                    <span className="text-muted-foreground [overflow-wrap:anywhere] xl:hidden">{row.factoryName}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className={cn("hidden whitespace-normal xl:table-cell", CELL)}>
                {row.factoryName ? <span className="[overflow-wrap:anywhere]">{row.factoryName}</span> : <NoValue />}
              </TableCell>
              <TableCell className={cn("whitespace-normal", CELL)}>{row.country ?? <NoValue />}</TableCell>
              <TableCell className={cn("hidden xl:table-cell", CELL)}>
                {row.address ? (
                  <div className="max-w-xs truncate text-muted-foreground" title={row.address}>
                    {oneLine(row.address)}
                  </div>
                ) : (
                  <NoValue />
                )}
              </TableCell>
              <TableCell className={CELL}>
                <UsageText usage={row.usage} />
              </TableCell>
              <TableCell className={cn("pr-4 text-right", CELL)}>
                <EditButton name={manufacturerLabel(row)} onClick={(button) => onEdit(row.id, button)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListCard>
  );
}
