// Small state badges for the defects tabs. Codes and templates are not
// results, so none of them borrows the pass and fail colours (docs/DESIGN.md):
// brand blue and slate, with an icon and words, never colour alone. Amber is
// kept for what waits for an admin, as the capture screen's unmapped chips.
import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FlagIcon,
  LockIcon,
  PencilLineIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { TEMPLATE_STATUS_LABEL, type TemplateStatus } from "@/lib/admin/defects";
import { cn } from "@/lib/utils";

const BADGE = cn(
  "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap",
  "touch:h-7 touch:gap-1.5 touch:px-2.5 touch:text-sm [&>svg]:size-3.5 touch:[&>svg]:size-4",
);

function Badge({ icon: Icon, label, className, slot }: { icon: LucideIcon; label: string; className: string; slot: string }) {
  return (
    <span data-slot={slot} className={cn(BADGE, className)}>
      <Icon aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/** Whether a code is offered when mapping labels. */
export function CodeStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge slot="code-status" icon={CircleCheckIcon} label="Active" className="border-brand-200 bg-brand-50 text-brand-700" />
  ) : (
    <Badge slot="code-status" icon={BanIcon} label="Inactive" className="border-slate-300 bg-slate-100 text-slate-700" />
  );
}

const TEMPLATE_LOOK: Readonly<Record<TemplateStatus, { icon: LucideIcon; className: string }>> = {
  // What inspectors start from: brand blue, filled.
  active: { icon: CircleCheckIcon, className: "border-brand-200 bg-brand-50 text-brand-700" },
  // Still being edited: dashed, like every other "not finished" in the app.
  draft: { icon: PencilLineIcon, className: "border-dashed border-slate-400 bg-card text-slate-700" },
  // Kept for the inspections that used it: quiet.
  retired: { icon: LockIcon, className: "border-slate-200 bg-slate-100 text-slate-700" },
};

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  const { icon, className } = TEMPLATE_LOOK[status];
  return <Badge slot="template-status" icon={icon} label={TEMPLATE_STATUS_LABEL[status]} className={className} />;
}

/** A template label whose code is not a defect code, or is inactive. */
export function CodeProblemBadge({ state }: { state: "unknown" | "inactive" }) {
  return state === "unknown" ? (
    <Badge
      slot="code-problem"
      icon={TriangleAlertIcon}
      label="Not a Defect Code"
      className="border-warn-border bg-warn-tint text-warn"
    />
  ) : (
    <Badge
      slot="code-problem"
      icon={CircleDashedIcon}
      label="Inactive Code"
      className="border-dashed border-warn-border bg-card text-warn"
    />
  );
}

/** A one-off label waiting for a code: the capture screen's dashed amber edge and flag. */
export function UnmappedBadge({ label = "Unmapped" }: { label?: string }) {
  return (
    <Badge
      slot="unmapped"
      icon={FlagIcon}
      label={label}
      className="border-dashed border-warn-border bg-warn-tint text-warn"
    />
  );
}
