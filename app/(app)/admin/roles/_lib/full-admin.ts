import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ROLE_MESSAGES } from "@/lib/admin/roles";
import { authorizeAction, requireAdmin, type ActionAuth, type SessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Who may open Roles & Permissions: people with the built-in Admin role only
 * (migration 20261027150000, is_full_admin()), so nobody gives themselves
 * more than they have. requireAdmin() alone is not enough: a custom role that
 * sees every inspection has profiles.role 'admin' too. Asked on the signed-in
 * person's own client, once per request. Kept here, in one place, until the
 * session knows each person's role (lib/auth/session.ts).
 */

const isFullAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_full_admin");
  if (error) throw new Error(`Could not check for the Admin role: ${error.message}`);
  return data === true;
});

/** For the page: the admin, or a 404 for anyone else, as requireAdmin() gives non-admins (BUILD_SPEC 3). */
export async function requireFullAdmin(): Promise<SessionUser> {
  const user = await requireAdmin();
  if (!(await isFullAdmin())) notFound();
  return user;
}

/** For the Server Actions: an active person with the Admin role, or why not, for the form. */
export async function authorizeFullAdmin(): Promise<ActionAuth> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return auth;
  return (await isFullAdmin()) ? auth : { ok: false, error: ROLE_MESSAGES.notFullAdmin };
}
