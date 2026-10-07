// What a row of the list offers (Kenneth, 7 October 2026: "build an action
// button at end of each row, to delete or to continue").
//
// The main action says what the viewer can do with the inspection:
// - Continue: a draft or reopened inspection the viewer may edit opens on
//   the capture screen (its inspector and admins edit there; the same rule
//   as the screen itself, lib/inspections/capture/access.ts).
// - Review: a submitted inspection, for an admin, opens on the review, where
//   admins approve or reopen it.
// - View: everything else opens on the review, read-only: a submitted one
//   for its inspector, an approved one, or one the viewer may not edit.
// Delete follows canDeleteInspection() (lib/inspections/delete.ts).
//
// The list only holds inspections the viewer may read (RLS), so these are
// the only cases. Server-side only: the delete rule lives with the deletion.
import { captureAccess, type UserRole } from "@/lib/inspections/capture/access";
import { canDeleteInspection } from "@/lib/inspections/delete";
import type { InspectionListRow } from "@/lib/inspections/query";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";

export type ListViewer = { id: string; role: UserRole };

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
  if (row.status === "submitted" && viewer.role === "admin") return { kind: "review", label: "Review", href: review };
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
