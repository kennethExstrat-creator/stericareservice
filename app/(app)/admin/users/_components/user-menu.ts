import type { AccountStatus, UserRole } from "@/lib/auth/users";

/** What a row's menu needs to know about a person. */
export type UserActionsTarget = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  isSelf: boolean;
};

export type MenuAction = "make-admin" | "make-inspector" | "send-link" | "deactivate" | "reactivate" | "activate";

/**
 * What an admin can do to this person, in menu groups. Nobody can demote or
 * deactivate themselves (the actions refuse it too), and password links only
 * go to accounts that can sign in.
 */
export function menuGroups(user: UserActionsTarget): MenuAction[][] {
  if (user.isSelf) return user.status === "active" ? [["send-link"]] : [];
  const roleChange: MenuAction = user.role === "admin" ? "make-inspector" : "make-admin";
  switch (user.status) {
    case "active":
      return [[roleChange, "send-link"], ["deactivate"]];
    case "pending":
      return [["activate", roleChange]];
    case "deactivated":
      return [["reactivate", roleChange]];
  }
}
