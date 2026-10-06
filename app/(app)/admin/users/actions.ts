"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { authorizeAction } from "@/lib/auth/session";
import {
  BAN_DURATION,
  ChangeRoleSchema,
  InviteUserSchema,
  MESSAGES,
  UNBAN,
  UserTargetSchema,
  authConfirmUrl,
  describeEmailError,
  describeProfileError,
  displayName,
  findProfileByEmail,
  firstFieldErrors,
  firstIssue,
  formFields,
  isEmailTaken,
  type InviteField,
} from "@/lib/auth/users";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * User management actions for /admin/users. Server Actions are public HTTP
 * endpoints: each one checks the caller is an active admin, validates its
 * input with zod and re-reads what it needs. Profile changes go through the
 * admin's own client, so RLS and the profiles guard (which also keeps one
 * active admin) check them again. Only Auth work (invites, bans, sign-in
 * details) uses the secret key.
 */

export type ActionResult =
  | { status: "idle" }
  | {
      status: "success" | "warning" | "error";
      message: string;
      fieldErrors?: Partial<Record<InviteField, string>>;
    };

const ok = (message: string): ActionResult => ({ status: "success", message });
const warn = (message: string): ActionResult => ({ status: "warning", message });
const fail = (message: string, fieldErrors?: Partial<Record<InviteField, string>>): ActionResult => ({
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

function emailTaken(active: boolean): ActionResult {
  const message = active
    ? "That email already has an account. If they need a new link, choose Send password link next to their name."
    : "That email belongs to an account that is not active. Choose Activate or Reactivate next to their name instead.";
  return fail(message, { email: message });
}

/** Invites someone by email and activates the account the invite creates. */
export async function inviteUser(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("inviteUser", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = InviteUserSchema.safeParse(formFields(formData, ["email", "fullName", "role"]));
    if (!parsed.success) return fail("Check the highlighted fields.", firstFieldErrors(parsed.error));
    const { email, fullName, role } = parsed.data;

    if (!isAdminClientConfigured()) return fail(MESSAGES.missingSecretKey);

    // An invite to an address that never accepted would resend it and could
    // switch a deactivated account back on, so existing accounts stop here.
    const supabase = await createClient();
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
      return fail(describeEmailError(error, "invite"));
    }

    // New accounts start inactive (a safety net should public sign-up ever be
    // switched on). The invite is the admin's decision, so it activates this one.
    const { data: activated, error: activationError } = await admin
      .from("profiles")
      .update({ role, full_name: fullName, active: true })
      .eq("id", data.user.id)
      .select("id");
    refresh();
    if (activationError || !activated?.length) {
      console.error("[admin/users] invite sent but the profile was not activated", activationError);
      return warn(
        `Invite sent to ${email}, but the account could not be activated. Choose Activate next to ${fullName} in the list.`,
      );
    }
    return ok(`Invite sent to ${email}. They choose a password from the link in the email.`);
  });
}

/** Makes someone an inspector or an admin. Admins cannot demote themselves. */
export async function changeRole(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("changeRole", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = ChangeRoleSchema.safeParse(formFields(formData, ["userId", "role"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { userId, role } = parsed.data;
    if (userId === auth.user.id && role !== "admin") return fail(MESSAGES.selfDemote);

    const supabase = await createClient();
    const { data: profile, error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", userId)
      .select("id, email, full_name")
      .maybeSingle();
    if (error) return fail(describeProfileError(error));
    if (!profile) return fail(MESSAGES.userNotFound);

    refresh();
    const name = displayName(profile.full_name, profile.email);
    return ok(role === "admin" ? `${name} is now an admin.` : `${name} is now an inspector.`);
  });
}

/** Blocks someone: no data (RLS) and no new sessions (an Auth ban). */
export async function deactivateUser(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deactivateUser", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = UserTargetSchema.safeParse(formFields(formData, ["userId"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { userId } = parsed.data;
    if (userId === auth.user.id) return fail(MESSAGES.selfDeactivate);

    // The profile first: from this moment RLS and the session guard block them.
    const supabase = await createClient();
    const { data: profile, error } = await supabase
      .from("profiles")
      .update({ active: false })
      .eq("id", userId)
      .select("id, email, full_name")
      .maybeSingle();
    if (error) return fail(describeProfileError(error));
    if (!profile) return fail(MESSAGES.userNotFound);
    refresh();

    const name = displayName(profile.full_name, profile.email);
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

/** Lets someone back in, or activates an account that was never active. */
export async function reactivateUser(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("reactivateUser", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = UserTargetSchema.safeParse(formFields(formData, ["userId"]));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { userId } = parsed.data;

    const supabase = await createClient();
    const { data: current, error: readError } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (readError) return fail(describeProfileError(readError));
    if (!current) return fail(MESSAGES.userNotFound);
    const name = displayName(current.full_name, current.email);

    // The ban goes first: if the profile update then fails, the account stays
    // blocked by RLS and the session guard, never half open.
    const canLiftBan = isAdminClientConfigured();
    if (canLiftBan) {
      const { error: unbanError } = await createAdminClient().auth.admin.updateUserById(userId, {
        ban_duration: UNBAN,
      });
      if (unbanError) {
        console.error("[admin/users] could not lift the ban", unbanError.code, unbanError.message);
        return fail(`${name} could not be reactivated: Supabase did not lift their sign-in block (${unbanError.message}).`);
      }
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .update({ active: true })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error) return fail(describeProfileError(error));
    if (!profile) return fail(MESSAGES.userNotFound);
    refresh();

    if (!canLiftBan) {
      return warn(
        `${name} is active again. The server has no SUPABASE_SECRET_KEY, so if their sign-in was blocked before, it still is.`,
      );
    }
    return ok(`${name} is active and can sign in.`);
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
    const name = displayName(profile.full_name, profile.email);
    if (!profile.active) return fail(`${name} cannot sign in until the account is active. Activate it first.`);

    const { error: sendError } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: authConfirmUrl(),
    });
    if (sendError) {
      console.error("[admin/users] password link refused", sendError.code, sendError.message);
      return fail(describeEmailError(sendError, "password link"));
    }
    return ok(`Password link sent to ${profile.email}.`);
  });
}
