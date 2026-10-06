// The standard frame for a sub-section inside a module body (ModuleCard's
// children): a heading in the template's wording ("Major Defects (AQL
// 2.5)"), an optional description, optional status and actions, then the
// content. Sections after the first are divided by a rule, so every module
// spaces its parts the same way. Heading level 3 sits under ModuleCard's h2.
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import { issuePathProps, type IssuePath } from "./issue-path";
import { SMALL_PILL_TOUCH, StatusPill } from "./status-pill";

type ModuleSectionProps = {
  /** In the template's wording; never editable on the capture screen (6.2 rule 11). */
  title: ReactNode;
  description?: ReactNode;
  /** A result for this part, e.g. a defect class. */
  status?: Status;
  statusLabel?: string;
  /** Controls beside the heading, e.g. a HandToggle or a "Copy from size M" button. */
  actions?: ReactNode;
  headingLevel?: 3 | 4;
  /** Marks the section for issue links (useIssueFocus). */
  issuePath?: IssuePath;
  id?: string;
  children?: ReactNode;
  className?: string;
};

export function ModuleSection({
  title,
  description,
  status,
  statusLabel,
  actions,
  headingLevel = 3,
  issuePath,
  id,
  children,
  className,
}: ModuleSectionProps) {
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-slot="module-section"
      {...issuePathProps(issuePath)}
      className={cn(
        "min-w-0 scroll-mt-24 space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <Heading id={headingId} className="text-base leading-6 font-semibold text-balance text-foreground">
            {title}
          </Heading>
          {description && <div className="text-sm text-muted-foreground touch:text-base">{description}</div>}
        </div>
        {(actions || status) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {status && <StatusPill size="sm" status={status} label={statusLabel} className={SMALL_PILL_TOUCH} />}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}
