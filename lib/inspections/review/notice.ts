// What the review says about where an inspection is in its workflow (BUILD_SPEC
// 5): who has to do what next, and for a reopen, what to change. Words only;
// the page draws them.
import type { InspectionStatus } from "@/lib/schemas/common";
import { actorText, type Actor } from "./actor";
import { latestReopen, type AuditEntry } from "./audit";
import { formatDateTime } from "./format";

export type NoticeInspection = {
  status: InspectionStatus;
  inspector: { id: string; name: string };
  submittedAt: string | null;
  approvedAt: string | null;
  approver: Actor | null;
};

export type StatusNotice = {
  status: InspectionStatus;
  title: string;
  body: string;
  /** For a reopen: the admin's reason, under its label. */
  reason: { label: string; text: string } | null;
};

/** " on 6 Oct 2026, 14:05", or nothing when the time is unknown. */
function on(iso: string | null): string {
  return iso ? ` on ${formatDateTime(iso)}` : "";
}

/**
 * The inspector reads their own inspection as "you"; anyone else reads it as
 * the inspector's: an admin, or a lead inspector reading their team's
 * (read-only: only admins approve and reopen). A submitted one waits for an
 * admin, so admins read it as theirs to review, their own inspections
 * included.
 */
export function statusNotice(
  inspection: NoticeInspection,
  viewer: { id: string; role: "inspector" | "admin" },
  history: readonly AuditEntry[],
): StatusNotice {
  const own = viewer.id === inspection.inspector.id;
  const inspector = inspection.inspector.name;

  switch (inspection.status) {
    case "draft":
      return {
        status: "draft",
        title: "Not submitted yet",
        body: own
          ? "The results below show what you have saved so far. Submit it from the inspection once it is complete."
          : `${inspector} has not submitted it yet. The results below show what is saved so far.`,
        reason: null,
      };

    case "submitted":
      return viewer.role === "admin"
        ? {
            status: "submitted",
            title: "Waiting for your review",
            body: `${own ? "You" : inspector} submitted it${on(inspection.submittedAt)}. Check the results, then approve it or reopen it for changes.`,
            reason: null,
          }
        : {
            status: "submitted",
            title: "Waiting for review",
            body: own
              ? `You submitted it${on(inspection.submittedAt)}. An admin checks it next. If something must change, ask an admin to reopen it.`
              : `${inspector} submitted it${on(inspection.submittedAt)}. An admin checks it next, and only an admin can reopen it for changes.`,
            reason: null,
          };

    case "reopened": {
      const reopen = latestReopen(history);
      const who = reopen
        ? `${actorText(reopen.actor, { start: true })} reopened it${on(reopen.at)}.`
        : "It was reopened for changes.";
      return {
        status: "reopened",
        title: own ? "Reopened: changes needed" : "Reopened for changes",
        body: own ? `${who} Make the changes, then submit it again.` : `${who} ${inspector} can change it and submit it again.`,
        reason: reopen?.reason ? { label: own ? "What to change" : "Reason", text: reopen.reason } : null,
      };
    }

    case "approved": {
      const who = inspection.approver ? `${actorText(inspection.approver, { start: true })} approved it` : "It was approved";
      return {
        status: "approved",
        title: "Approved",
        body: `${who}${on(inspection.approvedAt)}. It is final and can no longer be changed.`,
        reason: null,
      };
    }
  }
}
