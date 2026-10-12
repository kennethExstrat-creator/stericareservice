"use client";

import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { oneLine } from "@/lib/admin/defects";
import type { ShortformCode, ShortformItem } from "@/lib/admin/shortforms";
import { sameShortform } from "@/lib/schemas/ai-settings";
import { cn } from "@/lib/utils";
import { CodeProblemBadge, NoCodeBadge, ShortformStatusBadge } from "./badges";
import { ListCard } from "./list-parts";

// Compact rows with a mouse, as the codes (docs/DESIGN.md, Density); 44 px controls on touch.
const HEAD = "h-9 px-3 text-sm font-medium text-muted-foreground first:pl-4 last:pr-4 touch:h-11";
const CELL = "px-3 py-1.5 align-middle first:pl-4 last:pr-4 fine:py-0.5 touch:py-2.5";

/** Each code on its own line: its library name, then the code; or that it has none yet. */
function LinkedCodes({ codes }: { codes: readonly ShortformCode[] }) {
  if (codes.length === 0) return <NoCodeBadge />;
  return (
    <ul className="flex flex-col gap-1">
      {codes.map((code) => (
        <li key={code.code} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-code={code.code}>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {code.name && <span className="font-medium text-foreground">{code.name} </span>}
            <span
              className={cn(
                "font-mono text-[0.8125rem] touch:text-sm",
                code.name ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {code.code}
            </span>
          </span>
          {code.state !== "ok" && <CodeProblemBadge state={code.state} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * One kind of shortform. Defects: the shortform, its codes, its meaning (on
 * desktop; on iPad one line under the shortform), whether it is confirmed.
 * Other terms: the shortform, its meaning, whether it is confirmed. The whole
 * row opens the panel; the keyboard uses its Edit button.
 */
export function ShortformsTable({
  kind,
  rows,
  selected,
  disabled,
  onEdit,
}: {
  kind: "defect" | "term";
  rows: readonly ShortformItem[];
  /** The shortform the panel has open. */
  selected: string | null;
  /** Nothing can be saved here (no secret key, or the list could not be read). */
  disabled: boolean;
  /** Opens the shortform's panel; `opener` (the row's Edit button) gets the focus back when it closes. */
  onEdit: (short: string, opener: HTMLElement | null) => void;
}) {
  const defects = kind === "defect";
  return (
    <ListCard>
      <Table className="table-fixed text-sm touch:text-base">
        <caption className="sr-only">{defects ? "Defect shortforms and their codes" : "Other terms inspectors write"}</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={cn(HEAD, defects ? "w-[30%] xl:w-28" : "w-28 touch:w-32")}>
              Shortform
            </TableHead>
            {defects && (
              <TableHead scope="col" className={HEAD}>
                Defect Code
              </TableHead>
            )}
            <TableHead scope="col" className={cn(HEAD, defects && "hidden xl:table-cell")}>
              Meaning
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-40 touch:w-44")}>
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
              key={row.short}
              data-short={row.short}
              data-state={selected !== null && sameShortform(row.short, selected) ? "selected" : undefined}
              className={cn(!disabled && "cursor-pointer")}
              onClick={
                disabled
                  ? undefined
                  : (event) => onEdit(row.short, event.currentTarget.querySelector<HTMLElement>("[data-edit]"))
              }
            >
              <TableHead scope="row" className={cn(CELL, "h-auto font-normal whitespace-normal touch:h-auto")}>
                <span className="block font-semibold text-foreground [overflow-wrap:anywhere]">{row.short}</span>
                {/* One line here; the panel (tap or click the row) shows all of it. */}
                {defects && (
                  <span
                    className="mt-0.5 line-clamp-1 text-sm text-muted-foreground [overflow-wrap:anywhere] xl:hidden"
                    title={row.meaning}
                  >
                    {oneLine(row.meaning)}
                  </span>
                )}
              </TableHead>
              {defects && (
                <TableCell className={cn(CELL, "whitespace-normal")}>
                  <LinkedCodes codes={row.codes} />
                </TableCell>
              )}
              <TableCell className={cn(CELL, "whitespace-normal", defects && "hidden xl:table-cell")}>
                {/* Two lines with a mouse (all of it in the tooltip); on touch, where nothing hovers, all of it. */}
                <span className="text-muted-foreground [overflow-wrap:anywhere] fine:line-clamp-2" title={row.meaning}>
                  {oneLine(row.meaning)}
                </span>
              </TableCell>
              <TableCell className={CELL}>
                <ShortformStatusBadge confirmed={row.confirmed} />
              </TableCell>
              <TableCell className={cn(CELL, "text-right")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${row.short}`}
                  data-edit
                  disabled={disabled}
                  onClick={(event) => {
                    // The row opens the same panel; one opening is enough.
                    event.stopPropagation();
                    onEdit(row.short, event.currentTarget);
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
