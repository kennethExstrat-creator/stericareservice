import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));

import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ActivateSchema,
  AssignLeadSchema,
  BAN_DURATION,
  ChangeRoleSchema,
  InviteUserSchema,
  MESSAGES,
  UserTargetSchema,
  accountStatus,
  authConfirmUrl,
  describeEmailError,
  describeProfileError,
  displayName,
  findProfileByEmail,
  firstFieldErrors,
  getUserDirectory,
  isBanned,
  isEmailRejected,
  isEmailTaken,
  isUntouched,
} from "./users";

const VIEWER = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NEW = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";

describe("InviteUserSchema", () => {
  it("trims and lowercases the email and trims the name", () => {
    const result = InviteUserSchema.parse({ email: "  Jane.Tan@Example.COM ", fullName: "  Jane Tan ", role: "admin" });
    expect(result).toEqual({ email: "jane.tan@example.com", fullName: "Jane Tan", role: "admin" });
  });

  it("accepts the test.local addresses the e2e specs use", () => {
    expect(InviteUserSchema.safeParse({ email: "e2e-users-ab12cd@test.local", fullName: "E2E", role: "inspector" }).success).toBe(true);
  });

  it.each([
    [{ email: "", fullName: "Jane", role: "inspector" }, "email", "Enter their email address."],
    [{ email: "jane@", fullName: "Jane", role: "inspector" }, "email", "Enter a valid email address, like name@example.com."],
    [{ email: "jane@example.com", fullName: "   ", role: "inspector" }, "fullName", "Enter their full name."],
    [{ email: "jane@example.com", fullName: "x".repeat(121), role: "inspector" }, "fullName", "Keep the name under 120 characters."],
    [{ email: "jane@example.com", fullName: "Jane", role: "owner" }, "role", "Choose Inspector, Lead inspector or Admin."],
    // A field missing from the form arrives as null.
    [{ email: null, fullName: null, role: null }, "email", "Enter their email address."],
  ])("explains what is wrong with %j", (input, field, message) => {
    const result = InviteUserSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(firstFieldErrors(result.error!)).toMatchObject({ [field]: message });
  });

  it("reports one message per field", () => {
    const result = InviteUserSchema.safeParse({ email: null, fullName: null, role: null });
    expect(firstFieldErrors(result.error!)).toEqual({
      email: "Enter their email address.",
      fullName: "Enter their full name.",
      role: "Choose Inspector, Lead inspector or Admin.",
    });
  });
});

describe("role and target schemas", () => {
  it("accept a uuid and a known role", () => {
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: "inspector" })).toEqual({ userId: OTHER, role: "inspector" });
    expect(UserTargetSchema.parse({ userId: OTHER })).toEqual({ userId: OTHER });
  });

  it("lower-case the id, so an upper-case copy compares equal to the session's", () => {
    expect(UserTargetSchema.parse({ userId: VIEWER.toUpperCase() })).toEqual({ userId: VIEWER });
    expect(ChangeRoleSchema.parse({ userId: "7C2D4E1A-0b3f-4A5C-9d8e-1F2A3B4C5D6E", role: "inspector" })).toEqual({
      userId: VIEWER,
      role: "inspector",
    });
  });

  it("refuse anything that is not a user id", () => {
    for (const userId of ["", "42", "not-a-uuid", null, `${OTHER}' or 1=1`]) {
      expect(UserTargetSchema.safeParse({ userId }).success).toBe(false);
    }
    expect(ChangeRoleSchema.safeParse({ userId: OTHER, role: "superuser" }).success).toBe(false);
  });
});

describe("the lead inspector in a form", () => {
  it("takes a lead id, lower-cased, and reads an empty choice as none", () => {
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: "inspector", leadId: NEW.toUpperCase() })).toMatchObject({
      role: "inspector",
      leadId: NEW,
    });
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: "lead", leadId: "" }).leadId).toBeUndefined();
    expect(InviteUserSchema.parse({ email: "a@example.com", fullName: "A", role: "lead", leadId: null }).leadId).toBeUndefined();
    expect(ChangeRoleSchema.safeParse({ userId: OTHER, role: "inspector", leadId: "lina" }).success).toBe(false);
  });

  it("needs a lead to move someone to another team", () => {
    expect(AssignLeadSchema.parse({ userId: OTHER, leadId: NEW })).toEqual({ userId: OTHER, leadId: NEW });
    const missing = AssignLeadSchema.safeParse({ userId: OTHER, leadId: "" });
    expect(missing.error?.issues[0].message).toBe("Choose their lead inspector.");
  });

  it("lets an activation carry a role and a lead, or neither", () => {
    expect(ActivateSchema.parse({ userId: OTHER, role: "", leadId: "" })).toEqual({ userId: OTHER });
    expect(ActivateSchema.parse({ userId: OTHER, role: "inspector", leadId: NEW })).toEqual({
      userId: OTHER,
      role: "inspector",
      leadId: NEW,
    });
  });
});

describe("accountStatus", () => {
  const now = Date.parse("2026-10-06T08:00:00Z");
  const created = "2026-10-01T09:00:00.123456+00:00";
  // As sign-up made it: insert sets both timestamps to the same instant.
  const untouched = (active: boolean) => ({ active, created_at: created, updated_at: created });
  // Changed since: activated, deactivated, renamed, its role changed...
  const changed = (active: boolean) => ({ active, created_at: created, updated_at: "2026-10-02T10:00:00Z" });
  const bannedUntil = "2126-09-12T08:00:00Z";

  it("is active whenever the profile is active", () => {
    expect(accountStatus(changed(true), null, now)).toBe("active");
    expect(accountStatus(untouched(true), null, now)).toBe("active");
  });

  it("is pending while the inactive profile is as sign-up made it, sign-in details or not", () => {
    // The person may have tried to sign in: Auth let them, the app did not.
    expect(accountStatus(untouched(false), null, now)).toBe("pending");
    expect(accountStatus(untouched(false), undefined, now)).toBe("pending");
  });

  it("is deactivated once anyone changed the inactive profile", () => {
    expect(accountStatus(changed(false), null, now)).toBe("deactivated");
  });

  it("is deactivated while Supabase Auth bans the account, untouched or not", () => {
    expect(accountStatus(untouched(false), bannedUntil, now)).toBe("deactivated");
    expect(accountStatus(changed(false), bannedUntil, now)).toBe("deactivated");
  });

  it("ignores a ban that has run out", () => {
    expect(accountStatus(untouched(false), "2026-10-05T08:00:00Z", now)).toBe("pending");
  });
});

describe("isUntouched and isBanned", () => {
  it("compares the timestamps as instants, not as text", () => {
    expect(isUntouched({ created_at: "2026-10-06T08:00:00.123+00:00", updated_at: "2026-10-06T08:00:00.123Z" })).toBe(true);
    expect(isUntouched({ created_at: "2026-10-06T08:00:00Z", updated_at: "2026-10-06T08:00:05Z" })).toBe(false);
  });

  it("counts a ban only until it runs out", () => {
    const now = Date.parse("2026-10-06T08:00:00Z");
    expect(isBanned("2126-09-12T08:00:00Z", now)).toBe(true);
    expect(isBanned("2026-10-05T08:00:00Z", now)).toBe(false);
    expect(isBanned(null, now)).toBe(false);
    expect(isBanned(undefined, now)).toBe(false);
  });
});

describe("errors in plain words", () => {
  it("points a refused invite email at custom SMTP and the README", () => {
    const message = describeEmailError(
      {
        code: "email_address_not_authorized",
        status: 400,
        message: 'Email address "e2e@test.local" cannot be used as it is not authorized',
      },
      "invite",
    );
    expect(message).toMatch(/^The invite email could not be sent/);
    expect(message).toContain("only delivers to members of the project's team");
    expect(message).toContain("custom SMTP");
    expect(message).toContain("README");
  });

  it("explains the hourly email limit and the short gap between two links", () => {
    expect(describeEmailError({ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" }, "invite")).toMatch(
      /email limit for this hour has been reached.*custom SMTP/,
    );
    expect(
      describeEmailError(
        { code: "over_email_send_rate_limit", status: 429, message: "For security purposes, you can only request this after 42 seconds." },
        "password link",
      ),
    ).toBe("The password link could not be sent: one went to this address moments ago. Wait a minute and try again.");
  });

  it("blames a rejected secret key, not the mailer", () => {
    expect(describeEmailError({ status: 401, message: "Invalid API key" }, "invite")).toBe(
      "The invite email was not sent: Supabase refused the server's key. Check that SUPABASE_SECRET_KEY is the secret key of this project.",
    );
    expect(describeEmailError({ status: 403, code: "not_admin", message: "User not allowed" }, "invite")).toMatch(
      /SUPABASE_SECRET_KEY/,
    );
  });

  it("explains an address Supabase refuses before any email (the live project refuses test.local)", () => {
    const refused = { code: "email_address_invalid", status: 400, message: 'Email address "x@test.local" is invalid' };
    expect(isEmailRejected(refused)).toBe(true);
    expect(describeEmailError(refused, "invite")).toBe(
      "Supabase refused this address: it does not look able to receive email (for example, its domain does not exist). Check it for typos.",
    );
    expect(describeEmailError(refused, "password link")).toMatch(/^The password link could not be sent: Supabase refused/);
    // "Email" in a message is not a mailer failure.
    expect(describeEmailError({ message: "Email address is invalid" }, "invite")).not.toContain("SMTP");
  });

  it("passes other Auth messages through", () => {
    expect(describeEmailError({ code: "unexpected_failure", status: 500, message: "Error sending invite email" }, "invite")).toMatch(
      /could not be sent.*custom SMTP/,
    );
    expect(describeEmailError({ message: "Database error saving new user" }, "invite")).toBe(
      "The invite email could not be sent: Database error saving new user.",
    );
  });

  it("recognises an address that already has an account", () => {
    expect(isEmailTaken({ code: "email_exists", message: "" })).toBe(true);
    expect(isEmailTaken({ status: 422, message: "A user with this email address has already been registered" })).toBe(true);
    expect(isEmailTaken({ code: "email_address_not_authorized", message: "not authorized" })).toBe(false);
  });

  it("turns the last-admin rule into a sentence", () => {
    expect(describeProfileError({ code: "23514", message: "cannot remove the last active admin" })).toBe(MESSAGES.lastAdmin);
    expect(describeProfileError({ code: "42501", message: "only an admin can change role or active" })).toBe(MESSAGES.notAllowed);
    expect(describeProfileError({ code: "08006", message: "connection failure" })).toBe(
      "The change could not be saved: connection failure.",
    );
  });

  // The database's words for the team rules (migration 20261007170000), when something changed in between.
  it.each([
    ["an active inspector needs a lead inspector", "Choose their lead inspector."],
    ["the lead inspector must be an active lead inspector", "That lead inspector is not an active lead inspector any more. Reload the page and choose another."],
    [
      "this lead inspector still leads 2 inspector(s): assign them to another lead inspector first",
      "They still lead a team. Choose another lead inspector for each person in it first, then try again.",
    ],
    ["nobody is their own lead inspector", "Nobody can be their own lead inspector. Choose someone else."],
    ["an admin is not a lead inspector and is in no team", "Admins and lead inspectors work in no lead inspector's team. Reload the page and try again."],
  ])("turns the team rule %j into a sentence", (message, expected) => {
    expect(describeProfileError({ code: "23514", message })).toBe(expected);
  });

  it("says when the database has no lead inspectors yet", () => {
    expect(describeProfileError({ code: "PGRST204", message: "Could not find the 'is_lead' column of 'profiles' in the schema cache" })).toMatch(
      /^Lead inspectors need a database update first/,
    );
  });
});

describe("helpers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("names people by full name, then email", () => {
    expect(displayName("  Jane Tan ", "jane@example.com")).toBe("Jane Tan");
    expect(displayName(null, "jane@example.com")).toBe("jane@example.com");
    expect(displayName("", "")).toBe("This user");
  });

  it("sends email links to /auth/confirm on the site URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qc.example.com/");
    expect(authConfirmUrl()).toBe("https://qc.example.com/auth/confirm");
  });

  it("bans deactivated accounts for a century", () => {
    expect(BAN_DURATION).toBe("876000h");
  });
});

/* ------------------------------------------------------------------ *
 * The directory, against a fake Supabase
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };

/** A query builder that records its chain and resolves when awaited. */
function query(result: Result, calls: Array<[string, unknown[]]> = []) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "ilike", "eq", "limit", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const PROFILES = [
  // Activated by an admin after sign-up.
  { id: VIEWER, email: "admin@test.local", full_name: "Test Admin", role: "admin", active: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:05:00Z" },
  // Deactivated later.
  { id: OTHER, email: "olga@test.local", full_name: "olga Other", role: "inspector", active: false, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" },
  // As sign-up made it: never activated.
  { id: NEW, email: "new@test.local", full_name: null, role: "inspector", active: false, created_at: "2026-10-03T00:00:00.5Z", updated_at: "2026-10-03T00:00:00.5Z" },
];

describe("getUserDirectory", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn(() => query({ data: PROFILES, error: null })),
    } as never);
  });
  afterEach(() => vi.resetAllMocks());

  it("merges sign-in details, marks the viewer and sorts by name", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    const listUsers = vi.fn().mockResolvedValue({
      data: {
        users: [
          { id: VIEWER, last_sign_in_at: "2026-10-06T01:00:00Z" },
          { id: OTHER, last_sign_in_at: "2026-10-04T01:00:00Z", banned_until: "2126-09-12T00:00:00Z" },
          { id: NEW },
        ],
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ auth: { admin: { listUsers } } } as never);

    const { users, adminApi } = await getUserDirectory(VIEWER);

    expect(adminApi).toBe("ok");
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 });
    expect(users.map((user) => [user.email, user.status, user.isSelf, user.lastSignInAt])).toEqual([
      ["new@test.local", "pending", false, null],
      ["olga@test.local", "deactivated", false, "2026-10-04T01:00:00Z"],
      ["admin@test.local", "active", true, "2026-10-06T01:00:00Z"],
    ]);
  });

  it("follows Auth's paging", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: [{ id: VIEWER }], nextPage: 2 }, error: null })
      .mockResolvedValueOnce({ data: { users: [{ id: OTHER, last_sign_in_at: "2026-10-04T01:00:00Z" }], nextPage: null }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ auth: { admin: { listUsers } } } as never);

    const { users } = await getUserDirectory(VIEWER);

    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
    expect(users.find((user) => user.id === OTHER)?.lastSignInAt).toBe("2026-10-04T01:00:00Z");
  });

  it("keeps a never-activated account pending after its owner tried to sign in", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ id: NEW, last_sign_in_at: "2026-10-03T00:02:00Z" }] },
            error: null,
          }),
        },
      },
    } as never);

    const { users } = await getUserDirectory(VIEWER);

    expect(users.find((user) => user.id === NEW)).toMatchObject({ status: "pending", lastSignInAt: "2026-10-03T00:02:00Z" });
  });

  it("flags an active account that Supabase Auth still bans", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: {
              users: [
                { id: VIEWER, banned_until: "2126-09-12T00:00:00Z" },
                { id: OTHER, banned_until: "2126-09-12T00:00:00Z" },
              ],
            },
            error: null,
          }),
        },
      },
    } as never);

    const { users } = await getUserDirectory(VIEWER);

    // Active and banned: blocked. Inactive and banned: simply deactivated.
    expect(Object.fromEntries(users.map((user) => [user.email, [user.status, user.signInBlocked]]))).toEqual({
      "admin@test.local": ["active", true],
      "olga@test.local": ["deactivated", false],
      "new@test.local": ["pending", false],
    });
  });

  it("calls a banned account deactivated, even one never activated", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ id: NEW, banned_until: "2126-09-12T00:00:00Z" }] },
            error: null,
          }),
        },
      },
    } as never);

    const { users } = await getUserDirectory(VIEWER);

    expect(users.find((user) => user.id === NEW)?.status).toBe("deactivated");
  });

  it("still tells pending from deactivated without the secret key, and says the key is missing", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    const { users, adminApi } = await getUserDirectory(VIEWER);

    expect(adminApi).toBe("missing-key");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(users.map((user) => [user.email, user.status, user.lastSignInAt])).toEqual([
      ["new@test.local", "pending", null],
      ["olga@test.local", "deactivated", null],
      ["admin@test.local", "active", null],
    ]);
  });

  it("still lists everyone when Supabase Auth fails", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: new Error("Invalid API key") }) } },
    } as never);

    const { users, adminApi } = await getUserDirectory(VIEWER);

    expect(adminApi).toBe("failed");
    expect(users).toHaveLength(3);
  });

  it("throws when the profiles cannot be read, for the error page", async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn(() => query({ data: null, error: { message: "relation does not exist" } })),
    } as never);
    await expect(getUserDirectory(VIEWER)).rejects.toThrow("Could not load the user list: relation does not exist");
  });
});

describe("getUserDirectory with lead inspectors", () => {
  const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const OLD_LEAD = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
  const MEMBER = "3d4e5f60-7182-4c9d-8e0f-2a3b4c5d6e7f";
  const created = "2026-10-01T00:00:00Z";
  const touched = "2026-10-02T00:00:00Z";
  const row = (id: string, email: string, full_name: string | null, extra: Record<string, unknown>) => ({
    id,
    email,
    full_name,
    role: "inspector",
    active: true,
    created_at: created,
    updated_at: touched,
    is_lead: false,
    lead_id: null,
    ...extra,
  });
  const ROWS = [
    row(VIEWER, "admin@test.local", "Test Admin", { role: "admin" }),
    row(LEAD, "lina@test.local", "Lina Lead", { is_lead: true }),
    row(OLD_LEAD, "otto@test.local", "Otto Old", { is_lead: true, active: false }),
    row(MEMBER, "ivan@test.local", "Ivan Inspector", { lead_id: LEAD }),
    row(OTHER, "olga@test.local", "Olga Other", { lead_id: LEAD, active: false }),
    // From before teams: active, in no team.
    row(NEW, "gail@test.local", "Gail Grandfathered", {}),
  ];

  afterEach(() => vi.resetAllMocks());

  it("gives each person their role, lead and team, flags inspectors in no team, and lists the active leads", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => query({ data: ROWS, error: null })) } as never);

    const { users, teams, leads } = await getUserDirectory(VIEWER);

    expect(teams).toBe(true);
    const byEmail = Object.fromEntries(users.map((user) => [user.email, user]));
    expect(byEmail["lina@test.local"]).toMatchObject({
      roleChoice: "lead",
      lead: null,
      team: [
        { id: MEMBER, name: "Ivan Inspector", active: true },
        { id: OTHER, name: "Olga Other", active: false },
      ],
      missingLead: false,
    });
    expect(byEmail["ivan@test.local"]).toMatchObject({ roleChoice: "inspector", lead: { id: LEAD, name: "Lina Lead" }, team: [] });
    expect(byEmail["admin@test.local"]).toMatchObject({ roleChoice: "admin", lead: null, missingLead: false });
    expect(byEmail["gail@test.local"]).toMatchObject({ roleChoice: "inspector", lead: null, missingLead: true });
    // A deactivated lead cannot take anyone on.
    expect(leads).toEqual([{ id: LEAD, name: "Lina Lead", teamSize: 2 }]);
  });

  it("works with roles only on a project without the lead inspector columns", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    const calls: Array<[string, unknown[]]> = [];
    let reads = 0;
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn(() => {
        reads += 1;
        return reads === 1
          ? query({ data: null, error: { code: "42703", message: "column profiles.is_lead does not exist" } }, calls)
          : query({ data: PROFILES, error: null }, calls);
      }),
    } as never);

    const { users, teams, leads } = await getUserDirectory(VIEWER);

    expect(teams).toBe(false);
    expect(leads).toEqual([]);
    expect(users).toHaveLength(3);
    // Nobody is flagged for a team the project does not have yet.
    expect(users.every((user) => !user.missingLead && user.lead === null && user.roleChoice !== "lead")).toBe(true);
    expect(calls.filter(([method]) => method === "select").map(([, args]) => args[0])).toEqual([
      "id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id",
      "id, email, full_name, role, active, created_at, updated_at",
    ]);
  });
});

describe("findProfileByEmail", () => {
  it("matches case-insensitively with LIKE wildcards escaped", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const client = { from: vi.fn(() => query({ data: [{ id: OTHER, active: true }], error: null }, calls)) };

    const found = await findProfileByEmail(client as never, "first_last@example.com");

    expect(found).toEqual({ id: OTHER, active: true });
    expect(calls).toContainEqual(["ilike", ["email", "first\\_last@example.com"]]);
  });

  it("returns null when nobody has the address", async () => {
    const client = { from: vi.fn(() => query({ data: [], error: null })) };
    expect(await findProfileByEmail(client as never, "nobody@example.com")).toBeNull();
  });
});
