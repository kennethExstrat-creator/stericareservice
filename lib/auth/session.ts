import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  BUILT_IN_ROLE_NAME,
  builtInGrant,
  can,
  isBuiltInRole,
  isPermission,
  isRoleAccess,
  type AdminOnly,
  type Permission,
  type RoleGrant,
} from "./permissions";
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
  /**
   * Their role (public.roles, migration 20261027150000): its name, what it
   * sees and what it allows. getSession() sets it whenever the role can be
   * read; absent (test doubles, a project without the migration) means the
   * built-in role for `role` and `isLead` as it was made (grantOf).
   */
  grant?: SessionRole;
};

/** Someone's role as the session reads it: its id (null for a stand-in) and name too. */
export type SessionRole = RoleGrant & { id: string | null; name: string };

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
  const [statusResult, profile, grant] = await Promise.all([
    supabase.rpc("my_profile_status"),
    readOwnProfile(supabase, userId),
    readOwnRole(supabase),
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
      ...(grant ? { grant } : {}),
    },
  };
});

/**
 * The signed-in user's own role (my_role(), security definer), or null when it
 * cannot be read: a project without migration 20261027150000, or a passing
 * fault. The session then stands in the built-in role (grantOf), which never
 * gives more than someone had before roles; the database checks every write
 * against the real role anyway.
 */
async function readOwnRole(supabase: Awaited<ReturnType<typeof createClient>>): Promise<SessionRole | null> {
  const { data, error } = await supabase.rpc("my_role");
  const row = data?.[0];
  if (error || !row || !isRoleAccess(row.access)) {
    if (error) console.error("[session] reading the role failed", { code: error.code, message: error.message });
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    builtIn: isBuiltInRole(row.built_in) ? row.built_in : null,
    access: row.access,
    permissions: (row.permissions ?? []).filter(isPermission),
  };
}

/** Someone's role: the one the session read, else the built-in role for what they are. */
export function grantOf(user: Pick<SessionUser, "role" | "isLead" | "grant">): SessionRole {
  if (user.grant) return user.grant;
  const kind = user.role === "admin" ? "admin" : user.isLead ? "lead" : "inspector";
  return { ...builtInGrant(kind), id: null, name: BUILT_IN_ROLE_NAME[kind] };
}

/**
 * Whether someone's role allows a permission or opens an admin-only screen
 * (lib/auth/permissions.ts can()): the check every page, Server Action and
 * Route Handler makes before what the role switches.
 */
export function userCan(user: Pick<SessionUser, "role" | "isLead" | "grant">, permission: Permission | AdminOnly): boolean {
  return can(grantOf(user), permission);
}

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

/**
 * For a page behind a role's switch: someone whose role does not allow it gets
 * a 404, as a non-admin does on /admin, so the page does not reveal itself.
 */
export async function requirePermission(permission: Permission | AdminOnly): Promise<SessionUser> {
  const user = await requireUser();
  if (!userCan(user, permission)) notFound();
  return user;
}

export type ActionAuth =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

/** What an action answers someone invited who has not created their account yet. */
export const CREATE_ACCOUNT_FIRST = "Create your account first: finish the Account Creation page.";

/**
 * For Server Actions, which are public HTTP endpoints: returns an error result
 * instead of redirecting, so the form can show it. `need` is a role level
 * ("admin": every inspection in sight) or a permission of the caller's role.
 * Someone invited who has not created their account yet may call no action
 * but Create Account itself (`allowUnjoined`), as requireUser() lets them open
 * no page but /create-account.
 */
export async function authorizeAction(
  need?: UserRole | { permission: Permission | AdminOnly },
  { allowUnjoined = false }: { allowUnjoined?: boolean } = {},
): Promise<ActionAuth> {
  const session = await getSession();
  if (session.status === "unconfigured") return { ok: false, error: "Supabase is not configured yet." };
  if (session.status === "signed-out") return { ok: false, error: "Your session has ended. Sign in again." };
  if (session.status === "deactivated") return { ok: false, error: "This account has been deactivated." };
  if (!allowUnjoined && !hasJoined(session.user)) return { ok: false, error: CREATE_ACCOUNT_FIRST };
  const allowed =
    need === undefined ||
    (typeof need === "string" ? session.user.role === need : userCan(session.user, need.permission));
  if (!allowed) return { ok: false, error: "You do not have permission to do that." };
  return { ok: true, user: session.user };
}
