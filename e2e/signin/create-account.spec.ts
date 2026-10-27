import type { Page, TestInfo } from "@playwright/test";
import { PHONE_HINT } from "../../lib/auth/fields";
import { createTestAdminClient, throwawayEmail } from "../support/admin";
import { sessionCookies } from "../support/session";
import { expect, isTouch, onlyIn, open, press, shot, test } from "./support";

// Account Creation (Kenneth, 27 October 2026): an admin invites someone with
// their role chosen; the invitation link signs them in and opens
// /create-account, where they fill in their name and phone and choose a
// password, then land on their dashboard signed in. The links come from the
// admin API (generateLink), which sends no email, and open through
// /auth/confirm exactly as the emailed ones do. Every account here is a
// throwaway that the accounts fixture deletes after the test.

const PASSWORD = "Invited-2026-gloves";

/** An invitation link: creates the account (inactive, not joined, no password) and sends nothing. */
async function invitation(email: string, fullName?: string): Promise<{ userId: string; tokenHash: string }> {
  const { data, error } = await createTestAdminClient().auth.admin.generateLink({
    type: "invite",
    email,
    options: fullName ? { data: { full_name: fullName } } : undefined,
  });
  const tokenHash = data.properties?.hashed_token;
  if (error || !data.user || !tokenHash) throw new Error(`generateLink (invite) failed: ${error?.message}`);
  return { userId: data.user.id, tokenHash };
}

/** The admin's invite activates the account it creates, with the role the admin chose. */
async function placeAs(userId: string, role: "inspector" | "admin") {
  const { error } = await createTestAdminClient().from("profiles").update({ active: true, role }).eq("id", userId);
  if (error) throw new Error(`Could not activate ${userId} as ${role}: ${error.message}`);
}

async function profileOf(userId: string) {
  const { data, error } = await createTestAdminClient()
    .from("profiles")
    .select("full_name, phone, role, joined_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`Could not read ${userId}: ${error.message}`);
  return data;
}

async function openInvitation(page: Page, tokenHash: string) {
  await open(page, `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=invite`);
}

function fields(page: Page) {
  return {
    name: page.getByLabel("Full Name", { exact: true }),
    email: page.getByLabel("Email", { exact: true }),
    phone: page.getByLabel("Phone", { exact: true }),
    password: page.getByLabel("Password", { exact: true }),
    confirm: page.getByLabel("Confirm Password", { exact: true }),
    rules: page.locator("#create-password-policy li"),
  };
}

async function createAccount(page: Page, testInfo: TestInfo) {
  await press(page.getByRole("button", { name: "Create Account" }), testInfo);
}

test("an invitation: the details and a password, then straight to the inspections list", async ({ page, accounts }, testInfo) => {
  const email = throwawayEmail("signin");
  const { userId, tokenHash } = await invitation(email, "E2E Invitee");
  accounts.track(userId);
  await placeAs(userId, "inspector");
  await openInvitation(page, tokenHash);

  await expect(page).toHaveURL(/\/create-account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Create Your Account" })).toBeVisible();
  await expect(page).toHaveTitle("Create Your Account · SteriCare QC");
  await expect(page.getByRole("main")).toContainText("You are joining as an Inspector.");
  const { name, email: emailField, phone, password, confirm, rules } = fields(page);
  await expect(name).toHaveValue("E2E Invitee");
  await expect(name).toHaveAttribute("autocomplete", "name");
  // The invitation's address, shown and never sent.
  await expect(emailField).toHaveValue(email);
  await expect(emailField).not.toBeEditable();
  expect(await emailField.getAttribute("name")).toBeNull();
  await expect(phone).toHaveAttribute("type", "tel");
  await expect(phone).toHaveAttribute("autocomplete", "tel");
  await expect(phone).toHaveAccessibleDescription(PHONE_HINT);
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(confirm).toHaveAttribute("autocomplete", "new-password");
  await expect(rules).toHaveCount(2);
  await shot(page, testInfo, "create-account");
  if (isTouch(testInfo)) {
    for (const target of [name, emailField, phone, password, confirm, page.getByRole("button", { name: "Create Account" })]) {
      expect((await target.boundingBox())?.height, await target.evaluate((element) => element.id || element.textContent)).toBeGreaterThanOrEqual(44);
    }
  }

  // Enter in a field moves on to the next empty one instead of sending the form.
  await name.press("Enter");
  await expect(phone).toBeFocused();

  // The server holds the phone to the database's rule and keeps what was typed.
  await phone.fill("12345");
  await password.fill(PASSWORD);
  await confirm.fill(PASSWORD);
  await createAccount(page, testInfo);
  await expect(page.getByText("Enter a phone number, like +60 12-345 6789 or 012-345 6789.")).toBeVisible();
  await expect(phone).toBeFocused();
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(phone).toHaveValue("12345");
  await expect(name).toHaveValue("E2E Invitee");
  await expect(password).toHaveValue("");
  await shot(page, testInfo, "create-account-invalid-phone");
  expect((await profileOf(userId)).joined_at).toBeNull();

  await phone.fill("+60 12-345 6789");
  await password.fill(PASSWORD);
  await confirm.fill(PASSWORD);
  await createAccount(page, testInfo);
  await expect(page).toHaveURL(/\/inspections$/);

  // Joined, with the details as typed and the role the admin chose.
  const profile = await profileOf(userId);
  expect(profile).toMatchObject({ full_name: "E2E Invitee", phone: "+60 12-345 6789", role: "inspector" });
  expect(profile.joined_at).not.toBeNull();

  // Created: Account Creation sends the account on to its dashboard.
  await page.goto("/create-account");
  await expect(page).toHaveURL(/\/inspections$/);

  if (testInfo.project.name === "desktop") {
    // One sign-in, in one project: the new password works.
    expect(await sessionCookies(email, PASSWORD)).not.toHaveLength(0);
  }
});

test("until the account is created, every page leads to Account Creation", async ({ page, accounts }, testInfo) => {
  onlyIn(testInfo, "desktop");
  const { userId, tokenHash } = await invitation(throwawayEmail("signin"), "E2E Invitee");
  accounts.track(userId);
  await placeAs(userId, "inspector");
  await openInvitation(page, tokenHash);
  await expect(page).toHaveURL(/\/create-account$/);

  // The inspections list, the sign-in screen (which sends a session on), and
  // the password screen an invitation opened before Account Creation.
  for (const path of ["/inspections", "/login", "/reset-password?flow=invite", "/"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/create-account$/);
  }
  await expect(page.getByRole("heading", { level: 1, name: "Create Your Account" })).toBeVisible();
});

test("an admin invited without a name fills it in and lands on the Admin Dashboard", async ({ page, accounts }, testInfo) => {
  onlyIn(testInfo, "desktop");
  const { userId, tokenHash } = await invitation(throwawayEmail("signin"));
  accounts.track(userId);
  await placeAs(userId, "admin");
  await openInvitation(page, tokenHash);

  await expect(page.getByRole("main")).toContainText("You are joining as an Admin.");
  const { name, phone, password, confirm } = fields(page);
  await expect(name).toHaveValue("");

  // Nothing typed: every field says what it needs.
  await createAccount(page, testInfo);
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await expect(page.getByText("Enter your phone number.")).toBeVisible();
  await expect(page.getByText("Enter a new password.")).toBeVisible();
  await expect(name).toBeFocused();

  await name.fill("E2E Admin");
  await phone.fill("03-1234 5678");
  await password.fill(PASSWORD);
  await confirm.fill(PASSWORD);
  await createAccount(page, testInfo);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page).toHaveTitle("Admin Dashboard · SteriCare QC");
  expect(await profileOf(userId)).toMatchObject({ full_name: "E2E Admin", phone: "03-1234 5678", role: "admin" });
});
