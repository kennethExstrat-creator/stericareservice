import "server-only";
import { z } from "zod";
import { getSiteUrl } from "@/lib/env";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * User management for /admin/users (BUILD_SPEC 3 and 10): input schemas, the
 * user directory an admin sees, and plain-words versions of the errors
 * Supabase Auth and the database return. Server only: the directory reads
 * sign-in details with the secret key.
 */

export type UserRole = Database["public"]["Enums"]["user_role"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

export const USER_ROLES = ["inspector", "admin"] as const satisfies readonly UserRole[];

export const RoleSchema = z.enum(USER_ROLES, { error: "Choose Inspector or Admin." });

/** A user id sent back by the page. The action re-reads everything else. */
export const UserIdSchema = z.uuid({ error: "That user could not be found. Reload the page and try again." });

export const InviteUserSchema = z.object({
  email: z
    .string({ error: "Enter their email address." })
    .trim()
    .toLowerCase()
    .min(1, "Enter their email address.")
    .max(254, "That email address is too long.")
    .pipe(z.email({ error: "Enter a valid email address, like name@example.com." })),
  fullName: z
    .string({ error: "Enter their full name." })
    .trim()
    .min(1, "Enter their full name.")
    .max(120, "Keep the name under 120 characters."),
  role: RoleSchema,
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;
export type InviteField = keyof InviteUserInput;

export const ChangeRoleSchema = z.object({ userId: UserIdSchema, role: RoleSchema });
export const UserTargetSchema = z.object({ userId: UserIdSchema });

/** Reads a form's fields by name; missing fields arrive as null and fail validation. */
export function formFields<K extends string>(formData: FormData, keys: readonly K[]): Record<K, FormDataEntryValue | null> {
  return Object.fromEntries(keys.map((key) => [key, formData.get(key)])) as Record<K, FormDataEntryValue | null>;
}

/** The first message for each field, for aria-describedby error text. */
export function firstFieldErrors<T>(error: z.ZodError<T>): Partial<Record<keyof T & string, string>> {
  const fieldErrors = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const result: Partial<Record<string, string>> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages?.[0]) result[field] = messages[0];
  }
  return result as Partial<Record<keyof T & string, string>>;
}

/** The first message of a failed parse, for actions without visible fields. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Something in the request was not valid. Reload the page and try again.";
}

/* ------------------------------------------------------------------ *
 * Auth settings
 * ------------------------------------------------------------------ */

/** Deactivation bans the auth user for 100 years, so refresh tokens stop working. */
export const BAN_DURATION = "876000h";
export const UNBAN = "none";

/** Where invite and password links land (app/auth/confirm/route.ts). */
export function authConfirmUrl(): string {
  return `${getSiteUrl()}/auth/confirm`;
}

/* ------------------------------------------------------------------ *
 * Account status
 * ------------------------------------------------------------------ */

/**
 * - `active`: may sign in and read data.
 * - `pending`: never active yet. New auth accounts start inactive (a safety net
 *   in case public sign-up is switched on), so an account that has never
 *   signed in and was never banned is waiting for an admin, not blocked by one.
 * - `deactivated`: blocked by an admin.
 */
export type AccountStatus = "active" | "pending" | "deactivated";

/** Sign-in details from Supabase Auth; only the secret key can read them. */
export type SignInDetails = {
  lastSignInAt: string | null;
  bannedUntil: string | null;
};

export function accountStatus(active: boolean, signIn: SignInDetails | null | undefined, now: number = Date.now()): AccountStatus {
  if (active) return "active";
  // Without Auth details there is no telling a new account from a blocked one.
  if (!signIn) return "deactivated";
  const banned = signIn.bannedUntil !== null && Date.parse(signIn.bannedUntil) > now;
  return !signIn.lastSignInAt && !banned ? "pending" : "deactivated";
}

/* ------------------------------------------------------------------ *
 * The directory
 * ------------------------------------------------------------------ */

/** What the page shows for one person. Only display fields: this reaches the browser. */
export type UserListItem = {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  /** Null when they never signed in, or when sign-in details are unavailable. */
  lastSignInAt: string | null;
  isSelf: boolean;
};

/**
 * - `ok`: sign-in details loaded with the secret key.
 * - `missing-key`: SUPABASE_SECRET_KEY is not set; invites and bans are off.
 * - `failed`: the key is set but Supabase Auth did not answer.
 */
export type AdminApiState = "ok" | "missing-key" | "failed";

export type UserDirectory = { users: UserListItem[]; adminApi: AdminApiState };

/** How a person is named in the list, dialogs and messages. */
export function displayName(fullName: string | null | undefined, email: string | null | undefined): string {
  return fullName?.trim() || email?.trim() || "This user";
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/**
 * Everyone with a profile, read through the signed-in admin's own client (RLS
 * lets admins read every profile), merged with sign-in details from Supabase
 * Auth when the secret key is set. Call it only after requireAdmin().
 */
export async function getUserDirectory(viewerId: string): Promise<UserDirectory> {
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, created_at");
  if (error) throw new Error(`Could not load the user list: ${error.message}`);

  let adminApi: AdminApiState = "missing-key";
  let signIns: Map<string, SignInDetails> | null = null;
  if (isAdminClientConfigured()) {
    try {
      signIns = await loadSignInDetails();
      adminApi = "ok";
    } catch (cause) {
      console.error("Could not read sign-in details from Supabase Auth", cause);
      adminApi = "failed";
    }
  }

  const now = Date.now();
  const users = (profiles ?? []).map((profile): UserListItem => {
    // Someone missing from the Auth listing is unknown, never assumed new.
    const signIn = signIns?.get(profile.id) ?? null;
    return {
      id: profile.id,
      email: profile.email ?? "",
      fullName: profile.full_name,
      role: profile.role,
      status: accountStatus(profile.active, signIn, now),
      createdAt: profile.created_at,
      lastSignInAt: signIn?.lastSignInAt ?? null,
      isSelf: profile.id === viewerId,
    };
  });
  users.sort(
    (a, b) =>
      byName.compare(displayName(a.fullName, a.email), displayName(b.fullName, b.email)) ||
      byName.compare(a.email, b.email),
  );
  return { users, adminApi };
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

async function loadSignInDetails(): Promise<Map<string, SignInDetails>> {
  const admin = createAdminClient();
  const details = new Map<string, SignInDetails>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    for (const user of data.users) {
      details.set(user.id, {
        lastSignInAt: user.last_sign_in_at ?? null,
        bannedUntil: user.banned_until ?? null,
      });
    }
    // Follow Auth's own paging; a full page means there may be more.
    if (!data.nextPage && data.users.length < PAGE_SIZE) break;
  }
  return details;
}

/** The profile with this email, if any (case-insensitive: `_` is escaped so it is not a wildcard). */
export async function findProfileByEmail(
  supabase: ServerClient,
  email: string,
): Promise<Pick<Profile, "id" | "active"> | null> {
  const pattern = email.replace(/[\\%_]/g, (match) => `\\${match}`);
  const { data, error } = await supabase.from("profiles").select("id, active").ilike("email", pattern).limit(1);
  if (error) throw new Error(`Could not check for an existing account: ${error.message}`);
  return data?.[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * Errors in plain words
 * ------------------------------------------------------------------ */

const SMTP_HELP = "set up custom SMTP in Supabase (README, Supabase setup step 4)";

export const MESSAGES = {
  missingSecretKey:
    "Invites are switched off: the server needs SUPABASE_SECRET_KEY. Add it to the environment (.env.local, or the Vercel project settings) and restart the app.",
  userNotFound: "That user could not be found. Reload the page and try again.",
  unexpected: "Something went wrong. Try again, and reload the page if it keeps happening.",
  selfDeactivate: "You cannot deactivate your own account. Ask another admin to do it.",
  selfDemote: "You cannot remove your own admin role. Ask another admin to do it.",
  lastAdmin: "This would leave the app without an active admin. Make someone else an admin first.",
  notAllowed: "You do not have permission to do that.",
} as const;

type ErrorLike = { code?: string | null; status?: number | null; message?: string | null };

/** Supabase Auth says the address already belongs to an account. */
export function isEmailTaken(error: ErrorLike): boolean {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already (been )?registered|already exists/i.test(error.message ?? "")
  );
}

/**
 * An Auth error from sending an invite or a password link. The built-in
 * mailer only delivers to the project's team and a few emails an hour, so
 * those two cases point at custom SMTP.
 */
export function describeEmailError(error: ErrorLike, what: "invite" | "password link"): string {
  const message = error.message ?? "";
  const subject = what === "invite" ? "The invite email" : "The password link";

  if (
    error.status === 401 ||
    error.code === "not_admin" ||
    error.code === "no_authorization" ||
    error.code === "bad_jwt" ||
    /invalid api key/i.test(message)
  ) {
    return `${subject} was not sent: Supabase refused the server's key. Check that SUPABASE_SECRET_KEY is the secret key of this project.`;
  }
  if (error.code === "email_address_not_authorized" || /not authori[sz]ed/i.test(message)) {
    return `${subject} could not be sent: Supabase's built-in mailer only delivers to members of the project's team. To email anyone, ${SMTP_HELP}.`;
  }
  const rateLimited =
    error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" || error.status === 429;
  if (rateLimited) {
    // Auth also enforces a short gap between two emails to the same address.
    if (/\d+\s*seconds?/i.test(message)) {
      return `${subject} could not be sent: one went to this address moments ago. Wait a minute and try again.`;
    }
    if (error.code === "over_request_rate_limit") {
      return `${subject} could not be sent: too many requests to Supabase just now. Wait a minute and try again.`;
    }
    return `${subject} could not be sent: Supabase's email limit for this hour has been reached. Try again later, or ${SMTP_HELP}.`;
  }
  if (error.code === "email_address_invalid") {
    return "Supabase refused this email address as invalid. Check it for typos.";
  }
  if (/sending|smtp|mail/i.test(message)) {
    return `${subject} could not be sent. Check the email settings in Supabase, or ${SMTP_HELP}.`;
  }
  return `${subject} could not be sent: ${message || "Supabase did not say why"}.`;
}

/** A database error from changing a profile, in plain words. */
export function describeProfileError(error: ErrorLike): string {
  const message = error.message ?? "";
  if (error.code === "23514" && /last active admin/i.test(message)) return MESSAGES.lastAdmin;
  if (error.code === "42501") return MESSAGES.notAllowed;
  return `The change could not be saved: ${message || "the database did not say why"}.`;
}
