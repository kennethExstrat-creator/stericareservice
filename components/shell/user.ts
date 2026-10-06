/**
 * What the shell shows about the signed-in user: name, email and role, and
 * nothing else (no id, no tokens). Built on the server from the session and
 * passed to the user menu, a Client Component.
 */
import type { UserRole } from "./nav";

export type ShellUser = {
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  initials: string;
};

export const ROLE_LABEL: Readonly<Record<UserRole, string>> = {
  inspector: "Inspector",
  admin: "Admin",
};

/** Up to two letters for the avatar: "Test Admin" is TA, "kenneth@…" is K. */
export function initialsFor(name: string | null | undefined, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const letters = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
    return letters
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toLocaleUpperCase("en-GB");
  }
  const first = Array.from(email.trim())[0];
  return first ? first.toLocaleUpperCase("en-GB") : "?";
}

export function toShellUser(user: { email: string; fullName: string | null; role: UserRole }): ShellUser {
  const fullName = user.fullName?.trim() || null;
  return {
    // Accounts invited without a name still need something to show.
    name: fullName ?? user.email,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABEL[user.role],
    initials: initialsFor(fullName, user.email),
  };
}
