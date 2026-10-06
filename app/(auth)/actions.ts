"use server";

import { isAuthRetryableFetchError, isAuthSessionMissingError, isAuthWeakPasswordError, type AuthError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  fieldErrors,
  ForgotPasswordSchema,
  MESSAGES,
  ResetPasswordSchema,
  SignInSchema,
  type ForgotPasswordState,
  type ResetPasswordField,
  type ResetPasswordState,
  type SignInField,
  type SignInState,
} from "@/lib/auth/forms";
import { HOME_PATH, safeNextPath } from "@/lib/auth/routes";
import { authorizeAction, getSession } from "@/lib/auth/session";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Actions for the sign-in screens. Each is a public POST endpoint:
 * input is parsed with the zod schemas in lib/auth/forms.ts, and replies are
 * worded so they never reveal whether an account exists.
 *
 * signIn and requestPasswordReset serve signed-out visitors, so there is no
 * session to authorise; the credentials and the email link are the check.
 * updatePassword needs the session an invite or reset link creates.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
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
    supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) return failed(signInFailure(error));
  } catch {
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
  redirect(safeNextPath(parsed.data.next));
}

/**
 * Wrong email, wrong password, banned (deactivated) and unconfirmed accounts
 * all read the same, so the form cannot be used to find out who has an
 * account. Supabase reports a ban before it checks the password.
 */
function signInFailure(error: AuthError): string {
  const status = error.status ?? 0;
  if (status === 429) return MESSAGES.signInRateLimited;
  if (status === 0 || status >= 500 || isAuthRetryableFetchError(error)) return MESSAGES.serviceUnavailable;
  return MESSAGES.invalidCredentials;
}

/** The same check as lib/auth/session.ts, on the client that just signed in. */
async function profileStatus(supabase: SupabaseServerClient): Promise<"active" | "blocked" | "unknown"> {
  try {
    const { data, error } = await supabase.rpc("my_profile_status");
    if (error) return "unknown";
    const status = data?.[0];
    return status?.active ? "active" : "blocked";
  } catch {
    return "unknown";
  }
}

async function signOutQuietly(supabase: SupabaseServerClient): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The cookies are cleared locally even when the revoke call fails.
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
    return { status: "error", attempt, email: text(formData, "email").trim(), fieldErrors: fieldErrors<"email">(parsed.error) };
  }
  const { email } = parsed.data;
  if (!isSupabaseConfigured()) return { status: "error", attempt, email, message: MESSAGES.notConfigured };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/auth/confirm`,
    });
    if (error && isRequestRateLimit(error)) {
      return { status: "error", attempt, email, message: MESSAGES.resetRateLimited };
    }
  } catch {
    // Same answer whatever happened: see below.
  }

  // Unknown addresses, refused emails and server errors all get this reply.
  return { status: "sent", attempt, email };
}

/**
 * Supabase answers an unknown address with success and only reaches its email
 * limits (one email per address per minute, the hourly quota) for real
 * accounts. So only the per-IP request limit, which every address hits alike,
 * may show as "too many requests"; the email limits get the usual reply.
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
    // getSession() is cached per request: this reads the result authorizeAction used.
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
  } catch {
    return { status: "error", attempt, message: MESSAGES.updateFailed };
  }

  revalidatePath("/", "layout");
  redirect(HOME_PATH);
}

function updateFailure(error: AuthError): Pick<ResetPasswordState, "message" | "fieldErrors" | "expired"> {
  if (error.status === 429) return { message: MESSAGES.updateRateLimited };
  if (error.code === "same_password") return { fieldErrors: { password: MESSAGES.samePassword } };
  if (isAuthWeakPasswordError(error)) {
    return { fieldErrors: { password: error.reasons.includes("pwned") ? MESSAGES.pwnedPassword : MESSAGES.weakPassword } };
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
  return { message: MESSAGES.updateFailed };
}
