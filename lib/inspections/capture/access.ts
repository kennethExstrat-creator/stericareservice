// Who may change what on the capture screen (BUILD_SPEC 3 and 5). The rule:
//
// - Draft and reopened inspections are edited here, by their inspector or an
//   admin. Row Level Security agrees: inspectors update their own only while
//   draft or reopened; admins update any inspection that is not approved.
// - Anyone else who can open it reads it: a lead inspector looking at their
//   team's inspection (role inspector, not the owner) gets "not_yours", and
//   the database refuses them every change too (migration 20261007170000:
//   leads only read their team's rows). Only the owner and admins edit.
// - Submitted inspections are read-only here. An admin who needs a change
//   reopens the inspection from the review screen, so what the reviewer sees
//   never moves underneath them.
// - Approved inspections are read-only everywhere.
// - Admins switch modules off and on for one inspection (BUILD_SPEC 4.4)
//   until it is approved; the database refuses that to anyone else.
import type { InspectionStatus } from "@/lib/schemas/common";
import type { Database } from "@/lib/supabase/database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];

/** Statuses whose data the capture screen edits (the autosave transport's rule too). */
export const EDITABLE_STATUSES: readonly InspectionStatus[] = ["draft", "reopened"];

export type ReadOnlyReason = "approved" | "submitted" | "not_yours";

export type CaptureAccess =
  | { editable: true; readOnlyReason: null; canSwitchModules: boolean }
  | { editable: false; readOnlyReason: ReadOnlyReason; canSwitchModules: boolean };

export type AccessInput = {
  status: InspectionStatus;
  role: UserRole;
  userId: string;
  inspectorId: string;
};

export function isEditableStatus(status: InspectionStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Whether `role` may switch a module off or on for an inspection in `status`. */
export function canSwitchModules({ status, role }: Pick<AccessInput, "status" | "role">): boolean {
  return role === "admin" && status !== "approved";
}

export function captureAccess(input: AccessInput): CaptureAccess {
  const canSwitch = canSwitchModules(input);
  if (input.status === "approved") return { editable: false, readOnlyReason: "approved", canSwitchModules: canSwitch };
  if (!isEditableStatus(input.status)) {
    return { editable: false, readOnlyReason: "submitted", canSwitchModules: canSwitch };
  }
  if (input.role !== "admin" && input.userId !== input.inspectorId) {
    return { editable: false, readOnlyReason: "not_yours", canSwitchModules: canSwitch };
  }
  return { editable: true, readOnlyReason: null, canSwitchModules: canSwitch };
}
