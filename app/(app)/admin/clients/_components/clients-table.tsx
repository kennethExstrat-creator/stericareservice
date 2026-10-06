"use client";

import { CloudOffIcon, ImageOffIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { oneLine, type ClientItem, type LogoPreview } from "@/lib/admin/reference";
import { cn } from "@/lib/utils";
import { CELL, EditButton, HEAD, ListCard, NoValue, UsageText } from "../../manufacturers/_components/reference-list";

/**
 * The clients, with their logos. On iPad the notes drop out (the panel shows
 * them), so rows keep 44 px controls without scrolling sideways.
 */
export function ClientsTable({
  rows,
  selectedId,
  onEdit,
}: {
  rows: readonly ClientItem[];
  selectedId: string | null;
  onEdit: (id: string) => void;
}) {
  return (
    <ListCard>
      <Table className="touch:text-base">
        <caption className="sr-only">Clients</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn("w-0 pl-4", HEAD)}>Logo</TableHead>
            <TableHead className={HEAD}>Name</TableHead>
            <TableHead className={cn("hidden xl:table-cell", HEAD)}>Notes</TableHead>
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
              onClick={() => onEdit(row.id)}
            >
              <TableCell className={cn("pl-4", CELL)}>
                <LogoThumbnail logo={row.logo} />
              </TableCell>
              <TableCell className={cn("whitespace-normal", CELL)}>
                <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.name}</span>
              </TableCell>
              <TableCell className={cn("hidden xl:table-cell", CELL)}>
                {row.notes ? (
                  <div className="max-w-md truncate text-muted-foreground" title={row.notes}>
                    {oneLine(row.notes)}
                  </div>
                ) : (
                  <NoValue />
                )}
              </TableCell>
              <TableCell className={CELL}>
                <UsageText usage={row.usage} />
              </TableCell>
              <TableCell className={cn("pr-4 text-right", CELL)}>
                <EditButton name={row.name} onClick={() => onEdit(row.id)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListCard>
  );
}

/**
 * A logo in its own white box, scaled to fit. The name sits next to it, so
 * the image is decorative here; the words say when there is none, when its
 * file is missing, and when Storage could not be asked for a preview.
 */
export function LogoThumbnail({ logo }: { logo: LogoPreview | null }) {
  const box = "flex h-8 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md touch:h-10 touch:w-20";
  if (!logo) {
    return (
      <span className={cn(box, "border border-dashed border-slate-300 bg-slate-50 text-xs text-muted-foreground")}>
        No logo
      </span>
    );
  }
  if (logo.url === null) {
    return logo.problem === "unavailable" ? (
      // The file may be fine: Storage did not answer. Wider, so the word fits.
      <span
        className={cn(box, "w-auto gap-1 border border-border bg-slate-50 px-2 text-xs text-muted-foreground touch:w-auto")}
        title="Logo preview unavailable. Reload to try again."
      >
        <CloudOffIcon aria-hidden className="size-3.5" />
        Unavailable
      </span>
    ) : (
      <span className={cn(box, "gap-1 border border-warn-border bg-warn-tint text-xs font-medium text-warn")}>
        <ImageOffIcon aria-hidden className="size-3.5" />
        Missing
      </span>
    );
  }
  return (
    <span className={cn(box, "bg-white p-1 ring-1 ring-border")}>
      {/* A signed URL from a private bucket: next/image would need the
          Supabase host in remotePatterns and would proxy every token. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
    </span>
  );
}
