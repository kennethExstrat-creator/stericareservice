import { TEAM_MESSAGES, type RoleChoice } from "@/lib/auth/org";
import type { AccountStatus, LeadOption } from "@/lib/auth/users";

/** What a row's menu needs to know about a person. */
export type UserActionsTarget = {
  id: string;
  /** How the app names them: their full name, else their email. */
  name: string;
  /** Their full name as saved, null when they have none: Change Name starts from it. */
  fullName: string | null;
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
  | "change-name"
  | "change-role"
  | "change-lead"
  | "send-link"
  | "unblock"
  | "deactivate"
  | "reactivate"
  | "activate";

/** Each item as the menu says it: labels, so in Title Case (Kenneth, 8 October 2026). Messages that name an item quote these. */
export const MENU_LABEL: Readonly<Record<MenuAction, string>> = {
  "change-name": "Change Name",
  "change-role": "Change Role",
  "change-lead": "Change Lead Inspector",
  "send-link": "Send Password Link",
  unblock: "Lift Sign-In Block",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
  activate: "Activate",
};

/**
 * The title of the dialog each item opens, naming the person: titles are
 * labels too, so in Title Case, a question keeping its question mark. "In"
 * keeps its capital in "Sign In", where it belongs to the verb. Deactivate on
 * someone who still leads a team opens "leads-team" instead, which says who
 * to move first.
 */
export const DIALOG_TITLE: Readonly<Record<MenuAction | "leads-team", (name: string) => string>> = {
  "change-name": (name) => `Change ${name}'s Name`,
  "change-role": (name) => `Change ${name}'s Role`,
  "change-lead": (name) => `Change ${name}'s Lead Inspector`,
  "send-link": (name) => `Send a Password Link to ${name}?`,
  unblock: (name) => `Let ${name} Sign In Again?`,
  deactivate: (name) => `Deactivate ${name}?`,
  "leads-team": (name) => `${name} Still Leads a Team`,
  reactivate: (name) => `Reactivate ${name}?`,
  activate: (name) => `Activate ${name}?`,
};

/**
 * What an admin can do to this person, in menu groups. Anyone's name can
 * change, the admin's own included, active or deactivated. Nobody can change
 * their own role or deactivate themselves (the actions refuse it too), and
 * password links only go to accounts that can sign in: a blocked sign-in is
 * lifted first. A pending account is activated first: any other change, a
 * new name included, would make it look like a deactivated one (it counts
 * as pending only while nothing has changed its profile, accountStatus() in
 * lib/auth/users.ts). With teams (migration 20261007170000), inspectors who
 * are not leads can be moved to another lead inspector's team.
 */
export function menuGroups(user: UserActionsTarget, { teams = true }: { teams?: boolean } = {}): MenuAction[][] {
  const access: MenuAction = user.signInBlocked ? "unblock" : "send-link";
  if (user.isSelf) return user.status === "active" ? [["change-name", access]] : [];
  const team: MenuAction[] = teams && user.role === "inspector" ? ["change-lead"] : [];
  switch (user.status) {
    case "active":
      return [["change-name", "change-role", ...team, access], ["deactivate"]];
    case "pending":
      return [["activate"]];
    case "deactivated":
      return [["reactivate", "change-name", "change-role", ...team]];
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
