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
const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const LEAD_TWO = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
const MEMBER = "3d4e5f60-7182-4c9d-8e0f-2a3b4c5d6e7f";
const IDLE: ActionResult = { status: "idle" };

/* ------------------------------------------------------------------ *
 * A fake Supabase: one profiles table that the admin's client and the
 * secret-key client both read and write, with every query recorded.
 * ------------------------------------------------------------------ */

type Row = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "inspector" | "admin";
  active: boolean;
  is_lead: boolean;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
};

type Query = { client: "user" | "admin"; calls: Array<[string, unknown[]]> };
type Failure = { code?: string; message: string };

const CREATED = "2026-10-01T00:00:00.123456+00:00";

function row(id: string, email: string, fullName: string | null, extra: Partial<Row> = {}): Row {
  return {
    id,
    email,
    full_name: fullName,
    role: "inspector",
    active: true,
    is_lead: false,
    lead_id: null,
    created_at: CREATED,
    updated_at: "2026-10-02T00:00:00Z",
    ...extra,
  };
}

let rows: Map<string, Row>;
let queries: Query[];
/** False: a project that has not run migration 20261007170000. */
let teams: boolean;
/** Makes the next matching operation fail. */
let failures: { update?: Failure; read?: Failure };

const MISSING_READ = { code: "42703", message: "column profiles.is_lead does not exist" };
const MISSING_WRITE = { code: "PGRST204", message: "Could not find the 'is_lead' column of 'profiles' in the schema cache" };

function project(source: Row | undefined, columns: string): Record<string, unknown> | null {
  if (!source) return null;
  return Object.fromEntries(columns.split(",").map((name) => [name.trim(), source[name.trim() as keyof Row]]));
}

function fakeClient(kind: "user" | "admin") {
  const from = vi.fn((table: string) => {
    expect(table).toBe("profiles");
    const query: Query = { client: kind, calls: [] };
    queries.push(query);
    const arg = (method: string) => query.calls.find(([name]) => name === method)?.[1];
    const eqs = () => query.calls.filter(([name]) => name === "eq").map(([, args]) => args as [string, unknown]);

    function run(single: boolean): { data: unknown; error: unknown } {
      const columns = String(arg("select")?.[0] ?? "");
      const update = arg("update")?.[0] as Partial<Row> | undefined;
      const touchesTeams = /is_lead|lead_id/.test(columns) || (update && ("is_lead" in update || "lead_id" in update));
      if (!teams && touchesTeams) return { data: null, error: update ? MISSING_WRITE : MISSING_READ };

      const matching = [...rows.values()].filter((candidate) =>
        eqs().every(([column, value]) => candidate[column as keyof Row] === value),
      );
      const ilike = arg("ilike") as [string, string] | undefined;
      const found = ilike
        ? matching.filter((candidate) => candidate.email?.toLowerCase() === ilike[1].replace(/\\(.)/g, "$1").toLowerCase())
        : matching;

      if (update) {
        if (failures.update) return { data: null, error: failures.update };
        for (const target of found) Object.assign(target, update, { updated_at: "2026-10-07T00:00:00Z" });
        const data = found.map((target) => project(target, columns || "id"));
        return { data: single ? (data[0] ?? null) : data, error: null };
      }
      if (failures.read) return { data: null, error: failures.read };
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
  const auth = {
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    admin: {
      inviteUserByEmail: vi.fn(async () => {
        // Supabase Auth creates the user; the sign-up trigger makes an inactive inspector.
        rows.set(NEW, row(NEW, "jane.tan@example.com", "Jane Tan", { active: false, updated_at: CREATED }));
        return { data: { user: { id: NEW } }, error: null };
      }),
      updateUserById: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
      // Deactivated accounts are banned; tests that need a pending one say so.
      getUserById: vi.fn().mockResolvedValue({ data: { user: { banned_until: "2126-09-12T08:00:00Z" } }, error: null }),
    },
  };
  return { from, auth };
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

const inviteForm = (overrides: Record<string, string> = {}) =>
  form({ email: "  Jane.Tan@Example.com ", fullName: " Jane Tan ", role: "admin", ...overrides });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qc.example.com");
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: SELF, email: "admin@test.local", fullName: "Test Admin", role: "admin" },
  });
  vi.mocked(isAdminClientConfigured).mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  teams = true;
  failures = {};
  queries = [];
  rows = new Map(
    [
      row(SELF, "admin@test.local", "Test Admin", { role: "admin" }),
      row(LEAD, "lina@test.local", "Lina Lead", { is_lead: true }),
      row(LEAD_TWO, "leo@test.local", "Leo Lead", { is_lead: true }),
      row(MEMBER, "ivan@test.local", "Ivan Inspector", { lead_id: LEAD }),
      row(OTHER, "olga@test.local", "Olga Other", { lead_id: LEAD_TWO }),
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
  const calls: Array<[string, () => Promise<ActionResult>]> = [
    ["inviteUser", () => inviteUser(IDLE, inviteForm())],
    ["changeRole", () => changeRole(IDLE, form({ userId: OTHER, role: "admin" }))],
    ["assignLead", () => assignLead(IDLE, form({ userId: OTHER, leadId: LEAD }))],
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
    const action = { changeRole, assignLead, deactivateUser, reactivateUser, sendPasswordLink }[name]!;
    const result = await action(IDLE, form({ userId: "1 or 1=1", role: "admin", leadId: LEAD }));
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
    const result = await inviteUser(IDLE, inviteForm());

    expect(result).toEqual({
      status: "success",
      message: "Invite sent to jane.tan@example.com. They choose a password from the link in the email.",
    });
    expect(adminClient.auth.admin.inviteUserByEmail).toHaveBeenCalledWith("jane.tan@example.com", {
      data: { full_name: "Jane Tan" },
      redirectTo: "https://qc.example.com/auth/confirm",
    });
    expect(updates()).toEqual([
      {
        client: "admin",
        fields: { role: "admin", is_lead: false, lead_id: null, full_name: "Jane Tan", active: true },
        // Only if nobody changed it since the read.
        eq: [
          ["id", NEW],
          ["updated_at", CREATED],
        ],
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("invites an inspector into the lead inspector's team chosen", async () => {
    const result = await inviteUser(IDLE, inviteForm({ role: "inspector", leadId: LEAD }));

    expect(result).toMatchObject({ status: "success", message: expect.stringMatching(/They work in Lina Lead's team\.$/) });
    expect(updates()[0].fields).toEqual({ role: "inspector", is_lead: false, lead_id: LEAD, full_name: "Jane Tan", active: true });
  });

  it("invites a lead inspector", async () => {
    await inviteUser(IDLE, inviteForm({ role: "lead" }));
    expect(updates()[0].fields).toMatchObject({ role: "inspector", is_lead: true, lead_id: null });
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

  it("refuses a lead who is not an active lead inspector, by name, before any email", async () => {
    rows.get(LEAD)!.active = false;
    const result = await inviteUser(IDLE, inviteForm({ role: "inspector", leadId: LEAD }));

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { leadId: "Lina Lead is not an active lead inspector any more. Choose another lead inspector." },
    });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("invites with roles only on a project without lead inspectors, and refuses a lead inspector there", async () => {
    teams = false;
    expect(await inviteUser(IDLE, inviteForm({ role: "inspector" }))).toMatchObject({ status: "success" });
    expect(updates()[0].fields).toEqual({ role: "inspector", full_name: "Jane Tan", active: true });

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

    expect(await inviteUser(IDLE, inviteForm())).toEqual({
      status: "warning",
      message:
        "Invite sent to jane.tan@example.com, but the account could not be activated. Choose Activate next to Jane Tan, then make them an admin.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("only asks for Activate when the invitee is an inspector", async () => {
    failures.update = { code: "57014", message: "statement timeout" };
    expect(await inviteUser(IDLE, inviteForm({ role: "inspector", leadId: LEAD }))).toMatchObject({
      status: "warning",
      message: expect.stringMatching(/Choose Activate next to Jane Tan\.$/),
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
    expect(updates()).toEqual([]);
  });

  it("stops at an address that already has an account, without sending anything", async () => {
    const result = await inviteUser(IDLE, inviteForm({ email: "OLGA@test.local" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { email: expect.stringContaining("already has an account") } });
    expect(adminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("points a deactivated address at Reactivate", async () => {
    rows.get(OTHER)!.active = false;
    const result = await inviteUser(IDLE, inviteForm({ email: "olga@test.local" }));
    expect(result).toMatchObject({ fieldErrors: { email: expect.stringContaining("Reactivate") } });
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
    const result = await inviteUser(IDLE, form({ email: "jane@", fullName: "", role: "owner" }));

    expect(result).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        email: "Enter a valid email address, like name@example.com.",
        fullName: "Enter their full name.",
        role: "Choose Inspector, Lead inspector or Admin.",
      },
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("changeRole", () => {
  it("makes someone an admin through the admin's own client, so RLS applies, and takes them out of their team", async () => {
    const result = await changeRole(IDLE, form({ userId: OTHER, role: "admin" }));

    expect(result).toEqual({ status: "success", message: "Olga Other is now an admin." });
    expect(updates()).toEqual([{ client: "user", fields: { role: "admin", is_lead: false, lead_id: null }, eq: [["id", OTHER]] }]);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
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

  it("refuses to demote a lead inspector whose team has members, naming them", async () => {
    for (const role of ["inspector", "admin"]) {
      const result = await changeRole(IDLE, form({ userId: LEAD, role, leadId: LEAD_TWO }));
      expect(result).toEqual({
        status: "error",
        message:
          "Lina Lead leads 1 inspector: Ivan Inspector. Choose another lead inspector for them first (Change lead inspector, next to their name).",
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
    ["as the page sends it", SELF],
    ["in upper case", SELF.toUpperCase()],
  ])("refuses to let admins demote themselves (their id %s)", async (_case, userId) => {
    expect(await changeRole(IDLE, form({ userId, role: "lead" }))).toEqual({ status: "error", message: MESSAGES.selfDemote });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("surfaces the database's own rules in plain words", async () => {
    failures.update = { code: "23514", message: "cannot remove the last active admin" };
    rows.get(OTHER)!.role = "admin";
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "lead" }))).toEqual({
      status: "error",
      message: "This would leave the app without an active admin. Make someone else an admin first.",
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

  it("changes roles only on a project without lead inspectors", async () => {
    teams = false;
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
  ])("refuses to put a lead inspector or an admin in a team", async (userId, message) => {
    expect(await assignLead(IDLE, form({ userId, leadId: LEAD_TWO }))).toEqual({ status: "error", message });
    expect(updates()).toEqual([]);
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
        "Lina Lead leads 1 inspector: Ivan Inspector. Choose another lead inspector for them first (Change lead inspector, next to their name).",
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

    it("joins the team chosen as they are activated", async () => {
      expect(await reactivateUser(IDLE, form({ userId: OTHER, role: "inspector", leadId: LEAD }))).toEqual({
        status: "success",
        message: "Olga Other is active and can sign in. They work in Lina Lead's team.",
      });
      expect(updates()[0].fields).toEqual({ role: "inspector", is_lead: false, lead_id: LEAD, active: true });
    });

    it("can come back as a lead inspector or an admin instead", async () => {
      expect(await reactivateUser(IDLE, form({ userId: OTHER, role: "lead" }))).toMatchObject({
        message: "Olga Other is active and can sign in. They are a lead inspector.",
      });
      expect(updates()[0].fields).toEqual({ role: "inspector", is_lead: true, lead_id: null, active: true });
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
