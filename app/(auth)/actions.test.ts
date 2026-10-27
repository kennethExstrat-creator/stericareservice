import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  INITIAL_CREATE_ACCOUNT_STATE,
  INITIAL_FORGOT_PASSWORD_STATE,
  INITIAL_RESET_PASSWORD_STATE,
  INITIAL_SIGN_IN_STATE,
  MESSAGES,
} from "@/lib/auth/forms";
import type { ActionAuth, SessionState } from "@/lib/auth/session";

// redirect() ends a Server Action by throwing; the stand-in does the same so
// the tests can see where it pointed.
const { Redirect, mocks } = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  return {
    Redirect,
    mocks: {
      createClient: vi.fn(),
      createAuthClient: vi.fn(),
      authorizeAction: vi.fn(),
      getSession: vi.fn(),
      isSupabaseConfigured: vi.fn(),
      revalidatePath: vi.fn(),
      refresh: vi.fn(),
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient, createAuthClient: mocks.createAuthClient }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  authorizeAction: mocks.authorizeAction,
  getSession: mocks.getSession,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, refresh: mocks.refresh }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { createAccount, requestPasswordReset, signIn, updatePassword } = await import("./actions");

const PASSWORD = "Glove-check-2026";
const INSPECTOR = { id: "user-1", email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" as const };

/** JWT claims of a session; by default one a reset link started ten seconds ago. */
function claims(method = "otp", ageSeconds = 10) {
  return { data: { claims: { sub: INSPECTOR.id, amr: [{ method, timestamp: Date.now() / 1000 - ageSeconds }] } }, error: null };
}

/**
 * The user's Supabase server client (createClient), whose calls succeed unless
 * a test says otherwise: my_profile_status() finds an active inspector,
 * complete_account() saves.
 */
function fakeSupabase() {
  return {
    auth: {
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: { user: { id: INSPECTOR.id } }, error: null })),
      getClaims: vi.fn(async () => claims()),
    },
    rpc: vi.fn(async (name: string) =>
      name === "complete_account"
        ? { data: null, error: null }
        : { data: [{ active: true, role: "inspector" }], error: null },
    ),
  };
}

/** The auth API createAuthClient hands out for signed-out visitors (secret key, visitor's address). */
function fakeAuthApi() {
  return {
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: INSPECTOR.id }, session: {} }, error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
  };
}

let supabase: ReturnType<typeof fakeSupabase>;
let authApi: ReturnType<typeof fakeAuthApi>;
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = fakeSupabase();
  authApi = fakeAuthApi();
  mocks.createClient.mockResolvedValue(supabase);
  mocks.createAuthClient.mockResolvedValue(authApi);
  mocks.isSupabaseConfigured.mockReturnValue(true);
  mocks.authorizeAction.mockResolvedValue({ ok: true, user: INSPECTOR } satisfies ActionAuth);
  mocks.getSession.mockResolvedValue({ status: "active", user: INSPECTOR } satisfies SessionState);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qc.example.com/");
  // The actions log unexpected failures; keep the test output clean and check what they say.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  consoleError.mockRestore();
});

/** Everything the actions logged, as one string. */
function logged(): string {
  return consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Runs an action that should end in a redirect and returns where it went. */
async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof Redirect)) throw new Error(`expected a redirect, got ${String(error)}`);
  return error.url;
}

describe("signIn", () => {
  const credentials = { email: " Inspector@Test.Local ", password: PASSWORD };

  it("signs in through the auth client, checks the profile as the user and follows a safe next", async () => {
    const url = await redirectOf(signIn(INITIAL_SIGN_IN_STATE, form({ ...credentials, next: "/inspections/abc?tab=visual" })));

    expect(url).toBe("/inspections/abc?tab=visual");
    expect(authApi.signInWithPassword).toHaveBeenCalledWith({ email: "inspector@test.local", password: PASSWORD });
    expect(supabase.rpc).toHaveBeenCalledWith("my_profile_status");
    // The user's client comes after sign-in, so it reads the session sign-in stored.
    const [signedIn] = authApi.signInWithPassword.mock.invocationCallOrder;
    const [userClient] = mocks.createClient.mock.invocationCallOrder;
    expect(userClient).toBeGreaterThan(signedIn);
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["no next", undefined],
    ["an empty next", ""],
    ["another site", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["the sign-in screen itself", "/login"],
    // Dot segments collapse to "//evil.example" after safeNextPath's own "//" check.
    ["a dot segment before //", "/.//evil.example"],
    ["a parent segment before //", "/..//evil.example"],
    ["an encoded dot segment", "/%2e//evil.example"],
    ["a folder and parent segment", "/x/..//evil.example"],
  ])("goes to /inspections for %s", async (_label, next) => {
    const fields = next === undefined ? credentials : { ...credentials, next };
    expect(await redirectOf(signIn(INITIAL_SIGN_IN_STATE, form(fields)))).toBe("/inspections");
  });

  it("says only that the email or password is wrong, keeping the email", async () => {
    authApi.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    } as never);

    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));

    expect(state).toEqual({
      status: "error",
      attempt: 1,
      email: "inspector@test.local",
      message: "Email or password is incorrect.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["a banned (deactivated) account", new AuthApiError("User is banned", 400, "user_banned")],
    ["an unconfirmed email", new AuthApiError("Email not confirmed", 400, "email_not_confirmed")],
    ["a rejected email format", new AuthApiError("Unable to validate email address", 400, "validation_failed")],
  ])("gives %s the same generic answer", async (_label, error) => {
    authApi.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error } as never);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.invalidCredentials);
  });

  it("signs straight out again when the profile is deactivated", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [{ active: false, role: "inspector" }], error: null });

    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));

    expect(state.message).toBe("This account has been deactivated. Ask your SteriCare administrator.");
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("treats a missing profile like a deactivated one", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.deactivated);
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("signs out and asks to retry when the profile cannot be checked", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } } as never);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.profileCheckFailed);
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("explains a rate limit (429)", async () => {
    authApi.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
    } as never);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe("Too many sign-in attempts. Wait a few minutes, then try again.");
  });

  it.each([
    ["the network fails", new AuthRetryableFetchError("fetch failed", 0)],
    ["Supabase answers 503", new AuthRetryableFetchError("Service Unavailable", 503)],
    ["Supabase answers 500", new AuthApiError("Database error querying schema", 500, "unexpected_failure")],
  ])("does not blame the password when %s", async (_label, error) => {
    authApi.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error } as never);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.serviceUnavailable);
  });

  it("gives a status no wrong password produces (an API key Supabase refuses) the generic answer too", async () => {
    authApi.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError("Invalid API key", 401, undefined),
    } as never);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.invalidCredentials);
  });

  it("survives an auth client that throws", async () => {
    mocks.createAuthClient.mockRejectedValueOnce(new Error("boom"));
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.serviceUnavailable);
  });

  it("survives the user's client failing after sign-in", async () => {
    mocks.createClient.mockRejectedValueOnce(new Error("boom"));
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.serviceUnavailable);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses politely while Supabase is not configured", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(state.message).toBe(MESSAGES.notConfigured);
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("validates before calling Supabase, keeping what was typed", async () => {
    const state = await signIn(INITIAL_SIGN_IN_STATE, form({ email: " not-an-email ", password: "" }));
    expect(state).toEqual({
      status: "error",
      attempt: 1,
      email: "not-an-email",
      fieldErrors: { email: MESSAGES.emailInvalid, password: MESSAGES.passwordRequired },
    });
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("counts attempts, so the same message is announced again", async () => {
    const first = await signIn(INITIAL_SIGN_IN_STATE, form({ email: "", password: "" }));
    const second = await signIn(first, form({ email: "", password: "" }));
    expect([first.attempt, second.attempt]).toEqual([1, 2]);
  });
});

describe("requestPasswordReset", () => {
  it("asks Supabase for a reset email that lands on /auth/confirm", async () => {
    const state = await requestPasswordReset(INITIAL_FORGOT_PASSWORD_STATE, form({ email: " Kenneth@Example.com " }));

    expect(authApi.resetPasswordForEmail).toHaveBeenCalledWith("kenneth@example.com", {
      redirectTo: "https://qc.example.com/auth/confirm",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(state).toEqual({ status: "sent", attempt: 1, email: "kenneth@example.com" });
  });

  it.each([
    ["an unknown address (Supabase answers success)", null],
    ["a refused address", new AuthApiError("Email address not authorized", 400, "email_address_not_authorized")],
    [
      "the per-address resend limit",
      new AuthApiError("For security purposes, you can only request this after 42 seconds.", 429, "over_email_send_rate_limit"),
    ],
    ["a mailer failure", new AuthApiError("Error sending recovery email", 500, "unexpected_failure")],
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
  ])("gives the same confirmation for %s", async (_label, error) => {
    authApi.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error } as never);
    const state = await requestPasswordReset(INITIAL_FORGOT_PASSWORD_STATE, form({ email: "someone@test.local" }));
    expect(state).toEqual({ status: "sent", attempt: 1, email: "someone@test.local" });
    expect(MESSAGES.resetSent).toBe("If an account exists for that email, a reset link is on its way.");
  });

  it("still confirms when the auth client throws", async () => {
    mocks.createAuthClient.mockRejectedValueOnce(new Error("boom"));
    const state = await requestPasswordReset(INITIAL_FORGOT_PASSWORD_STATE, form({ email: "someone@test.local" }));
    expect(state.status).toBe("sent");
  });

  it("explains the request rate limit, which every address hits alike", async () => {
    authApi.resetPasswordForEmail.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
    } as never);
    const state = await requestPasswordReset(INITIAL_FORGOT_PASSWORD_STATE, form({ email: "someone@test.local" }));
    expect(state).toMatchObject({ status: "error", message: MESSAGES.resetRateLimited });
  });

  it("validates the email without calling Supabase", async () => {
    const state = await requestPasswordReset(INITIAL_FORGOT_PASSWORD_STATE, form({ email: "someone" }));
    expect(state).toEqual({ status: "error", attempt: 1, email: "someone", fieldErrors: { email: MESSAGES.emailInvalid } });
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
  });

  it("refuses politely while Supabase is not configured", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    const state = await requestPasswordReset(INITIAL_FORGOT_PASSWORD_STATE, form({ email: "someone@test.local" }));
    expect(state.message).toBe(MESSAGES.notConfigured);
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
  });
});

describe("updatePassword", () => {
  const passwords = { password: PASSWORD, confirm: PASSWORD };

  it("saves the password for the signed-in user and goes to the inspections list", async () => {
    const url = await redirectOf(updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords)));

    expect(url).toBe("/inspections");
    expect(mocks.authorizeAction).toHaveBeenCalledWith();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("requires the session from the email link", async () => {
    mocks.authorizeAction.mockResolvedValueOnce({ ok: false, error: "Your session has ended. Sign in again." });
    mocks.getSession.mockResolvedValueOnce({ status: "signed-out" });

    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords));

    expect(state).toEqual({ status: "error", attempt: 1, message: MESSAGES.linkExpired, expired: true });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses a deactivated account", async () => {
    mocks.authorizeAction.mockResolvedValueOnce({ ok: false, error: "This account has been deactivated." });
    mocks.getSession.mockResolvedValueOnce({ status: "deactivated", userId: INSPECTOR.id });

    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords));

    expect(state).toEqual({ status: "error", attempt: 1, message: MESSAGES.deactivated });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("checks the session before it looks at the input", async () => {
    mocks.authorizeAction.mockResolvedValueOnce({ ok: false, error: "Your session has ended. Sign in again." });
    mocks.getSession.mockResolvedValueOnce({ status: "signed-out" });
    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form({ password: "x", confirm: "y" }));
    expect(state.fieldErrors).toBeUndefined();
    expect(state.expired).toBe(true);
  });

  it("holds the new password to the policy on the server", async () => {
    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form({ password: "abcdefghij", confirm: "abcdefghij" }));
    expect(state).toEqual({ status: "error", attempt: 1, fieldErrors: { password: MESSAGES.passwordNeedsMix } });
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("catches a mismatched confirmation", async () => {
    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form({ password: PASSWORD, confirm: `${PASSWORD}!` }));
    expect(state.fieldErrors).toEqual({ confirm: MESSAGES.confirmMismatch });
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  const expired = { message: MESSAGES.linkExpired, expired: true };
  it.each([
    [
      "the current password",
      new AuthApiError("New password should be different from the old password.", 422, "same_password"),
      { fieldErrors: { password: MESSAGES.samePassword } },
    ],
    [
      "a breached password",
      new AuthWeakPasswordError("Password is known to be weak", 422, ["pwned"]),
      { fieldErrors: { password: MESSAGES.pwnedPassword } },
    ],
    [
      "a stricter project policy",
      new AuthWeakPasswordError("Password should contain…", 422, ["characters"]),
      { fieldErrors: { password: MESSAGES.weakPassword } },
    ],
    ["a lost session", new AuthSessionMissingError(), expired],
    ["an expired session", new AuthApiError("Session not found", 403, "session_not_found"), expired],
    [
      "a rate limit",
      new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
      { message: MESSAGES.updateRateLimited },
    ],
    ["a server error", new AuthApiError("Database error", 500, "unexpected_failure"), { message: MESSAGES.updateFailed }],
  ])("explains %s", async (_label, error, expected) => {
    supabase.auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error } as never);
    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords));
    expect(state).toEqual({ status: "error", attempt: 1, ...expected });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("survives a client that throws while checking the link", async () => {
    mocks.createClient.mockRejectedValueOnce(new Error("boom"));
    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords));
    expect(state.message).toBe(MESSAGES.updateFailed);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("survives a client that throws while saving", async () => {
    mocks.createClient.mockResolvedValueOnce(supabase).mockRejectedValueOnce(new Error("boom"));
    const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords));
    expect(state.message).toBe(MESSAGES.updateFailed);
    expect(logged()).toContain("password update failed: Error: boom");
  });

  describe("needs a session that an invite or reset link started in the last hour", () => {
    it.each([
      ["a password sign-in", claims("password", 10)],
      ["a link opened over an hour ago", claims("otp", 60 * 60 + 5)],
      ["a session without an amr claim", { data: { claims: { sub: INSPECTOR.id } }, error: null }],
      ["claims that do not verify", { data: null, error: new AuthApiError("invalid JWT", 401, "bad_jwt") }],
    ])("refuses %s and re-renders the page", async (_label, result) => {
      supabase.auth.getClaims.mockResolvedValueOnce(result as never);

      const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords));

      expect(state).toEqual({ status: "error", attempt: 1, message: MESSAGES.linkSessionRequired });
      expect(mocks.refresh).toHaveBeenCalled();
      expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    });

    it("checks it before it looks at the input", async () => {
      supabase.auth.getClaims.mockResolvedValueOnce(claims("password", 10) as never);
      const state = await updatePassword(INITIAL_RESET_PASSWORD_STATE, form({ password: "x", confirm: "y" }));
      expect(state.fieldErrors).toBeUndefined();
      expect(state.message).toBe(MESSAGES.linkSessionRequired);
    });

    it("accepts an invite or reset link opened 59 minutes ago", async () => {
      supabase.auth.getClaims.mockResolvedValueOnce(claims("otp", 59 * 60) as never);
      expect(await redirectOf(updatePassword(INITIAL_RESET_PASSWORD_STATE, form(passwords)))).toBe("/inspections");
    });
  });
});

describe("createAccount", () => {
  // Invited by an admin, signed in by the invitation link a moment ago, not joined yet.
  const INVITEE = { id: "user-2", email: "nora.new@test.local", fullName: null, role: "inspector" as const, joined: false };
  const details = { fullName: "  Nora   New ", phone: " +60 12-345 6789 ", password: PASSWORD, confirm: PASSWORD };
  const typed = { fullName: details.fullName, phone: details.phone };
  const samePassword = new AuthApiError("New password should be different from the old password.", 422, "same_password");

  /** complete_account's reply when the database refuses it, as PostgREST sends it (a plain object). */
  function refused(code: string, message: string) {
    return { data: null, error: { code, message, details: "Failing row contains (Nora New, +60 12-345 6789)", hint: "" } };
  }

  function saved() {
    return supabase.rpc.mock.calls.filter(([name]) => name === "complete_account");
  }

  beforeEach(() => {
    mocks.authorizeAction.mockResolvedValue({ ok: true, user: INVITEE } satisfies ActionAuth);
    mocks.getSession.mockResolvedValue({ status: "active", user: INVITEE } satisfies SessionState);
  });

  it("sets the password, saves the details as the user, then opens the inspections list signed in", async () => {
    const url = await redirectOf(createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details)));

    expect(url).toBe("/inspections");
    expect(mocks.authorizeAction).toHaveBeenCalledWith();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    // On one line each, as the admin's dialogs save them.
    expect(supabase.rpc).toHaveBeenCalledWith("complete_account", { p_full_name: "Nora New", p_phone: "+60 12-345 6789" });
    // The password first: should the details fail, the retry finds it set.
    const [passwordSet] = supabase.auth.updateUser.mock.invocationCallOrder;
    const [detailsSaved] = supabase.rpc.mock.invocationCallOrder;
    expect(detailsSaved).toBeGreaterThan(passwordSet);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    // No sign-in: the session the invitation link started is the user's.
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin", { role: "admin" as const }, "/admin"],
    ["a lead inspector", { role: "inspector" as const, isLead: true }, "/inspections"],
  ])("takes %s to their dashboard", async (_label, placement, dashboard) => {
    mocks.authorizeAction.mockResolvedValue({ ok: true, user: { ...INVITEE, ...placement } } satisfies ActionAuth);
    expect(await redirectOf(createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details)))).toBe(dashboard);
  });

  it("goes on to the details when a retry finds the password set already (same_password)", async () => {
    supabase.auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error: samePassword } as never);
    expect(await redirectOf(createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details)))).toBe("/inspections");
    expect(saved()).toHaveLength(1);
  });

  it("keeps the name and phone when the details are not saved, and the retry goes through", async () => {
    supabase.rpc.mockResolvedValueOnce(
      refused("PGRST202", "Could not find the function public.complete_account(p_full_name, p_phone) in the schema cache") as never,
    );

    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));

    expect(state).toEqual({ status: "error", attempt: 1, ...typed, message: MESSAGES.createFailed });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    // The password is set now: Supabase answers same_password, which is no error here.
    supabase.auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error: samePassword } as never);
    expect(await redirectOf(createAccount(state, form(details)))).toBe("/inspections");
    expect(saved()).toHaveLength(2);
  });

  it("shows a phone number the database refuses at the phone field", async () => {
    supabase.rpc.mockResolvedValueOnce(
      refused("23514", 'new row for relation "profiles" violates check constraint "profiles_phone_format"') as never,
    );
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));
    expect(state).toEqual({ status: "error", attempt: 1, ...typed, fieldErrors: { phone: MESSAGES.phoneRefused } });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["a name", "a name is needed", { fullName: MESSAGES.nameRequired }],
    ["a phone number", "a phone number is needed", { phone: MESSAGES.phoneRefused }],
  ])("shows %s the database finds blank at its field", async (_label, message, expected) => {
    supabase.rpc.mockResolvedValueOnce(refused("23514", message) as never);
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));
    expect(state.fieldErrors).toEqual(expected);
  });

  it.each([
    [
      "a breached password",
      new AuthWeakPasswordError("Password is known to be weak", 422, ["pwned"]),
      { fieldErrors: { password: MESSAGES.pwnedPassword } },
    ],
    [
      "a stricter project policy",
      new AuthWeakPasswordError("Password should contain…", 422, ["characters"]),
      { fieldErrors: { password: MESSAGES.weakPassword } },
    ],
    [
      "a rate limit",
      new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
      { message: MESSAGES.updateRateLimited },
    ],
    ["a lost session", new AuthSessionMissingError(), { message: MESSAGES.linkExpired, expired: true }],
    ["a server error", new AuthApiError("Database error", 500, "unexpected_failure"), { message: MESSAGES.updateFailed }],
  ])("explains %s like the reset form, and saves no details", async (_label, error, expected) => {
    supabase.auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error } as never);
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));
    expect(state).toEqual({ status: "error", attempt: 1, ...typed, ...expected });
    expect(saved()).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("checks every field before calling Supabase, keeping the name and phone as typed", async () => {
    const fields = { fullName: " ", phone: "12345", password: "abcdefghij", confirm: "abcdefghik" };
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(fields));
    expect(state).toEqual({
      status: "error",
      attempt: 1,
      fullName: " ",
      phone: "12345",
      fieldErrors: {
        fullName: MESSAGES.nameRequired,
        phone: expect.stringContaining("Enter a phone number"),
        password: MESSAGES.passwordNeedsMix,
        confirm: MESSAGES.confirmMismatch,
      },
    });
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it("says the invitation link has expired when the session is gone, before looking at the input", async () => {
    mocks.authorizeAction.mockResolvedValueOnce({ ok: false, error: "Your session has ended. Sign in again." });
    mocks.getSession.mockResolvedValueOnce({ status: "signed-out" });

    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form({ ...details, phone: "x" }));

    expect(state).toEqual({ status: "error", attempt: 1, ...typed, phone: "x", message: MESSAGES.linkExpired, expired: true });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses a deactivated account", async () => {
    mocks.authorizeAction.mockResolvedValueOnce({ ok: false, error: "This account has been deactivated." });
    mocks.getSession.mockResolvedValueOnce({ status: "deactivated", userId: INVITEE.id });
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));
    expect(state).toEqual({ status: "error", attempt: 1, ...typed, message: MESSAGES.deactivated });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["an invitation link opened over an hour ago", claims("otp", 60 * 60 + 5)],
    ["a password sign-in", claims("password", 10)],
  ])("refuses %s, changes nothing and re-renders the page", async (_label, result) => {
    supabase.auth.getClaims.mockResolvedValueOnce(result as never);

    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));

    expect(state).toEqual({ status: "error", attempt: 1, ...typed, message: MESSAGES.invitationLinkRequired });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it("sends an account created already to its dashboard, changing nothing", async () => {
    mocks.authorizeAction.mockResolvedValueOnce({ ok: true, user: { ...INVITEE, role: "admin", joined: true } } satisfies ActionAuth);
    expect(await redirectOf(createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details)))).toBe("/admin");
    expect(supabase.auth.getClaims).not.toHaveBeenCalled();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("logs a refused save by its code and never the name, phone or email", async () => {
    supabase.rpc.mockResolvedValueOnce(refused("42501", "no active account to create") as never);
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));
    expect(state.message).toBe(MESSAGES.createFailed);
    expect(logged()).toContain("[auth] account details failed: code 42501, no active account to create");
    expect(logged()).not.toMatch(/Nora|6789|nora\.new/);
  });

  it("survives a client that throws while saving the details", async () => {
    supabase.rpc.mockRejectedValueOnce(new Error("fetch failed"));
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));
    expect(state).toEqual({ status: "error", attempt: 1, ...typed, message: MESSAGES.createFailed });
    expect(logged()).toContain("[auth] account details failed: Error: fetch failed");
  });

  it("survives a client that throws while setting the password", async () => {
    // The first client checks the link; the second sets the password.
    mocks.createClient.mockResolvedValueOnce(supabase).mockRejectedValueOnce(new Error("boom"));
    const state = await createAccount(INITIAL_CREATE_ACCOUNT_STATE, form(details));
    expect(state.message).toBe(MESSAGES.createFailed);
    expect(saved()).toHaveLength(0);
  });
});

describe("server log", () => {
  const credentials = { email: "inspector@test.local", password: PASSWORD };

  it("records unexpected sign-in failures by status and code, never the email", async () => {
    authApi.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError("Service Unavailable", 503),
    } as never);
    await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(logged()).toContain("[auth] sign-in failed: status 503");
    expect(logged()).not.toContain("inspector@test.local");
  });

  it("keeps quiet about a plain wrong password", async () => {
    authApi.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    } as never);
    await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("records a sign-in refused for a reason no password causes, such as the API key", async () => {
    authApi.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError("Invalid API key", 401, undefined),
    } as never);
    await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(logged()).toContain("[auth] sign-in failed: status 401");
    expect(logged()).not.toContain("inspector@test.local");
  });

  it("records the user's client failing after sign-in", async () => {
    mocks.createClient.mockRejectedValueOnce(new Error("boom"));
    await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(logged()).toContain("[auth] sign-in failed: Error: boom");
  });

  it("records a full mail quota while the form still says sent", async () => {
    authApi.resetPasswordForEmail.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit"),
    } as never);
    const state = await requestPasswordReset(INITIAL_FORGOT_PASSWORD_STATE, form({ email: "someone@test.local" }));
    expect(state.status).toBe("sent");
    expect(logged()).toContain("[auth] reset request failed: status 429, code over_email_send_rate_limit");
    expect(logged()).not.toContain("someone@test.local");
  });

  it("records a failed profile check", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } } as never);
    await signIn(INITIAL_SIGN_IN_STATE, form(credentials));
    expect(logged()).toContain("[auth] profile check failed");
  });
});
