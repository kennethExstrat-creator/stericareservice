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
  assignLead,
  cancelInvite,
  changeRole,
  createInviteLink,
  deactivateUser,
  editUserDetails,
  inviteUser,
  reactivateUser,
  resendInvite,
  sendPasswordLink,
  type ActionResult,
} from "./actions";

const SELF = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NEW = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";
const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const LEAD_TWO = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
const MEMBER = "3d4e5f60-7182-4c9d-8e0f-2a3b4c5d6e7f";
/** Invited and activated, not joined yet: no name, and no password. */
const INVITED = "4e5f6071-8293-4d0e-9f1a-3b4c5d6e7f80";
/** Someone with a custom role that sees every inspection. */
const QUINN = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
const IDLE: ActionResult = { status: "idle" };
/** At the role field when no active lead inspector other than the person exists: the lead picker is empty. */
const NOBODY = "Nobody can lead them yet. Choose Lead Inspector or Admin, or make someone a lead inspector first.";

/** The roles (public.roles): the built-in ones, and a custom role for each access. */
const ADMIN_ROLE = "11111111-1111-4111-8111-111111111111";
const LEAD_ROLE = "22222222-2222-4222-8222-222222222222";
const INSPECTOR_ROLE = "33333333-3333-4333-8333-333333333333";
const REVIEWER_ROLE = "44444444-4444-4444-8444-444444444444";
const SENIOR_ROLE = "55555555-5555-4555-8555-555555555555";
const FIELD_ROLE = "66666666-6666-4666-8666-666666666666";
/** A role's id nobody has: deleted since the page loaded. */
const GONE_ROLE = "77777777-7777-4777-8777-777777777777";

/* ------------------------------------------------------------------ *
 * A fake Supabase: one profiles table and the roles, which the admin's
 * client and the secret-key client both read and write, with every query
 * recorded. Like the profiles guard, writing a role_id gives role and
 * is_lead the role's access.
 * ------------------------------------------------------------------ */

type Access = "own" | "team" | "all";
type RoleRow = { id: string; built_in: "admin" | "lead" | "inspector" | null; name: string; access: Access };

const ROLE_ROWS: readonly RoleRow[] = [
  { id: ADMIN_ROLE, built_in: "admin", name: "Admin", access: "all" },
  { id: LEAD_ROLE, built_in: "lead", name: "Lead Inspector", access: "team" },
  { id: INSPECTOR_ROLE, built_in: "inspector", name: "Inspector", access: "own" },
  { id: REVIEWER_ROLE, built_in: null, name: "QA Reviewer", access: "all" },
  { id: SENIOR_ROLE, built_in: null, name: "Senior Lead", access: "team" },
  { id: FIELD_ROLE, built_in: null, name: "Field Inspector", access: "own" },
];

type Row = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: "inspector" | "admin";
  active: boolean;
  is_lead: boolean;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
  joined_at: string | null;
  role_id: string;
};

type Query = { client: "user" | "admin"; table: string; calls: Array<[string, unknown[]]> };
type Failure = { code?: string; message: string };

const CREATED = "2026-10-01T00:00:00.123456+00:00";

function row(id: string, email: string, fullName: string | null, extra: Partial<Row> = {}): Row {
  return {
    id,
    email,
    full_name: fullName,
    phone: null,
    role: "inspector",
    active: true,
    is_lead: false,
    lead_id: null,
    created_at: CREATED,
    updated_at: "2026-10-02T00:00:00Z",
    joined_at: "2026-10-02T00:00:00Z",
    role_id: INSPECTOR_ROLE,
    ...extra,
  };
}

let rows: Map<string, Row>;
let queries: Query[];
/** False: a project that has not run migration 20261007170000. */
let teams: boolean;
/** False: a project that has not run migration 20261027140000 (phones and joined_at). */
let accounts: boolean;
/** False: a project that has not run migration 20261027150000 (roles). */
let roles: boolean;
/** Makes the matching operations fail: updates, reads, only the count of lead inspectors, or the roles. */
let failures: { update?: Failure; read?: Failure; leads?: Failure; roles?: Failure };
/** What is_full_admin() answers. */
let fullAdmin: { data: boolean | null; error: Failure | null };

const MISSING_READ = { code: "42703", message: "column profiles.is_lead does not exist" };
const MISSING_WRITE = { code: "PGRST204", message: "Could not find the 'is_lead' column of 'profiles' in the schema cache" };
const MISSING_ACCOUNT_READ = { code: "42703", message: "column profiles.phone does not exist" };
const MISSING_ACCOUNT_WRITE = { code: "PGRST204", message: "Could not find the 'phone' column of 'profiles' in the schema cache" };
const MISSING_ROLE_READ = { code: "42703", message: "column profiles.role_id does not exist" };
const MISSING_ROLE_WRITE = { code: "PGRST204", message: "Could not find the 'role_id' column of 'profiles' in the schema cache" };
const NO_ROLES_TABLE = { code: "PGRST205", message: "Could not find the table 'public.roles' in the schema cache" };

function project<T extends object>(source: T | undefined, columns: string): Record<string, unknown> | null {
  if (!source) return null;
  return Object.fromEntries(columns.split(",").map((name) => [name.trim(), source[name.trim() as keyof T]]));
}

function fakeClient(kind: "user" | "admin") {
  const from = vi.fn((table: string) => {
    expect(["profiles", "roles"]).toContain(table);
    const query: Query = { client: kind, table, calls: [] };
    queries.push(query);
    const arg = (method: string) => query.calls.find(([name]) => name === method)?.[1];
    const eqs = () => query.calls.filter(([name]) => name === "eq").map(([, args]) => args as [string, unknown]);

    /** public.roles: read only, by id or by kind. */
    function readRoles(single: boolean): { data: unknown; error: unknown } {
      if (!roles) return { data: null, error: NO_ROLES_TABLE };
      if (failures.roles) return { data: null, error: failures.roles };
      const found = ROLE_ROWS.filter((candidate) => eqs().every(([column, value]) => candidate[column as keyof RoleRow] === value));
      const data = found.map((target) => project(target, String(arg("select")?.[0] ?? "")));
      return { data: single ? (data[0] ?? null) : data, error: null };
    }

    function run(single: boolean): { data: unknown; error: unknown } {
      if (table === "roles") return readRoles(single);
      const columns = String(arg("select")?.[0] ?? "");
      const update = arg("update")?.[0] as Partial<Row> | undefined;
      const touchesTeams =
        /is_lead|lead_id/.test(columns) ||
        eqs().some(([column]) => /is_lead|lead_id/.test(column)) ||
        (update && ("is_lead" in update || "lead_id" in update));
      if (!teams && touchesTeams) return { data: null, error: update ? MISSING_WRITE : MISSING_READ };
      const touchesAccounts = /phone|joined_at/.test(columns) || (update && ("phone" in update || "joined_at" in update));
      if (!accounts && touchesAccounts) return { data: null, error: update ? MISSING_ACCOUNT_WRITE : MISSING_ACCOUNT_READ };
      const touchesRoles = /role_id/.test(columns) || (update && "role_id" in update);
      if (!roles && touchesRoles) return { data: null, error: update ? MISSING_ROLE_WRITE : MISSING_ROLE_READ };

      const matching = [...rows.values()].filter((candidate) =>
        eqs().every(([column, value]) => candidate[column as keyof Row] === value),
      );
      const ilike = arg("ilike") as [string, string] | undefined;
      const found = ilike
        ? matching.filter((candidate) => candidate.email?.toLowerCase() === ilike[1].replace(/\\(.)/g, "$1").toLowerCase())
        : matching;

      if (update) {
        if (failures.update) return { data: null, error: failures.update };
        const changes: Partial<Row> = { ...update };
        if (update.role_id !== undefined) {
          // profiles_role_id_fkey, then the guard: role and is_lead follow the role's access.
          const role = ROLE_ROWS.find((candidate) => candidate.id === update.role_id);
          if (!role) {
            return {
              data: null,
              error: { code: "23503", message: 'insert or update on table "profiles" violates foreign key constraint "profiles_role_id_fkey"' },
            };
          }
          Object.assign(changes, { role: role.access === "all" ? "admin" : "inspector", is_lead: role.access === "team" });
        }
        for (const target of found) Object.assign(target, changes, { updated_at: "2026-10-07T00:00:00Z" });
        const data = found.map((target) => project(target, columns || "id"));
        return { data: single ? (data[0] ?? null) : data, error: null };
      }
      if (failures.read) return { data: null, error: failures.read };
      if (failures.leads && eqs().some(([column]) => column === "is_lead")) return { data: null, error: failures.leads };
      const limit = arg("limit")?.[0] as number | undefined;
      const data = found.slice(0, limit ?? found.length).map((target) => project(target, columns));
      return { data: single ? (data[0] ?? null) : data, error: null };
    }

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "ilike", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(run(true));
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(run(false)).then(resolve, reject);
    return builder;
  });
  /** What the sign-up trigger makes for a new auth user: an inactive inspector, untouched, with no name and not joined. */
  const signUp = (email: string) =>
    rows.set(NEW, row(NEW, email, null, { active: false, updated_at: CREATED, joined_at: null }));
  const auth = {
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    admin: {
      inviteUserByEmail: vi.fn(async (email: string) => {
        // Supabase Auth creates the user; the invite gives no name, and no password.
        signUp(email);
        return { data: { user: { id: NEW } }, error: null };
      }),
      updateUserById: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
      // Deactivated accounts are banned; tests that need a pending one say so.
      getUserById: vi.fn().mockResolvedValue({ data: { user: { banned_until: "2126-09-12T08:00:00Z" } }, error: null }),
      // A link, nothing emailed: for the user who has the address. An invite link to a new address makes its account.
      generateLink: vi.fn(async ({ type, email }: { type: string; email: string }) => {
        if (type === "invite" && ![...rows.values()].some((candidate) => candidate.email === email)) signUp(email);
        const user = [...rows.values()].find((candidate) => candidate.email === email);
        return {
          data: {
            properties: {
              action_link: `https://project.supabase.co/auth/v1/verify?token=${type}-hash&type=${type}`,
              email_otp: "123456",
              hashed_token: `${type}-hash`,
              redirect_to: "https://qc.example.com",
              verification_type: type,
            },
            user: { id: user?.id ?? NEW },
          },
          error: null,
        };
      }),
      // The profile goes with the auth user (on delete cascade).
      deleteUser: vi.fn(async (id: string) => {
        rows.delete(id);
        return { data: { user: {} }, error: null };
      }),
    },
  };
  /** is_full_admin(): whether the caller has the built-in Admin role, as the database says. */
  const rpc = vi.fn(async (name: string) => {
    expect(name).toBe("is_full_admin");
    return fullAdmin;
  });
  return { from, auth, rpc };
}

let userClient: ReturnType<typeof fakeClient>;
let adminClient: ReturnType<typeof fakeClient>;

/** The updates in the order they ran, with the client that ran them. */
const updates = () =>
  queries
    .filter((query) => query.calls.some(([name]) => name === "update"))
    .map((query) => ({
      client: query.client,
      fields: query.calls.find(([name]) => name === "update")?.[1][0],
      eq: query.calls.filter(([name]) => name === "eq").map(([, args]) => args),
    }));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const inviteForm = (overrides: Record<string, string> = {}) => form({ email: "  Jane.Tan@Example.com ", role: "admin", ...overrides });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qc.example.com");
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: {
      id: SELF,
      email: "admin@test.local",
      fullName: "Test Admin",
      role: "admin",
      // Only the built-in Admin role gets past authorizeAction({ permission: "users" }).
      grant: { id: ADMIN_ROLE, name: "Admin", builtIn: "admin", access: "all", permissions: [] },
    },
  });
  vi.mocked(isAdminClientConfigured).mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  teams = true;
  accounts = true;
  roles = true;
  failures = {};
  fullAdmin = { data: true, error: null };
  queries = [];
  rows = new Map(
    [
      row(SELF, "admin@test.local", "Test Admin", { role: "admin", role_id: ADMIN_ROLE }),
      row(LEAD, "lina@test.local", "Lina Lead", { is_lead: true, role_id: LEAD_ROLE }),
      row(LEAD_TWO, "leo@test.local", "Leo Lead", { is_lead: true, role_id: LEAD_ROLE }),
      row(MEMBER, "ivan@test.local", "Ivan Inspector", { lead_id: LEAD }),
      row(OTHER, "olga@test.local", "Olga Other", { lead_id: LEAD_TWO }),
      // In no team, so the team counts of the tests below stay as they are.
      row(INVITED, "zed@example.com", null, { joined_at: null }),
      row(QUINN, "quinn@test.local", "Quinn Reviewer", { role: "admin", role_id: REVIEWER_ROLE }),
    ].map((entry) => [entry.id, entry]),
  );
  userClient = fakeClient("user");
  adminClient = fakeClient("admin");
  vi.mocked(createClient).mockResolvedValue(userClient as never);
  vi.mocked(createAdminClient).mockReturnValue(adminClient as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("every action", () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["inviteUser", () => inviteUser(IDLE, inviteForm())],
    ["editUserDetails", () => editUserDetails(IDLE, form({ userId: OTHER, fullName: "Olga Tan", phone: "" }))],
    ["changeRole", () => changeRole(IDLE, form({ userId: OTHER, role: "admin" }))],
    ["assignLead", () => assignLead(IDLE, form({ userId: OTHER, leadId: LEAD }))],
    ["deactivateUser", () => deactivateUser(IDLE, form({ userId: OTHER }))],
    ["reactivateUser", () => reactivateUser(IDLE, form({ userId: OTHER }))],
    ["sendPasswordLink", () => sendPasswordLink(IDLE, form({ userId: OTHER }))],
    ["resendInvite", () => resendInvite(IDLE, form({ userId: INVITED }))],
    ["createInviteLink", () => createInviteLink(IDLE, form({ userId: INVITED }))],
    ["cancelInvite", () => cancelInvite(IDLE, form({ userId: INVITED }))],
  ];

  it.each(calls)("%s asks for the users permission, and refuses anyone without it before anything else", async (_name, run) => {
    // As authorizeAction answers an inspector, or a custom role that sees every inspection: only the
    // built-in Admin role manages users.
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });

    expect(await run()).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledExactlyOnceWith({ permission: "users" });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks the database nothing more when the session read the Admin role", async () => {
    expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toMatchObject({ status: "success" });
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  describe("when the session could not read the caller's role, and stood in the built-in role for their level", () => {
    beforeEach(() => {
      // An admin at the database's level: the built-in Admin role, or a custom role that sees every inspection.
      vi.mocked(authorizeAction).mockResolvedValue({
        ok: true,
        user: { id: SELF, email: "admin@test.local", fullName: "Test Admin", role: "admin" },
      });
    });

    it.each(calls)("%s refuses a custom role that sees every inspection, before any work with the secret key", async (_name, run) => {
      fullAdmin = { data: false, error: null };
      expect(await run()).toEqual({ status: "error", message: MESSAGES.notAllowed });
      expect(userClient.rpc).toHaveBeenCalledExactlyOnceWith("is_full_admin");
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(updates()).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    });

    it("goes on for the built-in Admin role, as the database confirms", async () => {
      expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toMatchObject({ status: "success" });
      expect(userClient.rpc).toHaveBeenCalledOnce();
    });

    it("goes on by the level on a project without roles, which has no such function", async () => {
      fullAdmin = {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.is_full_admin without parameters in the schema cache" },
      };
      expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toMatchObject({ status: "success" });
    });

    it("says so plainly when the database cannot say", async () => {
      fullAdmin = { data: null, error: { code: "57014", message: "statement timeout" } };
      expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
        status: "error",
        message: "Your role could not be checked just now. Try again.",
      });
      expect(updates()).toEqual([]);
    });
  });

  it.each(calls.slice(1))("%s refuses a user id that is not a uuid", async (name) => {
    const action = {
      editUserDetails,
      changeRole,
      assignLead,
      deactivateUser,
      reactivateUser,
      sendPasswordLink,
      resendInvite,
      createInviteLink,
      cancelInvite,
    }[name]!;
    const result = await action(IDLE, form({ userId: "1 or 1=1", fullName: "Olga", role: "admin", leadId: LEAD }));
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("could not be found") });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("turns an unexpected failure into a message instead of an error page", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("fetch failed"));
    expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toEqual({ status: "error", message: MESSAGES.unexpected });
  });
});

describe("inviteUser", () => {
  it("invites through the admin client, then activates the new profile in its role, with no name", async () => {
    const result = await inviteUser(IDLE, inviteForm());

    expect(result).toEqual({
      status: "success",
      message: "Invite sent to jane.tan@example.com. From the link in it they create their account: name, phone and password.",
    });
    // No name: the invitee gives their own on Account Creation.
    expect(adminClient.auth.admin.inviteUserByEmail).toHaveBeenCalledExactlyOnceWith("jane.tan@example.com", {
      redirectTo: "https://qc.example.com/auth/confirm",
    });
    expect(updates()).toEqual([
      {
        client: "admin",
        // The role's id; the profiles guard gives role and is_lead its access.
        fields: { role_id: ADMIN_ROLE, lead_id: null, active: true },
        // Only if nobody changed it since the read.
        eq: [
          ["id", NEW],
          ["updated_at", CREATED],
        ],
      },
    ]);
    expect(rows.get(NEW)).toMatchObject({ role: "admin", is_lead: false, role_id: ADMIN_ROLE, active: true });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reads the role chosen again, through the admin's own client: what it sees never comes from the form", async () => {
    await inviteUser(IDLE, inviteForm({ role: REVIEWER_ROLE.toUpperCase(), access: "own" }));
    const read = queries.find((query) => query.table === "roles");
    expect(read).toMatchObject({ client: "user", calls: expect.arrayContaining([["eq", ["id", REVIEWER_ROLE]]]) });
    expect(updates()[0].fields).toEqual({ role_id: REVIEWER_ROLE, lead_id: null, active: true });
    expect(rows.get(NEW)).toMatchObject({ role: "admin", is_lead: false });
  });

  it("invites an inspector into the lead inspector's team chosen", async () => {
    const result = await inviteUser(IDLE, inviteForm({ role: "inspector", leadId: LEAD }));

    expect(result).toMatchObject({ status: "success", message: expect.stringMatching(/They work in Lina Lead's team\.$/) });
    expect(updates()[0].fields).toEqual({ role_id: INSPECTOR_ROLE, lead_id: LEAD, active: true });
  });

  it("invites a lead inspector, with no lead even if one was sent", async () => {
    await inviteUser(IDLE, inviteForm({ role: "lead", leadId: LEAD }));
    expect(updates()[0].fields).toEqual({ role_id: LEAD_ROLE, lead_id: null, active: true });
    expect(rows.get(NEW)).toMatchObject({ role: "inspector", is_lead: true });
  });

  it("invites in a custom role: one that sees its own inspections into a team, any other in none", async () => {
    expect(await inviteUser(IDLE, inviteForm({ role: FIELD_ROLE, leadId: LEAD }))).toMatchObject({
      status: "success",
      message: expect.stringMatching(/They work in Lina Lead's team\.$/),
    });
    expect(updates()[0].fields).toEqual({ role_id: FIELD_ROLE, lead_id: LEAD, active: true });

    rows.delete(NEW);
    expect(await inviteUser(IDLE, inviteForm({ role: FIELD_ROLE }))).toEqual({
      status: "error",
      message: "Choose their lead inspector.",
      fieldErrors: { leadId: "Choose their lead inspector." },
    });

    for (const role of [REVIEWER_ROLE, SENIOR_ROLE]) {
      rows.delete(NEW);
      expect(await inviteUser(IDLE, inviteForm({ role, leadId: LEAD })), role).toMatchObject({ status: "success" });
      expect(updates().at(-1)?.fields, role).toEqual({ role_id: role, lead_id: null, active: true });
    }
  });

  it("refuses a role deleted since the page loaded, at the role field, before any email", async () => {
    expect(await inviteUser(IDLE, inviteForm({ role: GONE_ROLE }))).toEqual({
      status: "error",
      message: "That role no longer exists. Reload the page and choose another.",
      fieldErrors: { role: "That role no longer exists. Reload the page and choose another." },
    });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("says plainly when the roles could not be read, before any email", async () => {
    failures.roles = { code: "57014", message: "statement timeout" };
    expect(await inviteUser(IDLE, inviteForm())).toMatchObject({
      status: "error",
      fieldErrors: { role: "The role could not be read: statement timeout. Try again." },
    });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("invites with the built-in roles standing in for the levels on a project without roles", async () => {
    roles = false;
    expect(await inviteUser(IDLE, inviteForm({ role: "lead" }))).toMatchObject({ status: "success" });
    expect(updates()[0].fields).toEqual({ role: "inspector", is_lead: true, lead_id: null, active: true });

    // A role's id needs the roles: refused at the field, before any email.
    rows.delete(NEW);
    expect(await inviteUser(IDLE, inviteForm({ role: REVIEWER_ROLE }))).toMatchObject({
      status: "error",
      fieldErrors: { role: expect.stringContaining("20261027150000_roles_and_permissions.sql") },
    });
    expect(adminClient.auth.admin.inviteUserByEmail).toHaveBeenCalledOnce();
  });

  it("asks for an inspector's lead, at the field, before any email", async () => {
    const result = await inviteUser(IDLE, inviteForm({ role: "inspector" }));

    expect(result).toEqual({
      status: "error",
      message: "Choose their lead inspector.",
      fieldErrors: { leadId: "Choose their lead inspector." },
    });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("says at the role field when nobody can lead an inspector yet, before any email", async () => {
    // A deactivated lead inspector leads nobody.
    rows.get(LEAD)!.active = false;
    rows.get(LEAD_TWO)!.is_lead = false;
    const result = await inviteUser(IDLE, inviteForm({ role: "inspector" }));

    expect(result).toEqual({ status: "error", message: NOBODY, fieldErrors: { role: NOBODY } });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("asks for the lead at the field when the lead inspectors cannot be counted", async () => {
    failures.leads = { code: "57014", message: "statement timeout" };
    expect(await inviteUser(IDLE, inviteForm({ role: "inspector" }))).toEqual({
      status: "error",
      message: "Choose their lead inspector.",
      fieldErrors: { leadId: "Choose their lead inspector." },
    });
    expect(console.error).toHaveBeenCalled();
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("refuses a lead who is not an active lead inspector, by name, before any email", async () => {
    rows.get(LEAD)!.active = false;
    const result = await inviteUser(IDLE, inviteForm({ role: "inspector", leadId: LEAD }));

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { leadId: "Lina Lead is not an active lead inspector any more. Choose another lead inspector." },
    });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("invites with the level only on a project without lead inspectors, and refuses a lead inspector there", async () => {
    // The migrations run in order: no lead inspectors, no roles either.
    teams = false;
    roles = false;
    expect(await inviteUser(IDLE, inviteForm({ role: "inspector" }))).toMatchObject({ status: "success" });
    expect(updates()[0].fields).toEqual({ role: "inspector", active: true });

    rows.delete(NEW);
    expect(await inviteUser(IDLE, inviteForm({ role: "lead", email: "lena@example.com" }))).toMatchObject({
      status: "error",
      fieldErrors: { role: expect.stringMatching(/^Lead inspectors need a database update first/) },
    });
  });

  it("leaves alone an account an admin already handled, which Supabase answers with a resent invite", async () => {
    // An unconfirmed account that an admin deactivated: the invite reaches it
    // when two admins invite at once, or the address check missed it.
    adminClient.auth.admin.inviteUserByEmail.mockImplementation(async () => {
      rows.set(NEW, row(NEW, "someone@example.com", "Jane Tan", { active: false, updated_at: "2026-10-06T11:00:00Z" }));
      return { data: { user: { id: NEW } }, error: null };
    });

    const result = await inviteUser(IDLE, inviteForm());

    expect(result).toMatchObject({ status: "error", fieldErrors: { email: expect.stringContaining("not active") } });
    expect(updates()).toEqual([]);
  });

  it("says so plainly when the invite went out but the account could not be activated", async () => {
    failures.update = { code: "57014", message: "statement timeout" };

    // The list names them by their email until they give a name.
    expect(await inviteUser(IDLE, inviteForm())).toEqual({
      status: "warning",
      message:
        "Invite sent to jane.tan@example.com, but the account could not be activated. Choose Activate next to jane.tan@example.com, then make them an admin.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("only asks for Activate when the invitee is an inspector", async () => {
    failures.update = { code: "57014", message: "statement timeout" };
    expect(await inviteUser(IDLE, inviteForm({ role: "inspector", leadId: LEAD }))).toMatchObject({
      status: "warning",
      message: expect.stringMatching(/Choose Activate next to jane\.tan@example\.com\.$/),
    });
  });

  it("treats an update that matched no row (changed since the read) as not activated", async () => {
    adminClient.auth.admin.inviteUserByEmail.mockImplementation(async () => {
      // Created, then changed between the read and the update.
      rows.set(NEW, row(NEW, "jane.tan@example.com", "Jane Tan", { active: false, updated_at: CREATED }));
      const read = adminClient.from;
      adminClient.from = vi.fn((table: string) => {
        const builder = read(table) as Record<string, (...args: unknown[]) => unknown>;
        const update = builder.update;
        builder.update = (...args: unknown[]) => {
          rows.get(NEW)!.updated_at = "2026-10-06T12:00:00Z";
          return update(...args);
        };
        return builder;
      }) as never;
      return { data: { user: { id: NEW } }, error: null };
    });
    expect((await inviteUser(IDLE, inviteForm())).status).toBe("warning");
  });

  it("is switched off without the secret key, before touching Supabase", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    expect(await inviteUser(IDLE, inviteForm())).toEqual({ status: "error", message: MESSAGES.missingSecretKey });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("explains a built-in mailer that refuses a non-team address, and points at custom SMTP", async () => {
    adminClient.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthApiError",
        code: "email_address_not_authorized",
        status: 400,
        message: 'Email address "inspector@factory.example" cannot be used as it is not authorized',
      },
    } as never);

    const result = await inviteUser(IDLE, inviteForm({ email: "inspector@factory.example" }));

    expect(result.status).toBe("error");
    expect(result).toMatchObject({ message: expect.stringContaining("The invite email could not be sent") });
    expect(result).toMatchObject({ message: expect.stringContaining("custom SMTP") });
    // A link sent by hand gets round the mailer: the same dialog makes one.
    expect(result).toMatchObject({ message: expect.stringMatching(/ Or choose Create Link and send them the link yourself\.$/) });
    expect(updates()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts an address Supabase refuses next to the email field", async () => {
    adminClient.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { code: "email_address_invalid", status: 400, message: 'Email address "x@test.local" is invalid' },
    } as never);

    const result = await inviteUser(IDLE, inviteForm({ email: "x@test.local" }));

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { email: expect.stringContaining("does not look able to receive email") },
    });
    // Check the address: a link would go to the same one.
    expect(result).not.toMatchObject({ message: expect.stringContaining("Create Link") });
    expect(updates()).toEqual([]);
  });

  it("stops at an address that already has an account, without sending anything", async () => {
    const result = await inviteUser(IDLE, inviteForm({ email: "OLGA@test.local" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { email: expect.stringContaining("already has an account") } });
    // Named as the row menu names it.
    expect(result).toMatchObject({ message: expect.stringContaining("choose Send Password Link next to their name") });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("points a deactivated address at Reactivate", async () => {
    rows.get(OTHER)!.active = false;
    const result = await inviteUser(IDLE, inviteForm({ email: "olga@test.local" }));
    expect(result).toMatchObject({ fieldErrors: { email: expect.stringContaining("Reactivate") } });
  });

  it("points an address invited already at Resend Invite and Copy Invite Link", async () => {
    const result = await inviteUser(IDLE, inviteForm({ email: "Zed@Example.com" }));
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: {
        email:
          "That email has been invited already. To send them a new link, choose Resend Invite or Copy Invite Link next to their name.",
      },
    });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("checks an address on a project without Account Creation, as before", async () => {
    accounts = false;
    expect(await inviteUser(IDLE, inviteForm({ email: "olga@test.local" }))).toMatchObject({
      fieldErrors: { email: expect.stringContaining("already has an account") },
    });
    rows.delete(NEW);
    expect(await inviteUser(IDLE, inviteForm())).toMatchObject({ status: "success" });
  });

  it("maps Auth's own duplicate error to the same message", async () => {
    adminClient.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" },
    } as never);
    expect(await inviteUser(IDLE, inviteForm())).toMatchObject({
      fieldErrors: { email: expect.stringContaining("already has an account") },
    });
  });

  it("returns field errors and sends nothing for an invalid form", async () => {
    const result = await inviteUser(IDLE, form({ email: "jane@", role: "owner", delivery: "fax" }));

    expect(result).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        email: "Enter a valid email address, like name@example.com.",
        role: "Choose their role.",
        delivery: "Choose Send Email or Create Link.",
      },
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("inviteUser by Create Link", () => {
  const CONFIRM = "https://qc.example.com/auth/confirm";
  const linkForm = (overrides: Record<string, string> = {}) => inviteForm({ delivery: "link", ...overrides });
  const MESSAGE =
    "Nothing was emailed: send this link to jane.tan@example.com yourself, by WhatsApp or any chat. From it they create their account: name, phone and password. It works once, within an hour; for a new one, choose Copy Invite Link next to their email.";

  it("makes the account with the secret key, emailing nothing, and hands the admin a link on /auth/confirm", async () => {
    expect(await inviteUser(IDLE, linkForm())).toEqual({
      status: "link",
      link: `${CONFIRM}?token_hash=invite-hash&type=invite`,
      message: MESSAGE,
    });
    expect(adminClient.auth.admin.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "invite", email: "jane.tan@example.com" });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(adminClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    // The link signs its holder in: it goes to the admin who asked, never into a log.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("activates and places the account exactly as the email invite does", async () => {
    await inviteUser(IDLE, linkForm({ role: "inspector", leadId: LEAD }));
    expect(updates()).toEqual([
      {
        client: "admin",
        fields: { role_id: INSPECTOR_ROLE, lead_id: LEAD, active: true },
        eq: [
          ["id", NEW],
          ["updated_at", CREATED],
        ],
      },
    ]);
    expect(rows.get(NEW)).toMatchObject({ active: true, role: "inspector", is_lead: false, lead_id: LEAD, joined_at: null, full_name: null });
  });

  it("says the team in the words over the link", async () => {
    expect(await inviteUser(IDLE, linkForm({ role: FIELD_ROLE, leadId: LEAD }))).toMatchObject({
      status: "link",
      message: `${MESSAGE} They work in Lina Lead's team.`,
    });
  });

  it("never hands out Supabase's own action_link", async () => {
    expect(JSON.stringify(await inviteUser(IDLE, linkForm()))).not.toContain("supabase.co");
  });

  it("leaves the list to the dialog, which refreshes it when it closes: the new row could take the dialog away", async () => {
    await inviteUser(IDLE, linkForm());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("settles the role and the lead before any account is made", async () => {
    expect(await inviteUser(IDLE, linkForm({ role: "inspector" }))).toMatchObject({ fieldErrors: { leadId: "Choose their lead inspector." } });
    expect(await inviteUser(IDLE, linkForm({ role: GONE_ROLE }))).toMatchObject({ fieldErrors: { role: MESSAGES.roleGone } });
    expect(adminClient.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(rows.has(NEW)).toBe(false);
  });

  it("stops at an address that has an account, before making anything", async () => {
    expect(await inviteUser(IDLE, linkForm({ email: "Zed@Example.com" }))).toMatchObject({
      fieldErrors: { email: expect.stringContaining("choose Resend Invite or Copy Invite Link") },
    });
    expect(adminClient.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it("explains a refused link in plain words, an address Supabase refuses at the email field", async () => {
    adminClient.auth.admin.generateLink.mockResolvedValueOnce({
      data: { properties: null, user: null },
      error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" },
    } as never);
    expect(await inviteUser(IDLE, linkForm())).toMatchObject({ fieldErrors: { email: expect.stringContaining("already has an account") } });

    adminClient.auth.admin.generateLink.mockResolvedValueOnce({
      data: { properties: null, user: null },
      error: { code: "email_address_invalid", status: 400, message: 'Email address "x@nowhere.example" is invalid' },
    } as never);
    expect(await inviteUser(IDLE, linkForm({ email: "x@nowhere.example" }))).toEqual({
      status: "error",
      message: MESSAGES.addressRefused,
      fieldErrors: { email: MESSAGES.addressRefused },
    });

    adminClient.auth.admin.generateLink.mockResolvedValueOnce({
      data: { properties: null, user: null },
      error: { status: 401, message: "Invalid API key" },
    } as never);
    expect(await inviteUser(IDLE, linkForm())).toEqual({
      status: "error",
      message:
        "The invite link was not created: Supabase refused the server's key. Check that SUPABASE_SECRET_KEY is the secret key of this project.",
    });
    expect(updates()).toEqual([]);
  });

  it("shows no link when the account could not be activated: it would not let them in", async () => {
    failures.update = { code: "57014", message: "statement timeout" };
    expect(await inviteUser(IDLE, linkForm())).toEqual({
      status: "warning",
      message:
        "The account for jane.tan@example.com was made, but it could not be activated, so a link would not let them in. Choose Activate next to jane.tan@example.com, then make them an admin, then Copy Invite Link.",
    });
    // The new row, as sign-up made it, shows in the list: the dialog closes on a warning.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says what to do when Supabase answers a link of another kind, which is never handed out", async () => {
    adminClient.auth.admin.generateLink.mockImplementationOnce(async ({ email }: { type: string; email: string }) => {
      rows.set(NEW, row(NEW, email, null, { active: false, updated_at: CREATED, joined_at: null }));
      return {
        data: {
          properties: { action_link: "", email_otp: "", hashed_token: "signup-hash", redirect_to: "", verification_type: "signup" },
          user: { id: NEW },
        },
        error: null,
      };
    });
    expect(await inviteUser(IDLE, linkForm())).toEqual({
      status: "warning",
      message:
        "jane.tan@example.com is invited, but Supabase answered a link of another kind. Choose Copy Invite Link next to jane.tan@example.com for one.",
    });
    expect(rows.get(NEW)).toMatchObject({ active: true });
  });

  it("is switched off without the secret key, as the email invite is", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    expect(await inviteUser(IDLE, linkForm())).toEqual({ status: "error", message: MESSAGES.missingSecretKey });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("editUserDetails", () => {
  const edit = (userId: string, fullName: string, phone = "") => editUserDetails(IDLE, form({ userId, fullName, phone }));

  it("saves the name and phone through the admin's own client, so RLS applies, then the name Supabase Auth keeps", async () => {
    const result = await edit(OTHER, "Olga Tan", " +60 12-345  6789 ");

    expect(result).toEqual({
      status: "success",
      message: "Olga Other is now Olga Tan. Their phone number is now +60 12-345 6789.",
    });
    expect(updates()).toEqual([
      { client: "user", fields: { full_name: "Olga Tan", phone: "+60 12-345 6789" }, eq: [["id", OTHER]] },
    ]);
    expect(rows.get(OTHER)).toMatchObject({ full_name: "Olga Tan", phone: "+60 12-345 6789" });
    // Only full_name: Auth merges it into the metadata it has.
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledExactlyOnceWith(OTHER, {
      user_metadata: { full_name: "Olga Tan" },
    });
    // The profile first: it is the copy the app reads.
    const savedAt = userClient.from.mock.invocationCallOrder.at(-1)!;
    expect(savedAt).toBeLessThan(adminClient.auth.admin.updateUserById.mock.invocationCallOrder[0]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says what changed: the name, the phone, both or neither", async () => {
    expect(await edit(OTHER, "Olga Tan")).toEqual({ status: "success", message: "Olga Other is now Olga Tan." });
    expect(await edit(OTHER, "Olga Tan", "012-345 6789")).toEqual({
      status: "success",
      message: "Olga Tan's phone number is now 012-345 6789.",
    });
    expect(await edit(OTHER, "Olga Tan", "")).toEqual({ status: "success", message: "Olga Tan's phone number is removed." });
    expect(await edit(OTHER, " Olga  Tan ")).toEqual({ status: "success", message: "Olga Tan's details stay as they were." });
    expect(updates().map((update) => update.fields)).toEqual([
      { full_name: "Olga Tan", phone: null },
      { full_name: "Olga Tan", phone: "012-345 6789" },
      { full_name: "Olga Tan", phone: null },
      { full_name: "Olga Tan", phone: null },
    ]);
  });

  it("saves the name trimmed and on one line", async () => {
    expect(await edit(OTHER.toUpperCase(), "  Ngan \t Boon\r\n Keat ")).toEqual({
      status: "success",
      message: "Olga Other is now Ngan Boon Keat.",
    });
    expect(updates()).toEqual([{ client: "user", fields: { full_name: "Ngan Boon Keat", phone: null }, eq: [["id", OTHER]] }]);
  });

  it("edits anyone: the admin themselves, a deactivated account, someone invited with no name yet", async () => {
    expect(await edit(SELF, "Ada Admin", "03-1234 5678")).toEqual({
      status: "success",
      message: "Test Admin is now Ada Admin. Their phone number is now 03-1234 5678.",
    });

    rows.get(OTHER)!.active = false;
    expect(await edit(OTHER, "Olga Tan")).toMatchObject({ status: "success" });

    // Named by their email until now; what they enter on Account Creation replaces it.
    expect(await edit(INVITED, "Zed Zainal", "012-345 6789")).toEqual({
      status: "success",
      message: "zed@example.com is now Zed Zainal. Their phone number is now 012-345 6789.",
    });
    expect(rows.get(INVITED)).toMatchObject({ full_name: "Zed Zainal", phone: "012-345 6789", joined_at: null });
  });

  it("leaves the phone as it is when the form sends no phone field", async () => {
    rows.get(OTHER)!.phone = "012-345 6789";
    expect(await editUserDetails(IDLE, form({ userId: OTHER, fullName: "Olga Tan" }))).toEqual({
      status: "success",
      message: "Olga Other is now Olga Tan.",
    });
    expect(updates()).toEqual([{ client: "user", fields: { full_name: "Olga Tan" }, eq: [["id", OTHER]] }]);
    expect(rows.get(OTHER)?.phone).toBe("012-345 6789");
  });

  it.each([
    ["an empty name", "", "Enter their name."],
    ["spaces only", "   ", "Enter their name."],
    ["101 characters", "x".repeat(101), "Keep the name to 100 characters or fewer."],
    ["a hidden control character", "Olga\u0000Tan", "The name holds a hidden control character. Type it again."],
  ])("refuses %s at the name field, before touching Supabase", async (_case, fullName, message) => {
    expect(await edit(OTHER, fullName)).toEqual({ status: "error", message, fieldErrors: { fullName: message } });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a phone number that is not one at the phone field, the name's problem first", async () => {
    const phone = "Enter a phone number, like +60 12-345 6789 or 012-345 6789.";
    expect(await edit(OTHER, "Olga Tan", "call me")).toEqual({ status: "error", message: phone, fieldErrors: { phone } });
    expect(await edit(OTHER, "", "12345")).toEqual({
      status: "error",
      message: "Enter their name.",
      fieldErrors: { fullName: "Enter their name.", phone },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("puts the database's refusal of a phone number at the phone field", async () => {
    failures.update = { code: "23514", message: 'new row for relation "profiles" violates check constraint "profiles_phone_format"' };
    expect(await edit(OTHER, "Olga Tan", "012-345 6789")).toEqual({
      status: "error",
      message: MESSAGES.phoneRefused,
      fieldErrors: { phone: MESSAGES.phoneRefused },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes exactly 100 characters", async () => {
    expect(await edit(OTHER, "x".repeat(100))).toMatchObject({ status: "success" });
  });

  it("asks for the name when the form has none", async () => {
    expect(await editUserDetails(IDLE, form({ userId: OTHER, phone: "" }))).toEqual({
      status: "error",
      message: "Enter their name.",
      fieldErrors: { fullName: "Enter their name." },
    });
  });

  it("refuses an admin whose account was deactivated, before reading anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "This account has been deactivated." });

    expect(await edit(OTHER, "Olga Tan")).toEqual({ status: "error", message: "This account has been deactivated." });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "users" });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("says when the user no longer exists, and changes nothing", async () => {
    expect(await edit(NEW, "Jane Tan")).toEqual({ status: "error", message: MESSAGES.userNotFound });
    expect(updates()).toEqual([]);
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  describe("checks that exactly one profile changed", () => {
    /** The admin's client, with the update (the second query) answered by `answer`. */
    function updateAnswers(answer: () => { data: unknown; error: unknown }) {
      const original = userClient.from;
      let count = 0;
      userClient.from = vi.fn((table: string) => {
        count += 1;
        if (count !== 2) return original(table);
        const builder: Record<string, unknown> = {};
        for (const method of ["update", "eq", "select"]) builder[method] = () => builder;
        builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve);
        return builder;
      }) as never;
    }

    it("none: the account went (or RLS hid it) since the read", async () => {
      updateAnswers(() => ({ data: [], error: null }));
      expect(await edit(OTHER, "Olga Tan")).toEqual({ status: "error", message: MESSAGES.userNotFound });
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("more than one: never reported as a success", async () => {
      updateAnswers(() => ({ data: [{ id: OTHER }, { id: MEMBER }], error: null }));
      expect(await edit(OTHER, "Olga Tan")).toEqual({ status: "error", message: MESSAGES.unexpected });
      expect(console.error).toHaveBeenCalled();
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    });
  });

  it("surfaces the database's refusal in plain words, and leaves Auth alone", async () => {
    failures.update = { code: "42501", message: "permission denied for table profiles" };
    expect(await edit(OTHER, "Olga Tan")).toEqual({ status: "error", message: MESSAGES.notAllowed });
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the new name when Supabase Auth refuses its copy: that is only logged", async () => {
    adminClient.auth.admin.updateUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 500, message: "Database error updating user" },
    });

    expect(await edit(OTHER, "Olga Tan")).toEqual({ status: "success", message: "Olga Other is now Olga Tan." });
    expect(rows.get(OTHER)?.full_name).toBe("Olga Tan");
    expect(console.error).toHaveBeenCalledWith(
      "[admin/users] name saved; Supabase Auth keeps the old one",
      undefined,
      "Database error updating user",
    );
  });

  it("saves without the secret key, leaving Auth's copy as it was", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    expect(await edit(OTHER, "Olga Tan")).toMatchObject({ status: "success" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("saves on a project without lead inspectors too", async () => {
    teams = false;
    expect(await edit(OTHER, "Olga Tan", "012-345 6789")).toMatchObject({ status: "success" });
  });

  it("saves the name alone on a project without phone numbers, and says what a phone needs", async () => {
    accounts = false;
    expect(await edit(OTHER, "Olga Tan")).toEqual({ status: "success", message: "Olga Other is now Olga Tan." });
    expect(updates()).toEqual([{ client: "user", fields: { full_name: "Olga Tan" }, eq: [["id", OTHER]] }]);

    expect(await edit(OTHER, "Olga Tan", "012-345 6789")).toEqual({
      status: "error",
      message: MESSAGES.accountsMissing,
      fieldErrors: { phone: MESSAGES.accountsMissing },
    });
    expect(updates()).toHaveLength(1);
  });
});

describe("changeRole", () => {
  it("makes someone an admin through the admin's own client, so RLS applies, and takes them out of their team", async () => {
    const result = await changeRole(IDLE, form({ userId: OTHER, role: "admin" }));

    expect(result).toEqual({ status: "success", message: "Olga Other is now an admin." });
    // The role's id and the lead in one write: the team rules never clear a lead for you.
    expect(updates()).toEqual([{ client: "user", fields: { role_id: ADMIN_ROLE, lead_id: null }, eq: [["id", OTHER]] }]);
    expect(rows.get(OTHER)).toMatchObject({ role: "admin", is_lead: false, lead_id: null });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("gives a custom role by its id, its words by its name: out of the team for one that sees more than its own", async () => {
    expect(await changeRole(IDLE, form({ userId: OTHER, role: REVIEWER_ROLE, leadId: LEAD }))).toEqual({
      status: "success",
      message: "Olga Other's role is now QA Reviewer.",
    });
    expect(updates()).toEqual([{ client: "user", fields: { role_id: REVIEWER_ROLE, lead_id: null }, eq: [["id", OTHER]] }]);
    expect(rows.get(OTHER)).toMatchObject({ role: "admin", is_lead: false, lead_id: null, role_id: REVIEWER_ROLE });
  });

  it("puts someone in a team with a custom role that sees its own inspections, and asks for the lead first", async () => {
    expect(await changeRole(IDLE, form({ userId: OTHER, role: FIELD_ROLE }))).toEqual({
      status: "error",
      message: "Choose their lead inspector.",
      fieldErrors: { leadId: "Choose their lead inspector." },
    });
    expect(await changeRole(IDLE, form({ userId: OTHER, role: FIELD_ROLE, leadId: LEAD }))).toEqual({
      status: "success",
      message: "Olga Other's role is now Field Inspector, in Lina Lead's team.",
    });
    expect(rows.get(OTHER)).toMatchObject({ role: "inspector", is_lead: false, lead_id: LEAD, role_id: FIELD_ROLE });
  });

  it("refuses a role deleted since the page loaded, at the role field, and changes nothing", async () => {
    expect(await changeRole(IDLE, form({ userId: OTHER, role: GONE_ROLE }))).toEqual({
      status: "error",
      message: MESSAGES.roleGone,
      fieldErrors: { role: MESSAGES.roleGone },
    });
    expect(updates()).toEqual([]);
  });

  it("says so in plain words when the role goes between the read and the change", async () => {
    // profiles_role_id_fkey refuses it: the role is gone by the time of the write.
    failures.update = {
      code: "23503",
      message: 'insert or update on table "profiles" violates foreign key constraint "profiles_role_id_fkey"',
    };
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "admin" }))).toEqual({ status: "error", message: MESSAGES.roleGone });
  });

  it("lets someone who leads a team move to another role that sees their team's: they keep leading it", async () => {
    expect(await changeRole(IDLE, form({ userId: LEAD, role: SENIOR_ROLE }))).toEqual({
      status: "success",
      message: "Lina Lead's role is now Senior Lead.",
    });
    expect(rows.get(LEAD)).toMatchObject({ is_lead: true, role_id: SENIOR_ROLE });
    expect(rows.get(MEMBER)?.lead_id).toBe(LEAD);
  });

  it("makes an inspector a lead inspector, who leaves their own lead's team", async () => {
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "lead", leadId: LEAD }))).toEqual({
      status: "success",
      message: "Olga Other is now a lead inspector.",
    });
    expect(rows.get(OTHER)).toMatchObject({ role: "inspector", is_lead: true, lead_id: null });
  });

  it("makes someone an inspector in the team chosen", async () => {
    rows.get(OTHER)!.role = "admin";
    rows.get(OTHER)!.lead_id = null;
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "inspector", leadId: LEAD.toUpperCase() }))).toEqual({
      status: "success",
      message: "Olga Other is now an inspector in Lina Lead's team.",
    });
    expect(rows.get(OTHER)).toMatchObject({ role: "inspector", is_lead: false, lead_id: LEAD });
  });

  it.each([
    ["no lead", {}, "Choose their lead inspector."],
    ["themselves as their lead", { leadId: OTHER }, "Nobody can be their own lead inspector. Choose someone else."],
    ["an inspector who is not a lead", { leadId: MEMBER }, "Ivan Inspector is not an active lead inspector any more. Choose another lead inspector."],
  ])("refuses an inspector with %s, at the lead field", async (_case, extra, message) => {
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "inspector", ...extra }))).toEqual({
      status: "error",
      message,
      fieldErrors: { leadId: message },
    });
    expect(updates()).toEqual([]);
  });

  it("says at the role field when nobody else can lead the only lead inspector", async () => {
    rows.get(LEAD_TWO)!.is_lead = false;
    expect(await changeRole(IDLE, form({ userId: LEAD, role: "inspector" }))).toEqual({
      status: "error",
      message: NOBODY,
      fieldErrors: { role: NOBODY },
    });
    expect(updates()).toEqual([]);
  });

  it("refuses a role that leads no team to a lead inspector whose team has members, naming them", async () => {
    for (const role of ["inspector", "admin", FIELD_ROLE, REVIEWER_ROLE]) {
      const result = await changeRole(IDLE, form({ userId: LEAD, role, leadId: LEAD_TWO }));
      expect(result, role).toEqual({
        status: "error",
        message:
          "Lina Lead leads 1 inspector: Ivan Inspector. Choose another lead inspector for them first (Change Lead Inspector, next to their name).",
      });
    }
    expect(updates()).toEqual([]);
  });

  it("demotes a lead inspector once their team is empty", async () => {
    expect(await changeRole(IDLE, form({ userId: LEAD_TWO, role: "inspector", leadId: OTHER }))).toMatchObject({ status: "error" });
    rows.get(OTHER)!.lead_id = LEAD;
    expect(await changeRole(IDLE, form({ userId: LEAD_TWO, role: "inspector", leadId: LEAD }))).toEqual({
      status: "success",
      message: "Leo Lead is now an inspector in Lina Lead's team.",
    });
  });

  // Postgres and Supabase Auth match ids in any case: an upper-case copy of
  // your own id must not slip past the check.
  it.each([
    ["as the page sends it", SELF, "lead"],
    ["in upper case", SELF.toUpperCase(), "lead"],
    ["for a custom role that sees every inspection", SELF, REVIEWER_ROLE],
    ["for a role id in upper case", SELF, REVIEWER_ROLE.toUpperCase()],
  ])("refuses to let admins leave the Admin role themselves (their id %s)", async (_case, userId, role) => {
    expect(await changeRole(IDLE, form({ userId, role }))).toEqual({ status: "error", message: MESSAGES.selfDemote });
    expect(MESSAGES.selfDemote).toBe("You cannot remove your own Admin role. Ask another admin to do it.");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("lets admins keep their own Admin role, by its kind or its id: nothing changes", async () => {
    for (const role of ["admin", ADMIN_ROLE]) {
      expect(await changeRole(IDLE, form({ userId: SELF, role })), role).toEqual({
        status: "success",
        message: "Test Admin is now an admin.",
      });
    }
    expect(rows.get(SELF)).toMatchObject({ role: "admin", role_id: ADMIN_ROLE });
  });

  it("surfaces the database's own rules in plain words", async () => {
    failures.update = { code: "23514", message: "cannot remove the last active admin" };
    rows.get(OTHER)!.role = "admin";
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "lead" }))).toEqual({
      status: "error",
      message: "This would leave nobody active with the Admin role. Give someone else the Admin role first.",
    });
    failures.update = { code: "23514", message: "the lead inspector must be an active lead inspector" };
    expect(await changeRole(IDLE, form({ userId: MEMBER, role: "inspector", leadId: LEAD }))).toEqual({
      status: "error",
      message: "That lead inspector is not an active lead inspector any more. Reload the page and choose another.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says when the user no longer exists", async () => {
    expect(await changeRole(IDLE, form({ userId: NEW, role: "admin" }))).toEqual({ status: "error", message: MESSAGES.userNotFound });
  });

  it("changes the level only on a project without lead inspectors", async () => {
    teams = false;
    roles = false;
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "admin" }))).toEqual({
      status: "success",
      message: "Olga Other is now an admin.",
    });
    expect(updates().at(-1)?.fields).toEqual({ role: "admin" });
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "inspector" }))).toEqual({
      status: "success",
      message: "Olga Other is now an inspector.",
    });
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "lead" }))).toMatchObject({
      status: "error",
      message: expect.stringMatching(/^Lead inspectors need a database update first/),
    });
  });

  it("works with the built-in roles standing in for the levels on a project without roles", async () => {
    roles = false;
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "lead" }))).toEqual({
      status: "success",
      message: "Olga Other is now a lead inspector.",
    });
    expect(updates().at(-1)?.fields).toEqual({ role: "inspector", is_lead: true, lead_id: null });
    expect(await changeRole(IDLE, form({ userId: OTHER, role: REVIEWER_ROLE }))).toEqual({
      status: "error",
      message: MESSAGES.rolesMissing,
      fieldErrors: { role: MESSAGES.rolesMissing },
    });
  });
});

describe("assignLead", () => {
  it("moves an inspector to another team", async () => {
    expect(await assignLead(IDLE, form({ userId: OTHER, leadId: LEAD }))).toEqual({
      status: "success",
      message: "Olga Other now works in Lina Lead's team.",
    });
    expect(updates()).toEqual([{ client: "user", fields: { lead_id: LEAD }, eq: [["id", OTHER]] }]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks for the lead at the field", async () => {
    expect(await assignLead(IDLE, form({ userId: OTHER, leadId: "" }))).toEqual({
      status: "error",
      message: "Choose their lead inspector.",
      fieldErrors: { leadId: "Choose their lead inspector." },
    });
  });

  it.each([
    [LEAD, "Lina Lead is a lead inspector, so they work in no lead inspector's team."],
    [SELF, "Test Admin is an admin, so they work in no lead inspector's team."],
    [QUINN, "Quinn Reviewer has the QA Reviewer role, so they work in no lead inspector's team."],
  ])("refuses to put someone whose role sees more than their own in a team (%s), naming the role", async (userId, message) => {
    expect(await assignLead(IDLE, form({ userId, leadId: LEAD_TWO }))).toEqual({ status: "error", message });
    expect(updates()).toEqual([]);
  });

  it("moves someone with a custom role that sees their own inspections, as an inspector", async () => {
    rows.get(OTHER)!.role_id = FIELD_ROLE;
    expect(await assignLead(IDLE, form({ userId: OTHER, leadId: LEAD }))).toEqual({
      status: "success",
      message: "Olga Other now works in Lina Lead's team.",
    });
  });

  it("names the level when the role cannot be read, on a project without roles too", async () => {
    failures.roles = { code: "57014", message: "statement timeout" };
    expect(await assignLead(IDLE, form({ userId: QUINN, leadId: LEAD }))).toEqual({
      status: "error",
      message: "Quinn Reviewer is an admin, so they work in no lead inspector's team.",
    });
    failures.roles = undefined;
    roles = false;
    expect(await assignLead(IDLE, form({ userId: LEAD, leadId: LEAD_TWO }))).toEqual({
      status: "error",
      message: "Lina Lead is a lead inspector, so they work in no lead inspector's team.",
    });
  });

  it("refuses a lead who is deactivated", async () => {
    rows.get(LEAD)!.active = false;
    expect(await assignLead(IDLE, form({ userId: OTHER, leadId: LEAD }))).toMatchObject({
      status: "error",
      fieldErrors: { leadId: "Lina Lead is not an active lead inspector any more. Choose another lead inspector." },
    });
  });

  it("says what is needed on a project without lead inspectors", async () => {
    teams = false;
    expect(await assignLead(IDLE, form({ userId: OTHER, leadId: LEAD }))).toMatchObject({
      status: "error",
      message: expect.stringMatching(/^Lead inspectors need a database update first/),
    });
  });
});

describe("deactivateUser", () => {
  it("deactivates the profile, then bans the auth user", async () => {
    const result = await deactivateUser(IDLE, form({ userId: OTHER }));

    expect(result).toEqual({ status: "success", message: "Olga Other is deactivated and has lost access." });
    expect(updates()).toEqual([{ client: "user", fields: { active: false }, eq: [["id", OTHER]] }]);
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(OTHER, { ban_duration: "876000h" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refuses a lead inspector whose team has members, before any ban", async () => {
    expect(await deactivateUser(IDLE, form({ userId: LEAD }))).toEqual({
      status: "error",
      message:
        "Lina Lead leads 1 inspector: Ivan Inspector. Choose another lead inspector for them first (Change Lead Inspector, next to their name).",
    });
    expect(updates()).toEqual([]);
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("bans nobody when the user cannot be found", async () => {
    expect(await deactivateUser(IDLE, form({ userId: NEW }))).toEqual({ status: "error", message: MESSAGES.userNotFound });
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["as the page sends it", SELF],
    ["in upper case", SELF.toUpperCase()],
  ])("refuses to let admins deactivate themselves (their id %s)", async (_case, userId) => {
    expect(await deactivateUser(IDLE, form({ userId }))).toEqual({ status: "error", message: MESSAGES.selfDeactivate });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("deactivates and bans with the id in the form Supabase stores it", async () => {
    expect(await deactivateUser(IDLE, form({ userId: OTHER.toUpperCase() }))).toMatchObject({ status: "success" });
    expect(updates()[0].eq).toEqual([["id", OTHER]]);
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(OTHER, { ban_duration: "876000h" });
  });

  it("surfaces the last-admin rule and never bans", async () => {
    failures.update = { code: "23514", message: "cannot remove the last active admin" };
    expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toEqual({ status: "error", message: MESSAGES.lastAdmin });
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("warns when the data is blocked but the sign-in could not be", async () => {
    adminClient.auth.admin.updateUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 500, message: "Database error updating user" },
    });

    expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
      status: "warning",
      message:
        "Olga Other is deactivated and can no longer see any data, but Supabase could not block their sign-in: Database error updating user",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("still blocks the data without the secret key, and says the sign-in stays open", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    expect(await deactivateUser(IDLE, form({ userId: OTHER }))).toMatchObject({
      status: "warning",
      message: expect.stringContaining("SUPABASE_SECRET_KEY"),
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("deactivates on a project without lead inspectors, as before", async () => {
    teams = false;
    expect(await deactivateUser(IDLE, form({ userId: LEAD }))).toMatchObject({ status: "success" });
  });
});

describe("reactivateUser", () => {
  beforeEach(() => {
    rows.get(OTHER)!.active = false;
  });

  it("lifts the ban before activating the profile, back in their team", async () => {
    const result = await reactivateUser(IDLE, form({ userId: OTHER }));

    expect(result).toEqual({ status: "success", message: "Olga Other is active and can sign in." });
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledExactlyOnceWith(OTHER, { ban_duration: "none" });
    expect(updates()).toEqual([{ client: "user", fields: { active: true }, eq: [["id", OTHER]] }]);
    const unbannedAt = adminClient.auth.admin.updateUserById.mock.invocationCallOrder[0];
    const updatedAt = userClient.from.mock.invocationCallOrder.at(-1)!;
    expect(unbannedAt).toBeLessThan(updatedAt);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("activates a pending account, which was never banned, without touching Auth", async () => {
    adminClient.auth.admin.getUserById.mockResolvedValue({ data: { user: { banned_until: null } }, error: null });

    expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toMatchObject({ status: "success" });
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(updates()[0].fields).toEqual({ active: true });
  });

  describe("an inspector in no team", () => {
    beforeEach(() => {
      rows.get(OTHER)!.lead_id = null;
    });

    it("needs a lead first, and nothing changes until there is one", async () => {
      expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
        status: "error",
        message: "Choose their lead inspector.",
        fieldErrors: { leadId: "Choose their lead inspector." },
      });
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(updates()).toEqual([]);
    });

    it("says at the role field when nobody can lead them, and lifts no sign-in block", async () => {
      rows.get(LEAD)!.is_lead = false;
      rows.get(LEAD_TWO)!.is_lead = false;
      expect(await reactivateUser(IDLE, form({ userId: OTHER, role: "inspector" }))).toEqual({
        status: "error",
        message: NOBODY,
        fieldErrors: { role: NOBODY },
      });
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(updates()).toEqual([]);
    });

    it("joins the team chosen as they are activated", async () => {
      expect(await reactivateUser(IDLE, form({ userId: OTHER, role: "inspector", leadId: LEAD }))).toEqual({
        status: "success",
        message: "Olga Other is active and can sign in. They work in Lina Lead's team.",
      });
      expect(updates()[0].fields).toEqual({ role_id: INSPECTOR_ROLE, lead_id: LEAD, active: true });
    });

    it("keeps the role they have when the dialog sends none, a custom one too", async () => {
      rows.get(OTHER)!.role_id = FIELD_ROLE;
      expect(await reactivateUser(IDLE, form({ userId: OTHER, leadId: LEAD }))).toEqual({
        status: "success",
        message: "Olga Other is active and can sign in. Their role is Field Inspector, in Lina Lead's team.",
      });
      expect(updates()[0].fields).toEqual({ role_id: FIELD_ROLE, lead_id: LEAD, active: true });
    });

    it("can come back as a lead inspector, an admin or in a custom role instead", async () => {
      expect(await reactivateUser(IDLE, form({ userId: OTHER, role: "lead" }))).toMatchObject({
        message: "Olga Other is active and can sign in. They are a lead inspector.",
      });
      expect(updates()[0].fields).toEqual({ role_id: LEAD_ROLE, lead_id: null, active: true });

      rows.get(OTHER)!.active = false;
      rows.get(OTHER)!.is_lead = false;
      expect(await reactivateUser(IDLE, form({ userId: OTHER, role: REVIEWER_ROLE }))).toMatchObject({
        message: "Olga Other is active and can sign in. Their role is QA Reviewer.",
      });
      expect(updates().at(-1)?.fields).toEqual({ role_id: REVIEWER_ROLE, lead_id: null, active: true });
    });

    it("refuses a role deleted since the page loaded, and lifts no sign-in block", async () => {
      expect(await reactivateUser(IDLE, form({ userId: OTHER, role: GONE_ROLE }))).toEqual({
        status: "error",
        message: MESSAGES.roleGone,
        fieldErrors: { role: MESSAGES.roleGone },
      });
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(updates()).toEqual([]);
    });

    it("places them by their level on a project without roles", async () => {
      roles = false;
      expect(await reactivateUser(IDLE, form({ userId: OTHER, leadId: LEAD }))).toMatchObject({ status: "success" });
      expect(updates()[0].fields).toEqual({ role: "inspector", is_lead: false, lead_id: LEAD, active: true });
    });

    it("asks nothing when only a sign-in block is lifted from an active inspector from before teams", async () => {
      rows.get(OTHER)!.active = true;
      expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
        status: "success",
        message: "Olga Other is active and can sign in.",
      });
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(OTHER, { ban_duration: "none" });
      expect(updates()[0].fields).toEqual({ active: true });
    });

    it("is activated as before on a project without lead inspectors", async () => {
      teams = false;
      roles = false;
      expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
        status: "success",
        message: "Olga Other is active and can sign in.",
      });
      expect(updates()[0].fields).toEqual({ active: true });
    });
  });

  it("leaves the account blocked when the ban cannot be lifted", async () => {
    adminClient.auth.admin.updateUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 500, message: "Database error updating user" },
    });

    expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
      status: "error",
      message: "Olga Other was not activated: Supabase did not lift their sign-in block (Database error updating user).",
    });
    expect(updates()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts the ban back when the profile cannot be activated, so nothing changes", async () => {
    failures.update = { code: "57014", message: "statement timeout" };

    expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
      status: "error",
      message: "Olga Other was not activated. The change could not be saved: statement timeout.",
    });
    expect(adminClient.auth.admin.updateUserById.mock.calls).toEqual([
      [OTHER, { ban_duration: "none" }],
      [OTHER, { ban_duration: "876000h" }],
    ]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so when the ban could not be put back either", async () => {
    failures.update = { code: "57014", message: "statement timeout" };
    adminClient.auth.admin.updateUserById
      .mockResolvedValueOnce({ data: { user: {} }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: { status: 500, message: "Database error updating user" } });

    expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("Their sign-in block was lifted and could not be put back"),
    });
  });

  it("stops when Supabase Auth cannot say whether the account is banned", async () => {
    adminClient.auth.admin.getUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 503, message: "Service unavailable" },
    } as never);

    expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toEqual({
      status: "error",
      message: "Olga Other was not activated: Supabase Auth did not answer (Service unavailable). Try again.",
    });
    expect(updates()).toEqual([]);
  });

  it("activates without the secret key, and says an old ban may remain", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    expect(await reactivateUser(IDLE, form({ userId: OTHER }))).toMatchObject({
      status: "warning",
      message: expect.stringContaining("SUPABASE_SECRET_KEY"),
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("sendPasswordLink", () => {
  it("emails the address on the profile through the secret-key client, with the confirm route as redirect", async () => {
    const result = await sendPasswordLink(IDLE, form({ userId: OTHER, email: "attacker@example.com" }));

    expect(result).toEqual({ status: "success", message: "Password link sent to olga@test.local." });
    expect(adminClient.auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("olga@test.local", {
      redirectTo: "https://qc.example.com/auth/confirm",
    });
    // Not the admin's own client: that would leave a PKCE code verifier in their cookies.
    expect(userClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("falls back to the admin's own client without the secret key", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    expect(await sendPasswordLink(IDLE, form({ userId: OTHER }))).toMatchObject({ status: "success" });
    expect(userClient.auth.resetPasswordForEmail).toHaveBeenCalledOnce();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses accounts that cannot sign in", async () => {
    rows.get(OTHER)!.active = false;
    expect(await sendPasswordLink(IDLE, form({ userId: OTHER }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("Activate it first"),
    });
    expect(adminClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(userClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("explains a refused email", async () => {
    adminClient.auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" },
    } as never);
    expect(await sendPasswordLink(IDLE, form({ userId: OTHER }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("email limit for this hour"),
    });
  });
});

describe("invitations not yet answered", () => {
  const CONFIRM = "https://qc.example.com/auth/confirm";
  const COPY_INSTEAD = "Or choose Copy Invite Link and send them the link yourself.";

  /** Supabase Auth's account for the invitee: never opened (unconfirmed) and not banned unless said. */
  function authUser(extra: Record<string, unknown> = {}) {
    adminClient.auth.admin.getUserById.mockResolvedValue({
      data: { user: { id: INVITED, email: "zed@example.com", email_confirmed_at: null, banned_until: null, ...extra } },
      error: null,
    } as never);
  }

  beforeEach(() => authUser());

  describe.each([
    ["resendInvite", resendInvite],
    ["createInviteLink", createInviteLink],
  ] as const)("%s", (_name, action) => {
    const run = (userId: string) => action(IDLE, form({ userId }));

    it("refuses someone who has created their account, pointing at Send Password Link, and asks Auth nothing", async () => {
      expect(await run(OTHER)).toEqual({
        status: "error",
        message: "Olga Other has already created their account. If they need a new link, choose Send Password Link next to their name.",
      });
      expect(adminClient.auth.admin.getUserById).not.toHaveBeenCalled();
    });

    it("refuses an account that is not active: no link would let them in", async () => {
      rows.get(INVITED)!.active = false;
      expect(await run(INVITED)).toEqual({
        status: "error",
        message:
          "zed@example.com's account is not active, so a link would not let them in. Choose Activate or Reactivate next to their name first.",
      });
      expect(adminClient.auth.admin.getUserById).not.toHaveBeenCalled();
    });

    it("refuses while a ban blocks their sign-in", async () => {
      authUser({ banned_until: "2126-09-12T08:00:00Z" });
      expect(await run(INVITED)).toEqual({
        status: "error",
        message: "zed@example.com's sign-in is blocked, so a link would not let them in. Choose Lift Sign-In Block first.",
      });
      expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
      expect(adminClient.auth.admin.generateLink).not.toHaveBeenCalled();
    });

    it("says when Supabase Auth has no such account, or does not answer", async () => {
      adminClient.auth.admin.getUserById.mockResolvedValue({
        data: { user: null },
        error: { status: 404, code: "user_not_found", message: "User not found" },
      } as never);
      expect(await run(INVITED)).toEqual({ status: "error", message: MESSAGES.userNotFound });
      adminClient.auth.admin.getUserById.mockResolvedValue({
        data: { user: null },
        error: { status: 503, message: "Service unavailable" },
      } as never);
      expect(await run(INVITED)).toEqual({ status: "error", message: "Supabase Auth did not answer (Service unavailable). Try again." });
    });

    it("says when the user no longer exists", async () => {
      expect(await run(NEW)).toEqual({ status: "error", message: MESSAGES.userNotFound });
    });

    it("is switched off without the secret key, before reading anything", async () => {
      vi.mocked(isAdminClientConfigured).mockReturnValue(false);
      expect(await run(INVITED)).toEqual({ status: "error", message: MESSAGES.missingSecretKey });
      expect(createClient).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("says what is needed on a project without Account Creation", async () => {
      accounts = false;
      expect(await run(INVITED)).toEqual({ status: "error", message: MESSAGES.accountsMissing });
    });

    it("changes no profile", async () => {
      await run(INVITED);
      expect(updates()).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("resendInvite", () => {
    const resend = () => resendInvite(IDLE, form({ userId: INVITED }));

    it("invites an address that never opened its invite again, with a new link", async () => {
      adminClient.auth.admin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: INVITED } }, error: null } as never);

      expect(await resend()).toEqual({
        status: "success",
        message: "A new invite went to zed@example.com. The link in the earlier one no longer works.",
      });
      expect(adminClient.auth.admin.inviteUserByEmail).toHaveBeenCalledExactlyOnceWith("zed@example.com", { redirectTo: CONFIRM });
      expect(adminClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("sends a password link to someone who opened the invite without finishing: Supabase invites only once", async () => {
      authUser({ email_confirmed_at: "2026-10-26T09:00:00Z" });

      expect(await resend()).toEqual({
        status: "success",
        message:
          "zed@example.com opened the invite before without finishing, and Supabase sends an invite only once, so a password link went to zed@example.com instead. From it they go on to create their account.",
      });
      expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
      // The secret-key client: the admin's own would leave a PKCE code verifier in their cookies.
      expect(adminClient.auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("zed@example.com", { redirectTo: CONFIRM });
      expect(userClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("sends the password link when Supabase refuses the invite as taken: they opened it a moment ago", async () => {
      adminClient.auth.admin.inviteUserByEmail.mockResolvedValue({
        data: { user: null },
        error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" },
      } as never);

      expect(await resend()).toMatchObject({ status: "success", message: expect.stringContaining("a password link went to") });
      expect(adminClient.auth.resetPasswordForEmail).toHaveBeenCalledOnce();
    });

    it("explains an email Supabase did not send, and offers a link sent by hand", async () => {
      adminClient.auth.admin.inviteUserByEmail.mockResolvedValue({
        data: { user: null },
        error: { code: "email_address_not_authorized", status: 400, message: "Email address not authorized" },
      } as never);
      const refused = await resend();
      expect(refused).toMatchObject({ status: "error", message: expect.stringMatching(/^The invite email could not be sent: .*custom SMTP/) });
      expect(refused).toMatchObject({ message: expect.stringContaining(COPY_INSTEAD) });

      authUser({ email_confirmed_at: "2026-10-26T09:00:00Z" });
      adminClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: null,
        error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" },
      } as never);
      expect(await resend()).toEqual({
        status: "error",
        message: expect.stringMatching(/^The password link could not be sent: Supabase's email limit for this hour/),
      });
      expect(await resend()).toMatchObject({ message: expect.stringContaining(COPY_INSTEAD) });
    });

    it("does not offer a link by hand when Supabase refused the server's key: the link needs it too", async () => {
      adminClient.auth.admin.inviteUserByEmail.mockResolvedValue({
        data: { user: null },
        error: { status: 401, message: "Invalid API key" },
      } as never);
      const result = await resend();
      expect(result).toMatchObject({ status: "error", message: expect.stringContaining("SUPABASE_SECRET_KEY") });
      expect(result).not.toMatchObject({ message: expect.stringContaining("Copy Invite Link") });
    });
  });

  describe("createInviteLink", () => {
    const create = () => createInviteLink(IDLE, form({ userId: INVITED }));
    const MESSAGE =
      "It signs zed@example.com in to create their account. It works once, within an hour, and any earlier link no longer works, the one in their invite email included.";

    it("makes an invite link for an address that never opened its invite, on /auth/confirm, emailing nothing", async () => {
      expect(await create()).toEqual({
        status: "link",
        link: `${CONFIRM}?token_hash=invite-hash&type=invite`,
        message: MESSAGE,
      });
      expect(adminClient.auth.admin.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "invite", email: "zed@example.com" });
      expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
      expect(adminClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
      // The link signs its holder in: it goes to the admin who asked, never into a log.
      expect(console.error).not.toHaveBeenCalled();
    });

    it("never hands out Supabase's own action_link", async () => {
      const result = await create();
      expect(JSON.stringify(result)).not.toContain("supabase.co");
    });

    it("makes a magic link, checked as an email link, for someone who opened the invite without finishing", async () => {
      authUser({ email_confirmed_at: "2026-10-26T09:00:00Z" });
      expect(await create()).toEqual({ status: "link", link: `${CONFIRM}?token_hash=magiclink-hash&type=email`, message: MESSAGE });
      expect(adminClient.auth.admin.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "magiclink", email: "zed@example.com" });
    });

    it("makes the magic link when Supabase refuses the invite link as taken: they opened it a moment ago", async () => {
      adminClient.auth.admin.generateLink.mockResolvedValueOnce({
        data: { properties: null, user: null },
        error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" },
      } as never);
      expect(await create()).toMatchObject({ status: "link", link: `${CONFIRM}?token_hash=magiclink-hash&type=email` });
      expect(adminClient.auth.admin.generateLink.mock.calls.map(([params]) => params.type)).toEqual(["invite", "magiclink"]);
    });

    it("explains a refused link in plain words", async () => {
      adminClient.auth.admin.generateLink.mockResolvedValue({
        data: { properties: null, user: null },
        error: { status: 401, message: "Invalid API key" },
      } as never);
      expect(await create()).toEqual({
        status: "error",
        message:
          "The invite link was not created: Supabase refused the server's key. Check that SUPABASE_SECRET_KEY is the secret key of this project.",
      });
    });

    it("undoes an account Supabase made to hold the link when the invitee's went in the meantime", async () => {
      adminClient.auth.admin.generateLink.mockResolvedValue({
        data: {
          properties: { action_link: "", email_otp: "", hashed_token: "signup-hash", redirect_to: "", verification_type: "signup" },
          user: { id: NEW },
        },
        error: null,
      } as never);
      expect(await create()).toEqual({ status: "error", message: MESSAGES.userNotFound });
      expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith(NEW);
    });
  });

  describe("cancelInvite", () => {
    const cancel = (userId: string = INVITED) => cancelInvite(IDLE, form({ userId }));

    it("deletes the account nobody created, which takes its profile with it", async () => {
      expect(await cancel()).toEqual({
        status: "success",
        message: "The invite to zed@example.com is cancelled: its link no longer works, and the address can be invited again.",
      });
      expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith(INVITED);
      expect(rows.has(INVITED)).toBe(false);
      expect(refresh).toHaveBeenCalledOnce();
    });

    it.each([
      ["as the page sends it", SELF],
      ["in upper case", SELF.toUpperCase()],
    ])("refuses to cancel your own account (your id %s)", async (_case, userId) => {
      expect(await cancel(userId)).toEqual({ status: "error", message: MESSAGES.selfCancel });
      expect(createClient).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("refuses an account someone has created: Deactivate stops those", async () => {
      expect(await cancel(OTHER)).toEqual({
        status: "error",
        message:
          "Olga Other has already created their account, so there is no invite to cancel. To stop them signing in, choose Deactivate.",
      });
      expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it("cancels an invite whose account is no longer active too", async () => {
      rows.get(INVITED)!.active = false;
      expect(await cancel()).toMatchObject({ status: "success" });
    });

    it("moves an invited lead inspector's team first, naming it", async () => {
      rows.get(INVITED)!.is_lead = true;
      rows.get(OTHER)!.lead_id = INVITED;
      expect(await cancel()).toEqual({
        status: "error",
        message:
          "zed@example.com leads 1 inspector: Olga Other. Choose another lead inspector for them first (Change Lead Inspector, next to their name).",
      });
      expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it("says so in plain words when the database keeps the account", async () => {
      adminClient.auth.admin.deleteUser.mockResolvedValue({
        data: { user: null },
        error: { status: 500, code: "unexpected_failure", message: "Database error deleting user" },
      } as never);
      expect(await cancel()).toEqual({
        status: "error",
        message:
          "The invite to zed@example.com was not cancelled: records in the app point at their account, so the database keeps it. To stop them signing in, choose Deactivate instead.",
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("counts an account already gone as cancelled: another admin did it a moment ago", async () => {
      adminClient.auth.admin.deleteUser.mockResolvedValue({
        data: { user: null },
        error: { status: 404, code: "user_not_found", message: "User not found" },
      } as never);
      expect(await cancel()).toMatchObject({ status: "success" });
      expect(refresh).toHaveBeenCalledOnce();
    });

    it("cancels on a project without lead inspectors", async () => {
      teams = false;
      expect(await cancel()).toMatchObject({ status: "success" });
    });

    it("says when the user no longer exists, and is switched off without the secret key", async () => {
      expect(await cancel(NEW)).toEqual({ status: "error", message: MESSAGES.userNotFound });
      vi.mocked(isAdminClientConfigured).mockReturnValue(false);
      expect(await cancel()).toEqual({ status: "error", message: MESSAGES.missingSecretKey });
      expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    });
  });
});
