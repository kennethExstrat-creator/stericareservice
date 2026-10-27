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
  DeleteUserSchema,
  InviteUserSchema,
  MESSAGES,
  NAME_MAX_LENGTH,
  UserDetailsSchema,
  UserTargetSchema,
  accountStatus,
  authConfirmUrl,
  describeCancelError,
  describeDeleteError,
  describeEmailError,
  describeLinkError,
  describeProfileError,
  displayName,
  findKeptRecords,
  findProfileByEmail,
  findRole,
  firstFieldErrors,
  getUserDirectory,
  inviteLinkUrl,
  isBanned,
  isEmailRejected,
  isEmailTaken,
  isKept,
  isKeptByRecords,
  isMissingAccountColumn,
  isMissingRolesTable,
  isMissingUidColumn,
  isPhoneRefused,
  isUntouched,
  keptByDatabaseMessage,
  keptMessage,
  linkWouldHelp,
  type KeptRecords,
} from "./users";

const VIEWER = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NEW = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";
/** A custom role's id, as the Role field sends it. */
const REVIEWER_ROLE = "44444444-4444-4444-8444-444444444444";

const CHOOSE_ROLE = "Choose their role.";

describe("InviteUserSchema", () => {
  it("trims and lowercases the email, and sends an email unless asked for a link", () => {
    const result = InviteUserSchema.parse({ email: "  Jane.Tan@Example.COM ", role: "admin" });
    expect(result).toEqual({ email: "jane.tan@example.com", role: "admin", delivery: "email" });
    // A form sends "" for no choice, and a missing field arrives as null: an email, as before.
    for (const delivery of ["", null]) {
      expect(InviteUserSchema.parse({ email: "jane@example.com", role: "admin", delivery }).delivery).toBe("email");
    }
    expect(InviteUserSchema.parse({ email: "jane@example.com", role: "admin", delivery: "link" }).delivery).toBe("link");
  });

  it("takes a role by its id, lower-cased, or a built-in role by its kind", () => {
    expect(InviteUserSchema.parse({ email: "jane@example.com", role: REVIEWER_ROLE.toUpperCase() }).role).toBe(REVIEWER_ROLE);
    for (const role of ["admin", "lead", "inspector"]) {
      expect(InviteUserSchema.parse({ email: "jane@example.com", role }).role).toBe(role);
    }
  });

  it("takes no name: the invitee gives their own on Account Creation", () => {
    // A name sent anyway (a form from before) is dropped, never saved.
    expect(InviteUserSchema.parse({ email: "jane@example.com", fullName: "Jane Tan", role: "inspector" })).toEqual({
      email: "jane@example.com",
      role: "inspector",
      delivery: "email",
    });
  });

  it("accepts the test.local addresses the e2e specs use", () => {
    expect(InviteUserSchema.safeParse({ email: "e2e-users-ab12cd@test.local", role: "inspector" }).success).toBe(true);
  });

  it.each([
    [{ email: "", role: "inspector" }, "email", "Enter their email address."],
    [{ email: "jane@", role: "inspector" }, "email", "Enter a valid email address, like name@example.com."],
    [{ email: `${"x".repeat(250)}@example.com`, role: "inspector" }, "email", "That email address is too long."],
    [{ email: "jane@example.com", role: "owner" }, "role", CHOOSE_ROLE],
    [{ email: "jane@example.com", role: "" }, "role", CHOOSE_ROLE],
    [{ email: "jane@example.com", role: "Admin" }, "role", CHOOSE_ROLE],
    [{ email: "jane@example.com", role: "inspector", delivery: "fax" }, "delivery", "Choose Send Email or Create Link."],
    // A field missing from the form arrives as null.
    [{ email: null, role: null }, "email", "Enter their email address."],
  ])("explains what is wrong with %j", (input, field, message) => {
    const result = InviteUserSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(firstFieldErrors(result.error!)).toMatchObject({ [field]: message });
  });

  it("reports one message per field", () => {
    const result = InviteUserSchema.safeParse({ email: null, role: null });
    expect(firstFieldErrors(result.error!)).toEqual({
      email: "Enter their email address.",
      role: CHOOSE_ROLE,
    });
  });
});

describe("role and target schemas", () => {
  it("accept a uuid and a role", () => {
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: "inspector" })).toEqual({ userId: OTHER, role: "inspector" });
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: REVIEWER_ROLE })).toEqual({ userId: OTHER, role: REVIEWER_ROLE });
    expect(UserTargetSchema.parse({ userId: OTHER })).toEqual({ userId: OTHER });
  });

  it("lower-case the ids, so an upper-case copy compares equal to the session's", () => {
    expect(UserTargetSchema.parse({ userId: VIEWER.toUpperCase() })).toEqual({ userId: VIEWER });
    expect(ChangeRoleSchema.parse({ userId: "7C2D4E1A-0b3f-4A5C-9d8e-1F2A3B4C5D6E", role: REVIEWER_ROLE.toUpperCase() })).toEqual({
      userId: VIEWER,
      role: REVIEWER_ROLE,
    });
  });

  it("refuse anything that is not a user id, or a role", () => {
    for (const userId of ["", "42", "not-a-uuid", null, `${OTHER}' or 1=1`]) {
      expect(UserTargetSchema.safeParse({ userId }).success).toBe(false);
    }
    for (const role of ["superuser", `${REVIEWER_ROLE}' or 1=1`, null]) {
      const result = ChangeRoleSchema.safeParse({ userId: OTHER, role });
      expect(firstFieldErrors(result.error!)).toEqual({ role: CHOOSE_ROLE });
    }
  });

  it("take Delete Permanently's person and what was typed, anything but text as nothing typed", () => {
    expect(DeleteUserSchema.parse({ userId: OTHER.toUpperCase(), confirm: " SC-0003 " })).toEqual({ userId: OTHER, confirm: " SC-0003 " });
    // A form without the box sends null: the action asks for the UID.
    for (const confirm of [null, undefined, 42, "x".repeat(321)]) {
      expect(DeleteUserSchema.parse({ userId: OTHER, confirm }).confirm).toBe("");
    }
    expect(DeleteUserSchema.safeParse({ userId: "not-a-uuid", confirm: "SC-0003" }).success).toBe(false);
  });
});

describe("UserDetailsSchema", () => {
  const details = (fullName: unknown, phone: unknown = "") => UserDetailsSchema.safeParse({ userId: OTHER, fullName, phone });

  it("keeps the name on one line: trimmed, with runs of spaces, tabs and line breaks made one space", () => {
    expect(UserDetailsSchema.parse({ userId: OTHER.toUpperCase(), fullName: "  Ngan \t Boon\r\nKeat  ", phone: "" })).toEqual({
      userId: OTHER,
      fullName: "Ngan Boon Keat",
      phone: null,
    });
  });

  it("takes 1 to 100 characters", () => {
    expect(NAME_MAX_LENGTH).toBe(100);
    expect(details("x".repeat(100)).data?.fullName).toHaveLength(100);
    expect(details("Q").data?.fullName).toBe("Q");
  });

  it.each([
    ["an empty name", "", "Enter their name."],
    ["spaces only", " \n\t ", "Enter their name."],
    ["a missing field", null, "Enter their name."],
    ["101 characters", "x".repeat(101), "Keep the name to 100 characters or fewer."],
    ["a hidden control character", "Ngan\u0000Keat", "The name holds a hidden control character. Type it again."],
    ["a pasted next-line character", "Ngan\u0085Keat", "The name holds a hidden control character. Type it again."],
  ])("refuses %s, at the name", (_case, fullName, message) => {
    const result = details(fullName);
    expect(result.success).toBe(false);
    expect(firstFieldErrors(result.error!)).toEqual({ fullName: message });
  });

  it("takes a phone number as typed, on one line, and blank as none", () => {
    expect(details("Olga", " +60 12-345 6789 ").data?.phone).toBe("+60 12-345 6789");
    expect(details("Olga", "(03)  1234\t5678").data?.phone).toBe("(03) 1234 5678");
    expect(details("Olga", "012-345 6789").data?.phone).toBe("012-345 6789");
    // An account from before phones may stay without one.
    expect(details("Olga", "").data?.phone).toBeNull();
    expect(details("Olga", "   ").data?.phone).toBeNull();
  });

  it("leaves the phone as it is when the form has no such field", () => {
    expect(details("Olga", null).data?.phone).toBeUndefined();
    expect(UserDetailsSchema.parse({ userId: OTHER, fullName: "Olga" }).phone).toBeUndefined();
  });

  it.each([
    ["too few digits", "12345"],
    ["words", "call me"],
    ["more than 15 digits", "+60 12 345 6789 0000 1"],
    ["a hyphen at the end", "0123456789-"],
    ["a plus and a hyphen", "+-0123456789"],
  ])("refuses a phone number with %s, at the phone", (_case, phone) => {
    const result = details("Olga", phone);
    expect(result.success).toBe(false);
    expect(firstFieldErrors(result.error!)).toEqual({ phone: "Enter a phone number, like +60 12-345 6789 or 012-345 6789." });
  });

  it("reports the name and the phone at once", () => {
    expect(firstFieldErrors(details("", "x").error!)).toEqual({
      fullName: "Enter their name.",
      phone: "Enter a phone number, like +60 12-345 6789 or 012-345 6789.",
    });
  });

  it("refuses anything that is not a user id", () => {
    const result = UserDetailsSchema.safeParse({ userId: "1 or 1=1", fullName: "Ngan Boon Keat", phone: "" });
    expect(firstFieldErrors(result.error!)).toEqual({ userId: MESSAGES.userNotFound });
  });
});

describe("the lead inspector in a form", () => {
  it("takes a lead id, lower-cased, and reads an empty choice as none", () => {
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: "inspector", leadId: NEW.toUpperCase() })).toMatchObject({
      role: "inspector",
      leadId: NEW,
    });
    expect(ChangeRoleSchema.parse({ userId: OTHER, role: "lead", leadId: "" }).leadId).toBeUndefined();
    expect(InviteUserSchema.parse({ email: "a@example.com", role: "lead", leadId: null }).leadId).toBeUndefined();
    expect(ChangeRoleSchema.safeParse({ userId: OTHER, role: "inspector", leadId: "lina" }).success).toBe(false);
  });

  it("needs a lead to move someone to another team", () => {
    expect(AssignLeadSchema.parse({ userId: OTHER, leadId: NEW })).toEqual({ userId: OTHER, leadId: NEW });
    const missing = AssignLeadSchema.safeParse({ userId: OTHER, leadId: "" });
    expect(missing.error?.issues[0].message).toBe("Choose their lead inspector.");
  });

  it("lets an activation carry a role and a lead, or neither", () => {
    expect(ActivateSchema.parse({ userId: OTHER, role: "", leadId: "" })).toEqual({ userId: OTHER });
    expect(ActivateSchema.parse({ userId: OTHER, role: null, leadId: null })).toEqual({ userId: OTHER });
    expect(ActivateSchema.parse({ userId: OTHER, role: "inspector", leadId: NEW })).toEqual({
      userId: OTHER,
      role: "inspector",
      leadId: NEW,
    });
    expect(ActivateSchema.parse({ userId: OTHER, role: REVIEWER_ROLE }).role).toBe(REVIEWER_ROLE);
    expect(ActivateSchema.safeParse({ userId: OTHER, role: "owner" }).success).toBe(false);
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

  it("is active whenever the profile is active and its person has joined", () => {
    expect(accountStatus(changed(true), null, now)).toBe("active");
    expect(accountStatus(untouched(true), null, now)).toBe("active");
    expect(accountStatus({ ...changed(true), joined_at: "2026-10-03T00:00:00Z" }, null, now)).toBe("active");
  });

  it("is invited while an active account's person has not created it yet", () => {
    expect(accountStatus({ ...changed(true), joined_at: null }, null, now)).toBe("invited");
    // A ban does not change it: the list flags the blocked sign-in beside it.
    expect(accountStatus({ ...changed(true), joined_at: null }, bannedUntil, now)).toBe("invited");
  });

  it("counts everyone as joined on a database without joined_at (migration 20261027140000)", () => {
    expect(accountStatus(changed(true), null, now)).toBe("active");
  });

  it("is pending or deactivated when inactive, joined or not", () => {
    expect(accountStatus({ ...untouched(false), joined_at: null }, null, now)).toBe("pending");
    expect(accountStatus({ ...changed(false), joined_at: null }, null, now)).toBe("deactivated");
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
    expect(MESSAGES.lastAdmin).toBe("This would leave nobody active with the Admin role. Give someone else the Admin role first.");
    expect(describeProfileError({ code: "42501", message: "only an admin can change role or active" })).toBe(MESSAGES.notAllowed);
    expect(describeProfileError({ code: "08006", message: "connection failure" })).toBe(
      "The change could not be saved: connection failure.",
    );
  });

  it("says when the role chosen went in the meantime, or the database has no roles yet", () => {
    expect(
      describeProfileError({
        code: "23503",
        message: 'insert or update on table "profiles" violates foreign key constraint "profiles_role_id_fkey"',
      }),
    ).toBe(MESSAGES.roleGone);
    expect(describeProfileError({ code: "PGRST204", message: "Could not find the 'role_id' column of 'profiles' in the schema cache" })).toBe(
      MESSAGES.rolesMissing,
    );
    expect(MESSAGES.rolesMissing).toContain("20261027150000_roles_and_permissions.sql");
    // Another foreign key is not about roles.
    expect(describeProfileError({ code: "23503", message: 'violates foreign key constraint "profiles_lead_id_fkey"' })).toMatch(
      /^The change could not be saved/,
    );
  });

  it("recognises a database without the roles table, and nothing else", () => {
    expect(isMissingRolesTable({ code: "PGRST205", message: "Could not find the table 'public.roles' in the schema cache" })).toBe(true);
    expect(isMissingRolesTable({ code: "42P01", message: 'relation "public.roles" does not exist' })).toBe(true);
    expect(isMissingRolesTable({ code: "PGRST205", message: "Could not find the table 'public.clients' in the schema cache" })).toBe(false);
    expect(isMissingRolesTable({ code: "42501", message: "permission denied for table roles" })).toBe(false);
    expect(isMissingRolesTable(null)).toBe(false);
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

  it("says when the database has no phone numbers yet, and when it refuses one", () => {
    for (const error of [
      { code: "PGRST204", message: "Could not find the 'phone' column of 'profiles' in the schema cache" },
      { code: "42703", message: "column profiles.joined_at does not exist" },
    ]) {
      expect(describeProfileError(error)).toBe(MESSAGES.accountsMissing);
    }
    expect(MESSAGES.accountsMissing).toContain("20261027140000_profile_phone_and_joined.sql");
    const refused = { code: "23514", message: 'new row for relation "profiles" violates check constraint "profiles_phone_format"' };
    expect(isPhoneRefused(refused)).toBe(true);
    expect(describeProfileError(refused)).toBe(MESSAGES.phoneRefused);
    expect(isPhoneRefused({ code: "23514", message: "cannot remove the last active admin" })).toBe(false);
  });
});

describe("invite links and cancelled invites in plain words", () => {
  it("explains a refused invite link without blaming the mailer: nothing is emailed", () => {
    expect(describeLinkError({ status: 401, message: "Invalid API key" })).toBe(
      "The invite link was not created: Supabase refused the server's key. Check that SUPABASE_SECRET_KEY is the secret key of this project.",
    );
    expect(describeLinkError({ status: 404, code: "user_not_found", message: "User with this email not found" })).toBe(
      MESSAGES.userNotFound,
    );
    expect(describeLinkError({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" })).toMatch(
      /too many requests to Supabase just now/,
    );
    expect(describeLinkError({ status: 500, message: "Database error finding user" })).toBe(
      "The invite link was not created: Database error finding user.",
    );
    expect(describeLinkError({ message: "" })).toBe("The invite link was not created: Supabase did not say why.");
    // Create Link makes a new account: Supabase checks its address as it would for an email.
    expect(describeLinkError({ code: "email_address_invalid", status: 400, message: 'Email address "x@nowhere.example" is invalid' })).toBe(
      MESSAGES.addressRefused,
    );
  });

  it("says why an invite could not be cancelled, pointing at Deactivate when records keep the account", () => {
    expect(describeCancelError({ status: 500, code: "unexpected_failure", message: "Database error deleting user" }, "jo@example.com")).toBe(
      "The invite to jo@example.com was not cancelled: records in the app point at their account, so the database keeps it. To stop them signing in, choose Deactivate instead.",
    );
    expect(describeCancelError({ code: "not_admin", message: "User not allowed" }, "Jo")).toMatch(/SUPABASE_SECRET_KEY/);
    expect(describeCancelError({ status: 503, message: "Service unavailable" }, "Jo")).toBe(
      "The invite to Jo was not cancelled: Service unavailable.",
    );
  });

  it("offers a link sent by hand after any refused email but one the server's key caused", () => {
    expect(linkWouldHelp({ code: "email_address_not_authorized", message: "not authorized" })).toBe(true);
    expect(linkWouldHelp({ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" })).toBe(true);
    expect(linkWouldHelp({ status: 401, message: "Invalid API key" })).toBe(false);
  });
});

describe("deleting someone for good", () => {
  const NOTHING: KeptRecords = { inspections: 0, photos: 0, files: 0, aiDecisions: 0, history: 0, coverage: 0, team: [] };
  const kept = (counts: Partial<KeptRecords>): KeptRecords => ({ ...NOTHING, ...counts });

  it("keeps someone any QC record or team member points at, and nobody else", () => {
    expect(isKept(NOTHING)).toBe(false);
    for (const counts of [{ inspections: 1 }, { photos: 1 }, { files: 1 }, { aiDecisions: 1 }, { history: 1 }, { coverage: 1 }, { team: ["Ivan"] }]) {
      expect(isKept(kept(counts)), JSON.stringify(counts)).toBe(true);
    }
  });

  it("says why in Kenneth's words, naming each kind that applies, counted, in order", () => {
    expect(keptMessage("SC-0003", kept({ inspections: 4, history: 21 }))).toBe(
      "SC-0003 cannot be deleted: their name is on 4 inspections and 21 history entries, which QC records keep. They stay deactivated and cannot sign in.",
    );
    expect(keptMessage("SC-0003", kept({ inspections: 1, photos: 1, files: 1, aiDecisions: 1, history: 1, coverage: 1 }))).toBe(
      "SC-0003 cannot be deleted: their name is on 1 inspection, 1 photo, 1 file, 1 Steri-AI decision, 1 history entry and 1 template coverage confirmation, which QC records keep. They stay deactivated and cannot sign in.",
    );
    expect(keptMessage("Olga Other", kept({ photos: 12, files: 2, aiDecisions: 3, coverage: 2 }))).toBe(
      "Olga Other cannot be deleted: their name is on 12 photos, 2 files, 3 Steri-AI decisions and 2 template coverage confirmations, which QC records keep. They stay deactivated and cannot sign in.",
    );
  });

  it("says a pending account, never let in, stays inactive", () => {
    expect(keptMessage("SC-0003", kept({ history: 1 }), "inactive")).toBe(
      "SC-0003 cannot be deleted: their name is on 1 history entry, which QC records keep. They stay inactive and cannot sign in.",
    );
  });

  it("names who still has them as lead inspector, and says to move them when that is all that keeps them", () => {
    expect(keptMessage("SC-0003", kept({ team: ["Ivan Inspector"] }))).toBe(
      "SC-0003 cannot be deleted yet: Ivan Inspector still has them as lead inspector. Choose another lead inspector for them first (Change Lead Inspector, next to their name).",
    );
    expect(keptMessage("SC-0003", kept({ team: ["Ivan Inspector", "Olga Other"] }))).toBe(
      "SC-0003 cannot be deleted yet: Ivan Inspector and Olga Other still have them as lead inspector. Choose another lead inspector for each of them first (Change Lead Inspector, next to their name).",
    );
    // QC records keep them anyway: moving the team would not help.
    expect(keptMessage("SC-0003", kept({ inspections: 2, team: ["Ivan Inspector"] }))).toBe(
      "SC-0003 cannot be deleted: their name is on 2 inspections, which QC records keep, and Ivan Inspector still has them as lead inspector. They stay deactivated and cannot sign in.",
    );
  });

  it("says the database keeps them when it refuses though nothing was counted", () => {
    const words =
      "SC-0003 cannot be deleted: records in the app still point at their account, so the database keeps it. They stay deactivated and cannot sign in.";
    expect(keptByDatabaseMessage("SC-0003")).toBe(words);
    expect(keptMessage("SC-0003", NOTHING)).toBe(words);
  });

  it("recognises the database keeping an account, as a foreign key or as Supabase Auth says it", () => {
    expect(isKeptByRecords({ status: 500, code: "unexpected_failure", message: "Database error deleting user" })).toBe(true);
    expect(
      isKeptByRecords({ code: "23503", message: 'update or delete on table "profiles" violates foreign key constraint "inspections_inspector_id_fkey"' }),
    ).toBe(true);
    expect(isKeptByRecords({ status: 503, message: "Service unavailable" })).toBe(false);
    expect(isKeptByRecords({ status: 401, message: "Invalid API key" })).toBe(false);
  });

  it("says why Supabase Auth did not delete someone otherwise", () => {
    expect(describeDeleteError({ status: 401, message: "Invalid API key" }, "SC-0003")).toBe(
      "SC-0003 was not deleted: Supabase refused the server's key. Check that SUPABASE_SECRET_KEY is the secret key of this project.",
    );
    expect(describeDeleteError({ status: 503, message: "Service unavailable" }, "SC-0003")).toBe("SC-0003 was not deleted: Service unavailable.");
    expect(describeDeleteError({ message: "" }, "Olga Other")).toBe("Olga Other was not deleted: Supabase did not say why.");
  });

  describe("findKeptRecords", () => {
    type Answer = { count?: number; data?: unknown; error?: { code?: string; message: string } | null };

    /** The secret-key client: each table answers `answers[table]`, every call recorded. */
    function admin(answers: Record<string, Answer>, calls: Array<[string, string, unknown[]]> = []) {
      return {
        from: vi.fn((table: string) => {
          const builder: Record<string, unknown> = {};
          for (const method of ["select", "eq", "or"]) {
            builder[method] = (...args: unknown[]) => {
              calls.push([table, method, args]);
              return builder;
            };
          }
          const { count = 0, data = [], error = null } = answers[table] ?? {};
          builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ count, data, error }).then(resolve);
          return builder;
        }),
      } as never;
    }

    it("counts each kind with the secret-key client and names the team, by name", async () => {
      const calls: Array<[string, string, unknown[]]> = [];
      const client = admin(
        {
          inspections: { count: 4 },
          inspection_photos: { count: 12 },
          audit_log: { count: 21 },
          profiles: { data: [{ id: NEW, full_name: "Olga Other", email: "olga@test.local", active: true }, { id: VIEWER, full_name: null, email: "ivan@test.local", active: false }] },
        },
        calls,
      );
      expect(await findKeptRecords(client, OTHER.toUpperCase())).toEqual({
        kept: { inspections: 4, photos: 12, files: 0, aiDecisions: 0, history: 21, coverage: 0, team: ["ivan@test.local", "Olga Other"] },
        error: null,
      });
      // Inspections they did or approved, in one count, so one they did and approved counts once.
      expect(calls).toContainEqual(["inspections", "or", [`inspector_id.eq.${OTHER},approved_by.eq.${OTHER}`]]);
      expect(calls).toContainEqual(["profiles", "eq", ["lead_id", OTHER]]);
    });

    it("refuses anything but a user id before asking anything: the id goes into a filter", async () => {
      const client = admin({});
      await expect(findKeptRecords(client, `${OTHER}),approved_by.not.is.null`)).rejects.toThrow();
      expect((client as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
    });

    it("hands back the database's error, but counts no team on a project without lead inspectors", async () => {
      const timeout = { code: "57014", message: "statement timeout" };
      expect(await findKeptRecords(admin({ audit_log: { error: timeout } }), OTHER)).toEqual({ kept: null, error: timeout });
      const noTeams = { code: "42703", message: "column profiles.lead_id does not exist" };
      expect(await findKeptRecords(admin({ profiles: { error: noTeams } }), OTHER)).toEqual({
        kept: { inspections: 0, photos: 0, files: 0, aiDecisions: 0, history: 0, coverage: 0, team: [] },
        error: null,
      });
    });
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

  it("builds Copy Invite Link's address on /auth/confirm, never Supabase's own link", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qc.example.com");
    const tokenHash = "5d41402abc4b2a76b9719d911017c592ae2c3a5e9ac2d1d6e2e5e1b2";
    expect(inviteLinkUrl({ hashed_token: tokenHash, verification_type: "invite" })).toBe(
      `https://qc.example.com/auth/confirm?token_hash=${tokenHash}&type=invite`,
    );
    // A magic link is checked as an email link: /auth/confirm accepts no "magiclink".
    expect(inviteLinkUrl({ hashed_token: tokenHash, verification_type: "magiclink" })).toBe(
      `https://qc.example.com/auth/confirm?token_hash=${tokenHash}&type=email`,
    );
    // Any other kind is not handed out.
    expect(inviteLinkUrl({ hashed_token: tokenHash, verification_type: "signup" })).toBeNull();
    expect(inviteLinkUrl({ hashed_token: "", verification_type: "invite" })).toBeNull();
  });

  it("recognises a database without phones or Account Creation, and nothing else", () => {
    expect(isMissingAccountColumn({ code: "42703", message: "column profiles.phone does not exist" })).toBe(true);
    expect(isMissingAccountColumn({ code: "42703", message: "column profiles.joined_at does not exist" })).toBe(true);
    expect(isMissingAccountColumn({ code: "PGRST204", message: "Could not find the 'phone' column of 'profiles' in the schema cache" })).toBe(true);
    expect(isMissingAccountColumn({ code: "42703", message: "column profiles.uid does not exist" })).toBe(false);
    expect(isMissingAccountColumn({ code: "42703", message: "column profiles.telephone does not exist" })).toBe(false);
    expect(isMissingAccountColumn({ code: "23514", message: "phone" })).toBe(false);
    expect(isMissingAccountColumn(null)).toBe(false);
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
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/** What PostgREST answers for public.roles on a project without migration 20261027150000. */
const NO_ROLES_TABLE: Result = {
  data: null,
  error: { code: "PGRST205", message: "Could not find the table 'public.roles' in the schema cache" },
};

/**
 * A fake client whose profile reads answer `profiles` in turn (the last one
 * again after that) and whose reads of public.roles answer `roles` (by
 * default, a project without them), recording each profile select.
 */
function client(profiles: Result[], { roles = NO_ROLES_TABLE, selects = [] }: { roles?: Result; selects?: string[] } = {}) {
  let read = 0;
  return {
    from: vi.fn((table: string) => {
      if (table === "roles") return query(roles);
      expect(table).toBe("profiles");
      const builder = query(profiles[Math.min(read, profiles.length - 1)]);
      read += 1;
      const select = builder.select as (...args: unknown[]) => unknown;
      builder.select = (...args: unknown[]) => {
        selects.push(String(args[0]));
        return select(...args);
      };
      return builder;
    }),
  } as never;
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
    vi.mocked(createClient).mockResolvedValue(client([{ data: PROFILES, error: null }]));
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
    vi.mocked(createClient).mockResolvedValue(client([{ data: null, error: { message: "relation does not exist" } }]));
    await expect(getUserDirectory(VIEWER)).rejects.toThrow("Could not load the user list: relation does not exist");
  });
});

/** The profile reads, from a project with every migration down to one with none of the later ones. */
const SELECT = {
  roles: "id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id, uid, phone, joined_at, role_id",
  accounts: "id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id, uid, phone, joined_at",
  uids: "id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id, uid",
  teams: "id, email, full_name, role, active, created_at, updated_at, is_lead, lead_id",
  legacy: "id, email, full_name, role, active, created_at, updated_at",
} as const;

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
    vi.mocked(createClient).mockResolvedValue(client([{ data: ROWS, error: null }]));

    const { users, teams, leads } = await getUserDirectory(VIEWER);

    expect(teams).toBe(true);
    const byEmail = Object.fromEntries(users.map((user) => [user.email, user]));
    // Without roles, the built-in role for each level stands in.
    expect(byEmail["lina@test.local"]).toMatchObject({
      role: { id: null, builtIn: "lead", name: "Lead Inspector", access: "team" },
      lead: null,
      team: [
        { id: MEMBER, name: "Ivan Inspector", active: true },
        { id: OTHER, name: "Olga Other", active: false },
      ],
      missingLead: false,
    });
    expect(byEmail["ivan@test.local"]).toMatchObject({
      role: { builtIn: "inspector", name: "Inspector" },
      lead: { id: LEAD, name: "Lina Lead" },
      team: [],
    });
    expect(byEmail["admin@test.local"]).toMatchObject({ role: { builtIn: "admin", name: "Admin" }, lead: null, missingLead: false });
    expect(byEmail["gail@test.local"]).toMatchObject({ role: { builtIn: "inspector" }, lead: null, missingLead: true });
    // A deactivated lead cannot take anyone on.
    expect(leads).toEqual([{ id: LEAD, name: "Lina Lead", teamSize: 2 }]);
  });

  it("works with the level only on a project without the lead inspector columns", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    const selects: string[] = [];
    vi.mocked(createClient).mockResolvedValue(
      client([{ data: null, error: { code: "42703", message: "column profiles.is_lead does not exist" } }, { data: PROFILES, error: null }], {
        selects,
      }),
    );

    const { users, teams, leads, roles } = await getUserDirectory(VIEWER);

    expect(teams).toBe(false);
    expect(leads).toEqual([]);
    expect(users).toHaveLength(3);
    // Nobody is flagged for a team the project does not have yet, and nobody leads one.
    expect(users.every((user) => !user.missingLead && user.lead === null && user.role.access !== "team")).toBe(true);
    expect(selects).toEqual([SELECT.roles, SELECT.legacy]);
    // Admin and Inspector to choose from: there are no lead inspectors yet.
    expect(roles.map((role) => role.name)).toEqual(["Admin", "Inspector"]);
  });
});

describe("getUserDirectory with roles", () => {
  const ADMIN_ROLE = "11111111-1111-4111-8111-111111111111";
  const LEAD_ROLE = "22222222-2222-4222-8222-222222222222";
  const INSPECTOR_ROLE = "33333333-3333-4333-8333-333333333333";
  const FIELD_ROLE = "55555555-5555-4555-8555-555555555555";
  const SENIOR_ROLE = "66666666-6666-4666-8666-666666666666";
  const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const MEMBER = "3d4e5f60-7182-4c9d-8e0f-2a3b4c5d6e7f";
  const QUINN = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
  /** As public.roles answers: in no order, an access the app does not know left out. */
  const ROLES = [
    { id: FIELD_ROLE, built_in: null, name: "Field Inspector", access: "own" },
    { id: INSPECTOR_ROLE, built_in: "inspector", name: "Inspector", access: "own" },
    { id: REVIEWER_ROLE, built_in: null, name: "QA Reviewer", access: "all" },
    { id: ADMIN_ROLE, built_in: "admin", name: "Admin", access: "all" },
    { id: SENIOR_ROLE, built_in: null, name: "Senior Lead", access: "team" },
    { id: LEAD_ROLE, built_in: "lead", name: "Lead Inspector", access: "team" },
    { id: "77777777-7777-4777-8777-777777777777", built_in: null, name: "From the Future", access: "region" },
  ];
  const row = (id: string, email: string, full_name: string, extra: Record<string, unknown>) => ({
    id,
    email,
    full_name,
    role: "inspector",
    active: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
    is_lead: false,
    lead_id: null,
    uid: null,
    phone: null,
    joined_at: "2026-10-02T00:00:00Z",
    role_id: INSPECTOR_ROLE,
    ...extra,
  });
  const ROWS = [
    row(VIEWER, "admin@test.local", "Test Admin", { role: "admin", role_id: ADMIN_ROLE }),
    // A custom role that sees every inspection: an admin to the database, in no team.
    row(QUINN, "quinn@test.local", "Quinn Reviewer", { role: "admin", role_id: REVIEWER_ROLE }),
    // A custom role that sees their team's: a lead, who leads Ivan.
    row(LEAD, "sam@test.local", "Sam Senior", { is_lead: true, role_id: SENIOR_ROLE }),
    row(MEMBER, "ivan@test.local", "Ivan Inspector", { lead_id: LEAD, role_id: FIELD_ROLE }),
    // A custom role that sees their own, active and in no team.
    row(NEW, "fay@test.local", "Fay Field", { role_id: FIELD_ROLE }),
    // Invited, not joined yet.
    row(OTHER, "zed@example.com", "Zed", { joined_at: null }),
  ];

  beforeEach(() => vi.mocked(isAdminClientConfigured).mockReturnValue(false));
  afterEach(() => vi.resetAllMocks());

  it("gives each person their role by name, custom roles too, and the roles to choose from, the built-in ones first", async () => {
    const selects: string[] = [];
    vi.mocked(createClient).mockResolvedValue(client([{ data: ROWS, error: null }], { roles: { data: ROLES, error: null }, selects }));

    const { users, roles, leads } = await getUserDirectory(VIEWER);

    expect(selects).toEqual([SELECT.roles]);
    expect(roles).toEqual([
      { id: ADMIN_ROLE, builtIn: "admin", name: "Admin", access: "all" },
      { id: LEAD_ROLE, builtIn: "lead", name: "Lead Inspector", access: "team" },
      { id: INSPECTOR_ROLE, builtIn: "inspector", name: "Inspector", access: "own" },
      { id: FIELD_ROLE, builtIn: null, name: "Field Inspector", access: "own" },
      { id: REVIEWER_ROLE, builtIn: null, name: "QA Reviewer", access: "all" },
      { id: SENIOR_ROLE, builtIn: null, name: "Senior Lead", access: "team" },
    ]);
    const byEmail = Object.fromEntries(users.map((user) => [user.email, user]));
    expect(byEmail["admin@test.local"].role).toMatchObject({ builtIn: "admin", name: "Admin" });
    expect(byEmail["quinn@test.local"]).toMatchObject({ role: { name: "QA Reviewer", access: "all" }, team: [], missingLead: false });
    // A custom role that sees their team's leads one, and can take people on.
    expect(byEmail["sam@test.local"]).toMatchObject({
      role: { name: "Senior Lead", access: "team" },
      team: [{ id: MEMBER, name: "Ivan Inspector", active: true }],
    });
    expect(leads).toEqual([{ id: LEAD, name: "Sam Senior", teamSize: 1 }]);
    expect(byEmail["ivan@test.local"]).toMatchObject({ role: { name: "Field Inspector" }, lead: { id: LEAD, name: "Sam Senior" } });
    // A custom role that sees their own needs a lead like an inspector.
    expect(byEmail["fay@test.local"]).toMatchObject({ role: { name: "Field Inspector", access: "own" }, missingLead: true });
    expect(byEmail["zed@example.com"]).toMatchObject({ status: "invited", joined: false, role: { name: "Inspector" } });
    expect(users.filter((user) => user.email !== "zed@example.com").every((user) => user.joined)).toBe(true);
  });

  it("reads the list again without roles on a project without them, the built-in roles standing in", async () => {
    const selects: string[] = [];
    vi.mocked(createClient).mockResolvedValue(
      client(
        [
          { data: null, error: { code: "42703", message: "column profiles.role_id does not exist" } },
          // As the database without the column answers.
          { data: ROWS.map((profile) => Object.fromEntries(Object.entries(profile).filter(([column]) => column !== "role_id"))), error: null },
        ],
        { selects },
      ),
    );

    const { users, roles, teams } = await getUserDirectory(VIEWER);

    expect(selects).toEqual([SELECT.roles, SELECT.accounts]);
    expect(teams).toBe(true);
    expect(roles).toEqual([
      { id: null, builtIn: "admin", name: "Admin", access: "all" },
      { id: null, builtIn: "lead", name: "Lead Inspector", access: "team" },
      { id: null, builtIn: "inspector", name: "Inspector", access: "own" },
    ]);
    const byEmail = Object.fromEntries(users.map((user) => [user.email, user]));
    expect(byEmail["quinn@test.local"].role).toEqual({ id: null, builtIn: "admin", name: "Admin", access: "all" });
    expect(byEmail["sam@test.local"].role).toMatchObject({ builtIn: "lead", name: "Lead Inspector" });
  });

  it("names someone by their level when their role is not on the list", async () => {
    vi.mocked(createClient).mockResolvedValue(
      client([{ data: [ROWS[1]], error: null }], { roles: { data: ROLES.filter((role) => role.id !== REVIEWER_ROLE), error: null } }),
    );
    const { users } = await getUserDirectory(VIEWER);
    expect(users[0].role).toEqual({ id: null, builtIn: "admin", name: "Admin", access: "all" });
  });

  it("throws when the roles cannot be read for any other reason, for the error page", async () => {
    vi.mocked(createClient).mockResolvedValue(
      client([{ data: ROWS, error: null }], { roles: { data: null, error: { code: "57014", message: "statement timeout" } } }),
    );
    await expect(getUserDirectory(VIEWER)).rejects.toThrow("Could not load the roles: statement timeout");
  });
});

describe("findRole", () => {
  const ROLE = { id: REVIEWER_ROLE, built_in: null, name: "QA Reviewer", access: "all" };

  /** A client whose role read answers `result`, recording its chain. */
  function rolesClient(result: Result) {
    const calls: Array<[string, unknown[]]> = [];
    const tables: string[] = [];
    return {
      calls,
      tables,
      client: {
        from: vi.fn((table: string) => {
          tables.push(table);
          return query(result, calls);
        }),
      } as never,
    };
  }

  it("reads a role by its id", async () => {
    const { client: fake, calls, tables } = rolesClient({ data: ROLE, error: null });
    expect(await findRole(fake, REVIEWER_ROLE)).toEqual({
      ok: true,
      role: { id: REVIEWER_ROLE, builtIn: null, name: "QA Reviewer", access: "all" },
    });
    expect(tables).toEqual(["roles"]);
    expect(calls).toContainEqual(["eq", ["id", REVIEWER_ROLE]]);
  });

  it("reads a built-in role by its kind", async () => {
    const { client: fake, calls } = rolesClient({ data: { id: NEW, built_in: "lead", name: "Lead Inspector", access: "team" }, error: null });
    expect(await findRole(fake, "lead")).toEqual({ ok: true, role: { id: NEW, builtIn: "lead", name: "Lead Inspector", access: "team" } });
    expect(calls).toContainEqual(["eq", ["built_in", "lead"]]);
  });

  it("stands a kind in for its level on a project without roles, and says what a role's id needs there", async () => {
    expect(await findRole(rolesClient(NO_ROLES_TABLE).client, "admin")).toEqual({
      ok: true,
      role: { id: null, builtIn: "admin", name: "Admin", access: "all" },
    });
    expect(await findRole(rolesClient(NO_ROLES_TABLE).client, REVIEWER_ROLE)).toEqual({ ok: false, message: MESSAGES.rolesMissing });
  });

  it("says when the role has gone, or could not be read", async () => {
    expect(await findRole(rolesClient({ data: null, error: null }).client, REVIEWER_ROLE)).toEqual({ ok: false, message: MESSAGES.roleGone });
    expect(MESSAGES.roleGone).toBe("That role no longer exists. Reload the page and choose another.");
    expect(await findRole(rolesClient({ data: { ...ROLE, access: "region" }, error: null }).client, REVIEWER_ROLE)).toEqual({
      ok: false,
      message: MESSAGES.roleGone,
    });
    expect(await findRole(rolesClient({ data: null, error: { code: "57014", message: "statement timeout" } }).client, REVIEWER_ROLE)).toEqual({
      ok: false,
      message: "The role could not be read: statement timeout. Try again.",
    });
  });
});

describe("getUserDirectory with UIDs", () => {
  const FULL = SELECT.roles;
  const WITHOUT_UID = SELECT.teams;
  const LEGACY = SELECT.legacy;
  const MISSING_UID = { code: "42703", message: "column profiles.uid does not exist" };
  const MISSING_TEAMS = { code: "42703", message: "column profiles.is_lead does not exist" };
  const withTeams = PROFILES.map((profile) => ({ ...profile, is_lead: false, lead_id: null }));

  beforeEach(() => vi.mocked(isAdminClientConfigured).mockReturnValue(false));
  afterEach(() => vi.resetAllMocks());

  it("gives each person their UID", async () => {
    const selects: string[] = [];
    const uids = ["SC-0001", "SC-0002", "SC-10000"];
    vi.mocked(createClient).mockResolvedValue(
      client([{ data: withTeams.map((profile, index) => ({ ...profile, uid: uids[index] })), error: null }], { selects }),
    );

    const directory = await getUserDirectory(VIEWER);

    expect(directory).toMatchObject({ uids: true, teams: true });
    expect(Object.fromEntries(directory.users.map((user) => [user.email, user.uid]))).toEqual({
      "admin@test.local": "SC-0001",
      "olga@test.local": "SC-0002",
      "new@test.local": "SC-10000",
    });
    expect(selects).toEqual([FULL]);
  });

  it("reads the list again without UIDs on a project that has not run their migration", async () => {
    const selects: string[] = [];
    vi.mocked(createClient).mockResolvedValue(client([{ data: null, error: MISSING_UID }, { data: withTeams, error: null }], { selects }));

    const directory = await getUserDirectory(VIEWER);

    expect(directory).toMatchObject({ uids: false, teams: true });
    expect(directory.users).toHaveLength(3);
    expect(directory.users.every((user) => user.uid === null)).toBe(true);
    expect(selects).toEqual([FULL, WITHOUT_UID]);
  });

  it("reads the list with roles only on a project without either, whichever column is reported first", async () => {
    for (const first of [MISSING_UID, MISSING_TEAMS]) {
      const selects: string[] = [];
      const results = first === MISSING_UID ? [{ data: null, error: first }, { data: null, error: MISSING_TEAMS }] : [{ data: null, error: first }];
      vi.mocked(createClient).mockResolvedValue(client([...results, { data: PROFILES, error: null }], { selects }));

      const directory = await getUserDirectory(VIEWER);

      expect(directory, first.message).toMatchObject({ uids: false, teams: false });
      expect(directory.users.map((user) => user.uid), first.message).toEqual([null, null, null]);
      expect(selects, first.message).toEqual(first === MISSING_UID ? [FULL, WITHOUT_UID, LEGACY] : [FULL, LEGACY]);
    }
  });

  it("throws any other error, for the error page", async () => {
    for (const results of [
      [{ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }],
      [{ data: null, error: MISSING_UID }, { data: null, error: { code: "08006", message: "connection failure" } }],
    ]) {
      vi.mocked(createClient).mockResolvedValue(client(results));
      await expect(getUserDirectory(VIEWER)).rejects.toThrow(/^Could not load the user list: /);
    }
  });
});

describe("getUserDirectory with phones and invitations", () => {
  const FULL = SELECT.roles;
  const WITH_UID = SELECT.uids;
  const LEGACY = SELECT.legacy;
  const MISSING_PHONE = { code: "42703", message: "column profiles.phone does not exist" };
  const MISSING_JOINED = { code: "42703", message: "column profiles.joined_at does not exist" };
  const INVITED = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";
  const ROWS = [
    ...PROFILES.map((profile, index) => ({
      ...profile,
      is_lead: false,
      lead_id: null,
      uid: `SC-000${index + 1}`,
      phone: index === 0 ? "+60 12-345 6789" : null,
      joined_at: profile.created_at,
    })),
    // Invited and activated, not joined yet: no name, so the list names them by their email.
    {
      id: INVITED,
      email: "zed@example.com",
      full_name: null,
      role: "inspector",
      active: true,
      created_at: "2026-10-05T00:00:00Z",
      updated_at: "2026-10-05T00:00:01Z",
      is_lead: true,
      lead_id: null,
      uid: "SC-0004",
      phone: null,
      joined_at: null,
    },
  ];

  beforeEach(() => vi.mocked(isAdminClientConfigured).mockReturnValue(false));
  afterEach(() => vi.resetAllMocks());

  it("gives each person their phone, and calls an active account that has not joined Invited", async () => {
    const selects: string[] = [];
    vi.mocked(createClient).mockResolvedValue(client([{ data: ROWS, error: null }], { selects }));

    const { users } = await getUserDirectory(VIEWER);

    expect(selects).toEqual([FULL]);
    expect(users.map((user) => [user.email, user.status, user.phone])).toEqual([
      ["new@test.local", "pending", null],
      ["olga@test.local", "deactivated", null],
      ["admin@test.local", "active", "+60 12-345 6789"],
      ["zed@example.com", "invited", null],
    ]);
    expect(users.find((user) => user.id === INVITED)).toMatchObject({ fullName: null, joined: false, role: { builtIn: "lead" } });
  });

  it("keeps an invited account Invited when a ban blocks it, and flags the blocked sign-in", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({ data: { users: [{ id: INVITED, banned_until: "2126-09-12T00:00:00Z" }] }, error: null }),
        },
      },
    } as never);
    vi.mocked(createClient).mockResolvedValue(client([{ data: ROWS, error: null }]));

    const { users } = await getUserDirectory(VIEWER);

    expect(users.find((user) => user.id === INVITED)).toMatchObject({ status: "invited", signInBlocked: true });
  });

  it("reads the list again without them on a project that has not run their migration: no phones, everyone joined", async () => {
    for (const missing of [MISSING_PHONE, MISSING_JOINED]) {
      const selects: string[] = [];
      // As the database without those columns answers.
      const withoutAccounts = ROWS.map((row) => {
        const copy: Partial<(typeof ROWS)[number]> = { ...row };
        delete copy.phone;
        delete copy.joined_at;
        return copy;
      });
      vi.mocked(createClient).mockResolvedValue(
        client([{ data: null, error: missing }, { data: withoutAccounts, error: null }], { selects }),
      );

      const directory = await getUserDirectory(VIEWER);

      expect(selects, missing.message).toEqual([FULL, WITH_UID]);
      expect(directory, missing.message).toMatchObject({ uids: true, teams: true });
      expect(directory.users.every((user) => user.phone === null), missing.message).toBe(true);
      expect(directory.users.find((user) => user.id === INVITED)?.status, missing.message).toBe("active");
    }
  });

  it("reads roles only when the project has none of the later columns either", async () => {
    const selects: string[] = [];
    vi.mocked(createClient).mockResolvedValue(
      client(
        [
          { data: null, error: MISSING_PHONE },
          { data: null, error: { code: "42703", message: "column profiles.is_lead does not exist" } },
          { data: PROFILES, error: null },
        ],
        { selects },
      ),
    );

    const directory = await getUserDirectory(VIEWER);

    expect(selects).toEqual([FULL, WITH_UID, LEGACY]);
    expect(directory).toMatchObject({ uids: false, teams: false });
    expect(directory.users.map((user) => user.status)).toEqual(["pending", "deactivated", "active"]);
  });
});

describe("isMissingUidColumn", () => {
  it("recognises the answers for a project without UIDs, and nothing else", () => {
    expect(isMissingUidColumn({ code: "42703", message: "column profiles.uid does not exist" })).toBe(true);
    expect(isMissingUidColumn({ code: "PGRST204", message: "Could not find the 'uid' column of 'profiles' in the schema cache" })).toBe(true);
    expect(isMissingUidColumn({ code: "42703", message: "column profiles.is_lead does not exist" })).toBe(false);
    expect(isMissingUidColumn({ code: "42703", message: "column profiles.uuid does not exist" })).toBe(false);
    expect(isMissingUidColumn({ code: "42883", message: "function auth.uid() does not exist" })).toBe(false);
    expect(isMissingUidColumn({ code: "42501", message: "a user's UID never changes" })).toBe(false);
    expect(isMissingUidColumn(null)).toBe(false);
  });
});

describe("findProfileByEmail", () => {
  it("matches case-insensitively with LIKE wildcards escaped, and says whether its person has joined", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const fake = {
      from: vi.fn(() => query({ data: [{ id: OTHER, active: true, joined_at: "2026-10-02T00:00:00Z" }], error: null }, calls)),
    };

    const found = await findProfileByEmail(fake as never, "first_last@example.com");

    expect(found).toEqual({ id: OTHER, active: true, joined: true });
    expect(calls).toContainEqual(["ilike", ["email", "first\\_last@example.com"]]);
  });

  it("tells an invite not yet answered apart", async () => {
    const fake = { from: vi.fn(() => query({ data: [{ id: OTHER, active: true, joined_at: null }], error: null })) };
    expect(await findProfileByEmail(fake as never, "olga@test.local")).toEqual({ id: OTHER, active: true, joined: false });
  });

  it("counts everyone as joined on a project without joined_at", async () => {
    const selects: string[] = [];
    const fake = client(
      [
        { data: null, error: { code: "42703", message: "column profiles.joined_at does not exist" } },
        { data: [{ id: OTHER, active: false }], error: null },
      ],
      { selects },
    );
    expect(await findProfileByEmail(fake, "olga@test.local")).toEqual({ id: OTHER, active: false, joined: true });
    expect(selects).toEqual(["id, active, joined_at", "id, active"]);
  });

  it("returns null when nobody has the address, and throws for any other error", async () => {
    const empty = { from: vi.fn(() => query({ data: [], error: null })) };
    expect(await findProfileByEmail(empty as never, "nobody@example.com")).toBeNull();
    const broken = { from: vi.fn(() => query({ data: null, error: { code: "57014", message: "statement timeout" } })) };
    await expect(findProfileByEmail(broken as never, "nobody@example.com")).rejects.toThrow(
      "Could not check for an existing account: statement timeout",
    );
  });
});
