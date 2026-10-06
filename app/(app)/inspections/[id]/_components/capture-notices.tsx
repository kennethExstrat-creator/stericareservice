// Notices under the capture screen's header: why the inspection is
// read-only, and anything about saving that needs the inspector (the pill
// shows the state, this says what happened and what to do).
import type { ReactNode } from "react";
import { CircleAlertIcon, InfoIcon, LockIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warn" | "error" | "lock";

export type CaptureNotice = {
  key: string;
  tone: NoticeTone;
  message: ReactNode;
  action?: ReactNode;
};

const LOOK: Readonly<Record<NoticeTone, { icon: LucideIcon; className: string; role: "status" | "alert" }>> = {
  info: { icon: InfoIcon, className: "border-info-border bg-info-tint text-info", role: "status" },
  lock: { icon: LockIcon, className: "border-border bg-card text-foreground", role: "status" },
  warn: { icon: TriangleAlertIcon, className: "border-warn-border bg-warn-tint text-warn", role: "status" },
  error: { icon: CircleAlertIcon, className: "border-fail-border bg-fail-tint text-fail", role: "alert" },
};

export function CaptureNotices({ notices, className }: { notices: readonly CaptureNotice[]; className?: string }) {
  if (notices.length === 0) return null;
  return (
    <div data-slot="capture-notices" className={cn("space-y-2", className)}>
      {notices.map((notice) => {
        const { icon: Icon, className: look, role } = LOOK[notice.tone];
        return (
          <div
            key={notice.key}
            role={role}
            data-notice={notice.key}
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm font-medium touch:text-base",
              look,
            )}
          >
            <p className="flex min-w-0 flex-1 basis-80 items-start gap-2.5">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
              <span className="min-w-0">{notice.message}</span>
            </p>
            {notice.action && <div className="flex shrink-0 flex-wrap items-center gap-2">{notice.action}</div>}
          </div>
        );
      })}
    </div>
  );
}
