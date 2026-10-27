import "server-only";
import { ADMIN_PATH } from "@/components/shell/nav";
import { HOME_PATH } from "@/lib/auth/routes";
import { userCan, type SessionUser } from "@/lib/auth/session";

/**
 * Where someone lands once their account is created (Kenneth, 27 October
 * 2026: "Once filled in, auto login to dashboard"): the Admin Dashboard when
 * their role opens it, else the inspections list, which is an inspector's
 * dashboard. Server only: components/shell/nav.ts is kept out of the browser.
 */
export function dashboardPathFor(user: Pick<SessionUser, "role" | "isLead" | "grant">): string {
  return userCan(user, "dashboard") ? ADMIN_PATH : HOME_PATH;
}
