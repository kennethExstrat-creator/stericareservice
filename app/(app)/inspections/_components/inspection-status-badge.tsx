// Where an inspection is in its workflow: draft, submitted, approved,
// reopened. Deliberately not a StatusPill: the result colours (green, red,
// amber, and the slate dashed ring of Not Done) stay with the Result column,
// so an approved inspection that failed never shows a green tick and a
// reopened one on hold never shows two amber pills side by side. Workflow
// states use brand blue and plain slate only; shapes differ as well as tones,
// and every state is spelled out.
import { LockIcon, PencilLineIcon, RotateCcwIcon, SendIcon, type LucideIcon } from "lucide-react";
import { INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import type { InspectionStatus } from "@/lib/schemas/common";
import { cn } from "@/lib/utils";

/** Each state's icon, also on the counts above the list (inspection-metrics.tsx). */
export const INSPECTION_STATUS_ICON: Readonly<Record<InspectionStatus, LucideIcon>> = {
  draft: PencilLineIcon,
  submitted: SendIcon,
  approved: LockIcon,
  reopened: RotateCcwIcon,
};

const LOOK: Readonly<Record<InspectionStatus, string>> = {
  // Unfinished: dashed, like every other "not done yet" in the app.
  draft: "border-dashed border-slate-400 bg-card text-slate-700",
  // Waiting for an admin to review: brand blue, filled.
  submitted: "border-brand-200 bg-brand-50 text-brand-700",
  // Final and read-only: quiet, since most rows end up here.
  approved: "border-slate-200 bg-slate-100 text-slate-700",
  // Sent back to the inspector to change: brand blue, outlined on white.
  reopened: "border-brand-300 bg-card text-brand-700",
};

export function InspectionStatusBadge({ status, className }: { status: InspectionStatus; className?: string }) {
  const Icon = INSPECTION_STATUS_ICON[status];
  const look = LOOK[status];
  return (
    <span
      data-slot="inspection-status"
      data-status={status}
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap",
        "touch:h-7 touch:gap-1.5 touch:px-2.5 touch:text-sm [&>svg]:size-3.5 touch:[&>svg]:size-4",
        look,
        className,
      )}
    >
      <Icon aria-hidden />
      <span>{INSPECTION_STATUS_LABEL[status]}</span>
    </span>
  );
}
