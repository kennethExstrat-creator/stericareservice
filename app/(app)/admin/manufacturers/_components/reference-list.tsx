"use client";

// Shared by /admin/manufacturers, /admin/clients and /admin/roles (see reference-panel.tsx).

import type { ReactNode } from "react";
import { PencilIcon, SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { isInUse, usageText, type Usage } from "@/lib/admin/reference";
import { cn } from "@/lib/utils";

/** The white card a list table sits in, as on /admin/users. */
export function ListCard({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">{children}</div>;
}

/**
 * Compact rows with a mouse or trackpad (docs/DESIGN.md, Density), as on
 * /admin/users: a 36 px header and rows of about 35 px around the 32 px Edit
 * button and logo. Touch keeps the table's own 44 px sizes.
 */
export const HEAD = "fine:h-9";
export const CELL = "fine:py-px";

/** A row opens its panel from its Edit button, so the keyboard goes back there when the panel closes. */
export function rowEditButton(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>("[data-row-edit]");
}

/** An empty optional value: a dash for the eye, "None" for screen readers. */
export function NoValue() {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">None</span>
    </>
  );
}

/**
 * "Not in use" in secondary text; counts in normal text, since they block
 * deleting. On one line: a long name wraps instead.
 */
export function UsageText({ usage }: { usage: Usage }) {
  return (
    <span className={cn("whitespace-nowrap", !isInUse(usage) && "text-muted-foreground")}>{usageText(usage)}</span>
  );
}

/** The row's Edit button. The whole row opens the panel too, for mouse and touch. */
export function EditButton({ name, onClick }: { name: string; onClick: (button: HTMLButtonElement) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Edit ${name}`}
      data-row-edit=""
      onClick={(event) => {
        // The row opens the same panel; one opening is enough.
        event.stopPropagation();
        onClick(event.currentTarget);
      }}
    >
      <PencilIcon aria-hidden />
      Edit
    </Button>
  );
}

/** Nothing on the list yet. */
export function EmptyList({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  /** A sentence under the title, if the title and the button do not say enough. */
  description?: string;
  action: ReactNode;
}) {
  return (
    <Empty className="border border-dashed border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}

/** A search that matches nothing. `many` names the rows in Title Case: "Clients". */
export function NoMatches({ query, many, onClear }: { query: string; many: string; onClear: () => void }) {
  return (
    <Empty className="border border-dashed border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No {many} Match “{query.trim()}”</EmptyTitle>
        <EmptyDescription>Check the spelling, or search for part of the name.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" onClick={onClear}>
          Clear Search
        </Button>
      </EmptyContent>
    </Empty>
  );
}
