import type { AccountStatus, UserRole } from "@/lib/auth/users";

/** What a row's menu needs to know about a person. */
export type UserActionsTarget = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  /** Active, but Supabase Auth still bans them (see UserListItem). */
  signInBlocked: boolean;
  isSelf: boolean;
};

export type MenuAction =
  | "make-admin"
  | "make-inspector"
  | "send-link"
  | "unblock"
  | "deactivate"
  | "reactivate"
  | "activate";

/**
 * What an admin can do to this person, in menu groups. Nobody can demote or
 * deactivate themselves (the actions refuse it too), and password links only
 * go to accounts that can sign in: a blocked sign-in is lifted first. A
 * pending account is activated first: any other change would make it look
 * like a deactivated one.
 */
export function menuGroups(user: UserActionsTarget): MenuAction[][] {
  const access: MenuAction = user.signInBlocked ? "unblock" : "send-link";
  if (user.isSelf) return user.status === "active" ? [[access]] : [];
  const roleChange: MenuAction = user.role === "admin" ? "make-inspector" : "make-admin";
  switch (user.status) {
    case "active":
      return [[roleChange, access], ["deactivate"]];
    case "pending":
      return [["activate"]];
    case "deactivated":
      return [["reactivate", roleChange]];
  }
}
