import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sectionLabel, type SectionId } from "./sections";

/** One /design section: heading (its name in the index), the decision it records, and the specimens. */
export function DesignSection({
  id,
  description,
  source,
  children,
  className,
}: {
  id: SectionId;
  description?: ReactNode;
  /** Where the decision came from: a website file or "app-specific". */
  source?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 space-y-5 xl:scroll-mt-8", className)}>
      <div className="space-y-1.5">
        <h2 id={`${id}-title`} className="text-2xl font-bold tracking-tight text-foreground">
          {sectionLabel(id)}
        </h2>
        {description && <div className="max-w-3xl text-base text-muted-foreground">{description}</div>}
        {source && (
          <p className="text-xs font-medium text-muted-foreground">
            Source: <span className="font-mono text-foreground">{source}</span>
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/** A white specimen panel with an optional caption. */
export function Specimen({
  label,
  children,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-card p-5 shadow-sm ring-1 ring-border", className)}>
      {label && <p className="mb-4 text-sm font-semibold text-foreground">{label}</p>}
      {children}
    </div>
  );
}
