// Result and severity pills for the AI panel: the status colours with their
// icons and words (docs/DESIGN.md "Status colours"), never colour alone.
import type { ReactNode } from "react";
import { StatusPill } from "@/components/qc/status-pill";
import { RESULT_STATUS, SEVERITY_LABEL, SEVERITY_STATUS } from "@/lib/inspections/ai/format";
import type { FindingSeverity } from "@/lib/schemas/ai-review";
import type { InspectionResult } from "@/lib/schemas/common";
import { cn } from "@/lib/utils";

/**
 * An overall result: the system's suggestion, the inspector's final result or
 * the AI's suggestion, worded as everywhere else (Passed, Failed, On hold).
 */
export function ResultPill({
  result,
  size = "md",
  emptyLabel = "Not Chosen",
}: {
  result: InspectionResult | null;
  size?: "sm" | "md";
  emptyLabel?: string;
}) {
  if (result === null) return <StatusPill status="not_done" size={size} label={emptyLabel} />;
  return <StatusPill status={RESULT_STATUS[result]} size={size} />;
}

export function SeverityPill({ severity }: { severity: FindingSeverity }) {
  return <StatusPill status={SEVERITY_STATUS[severity]} size="sm" label={SEVERITY_LABEL[severity]} />;
}

/**
 * The small label above each cell of the comparison. Below the three-column
 * width it is visible; in three columns the column headings say it, so it
 * stays for screen readers only.
 */
export function CellLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase @4xl/ai:sr-only",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Secondary text that says a cell is empty, e.g. "No comment". */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
