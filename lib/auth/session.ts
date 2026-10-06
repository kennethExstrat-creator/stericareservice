import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { LOGIN_PATH } from "./routes";

/**
 * Data Access Layer for the signed-in user (Next.js authentication guide,
 * "Creating a Data Access Layer"). Every protected page, Server Action and
 * Route Handler starts here; proxy.ts and layouts are not security boundaries.
 */

export type UserRole = Database["public"]["Enums"]["user_role"];

export type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
};

export type SessionState =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "deactivated"; userId: string }
  | { status: "active"; user: SessionUser };

/** Where a deactivated user is sent: a Route Handler that can clear the cookie. */
export const DEACTIVATED_PATH = "/auth/sign-out?reason=deactivated";

/**
 * Resolves the session once per request (React `cache`): the JWT is verified by
 * getClaims(), then my_profile_status() reports role and active flag. That
 * function is security definer, so it still answers for a deactivated user,
 * whose RLS-protected profile row is otherwise invisible. The name and email
 * come from that row, read in parallel; RLS only returns it to active users,
 * the only ones who need it.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth) return { status: "signed-out" };

  const userId = auth.claims.sub;
  const [statusResult, profileResult] = await Promise.all([
    supabase.rpc("my_profile_status"),
    supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
  ]);
  if (statusResult.error) {
    throw new Error(`Could not load the profile status for ${userId}: ${statusResult.error.message}`);
  }

  const status = statusResult.data?.[0];
  // No profile row means the account was never set up: block it like a deactivated one.
  if (!status || !status.active) return { status: "deactivated", userId };

  const profile = profileResult.data;
  return {
    status: "active",
    user: {
      id: userId,
      email: profile?.email ?? auth.claims.email ?? "",
      fullName: profile?.full_name ?? null,
      role: status.role,
    },
  };
});

/** For pages: the active user, or a redirect to sign in (or out, if deactivated). */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  switch (session.status) {
    case "active":
      return session.user;
    case "deactivated":
      redirect(DEACTIVATED_PATH);
    case "unconfigured":
    case "signed-out":
      redirect(LOGIN_PATH);
  }
}

/** For admin pages: non-admins get a 404, so /admin does not reveal itself (BUILD_SPEC 3). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}

export type ActionAuth =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

/**
 * For Server Actions, which are public HTTP endpoints: returns an error result
 * instead of redirecting, so the form can show it.
 */
export async function authorizeAction(role?: UserRole): Promise<ActionAuth> {
  const session = await getSession();
  if (session.status === "unconfigured") return { ok: false, error: "Supabase is not configured yet." };
  if (session.status === "signed-out") return { ok: false, error: "Your session has ended. Sign in again." };
  if (session.status === "deactivated") return { ok: false, error: "This account has been deactivated." };
  if (role && session.user.role !== role) return { ok: false, error: "You do not have permission to do that." };
  return { ok: true, user: session.user };
}
