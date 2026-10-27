// What a row of the list offers (Kenneth, 7 October 2026: "build an action
// button at end of each row, to delete or to continue").
//
// The main action says what the viewer can do with the inspection:
// - Continue: a draft or reopened inspection the viewer may edit opens on
//   the capture screen (its inspector and admins edit there; the same rule
//   as the screen itself, lib/inspections/capture/access.ts).
// - Review: a submitted inspection, for someone whose role approves and
//   reopens (Approve and Reopen), opens on the review, where they do.
// - View: everything else opens on the review, read-only: a submitted one
//   for its inspector, an approved one, or one the viewer may not edit (a
//   lead inspector's team member's, in any status).
// Delete follows canDeleteInspection() (lib/inspections/delete.ts).
//
// The list only holds inspections the viewer may read (RLS), so these are
// the only cases. Server-side only: the delete rule lives with the deletion.
import { userCan, type SessionUser } from "@/lib/auth/session";
import { captureAccess } from "@/lib/inspections/capture/access";
import { canDeleteInspection } from "@/lib/inspections/delete";
import type { InspectionListRow } from "@/lib/inspections/query";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";

/**
 * The session's user. `isLead`: a lead inspector, who also sees their team's
 * inspections (read-only, so only View); `grant`: their role's switches.
 */
export type ListViewer = Pick<SessionUser, "id" | "role" | "isLead" | "grant">;

export type PrimaryRowAction = {
  kind: "continue" | "review" | "view";
  label: "Continue" | "Review" | "View";
  href: string;
};

type ActionRow = Pick<InspectionListRow, "id" | "refNo" | "status" | "inspectorId">;

export function primaryRowAction(row: Omit<ActionRow, "refNo">, viewer: ListViewer): PrimaryRowAction {
  const capture = `${INSPECTIONS_PATH}/${row.id}`;
  const review = `${capture}/review`;
  const { editable } = captureAccess({
    status: row.status,
    role: viewer.role,
    userId: viewer.id,
    inspectorId: row.inspectorId,
  });
  if (editable) return { kind: "continue", label: "Continue", href: capture };
  if (row.status === "submitted" && userCan(viewer, "approve_inspections")) {
    return { kind: "review", label: "Review", href: review };
  }
  return { kind: "view", label: "View", href: review };
}

export type RowActions = {
  primary: PrimaryRowAction & {
    /** "Continue INS-2026-0001": the words on the button first, then the ref, for screen readers. */
    name: string;
  };
  /** "Delete INS-2026-0001", or null where deleting is not allowed. */
  deleteName: string | null;
};

export function rowActions(row: ActionRow, viewer: ListViewer): RowActions {
  const primary = primaryRowAction(row, viewer);
  return {
    primary: { ...primary, name: `${primary.label} ${row.refNo}` },
    deleteName: canDeleteInspection(row, viewer) ? `Delete ${row.refNo}` : null,
  };
}
