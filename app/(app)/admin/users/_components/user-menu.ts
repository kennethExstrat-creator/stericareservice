import { TEAM_MESSAGES, type RoleChoice } from "@/lib/auth/org";
import type { AccountStatus, LeadOption } from "@/lib/auth/users";

/** What a row's menu needs to know about a person. */
export type UserActionsTarget = {
  id: string;
  /** Their UID (SC-0042), shown beside their name in every dialog; null before migration 20261008140000. */
  uid: string | null;
  /** How the app names them: their full name, else their email. */
  name: string;
  /** Their full name as saved, null when they have none: Edit Details starts from it. */
  fullName: string | null;
  /** Their phone number as saved, null when they have none: Edit Details starts from it too. */
  phone: string | null;
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
  | "edit-details"
  | "change-role"
  | "change-lead"
  | "send-link"
  | "unblock"
  | "resend-invite"
  | "copy-invite-link"
  | "cancel-invite"
  | "deactivate"
  | "reactivate"
  | "activate";

/** Each item as the menu says it: labels, so in Title Case (Kenneth, 8 October 2026). Messages that name an item quote these. */
export const MENU_LABEL: Readonly<Record<MenuAction, string>> = {
  "edit-details": "Edit Details",
  "change-role": "Change Role",
  "change-lead": "Change Lead Inspector",
  "send-link": "Send Password Link",
  unblock: "Lift Sign-In Block",
  "resend-invite": "Resend Invite",
  "copy-invite-link": "Copy Invite Link",
  "cancel-invite": "Cancel Invite",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
  activate: "Activate",
};

/** The items that take something away, in the menu's destructive red. */
export const DESTRUCTIVE: ReadonlySet<MenuAction> = new Set(["cancel-invite", "deactivate"]);

/**
 * The title of the dialog each item opens, naming the person: titles are
 * labels too, so in Title Case, a question keeping its question mark. "In"
 * keeps its capital in "Sign In", where it belongs to the verb. Deactivate or
 * Cancel Invite on someone who still leads a team opens "leads-team" instead,
 * which says who to move first. Copy Invite Link asks first, then shows the
 * link under "invite-link".
 */
export const DIALOG_TITLE: Readonly<Record<MenuAction | "leads-team" | "invite-link", (name: string) => string>> = {
  "edit-details": (name) => `Edit ${name}'s Details`,
  "change-role": (name) => `Change ${name}'s Role`,
  "change-lead": (name) => `Change ${name}'s Lead Inspector`,
  "send-link": (name) => `Send a Password Link to ${name}?`,
  unblock: (name) => `Let ${name} Sign In Again?`,
  "resend-invite": (name) => `Resend the Invite to ${name}?`,
  "copy-invite-link": (name) => `Create an Invite Link for ${name}?`,
  "invite-link": (name) => `Invite Link for ${name}`,
  "cancel-invite": (name) => `Cancel the Invite to ${name}?`,
  deactivate: (name) => `Deactivate ${name}?`,
  "leads-team": (name) => `${name} Still Leads a Team`,
  reactivate: (name) => `Reactivate ${name}?`,
  activate: (name) => `Activate ${name}?`,
};

/**
 * What an admin can do to this person, in menu groups. Anyone's details can
 * change, the admin's own included, active, invited or deactivated. Nobody
 * can change their own role or deactivate themselves (the actions refuse it
 * too), and password links only go to accounts that can sign in: a blocked
 * sign-in is lifted first. A pending account is activated first: any other
 * change, new details included, would make it look like a deactivated one
 * (it counts as pending only while nothing has changed its profile,
 * accountStatus() in lib/auth/users.ts). With teams (migration
 * 20261007170000), inspectors who are not leads can be moved to another lead
 * inspector's team.
 *
 * Someone invited has no password to reset yet: their invite is resent, a
 * link copied to send by hand, or the invite cancelled, which removes the
 * account. Those three need the secret key (`invites`); while a ban blocks
 * the account the links would not let them in, so it is lifted first.
 */
export function menuGroups(
  user: UserActionsTarget,
  { teams = true, invites = true }: { teams?: boolean; invites?: boolean } = {},
): MenuAction[][] {
  const access: MenuAction = user.signInBlocked ? "unblock" : "send-link";
  if (user.isSelf) return user.status === "active" ? [["edit-details", access]] : [];
  const team: MenuAction[] = teams && user.role === "inspector" ? ["change-lead"] : [];
  switch (user.status) {
    case "active":
      return [["edit-details", "change-role", ...team, access], ["deactivate"]];
    case "invited": {
      const links: MenuAction[] = invites && !user.signInBlocked ? ["resend-invite", "copy-invite-link"] : [];
      const unblock: MenuAction[] = user.signInBlocked ? ["unblock"] : [];
      const leave: MenuAction[] = invites ? ["cancel-invite", "deactivate"] : ["deactivate"];
      const groups: MenuAction[][] = [links, ["edit-details", "change-role", ...team, ...unblock], leave];
      return groups.filter((group) => group.length > 0);
    }
    case "pending":
      return [["activate"]];
    case "deactivated":
      return [["reactivate", "edit-details", "change-role", ...team]];
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
