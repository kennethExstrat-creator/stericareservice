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

/**
 * `own`: the viewer is the inspection's inspector, so what the screen says
 * is about their own work ("An admin can send it back to you"); a lead
 * reading a team member's inspection is told whose it is instead.
 */
export type CaptureAccess =
  | { editable: true; readOnlyReason: null; canSwitchModules: boolean; own: boolean }
  | { editable: false; readOnlyReason: ReadOnlyReason; canSwitchModules: boolean; own: boolean };

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
  const own = input.userId === input.inspectorId;
  if (input.status === "approved") return { editable: false, readOnlyReason: "approved", canSwitchModules: canSwitch, own };
  if (!isEditableStatus(input.status)) {
    return { editable: false, readOnlyReason: "submitted", canSwitchModules: canSwitch, own };
  }
  if (input.role !== "admin" && !own) {
    return { editable: false, readOnlyReason: "not_yours", canSwitchModules: canSwitch, own };
  }
  return { editable: true, readOnlyReason: null, canSwitchModules: canSwitch, own };
}
