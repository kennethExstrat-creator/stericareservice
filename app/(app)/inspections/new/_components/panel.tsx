// A section of the new-inspection form: a white card (docs/DESIGN.md Card)
// with an icon, a heading and an optional line under it.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  headingId,
  icon: Icon,
  title,
  description,
  descriptionId,
  className,
  children,
  ...rest
}: {
  headingId: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  descriptionId?: string;
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
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1 pt-1">
          <h2 id={headingId} className="text-lg leading-tight font-bold text-foreground">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground touch:text-base">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
