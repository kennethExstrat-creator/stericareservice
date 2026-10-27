import type { Metadata } from "next";
import { loadRoles } from "@/lib/admin/roles";
import { createClient } from "@/lib/supabase/server";
import { requireFullAdmin } from "./_lib/full-admin";
import { RolesAdmin } from "./_components/roles-admin";

/**
 * The title checks for the Admin role too: Next resolves metadata apart from
 * the page, so a static title would name this page on anyone else's 404. The
 * checks are cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireFullAdmin();
  return { title: "Roles & Permissions" };
}

/**
 * /admin/roles (migration 20261027150000; Kenneth, 27 October 2026: "build
 * permission and module on off for each role", with custom roles too): every
 * role, what its people see and which screens and actions it switches on.
 * Only people with the built-in Admin role open it; everyone else gets a 404
 * (requireFullAdmin). A layout is not a security boundary, so the page checks
 * for itself, and the database lets only the Admin role write roles.
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function RolesPage() {
  await requireFullAdmin();
  const supabase = await createClient();
  const roles = await loadRoles(supabase);

  return <RolesAdmin roles={roles} />;
}
