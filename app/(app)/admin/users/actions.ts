"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import {
  accessOf,
  BUILT_IN_IN_WORDS,
  needsLead,
  placementFor,
  roleChoiceOf,
  standInRole,
  TEAM_MESSAGES,
  type Placement,
  type RoleOption,
} from "@/lib/auth/org";
import { authorizeAction, type ActionAuth, type SessionUser } from "@/lib/auth/session";
import {
  anotherLeadExists,
  checkLead,
  isMissingTeamColumn,
  personName,
  readPerson,
  teamOf,
  teamsReady,
  type ErrorLike,
  type Person,
} from "@/lib/auth/team";
import {
  ActivateSchema,
  AssignLeadSchema,
  BAN_DURATION,
  ChangeRoleSchema,
  InviteUserSchema,
  MESSAGES,
  UNBAN,
  UserDetailsSchema,
  UserTargetSchema,
  authConfirmUrl,
  describeCancelError,
  describeEmailError,
  describeLinkError,
  describeProfileError,
  findProfileByEmail,
  findRole,
  firstFieldErrors,
  firstIssue,
  formFields,
  inviteLinkUrl,
  isBanned,
  isEmailRejected,
  isEmailTaken,
  isMissingAccountColumn,
  isPhoneRefused,
  isUntouched,
  isUserGone,
  linkWouldHelp,
  type InviteDelivery,
  type UserField,
} from "@/lib/auth/users";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * User management actions for /admin/users. Server Actions are public HTTP
 * endpoints: each one checks that the caller may manage users, validates its
 * input with zod and re-reads what it needs. Managing users is the built-in
 * Admin role's alone (lib/auth/permissions.ts, ADMIN_ONLY): a custom role
 * that sees every inspection is refused here as an inspector is, and the
 * database refuses it too (is_full_admin). Profile changes go through the
 * admin's own client, so RLS and the profiles guards (which keep one active
 * person with the Admin role and the lead inspector rules) check them
 * again. Only Auth work (invites, invite links, bans, deleting an unanswered
 * invite, sign-in details, the name Auth keeps) uses the secret key.
 *
 * Joining by invitation (Kenneth, 27 October 2026): an invite names the
 * address and the role; the person gives their name, phone and password on
 * Account Creation, which sets profiles.joined_at. The invite goes by email,
 * or as a link the admin sends by hand (Create Link: Supabase's built-in
 * mailer only reaches the project's team). Until they join the account is
 * Invited: an admin can resend the invite, copy a link to send by hand, or
 * cancel it.
 *
 * Roles (migration 20261027150000): any role of public.roles, stored as
 * profiles.role_id; the profiles guard gives role and is_lead its access.
 * Lead inspectors (lib/auth/org.ts): someone whose role sees their own
 * inspections works in an active lead inspector's team, so giving them such
 * a role, inviting them or activating them asks for their lead, in the same
 * write; any other role clears it there. Someone who leads a team keeps a
 * role that sees their team's until it has moved. A project without roles
 * offers the built-in ones, as before; one without migration 20261007170000
 * works with the level only.
 */

/** Who may call these actions: the built-in Admin role, which alone manages users. */
const MANAGE_USERS = { permission: "users" } as const;

/** PostgREST's answer for a function it does not have (PGRST202), or Postgres's own (42883). */
function isMissingFunction(error: ErrorLike): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

/**
 * The caller, when they may manage users. authorizeAction() decides on the
 * role the session read. Where the session could not read it (a passing
 * fault), it stands in the built-in role for their level, and a custom role
 * that sees every inspection is an admin at that level: the database is asked
 * then (is_full_admin), before any of the work the secret key does, which row
 * level security never checks. A project without roles has no such function:
 * the level is the role there.
 */
async function authorize(): Promise<ActionAuth> {
  const auth = await authorizeAction(MANAGE_USERS);
  // A role the session read and that passed is the built-in Admin role: nothing more to ask.
  if (!auth.ok || auth.user.grant) return auth;
  const { data, error } = await (await createClient()).rpc("is_full_admin");
  if (error && isMissingFunction(error)) return auth;
  if (error) {
    console.error("[admin/users] the Admin role could not be checked", error.code, error.message);
    return { ok: false, error: "Your role could not be checked just now. Try again." };
  }
  return data === true ? auth : { ok: false, error: MESSAGES.notAllowed };
}

type FieldErrors = Partial<Record<UserField, string>>;

export type ActionResult =
  | { status: "idle" }
  | {
      status: "success" | "warning" | "error";
      message: string;
      fieldErrors?: FieldErrors;
    };

/**
 * An answer that may carry an invite link (Invite User by Create Link, Copy
 * Invite Link): the link, which goes to the admin who asked and nowhere else
 * (never into a log), and what to say about it.
 */
export type InviteLinkResult = ActionResult | { status: "link"; link: string; message: string };

const ok = (message: string): ActionResult => ({ status: "success", message });
const warn = (message: string): ActionResult => ({ status: "warning", message });
const fail = (message: string, fieldErrors?: FieldErrors): ActionResult => ({
  status: "error",
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

/** Unexpected failures become a message on the form instead of an error page. */
async function guarded<Result extends ActionResult | InviteLinkResult = ActionResult>(
  name: string,
  run: () => Promise<Result>,
): Promise<Result | ActionResult> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[admin/users] ${name} failed`, error);
    return fail(MESSAGES.unexpected);
  }
}

/** A refused parse: the message, also next to the role or lead field when it is about one. */
function invalid(error: z.ZodError): ActionResult {
  const fields = firstFieldErrors(error) as FieldErrors;
  const field = (["leadId", "role"] as const).find((key) => fields[key]);
  return field ? fail(fields[field]!, { [field]: fields[field] }) : fail(firstIssue(error));
}

/** An address that has an account already, by what the admin can do about it (the row menu's words). */
function emailTaken({ active, joined = true }: { active: boolean; joined?: boolean }): ActionResult {
  const message = !active
    ? "That email belongs to an account that is not active. Choose Activate or Reactivate next to their name instead."
    : joined
      ? "That email already has an account. If they need a new link, choose Send Password Link next to their name."
      : "That email has been invited already. To send them a new link, choose Resend Invite or Copy Invite Link next to their name.";
  return fail(message, { email: message });
}

type Client = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

type RoleCheck = { ok: true; role: RoleOption } | { ok: false; result: ActionResult };

/**
 * The role a form chose (a role's id, or a built-in role's kind), read
 * again: what it sees never comes from the request. A role deleted since the
 * page loaded is refused at the Role field, where the admin chooses another.
 */
async function chosenRole(supabase: Client, value: string): Promise<RoleCheck> {
  const found = await findRole(supabase, value);
  if (found.ok) return found;
  return { ok: false, result: fail(found.message, { role: found.message }) };
}

/** Someone's role, for the words of a message: read by its id, else the built-in role for their level. */
async function roleOfPerson(supabase: Client, person: Person): Promise<RoleOption> {
  const level = standInRole(roleChoiceOf({ role: person.role, isLead: person.is_lead }));
  if (!person.role_id) return level;
  const found = await findRole(supabase, person.role_id);
  return found.ok ? found.role : level;
}

/**
 * Whether a Change Role choice keeps the caller in the Admin role, as their
 * own session tells without a read: the Admin role by its kind, or by the id
 * of the role they have (only the Admin role gets here). Anything else would
 * take it away from them.
 */
function keepsOwnRole(choice: string, user: SessionUser): boolean {
  return choice === "admin" || (Boolean(user.grant?.id) && choice === user.grant?.id);
}

/** Where someone will work: the columns to store, and their lead's name. */
type PlacementCheck = { ok: true; fields: Placement; leadName: string | null } | { ok: false; result: ActionResult };

/**
 * A role that needs a lead, without one chosen: ask for one at the lead
 * field, or, when nobody can lead them (no active lead inspector, or only the
 * person themselves), say so at the role field, where the admin can choose
 * otherwise. The lead picker is empty then, so asking it would lead nowhere.
 */
async function askForLead(supabase: Client, userId: string | null): Promise<ActionResult> {
  const leads = await anotherLeadExists(supabase, userId);
  if (leads.error) console.error("[admin/users] the lead inspectors could not be counted", leads.error);
  else if (!leads.exists) return fail(TEAM_MESSAGES.nobodyToLead, { role: TEAM_MESSAGES.nobodyToLead });
  return fail(TEAM_MESSAGES.chooseLead, { leadId: TEAM_MESSAGES.chooseLead });
}

/**
 * The role an admin chose, checked against the team rules before anything
 * changes: a role that sees its own inspections needs an active lead
 * inspector who is someone else; any other role leaves the team in the same
 * write. Without the lead inspector columns (a project that has not run
 * migration 20261007170000) only the level is stored, as before lead
 * inspectors.
 */
async function choosePlacement(
  supabase: Client,
  role: RoleOption,
  leadId: string | null,
  userId: string | null,
): Promise<PlacementCheck> {
  const teams = await teamsReady(supabase);
  if (teams.error) return { ok: false, result: fail(describeProfileError(teams.error)) };
  if (!teams.ready) {
    if (role.access === "team") {
      return { ok: false, result: fail(TEAM_MESSAGES.teamsMissing, { role: TEAM_MESSAGES.teamsMissing }) };
    }
    return { ok: true, fields: placementFor(role, null, false), leadName: null };
  }
  if (!needsLead(role.access)) return { ok: true, fields: placementFor(role, null), leadName: null };
  if (!leadId) return { ok: false, result: await askForLead(supabase, userId) };

  const lead = await checkLead(supabase, leadId, userId);
  if (!lead.ok) {
    if (lead.error) console.error("[admin/users] the lead inspector could not be read", lead.error);
    return { ok: false, result: fail(lead.message, { leadId: lead.message }) };
  }
  return { ok: true, fields: placementFor(role, leadId), leadName: lead.name };
}

/**
 * Rule 5: someone who leads a team keeps a role that sees their team's until
 * it has moved. Null when their team is empty.
 */
async function refuseWhileLeading(supabase: Client, leadId: string, name: string): Promise<ActionResult | null> {
  const { members, error } = await teamOf(supabase, leadId);
  if (error) return fail(describeProfileError(error));
  if (members.length === 0) return null;
  return fail(TEAM_MESSAGES.leadsTeam(name, members.map((member) => member.name)));
}

/**
 * What Change Role did: the built-in roles as the app has always said them
 * ("Olga Other is now an inspector in Lina Lead's team."), a custom role by
 * its name ("Olga Other's role is now QA Reviewer.").
 */
function placedMessage(name: string, role: RoleOption, leadName: string | null): string {
  if (role.builtIn) return `${name} is now ${BUILT_IN_IN_WORDS[role.builtIn]}${leadName ? ` in ${leadName}'s team` : ""}.`;
  return `${name}'s role is now ${role.name}${leadName ? `, in ${leadName}'s team` : ""}.`;
}

/** The second sentence after an activation that placed someone. */
function activatedAs(role: RoleOption, leadName: string | null): string {
  if (role.builtIn === "inspector" && leadName) return `They work in ${leadName}'s team.`;
  if (role.builtIn) return `They are ${BUILT_IN_IN_WORDS[role.builtIn]}.`;
  return `Their role is ${role.name}${leadName ? `, in ${leadName}'s team` : ""}.`;
}

/** After an invite email Supabase did not send: a link the admin sends by hand gets round the mailer. */
const CREATE_LINK_INSTEAD = " Or choose Create Link and send them the link yourself.";

/** An invitation made in Supabase Auth: the account it made (or found unanswered), and the link Create Link hands out. */
type InviteMade = { ok: true; userId: string; link: string | null } | { ok: false; result: ActionResult };

/** Send Email: Supabase makes the account and emails the invite, its link landing on /auth/confirm. */
async function emailInvite(admin: AdminClient, email: string): Promise<InviteMade> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: authConfirmUrl() });
  if (!error) return { ok: true, userId: data.user.id, link: null };
  if (isEmailTaken(error)) return { ok: false, result: emailTaken({ active: true }) };
  console.error("[admin/users] invite refused", error.code, error.message);
  const message = describeEmailError(error, "invite");
  // A refused address belongs next to the field the admin typed it in.
  if (isEmailRejected(error)) return { ok: false, result: fail(message, { email: message }) };
  return { ok: false, result: fail(message + (linkWouldHelp(error) ? CREATE_LINK_INSTEAD : "")) };
}

/**
 * Create Link: the same invitation without an email
 * (auth.admin.generateLink, with the secret key, which makes the account as
 * an invite does), its link built on /auth/confirm (inviteLinkUrl), never
 * Supabase's action_link. The link signs its holder in as the invitee, so it
 * goes back to the admin who asked and nowhere else, never into a log.
 */
async function linkInvite(admin: AdminClient, email: string): Promise<InviteMade> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email });
  if (error) {
    if (isEmailTaken(error)) return { ok: false, result: emailTaken({ active: true }) };
    console.error("[admin/users] invite link refused", error.code, error.message);
    const message = describeLinkError(error);
    return { ok: false, result: isEmailRejected(error) ? fail(message, { email: message }) : fail(message) };
  }
  const link = inviteLinkUrl(data.properties);
  // The account is made either way; a link of another kind is not handed out (the warning says what to do).
  if (!link) console.error("[admin/users] Supabase answered an invite link of another kind", data.properties.verification_type);
  return { ok: true, userId: data.user.id, link };
}

/**
 * After an invite whose account could not be activated. The profile stays as
 * sign-up made it, so the list shows it as pending, by its email; Activate
 * lets it in, and a role other than Inspector is given there or after.
 */
function notActivated(email: string, role: RoleOption, delivery: InviteDelivery): string {
  const then =
    role.builtIn === "inspector"
      ? ""
      : role.builtIn
        ? `, then make them ${BUILT_IN_IN_WORDS[role.builtIn]}`
        : `, then give them the ${role.name} role`;
  return delivery === "email"
    ? `Invite sent to ${email}, but the account could not be activated. Choose Activate next to ${email}${then}.`
    : `The account for ${email} was made, but it could not be activated, so a link would not let them in. Choose Activate next to ${email}${then}, then Copy Invite Link.`;
}

/** What the invite dialog says over a link it made. */
function linkMade(email: string, team: string): string {
  return `Nothing was emailed: send this link to ${email} yourself, by WhatsApp or any chat. From it they create their account: name, phone and password. It works once, within an hour; for a new one, choose Copy Invite Link next to their email.${team}`;
}

/**
 * Invites someone and activates the account the invite creates, in the role
 * (and team) chosen: by email (Send Email), or with a link the admin sends by
 * hand (Create Link), which the answer carries. No name: they give their
 * name, phone and password on Account Creation, from the link; until then the
 * list names them by their email.
 */
export async function inviteUser(_previous: InviteLinkResult, formData: FormData): Promise<InviteLinkResult> {
  return guarded<InviteLinkResult>("inviteUser", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = InviteUserSchema.safeParse(formFields(formData, ["email", "role", "leadId", "delivery"]));
    if (!parsed.success) return fail("Check the highlighted fields.", firstFieldErrors(parsed.error) as FieldErrors);
    const { email, role: choice, leadId, delivery } = parsed.data;

    if (!isAdminClientConfigured()) return fail(MESSAGES.missingSecretKey);

    // Their role and where they will work, settled before any email goes out or any link is made.
    const supabase = await createClient();
    const chosen = await chosenRole(supabase, choice);
    if (!chosen.ok) return chosen.result;
    const { role } = chosen;
    const placement = await choosePlacement(supabase, role, leadId ?? null, null);
    if (!placement.ok) return placement.result;

    // An invite to an address that never accepted would resend it and could
    // switch a deactivated account back on, so existing accounts stop here.
    const existing = await findProfileByEmail(supabase, email);
    if (existing) return emailTaken(existing);

    const admin = createAdminClient();
    const made = delivery === "link" ? await linkInvite(admin, email) : await emailInvite(admin, email);
    if (!made.ok) return made.result;

    // New accounts start inactive (a safety net should public sign-up ever be
    // switched on). The invite is the admin's decision, so it activates the
    // account it created. Supabase answers an invite to an address that has
    // an unconfirmed account by inviting it again, so only a profile nobody
    // has handled yet is changed: one an admin deactivated stays deactivated.
    const { data: created, error: readError } = await admin
      .from("profiles")
      .select("id, active, created_at, updated_at")
      .eq("id", made.userId)
      .maybeSingle();
    if (created && !readError && !isUntouched(created)) return emailTaken({ active: created.active });

    const { data: activated, error: activationError } = created
      ? await admin
          .from("profiles")
          .update({ ...placement.fields, active: true })
          .eq("id", created.id)
          // Unchanged since the read above, or the update matches nothing.
          .eq("updated_at", created.updated_at)
          .select("id")
      : { data: null, error: readError };
    if (activationError || !activated?.length) {
      console.error("[admin/users] invite made but the profile was not activated", activationError);
      refresh();
      return warn(notActivated(email, role, delivery));
    }

    const team = placement.leadName ? ` They work in ${placement.leadName}'s team.` : "";
    if (delivery === "email") {
      refresh();
      return ok(`Invite sent to ${email}. From the link in it they create their account: name, phone and password.${team}`);
    }
    if (!made.link) {
      refresh();
      return warn(`${email} is invited, but Supabase answered a link of another kind. Choose Copy Invite Link next to ${email} for one.`);
    }
    // No refresh() here: the dialog that shows the link may be Only You So
    // Far's, which the new row takes off the page, link and all. The dialog
    // refreshes the list when it closes.
    return { status: "link", link: made.link, message: linkMade(email, team) };
  });
}

/** Someone's name and phone number as saved, and whether the database has phone numbers at all. */
type DetailsRead = {
  profile: { id: string; email: string | null; full_name: string | null; phone: string | null } | null;
  /** False on a project without migration 20261027140000: the name alone is saved, as before. */
  phones: boolean;
  error: ErrorLike | null;
};

async function readDetails(supabase: Client, userId: string): Promise<DetailsRead> {
  const found = await supabase.from("profiles").select("id, email, full_name, phone").eq("id", userId).maybeSingle();
  if (!isMissingAccountColumn(found.error)) return { profile: found.data, phones: true, error: found.error };
  const legacy = await supabase.from("profiles").select("id, email, full_name").eq("id", userId).maybeSingle();
  return { profile: legacy.data ? { ...legacy.data, phone: null } : null, phones: false, error: legacy.error };
}

/** What Edit Details says it saved: a new name, a new phone number, both or neither. */
function detailsSaved(
  before: { name: string; phone: string | null },
  after: { fullName: string; phone: string | null | undefined },
): string {
  const renamed = before.name !== after.fullName;
  const phoneChanged = after.phone !== undefined && after.phone !== before.phone;
  const phone = after.phone ? `phone number is now ${after.phone}` : "phone number is removed";
  if (renamed && phoneChanged) return `${before.name} is now ${after.fullName}. Their ${phone}.`;
  if (renamed) return `${before.name} is now ${after.fullName}.`;
  if (phoneChanged) return `${after.fullName}'s ${phone}.`;
  return `${after.fullName}'s details stay as they were.`;
}

/**
 * Edit Details: the name the app shows for someone and their phone number,
 * anyone's, the admin's own included, active or not. Someone invited who has
 * not created their account yet can be given them too; what they enter on
 * Account Creation replaces both. profiles.full_name is the one copy of the
 * name the app reads (the lists, the capture header, the review, the export
 * and the AI hand-offs all join the profile), so a new name shows everywhere
 * at once, on past inspections too. Saved through the admin's own client: RLS
 * (profiles_update) lets only an active admin change someone else's profile,
 * the profiles guard trims the name again, and the database checks the
 * phone's format (profiles_phone_format) as the form does.
 *
 * Supabase Auth keeps a copy of the name in user_metadata.full_name. The app
 * never reads it after sign-up made the profile, but the Supabase dashboard
 * lists it, so it follows with the secret key, best effort: the profile is
 * what counts, and a failure there is only logged.
 */
export async function editUserDetails(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("editUserDetails", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = UserDetailsSchema.safeParse(formFields(formData, ["userId", "fullName", "phone"]));
    if (!parsed.success) {
      const fields = firstFieldErrors(parsed.error);
      // A user id the page never sends: nothing to fix at a field.
      if (fields.userId) return fail(fields.userId);
      const fieldErrors: FieldErrors = {
        ...(fields.fullName ? { fullName: fields.fullName } : {}),
        ...(fields.phone ? { phone: fields.phone } : {}),
      };
      return fail(fields.fullName ?? fields.phone ?? firstIssue(parsed.error), fieldErrors);
    }
    const { userId, fullName, phone } = parsed.data;

    const supabase = await createClient();
    const { profile: current, phones, error: readError } = await readDetails(supabase, userId);
    if (readError) return fail(describeProfileError(readError));
    if (!current) return fail(MESSAGES.userNotFound);
    if (!phones && phone) return fail(MESSAGES.accountsMissing, { phone: MESSAGES.accountsMissing });
    const before = { name: personName(current), phone: current.phone };

    const changes: TablesUpdate<"profiles"> = { full_name: fullName };
    if (phones && phone !== undefined) changes.phone = phone;
    const { data: saved, error } = await supabase.from("profiles").update(changes).eq("id", userId).select("id");
    if (error) {
      if (isPhoneRefused(error)) return fail(MESSAGES.phoneRefused, { phone: MESSAGES.phoneRefused });
      return fail(describeProfileError(error));
    }
    // Exactly their row: none means it went (or RLS hid it) since the read.
    if (saved.length !== 1) {
      if (saved.length > 1) console.error("[admin/users] Edit Details changed more than one profile", userId, saved.length);
      return fail(saved.length === 0 ? MESSAGES.userNotFound : MESSAGES.unexpected);
    }
    refresh();

    if (isAdminClientConfigured()) {
      // Merged into the metadata Auth keeps: only full_name changes.
      const { error: authError } = await createAdminClient().auth.admin.updateUserById(userId, {
        user_metadata: { full_name: fullName },
      });
      if (authError) {
        console.error("[admin/users] name saved; Supabase Auth keeps the old one", authError.code, authError.message);
      }
    }
    return ok(detailsSaved(before, { fullName, phone: phones ? phone : undefined }));
  });
}

/**
 * Gives someone a role (public.roles), with their lead inspector when the
 * role needs one, or out of their team when it does not. Nobody leaves the
 * Admin role by their own hand.
 */
export async function changeRole(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("changeRole", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = ChangeRoleSchema.safeParse(formFields(formData, ["userId", "role", "leadId"]));
    if (!parsed.success) return invalid(parsed.error);
    const { userId, role: choice, leadId } = parsed.data;
    if (userId === auth.user.id && !keepsOwnRole(choice, auth.user)) return fail(MESSAGES.selfDemote);

    const supabase = await createClient();
    const target = await readPerson(supabase, userId);
    if (target.error) return fail(describeProfileError(target.error));
    if (!target.person) return fail(MESSAGES.userNotFound);
    const name = personName(target.person);

    const chosen = await chosenRole(supabase, choice);
    if (!chosen.ok) return chosen.result;
    const { role } = chosen;
    const placement = await choosePlacement(supabase, role, leadId ?? null, userId);
    if (!placement.ok) return placement.result;
    if (target.teams && target.person.is_lead && role.access !== "team") {
      const refusal = await refuseWhileLeading(supabase, userId, name);
      if (refusal) return refusal;
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .update(placement.fields)
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error) return fail(describeProfileError(error));
    if (!profile) return fail(MESSAGES.userNotFound);

    refresh();
    return ok(placedMessage(name, role, placement.leadName));
  });
}

/** Moves someone whose role sees their own inspections to another lead inspector's team. */
export async function assignLead(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("assignLead", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = AssignLeadSchema.safeParse(formFields(formData, ["userId", "leadId"]));
    if (!parsed.success) return invalid(parsed.error);
    const { userId, leadId } = parsed.data;

    const supabase = await createClient();
    const target = await readPerson(supabase, userId);
    if (target.error) return fail(describeProfileError(target.error));
    if (!target.person) return fail(MESSAGES.userNotFound);
    if (!target.teams) return fail(TEAM_MESSAGES.teamsMissing);
    const name = personName(target.person);
    if (accessOf({ role: target.person.role, isLead: target.person.is_lead }) !== "own") {
      return fail(TEAM_MESSAGES.inNoTeam(name, await roleOfPerson(supabase, target.person)));
    }

    const lead = await checkLead(supabase, leadId, userId);
    if (!lead.ok) {
      if (lead.error) console.error("[admin/users] the lead inspector could not be read", lead.error);
      return fail(lead.message, { leadId: lead.message });
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .update({ lead_id: leadId })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error) return fail(describeProfileError(error));
    if (!profile) return fail(MESSAGES.userNotFound);

    refresh();
    return ok(`${name} now works in ${lead.name}'s team.`);
  });
}

/** Blocks someone: no data (RLS) and no new sessions (an Auth ban). A lead inspector's team moves first. */
export async function deactivateUser(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deactivateUser", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = UserTargetSchema.safeParse(formFields(formData, ["userId"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { userId } = parsed.data;
    if (userId === auth.user.id) return fail(MESSAGES.selfDeactivate);

    const supabase = await createClient();
    const target = await readPerson(supabase, userId);
    if (target.error) return fail(describeProfileError(target.error));
    if (!target.person) return fail(MESSAGES.userNotFound);
    const name = personName(target.person);
    if (target.teams && target.person.is_lead) {
      const refusal = await refuseWhileLeading(supabase, userId, name);
      if (refusal) return refusal;
    }

    // The profile first: from this moment RLS and the session guard block them.
    const { data: profile, error } = await supabase
      .from("profiles")
      .update({ active: false })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error) return fail(describeProfileError(error));
    if (!profile) return fail(MESSAGES.userNotFound);
    refresh();

    if (!isAdminClientConfigured()) {
      return warn(
        `${name} is deactivated and can no longer see any data, but their sign-in could not be blocked: the server needs SUPABASE_SECRET_KEY.`,
      );
    }
    // Then the ban, so their refresh token stops working.
    const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, {
      ban_duration: BAN_DURATION,
    });
    if (banError) {
      console.error("[admin/users] profile deactivated but the ban failed", banError.code, banError.message);
      return warn(
        `${name} is deactivated and can no longer see any data, but Supabase could not block their sign-in: ${banError.message}`,
      );
    }
    return ok(`${name} is deactivated and has lost access.`);
  });
}

/**
 * Lets someone back in, or activates an account that was never active.
 * Someone whose role needs a lead and who is in no team gets their role and
 * lead here first (rule 6): the dialog asks for them, starting from the role
 * they have.
 */
export async function reactivateUser(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("reactivateUser", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = ActivateSchema.safeParse(formFields(formData, ["userId", "role", "leadId"]));
    if (!parsed.success) return invalid(parsed.error);
    const { userId, role: choice, leadId } = parsed.data;

    const supabase = await createClient();
    const target = await readPerson(supabase, userId);
    if (target.error) return fail(describeProfileError(target.error));
    if (!target.person) return fail(MESSAGES.userNotFound);
    const current = target.person;
    const name = personName(current);
    const level = { role: current.role, isLead: current.is_lead };

    // Settled before the ban is lifted, so a refusal changes nothing.
    let fields: TablesUpdate<"profiles"> = { active: true };
    let placed = "";
    // Only an account being let in: lifting a sign-in block leaves an active
    // inspector from before teams as they are (rule 6 binds changes only).
    const inNoTeam = target.teams && !current.active && accessOf(level) === "own" && !current.lead_id;
    if (inNoTeam) {
      // The role the dialog chose, else the one they have.
      const chosen = await chosenRole(supabase, choice ?? current.role_id ?? roleChoiceOf(level));
      if (!chosen.ok) return chosen.result;
      const placement = await choosePlacement(supabase, chosen.role, leadId ?? null, userId);
      if (!placement.ok) return placement.result;
      fields = { ...placement.fields, active: true };
      placed = ` ${activatedAs(chosen.role, placement.leadName)}`;
    }

    const canLiftBan = isAdminClientConfigured();
    const admin = canLiftBan ? createAdminClient() : null;

    // The ban goes first: until the profile is active as well, RLS and the
    // session guard still block them. A pending account was never banned.
    let unbanned = false;
    if (admin) {
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
      if (authError) {
        console.error("[admin/users] could not read the auth user", authError.code, authError.message);
        return fail(`${name} was not activated: Supabase Auth did not answer (${authError.message}). Try again.`);
      }
      if (isBanned(authUser.user.banned_until)) {
        const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: UNBAN });
        if (unbanError) {
          console.error("[admin/users] could not lift the ban", unbanError.code, unbanError.message);
          return fail(`${name} was not activated: Supabase did not lift their sign-in block (${unbanError.message}).`);
        }
        unbanned = true;
      }
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .update(fields)
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error || !profile) {
      const reason = error ? `${name} was not activated. ${describeProfileError(error)}` : MESSAGES.userNotFound;
      // Put the ban back, so a failed attempt changes nothing.
      if (admin && unbanned) {
        const { error: rebanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION });
        if (rebanError) {
          console.error("[admin/users] activation failed and the ban could not be restored", rebanError.message);
          return fail(
            `${reason} Their sign-in block was lifted and could not be put back, but the account is still inactive, so they see nothing. Try again.`,
          );
        }
      }
      return fail(reason);
    }
    refresh();

    if (!canLiftBan) {
      return warn(
        `${name} is active again.${placed} The server has no SUPABASE_SECRET_KEY, so if their sign-in was blocked before, it still is.`,
      );
    }
    return ok(`${name} is active and can sign in.${placed}`);
  });
}

/** Emails a link to choose a new password: for a lost invite or a forgotten password. */
export async function sendPasswordLink(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("sendPasswordLink", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = UserTargetSchema.safeParse(formFields(formData, ["userId"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));

    // The address comes from the profile, never from the request.
    const supabase = await createClient();
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, active")
      .eq("id", parsed.data.userId)
      .maybeSingle();
    if (error) return fail(describeProfileError(error));
    if (!profile?.email) return fail(MESSAGES.userNotFound);
    const name = personName(profile);
    if (!profile.active) return fail(`${name} cannot sign in until the account is active. Activate it first.`);

    // Sent through the secret-key client when there is one: the admin's own
    // client would start a PKCE flow and leave its code verifier in the
    // admin's cookies. The email link carries a token hash that
    // /auth/confirm verifies on any device either way.
    const mailer = isAdminClientConfigured() ? createAdminClient().auth : supabase.auth;
    const { error: sendError } = await mailer.resetPasswordForEmail(profile.email, {
      redirectTo: authConfirmUrl(),
    });
    if (sendError) {
      console.error("[admin/users] password link refused", sendError.code, sendError.message);
      return fail(describeEmailError(sendError, "password link"));
    }
    return ok(`Password link sent to ${profile.email}.`);
  });
}

/* ------------------------------------------------------------------ *
 * Invitations not yet answered
 * ------------------------------------------------------------------ */

/** Someone invited who has not created their account yet, as their profile says now. */
type Invitee = { id: string; email: string; name: string; active: boolean };

type InviteeRead = { ok: true; invitee: Invitee } | { ok: false; result: ActionResult };

/**
 * The person an invitation action is for, re-read through the admin's own
 * client (RLS lets admins read every profile), their address included: it
 * never comes from the request. Refused once they have created their
 * account; `joined` words that for the action. A project without migration
 * 20261027140000 has nobody invited, and describeProfileError() says what is
 * needed.
 */
async function readInvitee(supabase: Client, userId: string, joined: (name: string) => string): Promise<InviteeRead> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, active, joined_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { ok: false, result: fail(describeProfileError(error)) };
  if (!data?.email) return { ok: false, result: fail(MESSAGES.userNotFound) };
  const name = personName(data);
  if (data.joined_at !== null) return { ok: false, result: fail(joined(name)) };
  return { ok: true, invitee: { id: data.id, email: data.email, name, active: data.active } };
}

/** Joined already: the link they may need is a password link, which the row menu offers as such. */
const joinedForLinks = (name: string) =>
  `${name} has already created their account. If they need a new link, choose Send Password Link next to their name.`;

/** An inactive account cannot use a link: the app turns its session away. */
const inactiveForLinks = (name: string) =>
  `${name}'s account is not active, so a link would not let them in. Choose Activate or Reactivate next to their name first.`;

type SignInRead = { ok: true; email: string; opened: boolean } | { ok: false; result: ActionResult };

/**
 * The invitee's account in Supabase Auth: its address, and whether they have
 * opened the invite (opening it confirms the address). A ban turns every
 * link away, so it is lifted first (Lift Sign-In Block).
 */
async function readSignIn(admin: AdminClient, invitee: Invitee): Promise<SignInRead> {
  const { data, error } = await admin.auth.admin.getUserById(invitee.id);
  if (error) {
    if (isUserGone(error)) return { ok: false, result: fail(MESSAGES.userNotFound) };
    console.error("[admin/users] could not read the auth user", error.code, error.message);
    return { ok: false, result: fail(`Supabase Auth did not answer (${error.message}). Try again.`) };
  }
  if (isBanned(data.user.banned_until)) {
    return {
      ok: false,
      result: fail(`${invitee.name}'s sign-in is blocked, so a link would not let them in. Choose Lift Sign-In Block first.`),
    };
  }
  return { ok: true, email: data.user.email ?? invitee.email, opened: Boolean(data.user.email_confirmed_at) };
}

/** After an email Supabase did not send: a link the admin sends by hand gets round the mailer. */
const COPY_INSTEAD = " Or choose Copy Invite Link and send them the link yourself.";

/**
 * Resend Invite: emails someone invited a new link to create their account.
 * To an address that never opened its invite, Supabase sends the invite
 * again, with a new link (the earlier one stops working). Once they opened
 * it, their address is confirmed and Supabase refuses another invite: a
 * password link goes instead, which signs them in the same way, and the app
 * takes an account that has not joined on to Account Creation.
 */
export async function resendInvite(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("resendInvite", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = UserTargetSchema.safeParse(formFields(formData, ["userId"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    if (!isAdminClientConfigured()) return fail(MESSAGES.missingSecretKey);

    const supabase = await createClient();
    const found = await readInvitee(supabase, parsed.data.userId, joinedForLinks);
    if (!found.ok) return found.result;
    const { invitee } = found;
    if (!invitee.active) return fail(inactiveForLinks(invitee.name));

    const admin = createAdminClient();
    const account = await readSignIn(admin, invitee);
    if (!account.ok) return account.result;

    if (!account.opened) {
      const { error } = await admin.auth.admin.inviteUserByEmail(account.email, { redirectTo: authConfirmUrl() });
      if (!error) return ok(`A new invite went to ${account.email}. The link in the earlier one no longer works.`);
      // Refused as taken: they opened it since the read above, so on to a password link.
      if (!isEmailTaken(error)) {
        console.error("[admin/users] invite not resent", error.code, error.message);
        return fail(describeEmailError(error, "invite") + (linkWouldHelp(error) ? COPY_INSTEAD : ""));
      }
    }

    // Through the secret-key client, as sendPasswordLink: no PKCE code verifier in the admin's cookies.
    const { error } = await admin.auth.resetPasswordForEmail(account.email, { redirectTo: authConfirmUrl() });
    if (error) {
      console.error("[admin/users] password link for an invite refused", error.code, error.message);
      return fail(describeEmailError(error, "password link") + (linkWouldHelp(error) ? COPY_INSTEAD : ""));
    }
    return ok(
      `${invitee.name} opened the invite before without finishing, and Supabase sends an invite only once, so a password link went to ${account.email} instead. From it they go on to create their account.`,
    );
  });
}

/**
 * Copy Invite Link: a new link for someone invited, for the admin to send by
 * WhatsApp or any chat (Supabase's built-in mailer only reaches the
 * project's team, a few emails an hour). Nothing is emailed. Never opened: a
 * new invite link, which stops the emailed one working. Opened without
 * finishing: Supabase refuses another invite, so a magic link, which signs
 * them in the same way. Either works once, within the project's link expiry
 * (an hour: otp_expiry in supabase/config.toml), and only the newest one
 * works. It signs its holder in as the invitee, so it goes back to the admin
 * who asked and nowhere else, never into a log.
 */
export async function createInviteLink(_previous: InviteLinkResult, formData: FormData): Promise<InviteLinkResult> {
  return guarded<InviteLinkResult>("createInviteLink", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = UserTargetSchema.safeParse(formFields(formData, ["userId"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    if (!isAdminClientConfigured()) return fail(MESSAGES.missingSecretKey);

    const supabase = await createClient();
    const found = await readInvitee(supabase, parsed.data.userId, joinedForLinks);
    if (!found.ok) return found.result;
    const { invitee } = found;
    if (!invitee.active) return fail(inactiveForLinks(invitee.name));

    const admin = createAdminClient();
    const account = await readSignIn(admin, invitee);
    if (!account.ok) return account.result;

    let generated = account.opened ? null : await admin.auth.admin.generateLink({ type: "invite", email: account.email });
    // Refused as taken: they opened it since the read above.
    if (!generated || (generated.error && isEmailTaken(generated.error))) {
      generated = await admin.auth.admin.generateLink({ type: "magiclink", email: account.email });
    }
    if (generated.error) {
      console.error("[admin/users] invite link refused", generated.error.code, generated.error.message);
      return fail(describeLinkError(generated.error));
    }
    const { properties, user } = generated.data;
    if (user.id !== invitee.id) {
      // The account went in the meantime (Cancel Invite in another tab), and
      // Supabase made a new one for the address to hold the link: undo that.
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) console.error("[admin/users] an account made for an invite link was not removed", user.id, error.message);
      return fail(MESSAGES.userNotFound);
    }
    const link = inviteLinkUrl(properties);
    if (!link) {
      console.error("[admin/users] Supabase answered an invite link of another kind", properties.verification_type);
      return fail(MESSAGES.unexpected);
    }
    return {
      status: "link",
      link,
      message: `It signs ${invitee.name} in to create their account. It works once, within an hour, and any earlier link no longer works, the one in their invite email included.`,
    };
  });
}

/**
 * Cancel Invite: removes an account nobody has created yet, an invite to a
 * wrong address or one no longer wanted. Deleting the Supabase Auth user
 * takes its profile with it (on delete cascade), so the invite's links stop
 * working and the address can be invited again. Never yourself, never an
 * account someone has created (Deactivate stops those), and an invited lead
 * inspector's team moves first (rule 5; profiles.lead_id refuses the delete
 * too). The database refuses while another row of the app points at the
 * account.
 */
export async function cancelInvite(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("cancelInvite", async () => {
    const auth = await authorize();
    if (!auth.ok) return fail(auth.error);

    const parsed = UserTargetSchema.safeParse(formFields(formData, ["userId"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { userId } = parsed.data;
    if (userId === auth.user.id) return fail(MESSAGES.selfCancel);
    if (!isAdminClientConfigured()) return fail(MESSAGES.missingSecretKey);

    const supabase = await createClient();
    const found = await readInvitee(
      supabase,
      userId,
      (name) =>
        `${name} has already created their account, so there is no invite to cancel. To stop them signing in, choose Deactivate.`,
    );
    if (!found.ok) return found.result;
    const { invitee } = found;

    const { members, error: teamError } = await teamOf(supabase, userId);
    if (teamError && !isMissingTeamColumn(teamError)) return fail(describeProfileError(teamError));
    if (members.length > 0) return fail(TEAM_MESSAGES.leadsTeam(invitee.name, members.map((member) => member.name)));

    const { error } = await createAdminClient().auth.admin.deleteUser(userId);
    // Gone already: another admin cancelled it a moment ago, which is what was asked.
    if (error && !isUserGone(error)) {
      console.error("[admin/users] invite not cancelled", error.code, error.message);
      return fail(describeCancelError(error, invitee.name));
    }
    refresh();
    return ok(`The invite to ${invitee.email} is cancelled: its link no longer works, and the address can be invited again.`);
  });
}
