import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));

import { refresh } from "next/cache";
import { authorizeAction } from "@/lib/auth/session";
import { MESSAGES } from "@/lib/auth/users";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  changeRole,
  deactivateUser,
  inviteUser,
  reactivateUser,
  sendPasswordLink,
  type ActionResult,
} from "./actions";

const SELF = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NEW = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";
const IDLE: ActionResult = { status: "idle" };

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the test's responder returns for it.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type Responder = (query: Query) => Result;

const OK_EMPTY: Result = { data: null, error: null };

function fakeClient(respond: Responder = () => OK_EMPTY) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "ilike", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => {
      query.calls.push(["maybeSingle", []]);
      return Promise.resolve(respond(query));
    };
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  });
  const auth = {
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    admin: {
      inviteUserByEmail: vi.fn().mockResolvedValue({ data: { user: { id: NEW } }, error: null }),
      updateUserById: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
    },
  };
  return { client: { from, auth }, queries };
}

/** The argument of the first call to `method` in a query, e.g. the update payload. */
function arg(query: Query | undefined, method: string): unknown {
  return query?.calls.find(([name]) => name === method)?.[1][0];
}
const hasCall = (query: Query | undefined, method: string, ...args: unknown[]) =>
  query?.calls.some(([name, callArgs]) => name === method && JSON.stringify(callArgs) === JSON.stringify(args)) ?? false;
const isUpdate = (query: Query) => query.calls.some(([name]) => name === "update");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const inviteForm = (overrides: Record<string, string> = {}) =>
  form({ email: "  Jane.Tan@Example.com ", fullName: " Jane Tan ", role: "admin", ...overrides });

let userClient: ReturnType<typeof fakeClient>;
let adminClient: ReturnType<typeof fakeClient>;

function useClients(user: Responder, admin: Responder = () => OK_EMPTY) {
  userClient = fakeClient(user);
  adminClient = fakeClient(admin);
  vi.mocked(createClient).mockResolvedValue(userClient.client as never);
  vi.mocked(createAdminClient).mockReturnValue(adminClient.client as never);
}

const profile = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  email: "olga@test.local",
  full_name: "Olga Other",
  ...extra,
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qc.example.com");
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: SELF, email: "admin@test.local", fullName: "Test Admin", role: "admin" },
  });
  vi.mocked(isAdminClientConfigured).mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  useClients(() => OK_EMPTY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("every action", () => {
  const calls: Array<[string, () => Promise<ActionResult>]> = [
    ["inviteUser", () => inviteUser(IDLE, inviteForm())],
    ["changeRole", () => changeRole(IDLE, form({ userId: OTHER, role: "admin" }))],
    ["deactivateUser", () => deactivateUser(IDLE, form({ userId: OTHER }))],
    ["reactivateUser", () => reactivateUser(IDLE, form({ userId: OTHER }))],
    ["sendPasswordLink", () => sendPasswordLink(IDLE, form({ userId: OTHER }))],
  ];

  it.each(calls)("%s refuses anyone who is not an active admin", async (_name, run) => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });

    expect(await run()).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith("admin");
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(calls.slice(1))("%s refuses a user id that is not a uuid", async (name) => {
    const action = { changeRole, deactivateUser, reactivateUser, sendPasswordLink }[name]!;
    const result = await action(IDLE, form({ userId: "1 or 1=1", role: "admin" }));
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("could not be found") });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("turns an unexpected failure into a message instead of an error page", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("fetch failed"));
    expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toEqual({ status: "error", message: MESSAGES.unexpected });
  });
});

describe("inviteUser", () => {
  it("invites through the admin client, then activates the new profile with its role and name", async () => {
    useClients(
      () => ({ data: [], error: null }), // nobody has the address yet
      (query) => (isUpdate(query) ? { data: [{ id: NEW }], error: null } : OK_EMPTY),
    );

    const result = await inviteUser(IDLE, inviteForm());

    expect(result).toEqual({
      status: "success",
      message: "Invite sent to jane.tan@example.com. They choose a password from the link in the email.",
    });
    expect(adminClient.client.auth.admin.inviteUserByEmail).toHaveBeenCalledWith("jane.tan@example.com", {
      data: { full_name: "Jane Tan" },
      redirectTo: "https://qc.example.com/auth/confirm",
    });
    const update = adminClient.queries.find(isUpdate);
    expect(update?.table).toBe("profiles");
    expect(arg(update, "update")).toEqual({ role: "admin", full_name: "Jane Tan", active: true });
    expect(hasCall(update, "eq", "id", NEW)).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says so plainly when the invite went out but the account could not be activated", async () => {
    useClients(
      () => ({ data: [], error: null }),
      (query) => (isUpdate(query) ? { data: null, error: { code: "57014", message: "statement timeout" } } : OK_EMPTY),
    );

    const result = await inviteUser(IDLE, inviteForm());

    expect(result).toEqual({
      status: "warning",
      message:
        "Invite sent to jane.tan@example.com, but the account could not be activated. Choose Activate next to Jane Tan in the list.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("treats an update that touched no row as not activated", async () => {
    useClients(() => ({ data: [], error: null }), (query) => (isUpdate(query) ? { data: [], error: null } : OK_EMPTY));
    expect((await inviteUser(IDLE, inviteForm())).status).toBe("warning");
  });

  it("is switched off without the secret key, before touching Supabase", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    expect(await inviteUser(IDLE, inviteForm())).toEqual({ status: "error", message: MESSAGES.missingSecretKey });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("explains a mailer that refuses the address, and points at custom SMTP", async () => {
    useClients(() => ({ data: [], error: null }));
    adminClient.client.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthApiError",
        code: "email_address_not_authorized",
        status: 400,
        message: 'Email address "e2e-users-x@test.local" cannot be used as it is not authorized',
      },
    });

    const result = await inviteUser(IDLE, inviteForm({ email: "e2e-users-x@test.local" }));

    expect(result.status).toBe("error");
    expect(result).toMatchObject({ message: expect.stringContaining("The invite email could not be sent") });
    expect(result).toMatchObject({ message: expect.stringContaining("custom SMTP") });
    expect(adminClient.queries.some(isUpdate)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops at an address that already has an account, without sending anything", async () => {
    useClients(() => ({ data: [{ id: OTHER, active: true }], error: null }));

    const result = await inviteUser(IDLE, inviteForm());

    expect(result).toMatchObject({ status: "error", fieldErrors: { email: expect.stringContaining("already has an account") } });
    expect(adminClient.client.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("points a deactivated address at Reactivate", async () => {
    useClients(() => ({ data: [{ id: OTHER, active: false }], error: null }));
    const result = await inviteUser(IDLE, inviteForm());
    expect(result).toMatchObject({ fieldErrors: { email: expect.stringContaining("Reactivate") } });
  });

  it("maps Auth's own duplicate error to the same message", async () => {
    useClients(() => ({ data: [], error: null }));
    adminClient.client.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" },
    });
    expect(await inviteUser(IDLE, inviteForm())).toMatchObject({
      fieldErrors: { email: expect.stringContaining("already has an account") },
    });
  });

  it("returns field errors and sends nothing for an invalid form", async () => {
    const result = await inviteUser(IDLE, form({ email: "jane@", fullName: "", role: "owner" }));

    expect(result).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        email: "Enter a valid email address, like name@example.com.",
        fullName: "Enter their full name.",
        role: "Choose Inspector or Admin.",
      },
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("changeRole", () => {
  it("updates the role through the admin's own client, so RLS applies", async () => {
    useClients(() => ({ data: profile(OTHER), error: null }));

    const result = await changeRole(IDLE, form({ userId: OTHER, role: "admin" }));

    expect(result).toEqual({ status: "success", message: "Olga Other is now an admin." });
    const update = userClient.queries.find(isUpdate);
    expect(arg(update, "update")).toEqual({ role: "admin" });
    expect(hasCall(update, "eq", "id", OTHER)).toBe(true);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refuses to let admins demote themselves", async () => {
    expect(await changeRole(IDLE, form({ userId: SELF, role: "inspector" }))).toEqual({
      status: "error",
      message: MESSAGES.selfDemote,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("surfaces the database's last-admin rule in plain words", async () => {
    useClients(() => ({ data: null, error: { code: "23514", message: "cannot remove the last active admin" } }));

    expect(await changeRole(IDLE, form({ userId: OTHER, role: "inspector" }))).toEqual({
      status: "error",
      message: "This would leave the app without an active admin. Make someone else an admin first.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says when the user no longer exists", async () => {
    useClients(() => ({ data: null, error: null }));
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "inspector" }))).toEqual({
      status: "error",
      message: MESSAGES.userNotFound,
    });
  });
});

describe("deactivateUser", () => {
  it("deactivates the profile, then bans the auth user", async () => {
    useClients(() => ({ data: profile(OTHER), error: null }));

    const result = await deactivateUser(IDLE, form({ userId: OTHER }));

    expect(result).toEqual({ status: "success", message: "Olga Other is deactivated and has lost access." });
    expect(arg(userClient.queries.find(isUpdate), "update")).toEqual({ active: false });
    expect(adminClient.client.auth.admin.updateUserById).toHaveBeenCalledWith(OTHER, { ban_duration: "876000h" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refuses to let admins deactivate themselves", async () => {
    expect(await deactivateUser(IDLE, form({ userId: SELF }))).toEqual({
      status: "error",
      message: MESSAGES.selfDeactivate,
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("surfaces the last-admin rule and never bans", async () => {
    useClients(() => ({ data: null, error: { code: "23514", message: "cannot remove the last active admin" } }));

    expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toEqual({ status: "error", message: MESSAGES.lastAdmin });
    expect(adminClient.client.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("warns when the data is blocked but the sign-in could not be", async () => {
    useClients(() => ({ data: profile(OTHER), error: null }));
    adminClient.client.auth.admin.updateUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 500, message: "Database error updating user" },
    });

    const result = await deactivateUser(IDLE, form({ userId: OTHER }));

    expect(result).toEqual({
      status: "warning",
      message:
        "Olga Other is deactivated and can no longer see any data, but Supabase could not block their sign-in: Database error updating user",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("still blocks the data without the secret key, and says the sign-in stays open", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    useClients(() => ({ data: profile(OTHER), error: null }));

    const result = await deactivateUser(IDLE, form({ userId: OTHER }));

    expect(result).toMatchObject({ status: "warning", message: expect.stringContaining("SUPABASE_SECRET_KEY") });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("reactivateUser", () => {
  it("lifts the ban before activating the profile", async () => {
    useClients((query) => ({ data: isUpdate(query) ? { id: OTHER } : profile(OTHER), error: null }));

    const result = await reactivateUser(IDLE, form({ userId: OTHER }));

    expect(result).toEqual({ status: "success", message: "Olga Other is active and can sign in." });
    expect(adminClient.client.auth.admin.updateUserById).toHaveBeenCalledWith(OTHER, { ban_duration: "none" });
    const update = userClient.queries.find(isUpdate);
    expect(arg(update, "update")).toEqual({ active: true });
    const unbannedAt = adminClient.client.auth.admin.updateUserById.mock.invocationCallOrder[0];
    const updatedAt = userClient.client.from.mock.invocationCallOrder[userClient.queries.indexOf(update!)];
    expect(unbannedAt).toBeLessThan(updatedAt);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("leaves the account blocked when the ban cannot be lifted", async () => {
    useClients(() => ({ data: profile(OTHER), error: null }));
    adminClient.client.auth.admin.updateUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 404, message: "User not found" },
    });

    const result = await reactivateUser(IDLE, form({ userId: OTHER }));

    expect(result).toEqual({
      status: "error",
      message: "Olga Other could not be reactivated: Supabase did not lift their sign-in block (User not found).",
    });
    expect(userClient.queries.some(isUpdate)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("sendPasswordLink", () => {
  it("emails the address on the profile, with the confirm route as redirect", async () => {
    useClients(() => ({ data: profile(OTHER, { active: true }), error: null }));

    const result = await sendPasswordLink(IDLE, form({ userId: OTHER, email: "attacker@example.com" }));

    expect(result).toEqual({ status: "success", message: "Password link sent to olga@test.local." });
    expect(userClient.client.auth.resetPasswordForEmail).toHaveBeenCalledWith("olga@test.local", {
      redirectTo: "https://qc.example.com/auth/confirm",
    });
  });

  it("refuses accounts that cannot sign in", async () => {
    useClients(() => ({ data: profile(OTHER, { active: false }), error: null }));
    expect(await sendPasswordLink(IDLE, form({ userId: OTHER }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("Activate it first"),
    });
    expect(userClient.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("explains a refused email", async () => {
    useClients(() => ({ data: profile(OTHER, { active: true }), error: null }));
    userClient.client.auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" },
    });
    expect(await sendPasswordLink(IDLE, form({ userId: OTHER }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("email limit for this hour"),
    });
  });
});
