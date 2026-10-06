// The audit trail (BUILD_SPEC 5): who created the inspection and who changed
// its status when, oldest first, with the reason for each reopen.
import {
  ActivityIcon,
  ArrowRightLeftIcon,
  FilePlus2Icon,
  LockIcon,
  RotateCcwIcon,
  SendIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { actorText } from "@/lib/inspections/review/actor";
import type { AuditEntry, AuditEntryKind } from "@/lib/inspections/review/audit";
import { formatDateTime } from "@/lib/inspections/review/format";
import { cn } from "@/lib/utils";
import { Panel, ReviewSection } from "./review-section";

const ICON: Readonly<Record<AuditEntryKind, LucideIcon>> = {
  created: FilePlus2Icon,
  submitted: SendIcon,
  resubmitted: SendIcon,
  approved: LockIcon,
  reopened: RotateCcwIcon,
  status: ArrowRightLeftIcon,
  event: ActivityIcon,
};

export function History({ history }: { history: { entries: AuditEntry[]; failed: boolean } }) {
  return (
    <ReviewSection id="history" title="History" description="Who changed the inspection, and when. Times are Malaysia time.">
      <Panel>
        {history.failed ? (
          <p className="flex gap-2 px-5 py-4 text-base text-warn fine:text-sm">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            The history could not be loaded. Reload the page to try again.
          </p>
        ) : history.entries.length === 0 ? (
          <p className="px-5 py-4 text-base text-muted-foreground fine:text-sm">Nothing recorded yet.</p>
        ) : (
          <ol className="divide-y divide-border">
            {history.entries.map((entry) => {
              const Icon = ICON[entry.kind];
              return (
                <li key={entry.id} data-kind={entry.kind} className="flex gap-3 px-5 py-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                      entry.kind === "reopened" || entry.kind === "submitted" || entry.kind === "resubmitted"
                        ? "bg-brand-50 text-brand-700"
                        : "bg-slate-100 text-slate-700",
                    )}
                  >
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-base fine:text-sm">
                      <span className="font-semibold text-foreground">{entry.title}</span>
                      {/* A space for screen readers and copying; the gap spaces them on screen. */}{" "}
                      <span className="text-muted-foreground">
                        by {actorText(entry.actor)} · <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                      </span>
                    </p>
                    {(entry.reason ?? entry.detail) && (
                      <p className="mt-1 text-base whitespace-pre-line text-foreground [overflow-wrap:anywhere] fine:text-sm">
                        <span className="font-medium">{entry.reason ? "Reason:" : "Note:"}</span> {entry.reason ?? entry.detail}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </ReviewSection>
  );
}
