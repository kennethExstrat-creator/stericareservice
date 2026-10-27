import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { CREATE_ACCOUNT_PATH, LOGIN_PATH } from "./routes";

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
  /**
   * A lead inspector (role inspector, lib/auth/org.ts): also reads every
   * inspection of their team. getSession() always sets it; absent (test
   * doubles, code written before teams) means not a lead.
   */
  isLead?: boolean;
  /** The lead inspector who manages them; null for admins, lead inspectors and inspectors in no team yet. */
  leadId?: string | null;
  /**
   * False for an invitation not yet answered (profiles.joined_at is null):
   * requireUser() sends them to /create-account to finish their account
   * first. getSession() always sets it; absent (test doubles) means joined.
   */
  joined?: boolean;
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
 * getClaims(), then my_profile_status() reports role, active flag, lead
 * inspector flag and lead. That function is security definer, so it still
 * answers for a deactivated user, whose RLS-protected profile row is otherwise
 * invisible. The name, email and joined_at come from that row, read in
 * parallel; RLS only returns it to active users, the only ones who need it. On
 * a project without migration 20261007170000 the function has no lead columns:
 * nobody is a lead.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth) return { status: "signed-out" };

  const userId = auth.claims.sub;
  const [statusResult, profile] = await Promise.all([
    supabase.rpc("my_profile_status"),
    readOwnProfile(supabase, userId),
  ]);
  if (statusResult.error) {
    throw new Error(`Could not load the profile status for ${userId}: ${statusResult.error.message}`);
  }

  const status = statusResult.data?.[0];
  // No profile row means the account was never set up: block it like a deactivated one.
  if (!status || !status.active) return { status: "deactivated", userId };

  return {
    status: "active",
    user: {
      id: userId,
      email: profile?.email ?? auth.claims.email ?? "",
      fullName: profile?.full_name ?? null,
      role: status.role,
      isLead: status.role === "inspector" && status.is_lead === true,
      leadId: status.role === "inspector" ? (status.lead_id ?? null) : null,
      // Only null is an invitation not yet answered. A row that cannot be read
      // counts as joined: joining only decides where people are sent, it guards
      // nothing, and must never lock anyone out of the app.
      joined: profile?.joined_at !== null,
    },
  };
});

type OwnProfile = { full_name: string | null; email: string | null; joined_at?: string | null };

/**
 * The signed-in user's own profile row, or null when it cannot be read. A
 * project without migration 20261027140000 answers 42703 for joined_at
 * ("column profiles.joined_at does not exist"): the row is read again without
 * it, and everyone has joined, as before.
 */
async function readOwnProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<OwnProfile | null> {
  const own = await supabase.from("profiles").select("full_name, email, joined_at").eq("id", userId).maybeSingle();
  if (!own.error) return own.data;
  if (own.error.code !== "42703" || !own.error.message.includes("joined_at")) return null;
  const legacy = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return legacy.data;
}

/** False only for an invitation not yet answered; see SessionUser.joined. */
export function hasJoined(user: Pick<SessionUser, "joined">): boolean {
  return user.joined !== false;
}

/**
 * For pages: the active user, or a redirect to sign in (or out, if
 * deactivated). Someone invited who has not created their account yet goes to
 * /create-account first, wherever their link or bookmark pointed; that page
 * reads getSession() instead, so it never sends them round in a loop.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  switch (session.status) {
    case "active":
      if (!hasJoined(session.user)) redirect(CREATE_ACCOUNT_PATH);
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
