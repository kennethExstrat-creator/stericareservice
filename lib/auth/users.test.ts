import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));

import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
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
  isEmailTaken,
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
    [{ email: "jane@example.com", fullName: "Jane", role: "owner" }, "role", "Choose Inspector or Admin."],
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
      role: "Choose Inspector or Admin.",
    });
  });
});

describe("role and target schemas", () => {
  it("accept a uuid and a known role", () => {
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: "inspector" })).toEqual({ userId: OTHER, role: "inspector" });
    expect(UserTargetSchema.parse({ userId: OTHER })).toEqual({ userId: OTHER });
  });

  it("refuse anything that is not a user id", () => {
    for (const userId of ["", "42", "not-a-uuid", null, `${OTHER}' or 1=1`]) {
      expect(UserTargetSchema.safeParse({ userId }).success).toBe(false);
    }
    expect(ChangeRoleSchema.safeParse({ userId: OTHER, role: "superuser" }).success).toBe(false);
  });
});

describe("accountStatus", () => {
  const now = Date.parse("2026-10-06T08:00:00Z");
  const never = { lastSignInAt: null, bannedUntil: null };

  it("is active whenever the profile is active", () => {
    expect(accountStatus(true, never, now)).toBe("active");
    expect(accountStatus(true, null, now)).toBe("active");
  });

  it("is pending for an inactive account that never signed in and was never banned", () => {
    expect(accountStatus(false, never, now)).toBe("pending");
  });

  it("is deactivated once the person has signed in before", () => {
    expect(accountStatus(false, { lastSignInAt: "2026-10-01T09:00:00Z", bannedUntil: null }, now)).toBe("deactivated");
  });

  it("is deactivated for a banned account, even one that never signed in", () => {
    expect(accountStatus(false, { lastSignInAt: null, bannedUntil: "2126-09-12T08:00:00Z" }, now)).toBe("deactivated");
  });

  it("ignores a ban that has run out", () => {
    expect(accountStatus(false, { lastSignInAt: null, bannedUntil: "2026-10-05T08:00:00Z" }, now)).toBe("pending");
  });

  it("falls back to deactivated without sign-in details", () => {
    expect(accountStatus(false, null, now)).toBe("deactivated");
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

  it("names a refused address and passes other Auth messages through", () => {
    expect(describeEmailError({ code: "email_address_invalid", message: "Email address is invalid" }, "invite")).toMatch(/invalid/);
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
  { id: VIEWER, email: "admin@test.local", full_name: "Test Admin", role: "admin", active: true, created_at: "2026-10-01T00:00:00Z" },
  { id: OTHER, email: "olga@test.local", full_name: "olga Other", role: "inspector", active: false, created_at: "2026-10-02T00:00:00Z" },
  { id: NEW, email: "new@test.local", full_name: null, role: "inspector", active: false, created_at: "2026-10-03T00:00:00Z" },
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

  it("follows Auth's paging, and never calls someone missing from it pending", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: [{ id: VIEWER }], nextPage: 2 }, error: null })
      .mockResolvedValueOnce({ data: { users: [{ id: OTHER }], nextPage: null }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ auth: { admin: { listUsers } } } as never);

    const { users } = await getUserDirectory(VIEWER);

    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
    expect(Object.fromEntries(users.map((user) => [user.email, user.status]))).toEqual({
      "admin@test.local": "active",
      "olga@test.local": "pending",
      "new@test.local": "deactivated", // not in the listing: unknown, so not "pending"
    });
  });

  it("shows Active and Deactivated only, and says why, without the secret key", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    const { users, adminApi } = await getUserDirectory(VIEWER);

    expect(adminApi).toBe("missing-key");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(users.map((user) => user.status)).toEqual(["deactivated", "deactivated", "active"]);
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
