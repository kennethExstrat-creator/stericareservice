// Small pieces the defects tabs share. No hooks: server and client both use them.
import type { ReactNode } from "react";
import { SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/** The white card a table sits in, as on /admin/users. */
export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border", className)}>{children}</div>;
}

/** An empty optional value: a dash for the eye, "None" for screen readers. */
export function NoValue({ spoken = "None" }: { spoken?: string }) {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

/** Nothing to show yet: what will appear here, and the one useful next step. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty className="border border-dashed border-slate-300 bg-card px-6 py-12 md:py-16">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon" className="size-12 rounded-xl bg-brand-50 text-brand-600">
          {icon}
        </EmptyMedia>
        <EmptyTitle>
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
        </EmptyTitle>
        <EmptyDescription className="text-base text-muted-foreground fine:text-sm">{children}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** A search that matches nothing. */
export function NoMatches({ query, many, onClear }: { query: string; many: string; onClear: () => void }) {
  return (
    <EmptyState
      icon={<SearchXIcon aria-hidden />}
      title={`No ${many} match “${query.trim()}”`}
      action={
        <Button type="button" variant="outline" onClick={onClear}>
          Clear search
        </Button>
      }
    >
      Check the spelling, or search for part of a word.
    </EmptyState>
  );
}
