"use server";

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
  type AuthError,
  type PostgrestError,
} from "@supabase/supabase-js";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CreateAccountSchema,
  fieldErrors,
  ForgotPasswordSchema,
  MESSAGES,
  ResetPasswordSchema,
  SignInSchema,
  type CreateAccountField,
  type CreateAccountState,
  type ForgotPasswordState,
  type ResetPasswordField,
  type ResetPasswordState,
  type SignInField,
  type SignInState,
} from "@/lib/auth/forms";
import { HOME_PATH, safeNextPath } from "@/lib/auth/routes";
import { authorizeAction, getSession, hasJoined } from "@/lib/auth/session";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { createAuthClient, createClient } from "@/lib/supabase/server";
import { dashboardPathFor } from "./dashboard-path";
import { sessionStartedByRecentLink } from "./link-session";

/**
 * Server Actions for the sign-in screens. Each is a public POST endpoint:
 * input is parsed with the zod schemas in lib/auth/forms.ts, and replies are
 * worded so they never reveal whether an account exists.
 *
 * signIn and requestPasswordReset serve signed-out visitors, so there is no
 * session to authorise; the credentials and the email link are the check.
 * They call Supabase Auth through createAuthClient(), which counts each
 * visitor against their own sign-in limit rather than everyone against the
 * server's. updatePassword and createAccount call authorizeAction() first and
 * then also want a session that an invitation or reset link started
 * (./link-session.ts: hardening of this app's screens, not a boundary
 * Supabase Auth enforces).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Server log for failures the user only sees as a generic message: the HTTP
 * status and Supabase's error code, never the email address, a name, a phone
 * number or a password.
 */
function logFailure(step: string, error: unknown): void {
  if (isAuthError(error)) {
    console.error(`[auth] ${step} failed: status ${error.status ?? "none"}, code ${error.code ?? error.name}`);
  } else if (error instanceof Error) {
    console.error(`[auth] ${step} failed: ${error.name}: ${error.message}`);
  } else if (isDatabaseError(error)) {
    // PostgREST's reply is a plain object. Its code and message, never its
    // details, which can quote the row.
    console.error(`[auth] ${step} failed: code ${error.code ?? "none"}, ${error.message}`);
  } else {
    console.error(`[auth] ${step} failed: ${String(error)}`);
  }
}

function isDatabaseError(error: unknown): error is { code?: string; message: string } {
  return typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string";
}

// ---- Sign in ---------------------------------------------------------------

export async function signIn(previous: SignInState, formData: FormData): Promise<SignInState> {
  const attempt = previous.attempt + 1;
  const email = text(formData, "email").trim();

  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });
  if (!parsed.success) {
    return { status: "error", attempt, email, fieldErrors: fieldErrors<SignInField>(parsed.error) };
  }
  if (!isSupabaseConfigured()) return { status: "error", attempt, email, message: MESSAGES.notConfigured };

  const failed = (message: string): SignInState => ({ status: "error", attempt, email: parsed.data.email, message });

  let supabase: SupabaseServerClient;
  try {
    const auth = await createAuthClient();
    const { error } = await auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) return failed(signInFailure(error));
    // From here on the user's own client, which reads the session sign-in has
    // just stored in the cookies.
    supabase = await createClient();
  } catch (error) {
    logFailure("sign-in", error);
    return failed(MESSAGES.serviceUnavailable);
  }

  // The password was right; now the account itself. A deactivated user, or one
  // without a profile, must not keep the session that sign-in just created.
  const profile = await profileStatus(supabase);
  if (profile !== "active") {
    await signOutQuietly(supabase);
    return failed(profile === "blocked" ? MESSAGES.deactivated : MESSAGES.profileCheckFailed);
  }

  // A shared iPad may have cached another inspector's pages: start fresh.
  revalidatePath("/", "layout");
  redirect(destinationAfterSignIn(parsed.data.next));
}

/**
 * Where sign-in leads: ?next= when it is a path on this site, else the
 * inspections list. safeNextPath used to let "/.//evil.example" through as
 * "//evil.example" (another site to a browser); main has fixed that, and this
 * second check stays as defence in depth.
 */
function destinationAfterSignIn(next: string | null | undefined): string {
  const path = safeNextPath(next);
  return path.startsWith("/") && !path.startsWith("//") ? path : HOME_PATH;
}

/**
 * Wrong email, wrong password, banned (deactivated) and unconfirmed accounts
 * all read the same, so the form cannot be used to find out who has an
 * account. Supabase reports a ban before it checks the password.
 */
function signInFailure(error: AuthError): string {
  const status = error.status ?? 0;
  if (status === 429) {
    logFailure("sign-in", error);
    return MESSAGES.signInRateLimited;
  }
  if (status === 0 || status >= 500 || isAuthRetryableFetchError(error)) {
    logFailure("sign-in", error);
    return MESSAGES.serviceUnavailable;
  }
  // Wrong credentials come back as 400 (422 for a malformed email). Anything
  // else, such as a 401 for an API key Supabase refuses, is a setup problem:
  // logged, while the visitor still learns nothing about the account.
  if (status !== 400 && status !== 422) logFailure("sign-in", error);
  return MESSAGES.invalidCredentials;
}

/** The same check as lib/auth/session.ts, on the client that just signed in. */
async function profileStatus(supabase: SupabaseServerClient): Promise<"active" | "blocked" | "unknown"> {
  try {
    const { data, error } = await supabase.rpc("my_profile_status");
    if (error) {
      logFailure("profile check", error);
      return "unknown";
    }
    const status = data?.[0];
    return status?.active ? "active" : "blocked";
  } catch (error) {
    logFailure("profile check", error);
    return "unknown";
  }
}

/**
 * Ends the session sign-in just created. A local sign-out clears the cookies
 * even when Supabase cannot revoke the session; if anything were left, the
 * session guard (lib/auth/session.ts) still turns the account away on the next
 * request and clears it through /auth/sign-out.
 */
async function signOutQuietly(supabase: SupabaseServerClient): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) logFailure("sign-out after the profile check", error);
  } catch (error) {
    logFailure("sign-out after the profile check", error);
  }
}

// ---- Forgot password -------------------------------------------------------

export async function requestPasswordReset(
  previous: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const attempt = previous.attempt + 1;
  const parsed = ForgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    const typed = text(formData, "email").trim();
    return { status: "error", attempt, email: typed, fieldErrors: fieldErrors<"email">(parsed.error) };
  }
  const { email } = parsed.data;
  if (!isSupabaseConfigured()) return { status: "error", attempt, email, message: MESSAGES.notConfigured };

  try {
    const auth = await createAuthClient();
    const { error } = await auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/auth/confirm`,
    });
    if (error) {
      // Logged even when the user is told "sent": a full mail quota or a broken
      // mailer must not fail silently.
      logFailure("reset request", error);
      if (isRequestRateLimit(error)) return { status: "error", attempt, email, message: MESSAGES.resetRateLimited };
    }
  } catch (error) {
    logFailure("reset request", error);
  }

  // Unknown addresses, refused emails and server errors all get this reply.
  return { status: "sent", attempt, email };
}

/**
 * Supabase answers an unknown address with plain success, while its email
 * limits (one email per address a minute, the mailer's hourly quota) are only
 * reached when it is about to send, that is for a real account. An email-limit
 * error could therefore reveal that the account exists, so it gets the usual
 * reply; only the per-IP request limit, which every address hits alike, shows
 * as "too many requests".
 */
function isRequestRateLimit(error: AuthError): boolean {
  return error.status === 429 && error.code !== "over_email_send_rate_limit";
}

// ---- Reset (or first set) password -----------------------------------------

export async function updatePassword(
  previous: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const attempt = previous.attempt + 1;

  const auth = await authorizeAction();
  if (!auth.ok) {
    // Only on this failure path: look again to tell an expired link from a
    // blocked account. (React's cache() does not memoise inside Server Actions,
    // so this repeats the session check rather than reading a cached result.)
    const session = await getSession();
    if (session.status === "signed-out") {
      return { status: "error", attempt, message: MESSAGES.linkExpired, expired: true };
    }
    return {
      status: "error",
      attempt,
      message: session.status === "deactivated" ? MESSAGES.deactivated : auth.error,
    };
  }

  // This app sets passwords only from a link opened in the last hour, not from a
  // password session (UI hardening: see ./link-session.ts). refresh() re-renders
  // the page, which then explains this and offers to sign out.
  let fromRecentLink: boolean;
  try {
    fromRecentLink = await sessionStartedByRecentLink();
  } catch (error) {
    logFailure("link session check", error);
    return { status: "error", attempt, message: MESSAGES.updateFailed };
  }
  if (!fromRecentLink) {
    refresh();
    return { status: "error", attempt, message: MESSAGES.linkSessionRequired };
  }

  const parsed = ResetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { status: "error", attempt, fieldErrors: fieldErrors<ResetPasswordField>(parsed.error) };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return { status: "error", attempt, ...updateFailure(error) };
  } catch (error) {
    logFailure("password update", error);
    return { status: "error", attempt, message: MESSAGES.updateFailed };
  }

  revalidatePath("/", "layout");
  redirect(HOME_PATH);
}

function updateFailure(error: AuthError): Pick<ResetPasswordState, "message" | "fieldErrors" | "expired"> {
  if (error.status === 429) {
    logFailure("password update", error);
    return { message: MESSAGES.updateRateLimited };
  }
  if (error.code === "same_password") return { fieldErrors: { password: MESSAGES.samePassword } };
  if (isAuthWeakPasswordError(error)) {
    const breached = error.reasons.includes("pwned");
    return { fieldErrors: { password: breached ? MESSAGES.pwnedPassword : MESSAGES.weakPassword } };
  }
  if (
    isAuthSessionMissingError(error) ||
    error.status === 401 ||
    error.status === 403 ||
    error.code === "session_not_found" ||
    error.code === "session_expired"
  ) {
    return { message: MESSAGES.linkExpired, expired: true };
  }
  logFailure("password update", error);
  return { message: MESSAGES.updateFailed };
}

// ---- Create account (the answer to an invitation) --------------------------

/**
 * Account Creation (/create-account, Kenneth, 27 October 2026): the invited
 * person's name, phone and first password. The invitation link has signed
 * them in already (/auth/confirm), so there is no sign-in step: the session
 * is the "auto login", and the redirect takes it to their dashboard. The role
 * is the one the admin chose; nothing here changes it.
 *
 * The password goes first, through Supabase Auth; then complete_account()
 * saves the name and phone and marks the account joined, as the user. Should
 * that second step fail, the password is set already: the retry gets
 * same_password for it, which here means done, and goes on to the details.
 */
export async function createAccount(previous: CreateAccountState, formData: FormData): Promise<CreateAccountState> {
  const attempt = previous.attempt + 1;
  const typed = { fullName: text(formData, "fullName"), phone: text(formData, "phone") };
  const failed = (reply: Pick<CreateAccountState, "message" | "fieldErrors" | "expired">): CreateAccountState => ({
    status: "error",
    attempt,
    ...typed,
    ...reply,
  });

  // The one action someone who has not joined yet may call.
  const auth = await authorizeAction(undefined, { allowUnjoined: true });
  if (!auth.ok) {
    // As updatePassword: look again to tell an expired link from a blocked account.
    const session = await getSession();
    if (session.status === "signed-out") return failed({ message: MESSAGES.linkExpired, expired: true });
    return failed({ message: session.status === "deactivated" ? MESSAGES.deactivated : auth.error });
  }

  // Created already (a second tab, the back button): nothing changes; on to their dashboard.
  if (hasJoined(auth.user)) redirect(dashboardPathFor(auth.user.role));

  // Only from an invitation (or reset) link opened in the last hour, as
  // updatePassword. refresh() re-renders the page, which then says to ask for
  // the invitation again.
  let fromRecentLink: boolean;
  try {
    fromRecentLink = await sessionStartedByRecentLink();
  } catch (error) {
    logFailure("link session check", error);
    return failed({ message: MESSAGES.createFailed });
  }
  if (!fromRecentLink) {
    refresh();
    return failed({ message: MESSAGES.invitationLinkRequired });
  }

  const parsed = CreateAccountSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return failed({ fieldErrors: fieldErrors<CreateAccountField>(parsed.error) });
  const { fullName, phone, password } = parsed.data;

  let supabase: SupabaseServerClient;
  try {
    supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error && error.code !== "same_password") return failed(updateFailure(error));
  } catch (error) {
    logFailure("password update", error);
    return failed({ message: MESSAGES.createFailed });
  }

  try {
    const { error } = await supabase.rpc("complete_account", { p_full_name: fullName, p_phone: phone });
    if (error) return failed(accountDetailsFailure(error));
  } catch (error) {
    logFailure("account details", error);
    return failed({ message: MESSAGES.createFailed });
  }

  // As after sign-in: a shared iPad may have cached another inspector's pages.
  revalidatePath("/", "layout");
  redirect(dashboardPathFor(auth.user.role));
}

/**
 * complete_account() checks the name and phone again: 23514 is a blank one,
 * or a phone number the database refuses (profiles_phone_format), shown at
 * its field. Anything else (42501: signed out or deactivated meanwhile, the
 * function missing on the project) is logged and gets a plain message; the
 * retry then finds the real reason, or succeeds.
 */
function accountDetailsFailure(error: PostgrestError): Pick<CreateAccountState, "message" | "fieldErrors"> {
  if (error.code === "23514") {
    // complete_account's own wording ("a name is needed", "a phone number is
    // needed") or the check constraint's name ("profiles_phone_format").
    return /name/.test(error.message)
      ? { fieldErrors: { fullName: MESSAGES.nameRequired } }
      : { fieldErrors: { phone: MESSAGES.phoneRefused } };
  }
  logFailure("account details", error);
  return { message: MESSAGES.createFailed };
}
