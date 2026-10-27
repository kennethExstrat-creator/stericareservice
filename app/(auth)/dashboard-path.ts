import "server-only";
import { ADMIN_PATH } from "@/components/shell/nav";
import { HOME_PATH } from "@/lib/auth/routes";
import type { UserRole } from "@/lib/auth/session";

/**
 * Where someone lands once their account is created (Kenneth, 27 October
 * 2026: "Once filled in, auto login to dashboard"): an admin on the Admin
 * Dashboard, everyone else on the inspections list, which is an inspector's
 * dashboard. Server only: components/shell/nav.ts is kept out of the browser.
 */
export function dashboardPathFor(role: UserRole): string {
  return role === "admin" ? ADMIN_PATH : HOME_PATH;
}
