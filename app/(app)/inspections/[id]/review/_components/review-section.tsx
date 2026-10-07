import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One part of the review under an H2. A link that scrolls to an anchored
 * section lands it clear of the iPad top bar by the page's scroll padding
 * (app/globals.css), which leaves the bar and 1rem.
 */
export function ReviewSection({
  id,
  title,
  description,
  actions,
  className,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 id={headingId} className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h2>
          {description && <div className="max-w-3xl text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A white card on the mist ground, the app's card look. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl bg-card shadow-sm ring-1 ring-border", className)}>{children}</div>;
}

/** "—" on screen, the reason for screen readers (anchored, so it never widens a scroller). */
export function Missing({ label }: { label: string }) {
  return (
    <span className="relative">
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
