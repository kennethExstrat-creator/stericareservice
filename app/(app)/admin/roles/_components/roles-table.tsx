"use client";

import { EyeIcon, PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACTION_TOTAL, BUILT_IN_TAG, SCREEN_TOTAL, allowedCounts, type RoleItem } from "@/lib/admin/roles";
import { ROLE_ACCESS_INFO } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { CELL, HEAD, ListCard, rowEditButton } from "../../manufacturers/_components/reference-list";

/** Counts are data: tabular figures, right aligned (docs/DESIGN.md, Type scale). */
const COUNT = "text-right tabular-nums";

/**
 * Every role, one compact line each with a mouse (docs/DESIGN.md, Density),
 * the description under the name. What its people see, how many of the
 * screens and actions it switches on (Users and Roles & Permissions count as
 * screens: the Admin role's alone), and how many people have it, the
 * inactive and invited among them: a role people have is not deleted.
 */
export function RolesTable({
  rows,
  selectedId,
  onOpen,
}: {
  rows: readonly RoleItem[];
  selectedId: string | null;
  /** Opens the role's panel; `opener` gets the focus back when it closes. */
  onOpen: (id: string, opener: HTMLElement | null) => void;
}) {
  return (
    <ListCard>
      <Table className="touch:text-base">
        <caption className="sr-only">Roles, what their people see, what they allow and who has them</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn("pl-4", HEAD)}>Role</TableHead>
            <TableHead className={HEAD}>Sees</TableHead>
            <TableHead className={cn(COUNT, HEAD)}>Screens</TableHead>
            <TableHead className={cn(COUNT, HEAD)}>Actions</TableHead>
            <TableHead className={cn(COUNT, HEAD)}>People</TableHead>
            <TableHead className={cn("w-0 pr-4", HEAD)}>
              <span className="sr-only">Edit</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((role) => {
            const allowed = allowedCounts(role);
            return (
              <TableRow
                key={role.id}
                data-role={role.builtIn ?? "custom"}
                data-state={role.id === selectedId ? "selected" : undefined}
                className="cursor-pointer"
                onClick={(event) => onOpen(role.id, rowEditButton(event.currentTarget))}
              >
                <TableCell className={cn("pl-4 whitespace-normal", CELL)}>
                  <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
                      <span className="[overflow-wrap:anywhere]">{role.name}</span>
                      {role.builtIn && <Badge variant="secondary">{BUILT_IN_TAG}</Badge>}
                    </span>
                    {role.description && (
                      <span className="max-w-prose text-muted-foreground [overflow-wrap:anywhere]">{role.description}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className={CELL}>{ROLE_ACCESS_INFO[role.access].label}</TableCell>
                <TableCell className={cn(COUNT, CELL)}>
                  {allowed.screens} of {SCREEN_TOTAL}
                </TableCell>
                <TableCell className={cn(COUNT, CELL)}>
                  {allowed.actions} of {ACTION_TOTAL}
                </TableCell>
                <TableCell className={cn(COUNT, role.people === 0 && "text-muted-foreground", CELL)}>
                  {role.people.toLocaleString("en-GB")}
                </TableCell>
                <TableCell className={cn("pr-4 text-right", CELL)}>
                  <OpenButton role={role} onClick={(button) => onOpen(role.id, button)} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ListCard>
  );
}

/** Edit, or View for the Admin role, which never changes. The whole row opens the panel too. */
function OpenButton({ role, onClick }: { role: RoleItem; onClick: (button: HTMLButtonElement) => void }) {
  const view = role.builtIn === "admin";
  const Icon = view ? EyeIcon : PencilIcon;
  const verb = view ? "View" : "Edit";
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`${verb} ${role.name}`}
      data-row-edit=""
      onClick={(event) => {
        // The row opens the same panel; one opening is enough.
        event.stopPropagation();
        onClick(event.currentTarget);
      }}
    >
      <Icon aria-hidden />
      {verb}
    </Button>
  );
}
