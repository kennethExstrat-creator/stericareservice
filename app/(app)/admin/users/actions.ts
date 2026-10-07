"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { needsLead, placementFor, roleChoiceOf, TEAM_MESSAGES, type Placement, type RoleChoice } from "@/lib/auth/org";
import { authorizeAction } from "@/lib/auth/session";
import { checkLead, personName, readPerson, teamOf, teamsReady } from "@/lib/auth/team";
import {
  ActivateSchema,
  AssignLeadSchema,
  BAN_DURATION,
  ChangeRoleSchema,
  InviteUserSchema,
  MESSAGES,
  UNBAN,
  UserTargetSchema,
  authConfirmUrl,
  describeEmailError,
  describeProfileError,
  findProfileByEmail,
  firstFieldErrors,
  firstIssue,
  formFields,
  isBanned,
  isEmailRejected,
  isEmailTaken,
  isUntouched,
  type UserField,
} from "@/lib/auth/users";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * User management actions for /admin/users. Server Actions are public HTTP
 * endpoints: each one checks the caller is an active admin, validates its
 * input with zod and re-reads what it needs. Profile changes go through the
 * admin's own client, so RLS and the profiles guards (which keep one active
 * admin and the lead inspector rules) check them again. Only Auth work
 * (invites, bans, sign-in details) uses the secret key.
 *
 * Lead inspectors (lib/auth/org.ts): an inspector who is not a lead works in
 * an active lead inspector's team, so making someone an inspector, inviting
 * one or activating one asks for their lead; someone who leads a team stays a
 * lead until it has moved. On a project without migration 20261007170000 the
 * actions work with roles only, as before.
 */

type FieldErrors = Partial<Record<UserField, string>>;

export type ActionResult =
  | { status: "idle" }
  | {
      status: "success" | "warning" | "error";
      message: string;
      fieldErrors?: FieldErrors;
    };

const ok = (message: string): ActionResult => ({ status: "success", message });
const warn = (message: string): ActionResult => ({ status: "warning", message });
const fail = (message: string, fieldErrors?: FieldErrors): ActionResult => ({
  status: "error",
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

/** Unexpected failures become a message on the form instead of an error page. */
async function guarded(name: string, run: () => Promise<ActionResult>): Promise<ActionResult> {
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

function emailTaken(active: boolean): ActionResult {
  const message = active
    ? "That email already has an account. If they need a new link, choose Send password link next to their name."
    : "That email belongs to an account that is not active. Choose Activate or Reactivate next to their name instead.";
  return fail(message, { email: message });
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** Where someone will work: the columns to store, and their lead's name. */
type PlacementCheck =
  | { ok: true; fields: Partial<Placement> & Pick<Placement, "role">; leadName: string | null }
  | { ok: false; result: ActionResult };

/**
 * The role an admin chose, checked against the team rules before anything
 * changes: an inspector needs an active lead inspector who is someone else.
 * Without the lead inspector columns (a project that has not run migration
 * 20261007170000) only the role is stored, as before lead inspectors.
 */
async function choosePlacement(
  supabase: Client,
  choice: RoleChoice,
  leadId: string | null,
  userId: string | null,
): Promise<PlacementCheck> {
  const teams = await teamsReady(supabase);
  if (teams.error) return { ok: false, result: fail(describeProfileError(teams.error)) };
  if (!teams.ready) {
    if (choice === "lead") {
      return { ok: false, result: fail(TEAM_MESSAGES.teamsMissing, { role: TEAM_MESSAGES.teamsMissing }) };
    }
    return { ok: true, fields: { role: choice === "admin" ? "admin" : "inspector" }, leadName: null };
  }
  if (!needsLead(choice)) return { ok: true, fields: placementFor(choice, null), leadName: null };
  if (!leadId) return { ok: false, result: fail(TEAM_MESSAGES.chooseLead, { leadId: TEAM_MESSAGES.chooseLead }) };

  const lead = await checkLead(supabase, leadId, userId);
  if (!lead.ok) {
    if (lead.error) console.error("[admin/users] the lead inspector could not be read", lead.error);
    return { ok: false, result: fail(lead.message, { leadId: lead.message }) };
  }
  return { ok: true, fields: placementFor("inspector", leadId), leadName: lead.name };
}

/** Rule 5: someone who leads a team stays a lead inspector until it has moved. Null when their team is empty. */
async function refuseWhileLeading(supabase: Client, leadId: string, name: string): Promise<ActionResult | null> {
  const { members, error } = await teamOf(supabase, leadId);
  if (error) return fail(describeProfileError(error));
  if (members.length === 0) return null;
  return fail(TEAM_MESSAGES.leadsTeam(name, members.map((member) => member.name)));
}

function placedMessage(name: string, choice: RoleChoice, leadName: string | null): string {
  switch (choice) {
    case "admin":
      return `${name} is now an admin.`;
    case "lead":
      return `${name} is now a lead inspector.`;
    case "inspector":
      return leadName ? `${name} is now an inspector in ${leadName}'s team.` : `${name} is now an inspector.`;
  }
}

/** The second sentence after an activation that placed someone. */
function activatedAs(choice: RoleChoice, leadName: string | null): string {
  switch (choice) {
    case "admin":
      return "They are an admin.";
    case "lead":
      return "They are a lead inspector.";
    case "inspector":
      return leadName ? `They work in ${leadName}'s team.` : "They are an inspector.";
  }
}

/** Invites someone by email and activates the account the invite creates, in the role (and team) chosen. */
export async function inviteUser(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("inviteUser", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = InviteUserSchema.safeParse(formFields(formData, ["email", "fullName", "role", "leadId"]));
    if (!parsed.success) return fail("Check the highlighted fields.", firstFieldErrors(parsed.error) as FieldErrors);
    const { email, fullName, role, leadId } = parsed.data;

    if (!isAdminClientConfigured()) return fail(MESSAGES.missingSecretKey);

    // Where they will work, settled before any email goes out.
    const supabase = await createClient();
    const placement = await choosePlacement(supabase, role, leadId ?? null, null);
    if (!placement.ok) return placement.result;

    // An invite to an address that never accepted would resend it and could
    // switch a deactivated account back on, so existing accounts stop here.
    const existing = await findProfileByEmail(supabase, email);
    if (existing) return emailTaken(existing.active);

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: authConfirmUrl(),
    });
    if (error) {
      if (isEmailTaken(error)) return emailTaken(true);
      console.error("[admin/users] invite refused", error.code, error.message);
      const message = describeEmailError(error, "invite");
      // A refused address belongs next to the field the admin typed it in.
      return isEmailRejected(error) ? fail(message, { email: message }) : fail(message);
    }

    // New accounts start inactive (a safety net should public sign-up ever be
    // switched on). The invite is the admin's decision, so it activates the
    // account it created. Supabase answers an invite to an address that has
    // an unconfirmed account by sending it again, so only a profile nobody has
    // handled yet is changed: one an admin deactivated stays deactivated.
    const { data: created, error: readError } = await admin
      .from("profiles")
      .select("id, active, created_at, updated_at")
      .eq("id", data.user.id)
      .maybeSingle();
    if (created && !readError && !isUntouched(created)) return emailTaken(created.active);

    const { data: activated, error: activationError } = created
      ? await admin
          .from("profiles")
          .update({ ...placement.fields, full_name: fullName, active: true })
          .eq("id", created.id)
          // Unchanged since the read above, or the update matches nothing.
          .eq("updated_at", created.updated_at)
          .select("id")
      : { data: null, error: readError };
    refresh();
    if (activationError || !activated?.length) {
      console.error("[admin/users] invite sent but the profile was not activated", activationError);
      // The profile stays as sign-up made it, so the list shows it as pending.
      const next =
        role === "inspector"
          ? `Choose Activate next to ${fullName}.`
          : `Choose Activate next to ${fullName}, then make them ${role === "admin" ? "an admin" : "a lead inspector"}.`;
      return warn(`Invite sent to ${email}, but the account could not be activated. ${next}`);
    }
    const team = placement.leadName ? ` They work in ${placement.leadName}'s team.` : "";
    return ok(`Invite sent to ${email}. They choose a password from the link in the email.${team}`);
  });
}

/** Makes someone an inspector in a lead's team, a lead inspector or an admin. Admins cannot demote themselves. */
export async function changeRole(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("changeRole", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = ChangeRoleSchema.safeParse(formFields(formData, ["userId", "role", "leadId"]));
    if (!parsed.success) return invalid(parsed.error);
    const { userId, role, leadId } = parsed.data;
    if (userId === auth.user.id && role !== "admin") return fail(MESSAGES.selfDemote);

    const supabase = await createClient();
    const target = await readPerson(supabase, userId);
    if (target.error) return fail(describeProfileError(target.error));
    if (!target.person) return fail(MESSAGES.userNotFound);
    const name = personName(target.person);

    const placement = await choosePlacement(supabase, role, leadId ?? null, userId);
    if (!placement.ok) return placement.result;
    if (target.teams && target.person.is_lead && role !== "lead") {
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

/** Moves an inspector to another lead inspector's team. */
export async function assignLead(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("assignLead", async () => {
    const auth = await authorizeAction("admin");
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
    const choice = roleChoiceOf({ role: target.person.role, isLead: target.person.is_lead });
    if (choice !== "inspector") return fail(TEAM_MESSAGES.inNoTeam(name, choice));

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
    const auth = await authorizeAction("admin");
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
 * Lets someone back in, or activates an account that was never active. An
 * inspector who is in no team gets their role and lead here first (rule 6):
 * the dialog asks for them.
 */
export async function reactivateUser(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("reactivateUser", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = ActivateSchema.safeParse(formFields(formData, ["userId", "role", "leadId"]));
    if (!parsed.success) return invalid(parsed.error);
    const { userId, role, leadId } = parsed.data;

    const supabase = await createClient();
    const target = await readPerson(supabase, userId);
    if (target.error) return fail(describeProfileError(target.error));
    if (!target.person) return fail(MESSAGES.userNotFound);
    const current = target.person;
    const name = personName(current);

    // Settled before the ban is lifted, so a refusal changes nothing.
    let fields: TablesUpdate<"profiles"> = { active: true };
    let placed = "";
    const inNoTeam =
      target.teams && roleChoiceOf({ role: current.role, isLead: current.is_lead }) === "inspector" && !current.lead_id;
    if (inNoTeam) {
      const choice = role ?? "inspector";
      const placement = await choosePlacement(supabase, choice, leadId ?? null, userId);
      if (!placement.ok) return placement.result;
      fields = { ...placement.fields, active: true };
      placed = ` ${activatedAs(choice, placement.leadName)}`;
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
    const auth = await authorizeAction("admin");
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
