import "server-only";
import { z } from "zod";
import { getSiteUrl } from "@/lib/env";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { fullNameSchema, OptionalPhoneSchema } from "./fields";
import { RoleChoiceSchema, TEAM_MESSAGES, canLead, roleChoiceOf, type RoleChoice } from "./org";
import { isMissingTeamColumn } from "./team";

/**
 * User management for /admin/users (BUILD_SPEC 3 and 10): input schemas, the
 * user directory an admin sees, and plain-words versions of the errors
 * Supabase Auth and the database return. Server only: the directory reads
 * sign-in details with the secret key.
 *
 * Joining by invitation (Kenneth, 27 October 2026): an admin invites an email
 * address in a role; the person gives their name, phone and password on
 * Account Creation (/create-account), which sets profiles.joined_at. Until
 * then the list shows them as Invited, by their email.
 */

export type UserRole = Database["public"]["Enums"]["user_role"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

/**
 * A user id sent back by the page. The action re-reads everything else.
 * Lower-cased, the form Supabase gives ids in: Postgres and Supabase Auth
 * match an id in any case, so an upper-case copy of your own id would
 * otherwise slip past the actions' "not yourself" checks.
 */
export const UserIdSchema = z
  .uuid({ error: "That user could not be found. Reload the page and try again." })
  .toLowerCase();

/**
 * The lead inspector chosen in a form, lower-cased like every id. A form
 * sends "" for no choice; whether one is needed depends on the role (and on
 * the database having teams), so the action decides that.
 */
const LeadChoiceSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.uuid({ error: TEAM_MESSAGES.leadGone }).toLowerCase().optional(),
);

/** The longest name the app saves for someone; the name rules live in ./fields.ts, shared with Account Creation. */
export { NAME_MAX_LENGTH } from "./fields";

/**
 * An invite: the address and the role chosen (with an inspector's lead
 * inspector). No name: the invitee gives their own name, phone and password
 * on Account Creation.
 */
export const InviteUserSchema = z.object({
  email: z
    .string({ error: "Enter their email address." })
    .trim()
    .toLowerCase()
    .min(1, "Enter their email address.")
    .max(254, "That email address is too long.")
    .pipe(z.email({ error: "Enter a valid email address, like name@example.com." })),
  role: RoleChoiceSchema,
  leadId: LeadChoiceSchema,
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

/** Fields a user form can mark: the invite's, the role and lead in every dialog, and Edit Details'. */
export type UserField = "email" | "fullName" | "phone" | "role" | "leadId";

/**
 * Edit Details: someone's name and phone number, by Account Creation's rules
 * (./fields.ts), so the dialog takes whatever an invitee entered there,
 * unedited. The phone may stay blank, as it is for accounts from before
 * phones: blank saves none. A form without the field at all leaves the
 * phone as it is.
 */
export const UserDetailsSchema = z.object({
  userId: UserIdSchema,
  fullName: fullNameSchema("Enter their name."),
  phone: z.preprocess((value) => (value === null ? undefined : value), OptionalPhoneSchema.optional()),
});

/** Change Role: inspector (in a lead's team), lead inspector or admin. */
export const ChangeRoleSchema = z.object({ userId: UserIdSchema, role: RoleChoiceSchema, leadId: LeadChoiceSchema });
/** Change Lead Inspector: move an inspector to another team. */
export const AssignLeadSchema = z.object({
  userId: UserIdSchema,
  leadId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.uuid({ error: TEAM_MESSAGES.chooseLead }).toLowerCase(),
  ),
});
/** Activate or reactivate; an inspector who has no lead gets their role and lead here. */
export const ActivateSchema = z.object({
  userId: UserIdSchema,
  role: z.preprocess((value) => (value === "" || value === null ? undefined : value), RoleChoiceSchema.optional()),
  leadId: LeadChoiceSchema,
});
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

/**
 * How /auth/confirm checks each kind of link Copy Invite Link hands out. An
 * invite keeps its type. A magic link, for someone who opened their invite
 * but never finished, is checked as an email link, which the route accepts
 * (it accepts no "magiclink"): Supabase finds the token either way, and the
 * route sends them into the app, which takes an account that has not joined
 * to Account Creation.
 */
const CONFIRM_TYPE: Readonly<Partial<Record<string, "invite" | "email">>> = { invite: "invite", magiclink: "email" };

/**
 * The address Copy Invite Link gives the admin, from what
 * auth.admin.generateLink() answers; null for any other kind of link. It
 * lands on /auth/confirm, which verifies the token hash itself, on any
 * device. Never Supabase's own action_link: that verifies on Supabase's
 * server and hands the session over in the address's #fragment, which this
 * app's server never sees.
 */
export function inviteLinkUrl(properties: { hashed_token: string; verification_type: string }): string | null {
  const type = CONFIRM_TYPE[properties.verification_type];
  if (!type || !properties.hashed_token) return null;
  return `${authConfirmUrl()}?${new URLSearchParams({ token_hash: properties.hashed_token, type })}`;
}

/* ------------------------------------------------------------------ *
 * Account status
 * ------------------------------------------------------------------ */

/**
 * - `active`: may sign in and read data.
 * - `invited`: active, but the person has not created their account yet
 *   (Account Creation sets profiles.joined_at). An invite activates the
 *   account it makes, in the role the admin chose; until the person joins,
 *   the app sends their session to /create-account.
 * - `pending`: never let in. New auth accounts start inactive (a safety net in
 *   case public sign-up is switched on) and wait for an admin.
 * - `deactivated`: shut out by an admin.
 */
export type AccountStatus = "active" | "invited" | "pending" | "deactivated";

/** Sign-in details from Supabase Auth; only the secret key can read them. */
export type SignInDetails = {
  lastSignInAt: string | null;
  bannedUntil: string | null;
};

type ProfileState = {
  active: boolean;
  created_at: string;
  updated_at: string;
  /**
   * When they created their account; null while an invite is unanswered.
   * Absent where the database has no such column (migration 20261027140000
   * not run): everyone has joined there, as before.
   */
  joined_at?: string | null;
};

/**
 * True while a profile is exactly as the sign-up trigger made it. Insert sets
 * created_at and updated_at to the same instant and every update moves
 * updated_at (set_updated_at), so activating, deactivating or any other
 * change ends it. A sign-in attempt does not touch the profile.
 */
export function isUntouched(profile: Pick<ProfileState, "created_at" | "updated_at">): boolean {
  return Date.parse(profile.updated_at) === Date.parse(profile.created_at);
}

/** True while Supabase Auth bans the account (deactivation bans for a century). */
export function isBanned(bannedUntil: string | null | undefined, now: number = Date.now()): boolean {
  return bannedUntil ? Date.parse(bannedUntil) > now : false;
}

/**
 * An inactive account is pending only when it can never have been active:
 * its profile is untouched since sign-up (so no admin ever activated or
 * deactivated it) and Supabase Auth does not ban it. This holds even after
 * the person tried to sign in, which the last sign-in time cannot tell.
 * Every other inactive account counts as deactivated: calling a blocked
 * person "pending" could invite an admin to let them back in. An active
 * account is invited until its person has joined.
 */
export function accountStatus(profile: ProfileState, bannedUntil?: string | null, now: number = Date.now()): AccountStatus {
  if (profile.active) return profile.joined_at === null ? "invited" : "active";
  return isUntouched(profile) && !isBanned(bannedUntil, now) ? "pending" : "deactivated";
}

/* ------------------------------------------------------------------ *
 * The directory
 * ------------------------------------------------------------------ */

/** What the page shows for one person. Only display fields: this reaches the browser. */
export type UserListItem = {
  id: string;
  /**
   * Their UID, SC- and a number (SC-0042), which the database gives when the
   * account is created and never changes. Null until the project has run
   * migration 20261008140000.
   */
  uid: string | null;
  email: string;
  /** Null until they give one: someone invited goes by their email until they create their account. */
  fullName: string | null;
  /**
   * Their phone number as typed, null when they have none: accounts from
   * before phones until someone adds one, and everyone on a project that has
   * not run migration 20261027140000.
   */
  phone: string | null;
  role: UserRole;
  /** Inspector, lead inspector or admin (lib/auth/org.ts). */
  roleChoice: RoleChoice;
  status: AccountStatus;
  createdAt: string;
  /** Null when they never signed in, or when sign-in details are unavailable. */
  lastSignInAt: string | null;
  /**
   * Active, yet Supabase Auth still bans them, so they cannot sign in: left by
   * a deactivation and a reactivation at the same moment, or a ban set in the
   * Supabase dashboard. Reactivating lifts it.
   */
  signInBlocked: boolean;
  isSelf: boolean;
  /** The lead inspector who manages them, when they are in a team. */
  lead: { id: string; name: string } | null;
  /** For a lead inspector: the people in their team, by name, active or not. Empty for everyone else. */
  team: TeamMemberItem[];
  /**
   * An active inspector who is not a lead and is in no team: an account from
   * before lead inspectors, or one a script set up. For an admin to fix.
   */
  missingLead: boolean;
};

export type TeamMemberItem = { id: string; name: string; active: boolean };

/** An active lead inspector, for the lead pickers. */
export type LeadOption = { id: string; name: string; teamSize: number };

/**
 * - `ok`: sign-in details loaded with the secret key.
 * - `missing-key`: SUPABASE_SECRET_KEY is not set; invites and bans are off.
 * - `failed`: the key is set but Supabase Auth did not answer.
 */
export type AdminApiState = "ok" | "missing-key" | "failed";

export type UserDirectory = {
  users: UserListItem[];
  adminApi: AdminApiState;
  /**
   * False until the project has run migration 20261007170000: the screen
   * then works as it did before lead inspectors and says what is needed.
   */
  teams: boolean;
  /**
   * False until the project has run migration 20261008140000: the screen
   * then has no UID column and searches names and emails only.
   */
  uids: boolean;
  /** Active lead inspectors by name: who an inspector can work under. */
  leads: LeadOption[];
};

/** How a person is named in the list, dialogs and messages. */
export function displayName(fullName: string | null | undefined, email: string | null | undefined): string {
  return fullName?.trim() || email?.trim() || "This user";
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

type DirectoryRow = Pick<Profile, "id" | "email" | "full_name" | "role" | "active" | "created_at" | "updated_at"> & {
  is_lead?: boolean | null;
  lead_id?: string | null;
  uid?: string | null;
  phone?: string | null;
  joined_at?: string | null;
};

/**
 * The database has no UIDs yet (migration 20261008140000). PostgREST answers
 * 42703 for an unknown column in a select or filter ("column profiles.uid
 * does not exist"), PGRST204 for one in a write ("Could not find the 'uid'
 * column of 'profiles' in the schema cache").
 */
export function isMissingUidColumn(error: ErrorLike | null | undefined): boolean {
  if (!error) return false;
  return (error.code === "42703" || error.code === "PGRST204") && /(?:^|[\s.'"])uid(?:[\s'"]|$)/.test(error.message ?? "");
}

/**
 * The database has no phone numbers or Account Creation yet (migration
 * 20261027140000): the same answers as above, for profiles.phone or
 * profiles.joined_at.
 */
export function isMissingAccountColumn(error: ErrorLike | null | undefined): boolean {
  if (!error) return false;
  return (
    (error.code === "42703" || error.code === "PGRST204") &&
    /(?:^|[\s.'"])(?:phone|joined_at)(?:[\s'"]|$)/.test(error.message ?? "")
  );
}

function listError(error: ErrorLike): Error {
  return new Error(`Could not load the user list: ${error.message}`);
}

type ProfileRead = { rows: DirectoryRow[]; teams: boolean; uids: boolean };

/** One way to read the list, and which of the later columns it reads. */
type ListRead = {
  teams: boolean;
  uids: boolean;
  accounts: boolean;
  read: () => PromiseLike<{ data: DirectoryRow[] | null; error: ErrorLike | null }>;
};

/**
 * Everyone's profile, with their place in the teams, their UID, phone and
 * whether they have joined, as far as the database has them. A project that
 * has not run a migration (20261007170000 lead inspectors, 20261008140000
 * UIDs, 20261027140000 phones and Account Creation) answers 42703 for the
 * first missing column it meets: the list is read again without that column,
 * so the screen works as before. The migrations run in order, so a project
 * without one has none of the later ones either; without the last, phone is
 * null and everyone has joined.
 */
async function readProfiles(supabase: ServerClient): Promise<ProfileRead> {
  const reads: readonly ListRead[] = [
    {
      teams: true,
      uids: true,
      accounts: true,
      read: () =>
        supabase
          .from("profiles")
          .select("id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id, uid, phone, joined_at"),
    },
    {
      teams: true,
      uids: true,
      accounts: false,
      read: () =>
        supabase.from("profiles").select("id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id, uid"),
    },
    {
      teams: true,
      uids: false,
      accounts: false,
      read: () => supabase.from("profiles").select("id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id"),
    },
    {
      teams: false,
      uids: false,
      accounts: false,
      read: () => supabase.from("profiles").select("id, email, full_name, role, active, created_at, updated_at"),
    },
  ];

  for (let index = 0; index < reads.length; ) {
    const { data, error } = await reads[index].read();
    if (!error) return { rows: data ?? [], teams: reads[index].teams, uids: reads[index].uids };
    const missing = isMissingAccountColumn(error)
      ? "accounts"
      : isMissingUidColumn(error)
        ? "uids"
        : isMissingTeamColumn(error)
          ? "teams"
          : null;
    // On to the next read without the missing column.
    const next = missing ? reads.findIndex((read, at) => at > index && !read[missing]) : -1;
    if (next === -1) throw listError(error);
    index = next;
  }
  // Never reached: the last read has none of the later columns, so any error there is thrown above.
  throw new Error("Could not load the user list.");
}

/**
 * Everyone with a profile, read through the signed-in admin's own client (RLS
 * lets admins read every profile), merged with sign-in details from Supabase
 * Auth when the secret key is set (last sign-in, bans), with each person's
 * lead inspector and each lead inspector's team. Call it only after
 * requireAdmin().
 */
export async function getUserDirectory(viewerId: string): Promise<UserDirectory> {
  const supabase = await createClient();
  const { rows, teams, uids } = await readProfiles(supabase);

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

  const nameOf = (row: DirectoryRow) => displayName(row.full_name, row.email);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const members = new Map<string, TeamMemberItem[]>();
  for (const row of rows) {
    if (!row.lead_id) continue;
    const team = members.get(row.lead_id) ?? [];
    team.push({ id: row.id, name: nameOf(row), active: row.active });
    members.set(row.lead_id, team);
  }
  for (const team of members.values()) team.sort((a, b) => byName.compare(a.name, b.name));

  const now = Date.now();
  const users = rows.map((profile): UserListItem => {
    const signIn = signIns?.get(profile.id) ?? null;
    const roleChoice = roleChoiceOf({ role: profile.role, isLead: profile.is_lead });
    const leadId = profile.lead_id ?? null;
    const lead = leadId ? byId.get(leadId) : undefined;
    return {
      id: profile.id,
      uid: profile.uid ?? null,
      email: profile.email ?? "",
      fullName: profile.full_name,
      phone: profile.phone ?? null,
      role: profile.role,
      roleChoice,
      status: accountStatus(profile, signIn?.bannedUntil, now),
      createdAt: profile.created_at,
      lastSignInAt: signIn?.lastSignInAt ?? null,
      signInBlocked: profile.active && isBanned(signIn?.bannedUntil, now),
      isSelf: profile.id === viewerId,
      lead: leadId ? { id: leadId, name: lead ? nameOf(lead) : "Unknown lead inspector" } : null,
      team: roleChoice === "lead" ? (members.get(profile.id) ?? []) : [],
      missingLead: teams && profile.active && roleChoice === "inspector" && leadId === null,
    };
  });
  users.sort(
    (a, b) =>
      byName.compare(displayName(a.fullName, a.email), displayName(b.fullName, b.email)) ||
      byName.compare(a.email, b.email),
  );

  const leads = teams
    ? rows
        .filter((row) => canLead({ role: row.role, isLead: row.is_lead, active: row.active }))
        .map((row): LeadOption => ({ id: row.id, name: nameOf(row), teamSize: members.get(row.id)?.length ?? 0 }))
        .sort((a, b) => byName.compare(a.name, b.name))
    : [];

  return { users, adminApi, teams, uids, leads };
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

/** An account found by its address: whether it is active, and whether its person has joined. */
export type ExistingAccount = { id: string; active: boolean; joined: boolean };

/**
 * The profile with this email, if any (case-insensitive: `_` is escaped so it
 * is not a wildcard). On a project without migration 20261027140000 everyone
 * has joined.
 */
export async function findProfileByEmail(supabase: ServerClient, email: string): Promise<ExistingAccount | null> {
  const pattern = email.replace(/[\\%_]/g, (match) => `\\${match}`);
  const found = await supabase.from("profiles").select("id, active, joined_at").ilike("email", pattern).limit(1);
  if (!found.error) {
    const row = found.data?.[0];
    return row ? { id: row.id, active: row.active, joined: row.joined_at !== null } : null;
  }
  if (!isMissingAccountColumn(found.error)) throw new Error(`Could not check for an existing account: ${found.error.message}`);
  const legacy = await supabase.from("profiles").select("id, active").ilike("email", pattern).limit(1);
  if (legacy.error) throw new Error(`Could not check for an existing account: ${legacy.error.message}`);
  const row = legacy.data?.[0];
  return row ? { ...row, joined: true } : null;
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
  selfCancel: "You cannot cancel your own account.",
  lastAdmin: "This would leave the app without an active admin. Make someone else an admin first.",
  notAllowed: "You do not have permission to do that.",
  accountsMissing:
    "Phone numbers and Account Creation need a database update first: apply supabase/migrations/20261027140000_profile_phone_and_joined.sql, then reload this page.",
  phoneRefused: "The database did not take that phone number. Enter it like +60 12-345 6789 or 012-345 6789.",
} as const;

type ErrorLike = { code?: string | null; status?: number | null; message?: string | null };

/** Supabase Auth refused the server's secret key (or it belongs to another project). */
function isKeyRefused(error: ErrorLike): boolean {
  return (
    error.status === 401 ||
    error.code === "not_admin" ||
    error.code === "no_authorization" ||
    error.code === "bad_jwt" ||
    /invalid api key/i.test(error.message ?? "")
  );
}

const KEY_HELP = "Check that SUPABASE_SECRET_KEY is the secret key of this project.";

/** Supabase Auth says the address already belongs to an account. */
export function isEmailTaken(error: ErrorLike): boolean {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already (been )?registered|already exists/i.test(error.message ?? "")
  );
}

/**
 * Supabase Auth refused the address itself, before any email: it checks that
 * an address can receive mail (a domain that does not exist, like the
 * test.local accounts, fails).
 */
export function isEmailRejected(error: ErrorLike): boolean {
  return error.code === "email_address_invalid";
}

/**
 * An Auth error from sending an invite or a password link. The built-in
 * mailer only delivers to the project's team and a few emails an hour, so
 * those two cases point at custom SMTP.
 */
export function describeEmailError(error: ErrorLike, what: "invite" | "password link"): string {
  const message = error.message ?? "";
  const subject = what === "invite" ? "The invite email" : "The password link";

  if (isKeyRefused(error)) return `${subject} was not sent: Supabase refused the server's key. ${KEY_HELP}`;
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
  if (isEmailRejected(error)) {
    return what === "invite"
      ? "Supabase refused this address: it does not look able to receive email (for example, its domain does not exist). Check it for typos."
      : "The password link could not be sent: Supabase refused this address because it does not look able to receive email.";
  }
  if (/error sending|smtp|mailer/i.test(message)) {
    return `${subject} could not be sent. Check the email settings in Supabase, or ${SMTP_HELP}.`;
  }
  return `${subject} could not be sent: ${message || "Supabase did not say why"}.`;
}

/**
 * True when an email failed for a reason a link sent by hand avoids (Copy
 * Invite Link): the mailer's limits, its settings, the address. Not when
 * Supabase refused the server's key, which the link needs too.
 */
export function linkWouldHelp(error: ErrorLike): boolean {
  return !isKeyRefused(error);
}

/** Supabase Auth has no such user (any more). */
export function isUserGone(error: ErrorLike): boolean {
  return error.code === "user_not_found" || error.status === 404;
}

/**
 * An Auth error from making an invite link (auth.admin.generateLink).
 * Nothing is emailed, so the mailer's limits never apply.
 */
export function describeLinkError(error: ErrorLike): string {
  if (isKeyRefused(error)) return `The invite link was not created: Supabase refused the server's key. ${KEY_HELP}`;
  if (isUserGone(error)) return MESSAGES.userNotFound;
  if (error.code === "over_request_rate_limit" || error.status === 429) {
    return "The invite link was not created: too many requests to Supabase just now. Wait a minute and try again.";
  }
  return `The invite link was not created: ${error.message || "Supabase did not say why"}.`;
}

/**
 * An Auth error from deleting an account that has not joined (Cancel
 * Invite). Supabase Auth answers "Database error deleting user" when the
 * database refuses: a row of the app still points at the account (the
 * profile goes with it, but an inspection or the audit log keeps it).
 */
export function describeCancelError(error: ErrorLike, name: string): string {
  const subject = `The invite to ${name} was not cancelled`;
  if (isKeyRefused(error)) return `${subject}: Supabase refused the server's key. ${KEY_HELP}`;
  if (/database error deleting user/i.test(error.message ?? "")) {
    return `${subject}: records in the app point at their account, so the database keeps it. To stop them signing in, choose Deactivate instead.`;
  }
  return `${subject}: ${error.message || "Supabase did not say why"}.`;
}

/** The database refused a phone number (profiles_phone_format, migration 20261027140000), which the app's check let through. */
export function isPhoneRefused(error: ErrorLike): boolean {
  return error.code === "23514" && /phone/i.test(error.message ?? "");
}

/**
 * The database's own words for the team rules (migration 20261007170000),
 * which the actions check first. They show up here when something changed
 * in between, for example another admin demoting the lead just chosen.
 */
const TEAM_RULE_MESSAGES: readonly [RegExp, string][] = [
  [/needs a lead inspector/i, TEAM_MESSAGES.chooseLead],
  [/must be an active lead inspector/i, "That lead inspector is not an active lead inspector any more. Reload the page and choose another."],
  [/still leads/i, "They still lead a team. Choose another lead inspector for each person in it first, then try again."],
  [/their own lead inspector/i, TEAM_MESSAGES.ownLead],
  [/has no lead inspector of their own|is in no team/i, "Admins and lead inspectors work in no lead inspector's team. Reload the page and try again."],
];

/** A database error from changing a profile, in plain words. */
export function describeProfileError(error: ErrorLike): string {
  const message = error.message ?? "";
  if (error.code === "23514" && /last active admin/i.test(message)) return MESSAGES.lastAdmin;
  if (error.code === "23514") {
    const rule = TEAM_RULE_MESSAGES.find(([pattern]) => pattern.test(message));
    if (rule) return rule[1];
  }
  if (isPhoneRefused(error)) return MESSAGES.phoneRefused;
  if (isMissingTeamColumn(error)) return TEAM_MESSAGES.teamsMissing;
  if (isMissingAccountColumn(error)) return MESSAGES.accountsMissing;
  if (error.code === "42501") return MESSAGES.notAllowed;
  return `The change could not be saved: ${message || "the database did not say why"}.`;
}
