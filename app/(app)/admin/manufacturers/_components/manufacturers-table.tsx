"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { manufacturerLabel, oneLine, type ManufacturerItem } from "@/lib/admin/reference";
import { EditButton, ListCard, NoValue, UsageText } from "./reference-list";

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
  onEdit: (id: string) => void;
}) {
  return (
    <ListCard>
      <Table className="touch:text-base">
        <caption className="sr-only">Manufacturers</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Name</TableHead>
            <TableHead className="hidden xl:table-cell">Factory</TableHead>
            <TableHead>Country</TableHead>
            <TableHead className="hidden xl:table-cell">Address</TableHead>
            <TableHead>In use</TableHead>
            <TableHead className="w-0 pr-4">
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
              onClick={() => onEdit(row.id)}
            >
              <TableCell className="pl-4 whitespace-normal">
                <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
                  <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.name}</span>
                  {row.factoryName && (
                    <span className="text-muted-foreground [overflow-wrap:anywhere] xl:hidden">{row.factoryName}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden whitespace-normal xl:table-cell">
                {row.factoryName ? <span className="[overflow-wrap:anywhere]">{row.factoryName}</span> : <NoValue />}
              </TableCell>
              <TableCell className="whitespace-normal">{row.country ?? <NoValue />}</TableCell>
              <TableCell className="hidden xl:table-cell">
                {row.address ? (
                  <div className="max-w-xs truncate text-muted-foreground" title={row.address}>
                    {oneLine(row.address)}
                  </div>
                ) : (
                  <NoValue />
                )}
              </TableCell>
              <TableCell>
                <UsageText usage={row.usage} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                <EditButton name={manufacturerLabel(row)} onClick={() => onEdit(row.id)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListCard>
  );
}
