// Where the inspection is in its workflow, and who acts next. Workflow states
// keep the list's look (inspection-status-badge.tsx): brand blue and slate,
// never the result colours, so an approved fail never shows green.
import { LockIcon, PencilLineIcon, RotateCcwIcon, SendIcon, type LucideIcon } from "lucide-react";
import type { StatusNotice as Notice } from "@/lib/inspections/review/notice";
import type { InspectionStatus } from "@/lib/schemas/common";
import { cn } from "@/lib/utils";

export const STATUS_HEADING_ID = "review-status";

const LOOK: Readonly<Record<InspectionStatus, { icon: LucideIcon; frame: string; badge: string }>> = {
  draft: { icon: PencilLineIcon, frame: "border-dashed border-slate-400 bg-card", badge: "bg-slate-100 text-slate-700" },
  submitted: { icon: SendIcon, frame: "border-brand-200 bg-brand-50", badge: "bg-card text-brand-700" },
  approved: { icon: LockIcon, frame: "border-slate-200 bg-slate-100", badge: "bg-card text-slate-700" },
  reopened: { icon: RotateCcwIcon, frame: "border-brand-300 bg-card", badge: "bg-brand-50 text-brand-700" },
};

export function StatusNotice({ notice }: { notice: Notice }) {
  const { icon: Icon, frame, badge } = LOOK[notice.status];
  return (
    <div data-slot="review-status" data-status={notice.status} className={cn("flex gap-4 rounded-xl border p-4 sm:px-5", frame)}>
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", badge)}>
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <h2 id={STATUS_HEADING_ID} className="text-lg leading-snug font-bold text-foreground">
          {notice.title}
        </h2>
        <p className="text-base text-foreground fine:text-sm">{notice.body}</p>
        {notice.reason && (
          <div className="mt-3 rounded-lg bg-card px-4 py-3 ring-1 ring-brand-200">
            <p className="text-xs font-bold tracking-[0.12em] text-brand-700 uppercase">{notice.reason.label}</p>
            <p className="mt-1 text-base whitespace-pre-line text-foreground [overflow-wrap:anywhere] fine:text-sm">
              {notice.reason.text}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
