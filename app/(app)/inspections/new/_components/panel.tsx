// A section of the new-inspection form: a white card (docs/DESIGN.md Card)
// with an icon and a heading, and any controls at the heading's end (Source
// Documents' Files / Media switch). No line under the title: subtitles in
// cards are redundant (Kenneth, 12 October 2026); field hints stay.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  headingId,
  icon: Icon,
  title,
  actions,
  className,
  children,
  ...rest
}: {
  headingId: string;
  icon: LucideIcon;
  title: string;
  /** At the heading's end; below it when the card is narrow. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        // relative: anchors the sr-only status lines inside (docs/DESIGN.md, Do / Don't).
        "relative flex min-w-0 flex-col gap-5 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6",
        className,
      )}
      {...rest}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon aria-hidden className="size-5" />
          </span>
          <h2 id={headingId} className="min-w-0 text-lg leading-tight font-bold text-foreground">
            {title}
          </h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
