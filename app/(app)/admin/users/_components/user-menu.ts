import { TEAM_MESSAGES, type RoleChoice } from "@/lib/auth/org";
import type { AccountStatus, LeadOption } from "@/lib/auth/users";

/** What a row's menu needs to know about a person. */
export type UserActionsTarget = {
  id: string;
  name: string;
  email: string;
  /** Inspector, lead inspector or admin. */
  role: RoleChoice;
  status: AccountStatus;
  /** Active, but Supabase Auth still bans them (see UserListItem). */
  signInBlocked: boolean;
  isSelf: boolean;
  /** The lead inspector who manages them, when they are in a team. */
  lead: { id: string; name: string } | null;
  /** For a lead inspector: the names of the people in their team. */
  team: string[];
};

export type MenuAction =
  | "change-role"
  | "change-lead"
  | "send-link"
  | "unblock"
  | "deactivate"
  | "reactivate"
  | "activate";

/**
 * What an admin can do to this person, in menu groups. Nobody can change
 * their own role or deactivate themselves (the actions refuse it too), and
 * password links only go to accounts that can sign in: a blocked sign-in is
 * lifted first. A pending account is activated first: any other change
 * would make it look like a deactivated one. With teams (migration
 * 20261007170000), inspectors who are not leads can be moved to another
 * lead inspector's team.
 */
export function menuGroups(user: UserActionsTarget, { teams = true }: { teams?: boolean } = {}): MenuAction[][] {
  const access: MenuAction = user.signInBlocked ? "unblock" : "send-link";
  if (user.isSelf) return user.status === "active" ? [[access]] : [];
  const team: MenuAction[] = teams && user.role === "inspector" ? ["change-lead"] : [];
  switch (user.status) {
    case "active":
      return [["change-role", ...team, access], ["deactivate"]];
    case "pending":
      return [["activate"]];
    case "deactivated":
      return [["reactivate", "change-role", ...team]];
  }
}

/**
 * The lead inspectors who may lead this person (nobody leads themselves),
 * and what the picker says when there is nobody: for the only active lead
 * inspector, that there is no other one rather than none at all.
 */
export function leadChoicesFor(
  userId: string,
  leads: readonly LeadOption[],
): { choices: LeadOption[]; emptyHint: string } {
  const choices = leads.filter((lead) => lead.id !== userId);
  const onlyThem = choices.length === 0 && leads.length > 0;
  return { choices, emptyHint: onlyThem ? TEAM_MESSAGES.noOtherLead : TEAM_MESSAGES.noLeads };
}

/**
 * Activating someone who would be an inspector in no team asks for their
 * role and lead first (an active inspector works in a lead's team).
 */
export function activationNeedsPlacement(user: UserActionsTarget, teams: boolean): boolean {
  return teams && user.role === "inspector" && user.lead === null;
}
