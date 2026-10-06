"use client";

// Shared by /admin/manufacturers and /admin/clients (see reference-panel.tsx).

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

/** "Not in use" in secondary text; counts in normal text, since they block deleting. */
export function UsageText({ usage }: { usage: Usage }) {
  return (
    <span className={cn("whitespace-normal", !isInUse(usage) && "text-muted-foreground")}>{usageText(usage)}</span>
  );
}

/** The row's Edit button. The whole row opens the panel too, for mouse and touch. */
export function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Edit ${name}`}
      onClick={(event) => {
        // The row opens the same panel; one opening is enough.
        event.stopPropagation();
        onClick();
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
  description: string;
  action: ReactNode;
}) {
  return (
    <Empty className="border border-dashed border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}

/** A search that matches nothing. */
export function NoMatches({ query, many, onClear }: { query: string; many: string; onClear: () => void }) {
  return (
    <Empty className="border border-dashed border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No {many} match “{query.trim()}”</EmptyTitle>
        <EmptyDescription>Check the spelling, or search for part of the name.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" onClick={onClear}>
          Clear search
        </Button>
      </EmptyContent>
    </Empty>
  );
}
