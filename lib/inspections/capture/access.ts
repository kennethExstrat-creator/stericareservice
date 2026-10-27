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
// - Modules are switched off and on for one inspection (BUILD_SPEC 4.4)
//   until it is approved, by someone who sees every inspection and whose
//   role allows Switch Inspection Steps On or Off; the database refuses that
//   to anyone else (migration 20261027150000).
// - The role's other switches the screen follows (lib/auth/permissions.ts):
//   Steri-AI reads Source Documents and sorts media only for a role with
//   Steri-AI Reading, and only a role that approves and reopens is told to
//   reopen a submitted inspection from the review.
import { builtInGrant, can, type RoleGrant } from "@/lib/auth/permissions";
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
 * `aiReading`: the role allows Steri-AI Reading; the screen reads and sorts
 * only while it can change the inspection as well.
 * `canReopen`: the role approves and reopens, so a submitted inspection is
 * changed by reopening it from the review.
 */
type AccessFlags = { canSwitchModules: boolean; own: boolean; aiReading: boolean; canReopen: boolean };

export type CaptureAccess =
  | ({ editable: true; readOnlyReason: null } & AccessFlags)
  | ({ editable: false; readOnlyReason: ReadOnlyReason } & AccessFlags);

export type AccessInput = {
  status: InspectionStatus;
  role: UserRole;
  userId: string;
  inspectorId: string;
  /**
   * The viewer's role and its switches (the session's grantOf). Absent (the
   * Server Actions that only ask what is editable, test doubles): the
   * built-in Admin or Inspector role as it was made, which allows what
   * everyone could do before roles.
   */
  grant?: RoleGrant;
};

export function isEditableStatus(status: InspectionStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** The viewer's role; the Lead Inspector's switches start as the Inspector's. */
function roleOf(input: Pick<AccessInput, "role" | "grant">): RoleGrant {
  return input.grant ?? builtInGrant(input.role === "admin" ? "admin" : "inspector");
}

/**
 * Whether the viewer may switch a module off or on for an inspection in
 * `status`: they see every inspection (only then does the database let them
 * write another inspector's) and their role allows it.
 */
export function canSwitchModules(input: Pick<AccessInput, "status" | "role" | "grant">): boolean {
  return input.role === "admin" && input.status !== "approved" && can(roleOf(input), "switch_steps");
}

export function captureAccess(input: AccessInput): CaptureAccess {
  const role = roleOf(input);
  const flags: AccessFlags = {
    canSwitchModules: canSwitchModules(input),
    own: input.userId === input.inspectorId,
    aiReading: can(role, "ai_reading"),
    canReopen: can(role, "approve_inspections"),
  };
  if (input.status === "approved") return { editable: false, readOnlyReason: "approved", ...flags };
  if (!isEditableStatus(input.status)) return { editable: false, readOnlyReason: "submitted", ...flags };
  if (input.role !== "admin" && !flags.own) return { editable: false, readOnlyReason: "not_yours", ...flags };
  return { editable: true, readOnlyReason: null, ...flags };
}
