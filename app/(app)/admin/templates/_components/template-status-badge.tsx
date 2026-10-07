// Where a template version is in its life: draft, active, retired. Workflow,
// not a result, so not a StatusPill: green, red and amber stay with results.
// Like the inspection workflow badge, states use brand blue and slate only,
// and differ in shape and icon as well as tone; every state is spelled out.
import { ArchiveIcon, BadgeCheckIcon, PencilLineIcon, type LucideIcon } from "lucide-react";
import { TEMPLATE_STATUS_LABEL, type TemplateStatus } from "@/lib/admin/templates";
import { cn } from "@/lib/utils";

const LOOK: Readonly<Record<TemplateStatus, { icon: LucideIcon; className: string }>> = {
  // Being edited, not offered to inspectors: dashed, like every unfinished thing in the app.
  draft: { icon: PencilLineIcon, className: "border-dashed border-slate-400 bg-card text-slate-700" },
  // What inspectors start from: brand blue, filled.
  active: { icon: BadgeCheckIcon, className: "border-brand-200 bg-brand-50 text-brand-700" },
  // Kept for the inspections that use it: quiet.
  retired: { icon: ArchiveIcon, className: "border-slate-200 bg-slate-100 text-slate-700" },
};

export function TemplateStatusBadge({ status, className }: { status: TemplateStatus; className?: string }) {
  const { icon: Icon, className: look } = LOOK[status];
  return (
    <span
      data-slot="template-status"
      data-status={status}
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap",
        "touch:h-7 touch:gap-1.5 touch:px-2.5 touch:text-sm [&>svg]:size-3.5 touch:[&>svg]:size-4",
        look,
        className,
      )}
    >
      <Icon aria-hidden />
      <span>{TEMPLATE_STATUS_LABEL[status]}</span>
    </span>
  );
}
