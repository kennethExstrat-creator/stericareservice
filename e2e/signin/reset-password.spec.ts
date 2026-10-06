import type { Page, TestInfo } from "@playwright/test";
import { createTestAdminClient, throwawayEmail } from "../support/admin";
import { sessionCookies, signIn, TEST_ACCOUNTS } from "../support/session";
import { expect, onlyIn, open, press, shot, test } from "./support";

// The password screen with a real session from a real email link. The links
// come from the admin API (generateLink), which sends no email, and open
// through /auth/confirm exactly as the emailed ones do. Every account here is a
// throwaway that the accounts fixture deletes after the test.

/** A reset link as Supabase would email it, without sending anything. */
async function recoveryLink(email: string): Promise<string> {
  const { data, error } = await createTestAdminClient().auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data.properties?.hashed_token;
  if (error || !tokenHash) throw new Error(`generateLink (recovery) failed: ${error?.message}`);
  return tokenHash;
}

/** An invite link: creates the (inactive) account, sends nothing. */
async function inviteLink(email: string, fullName: string): Promise<{ userId: string; tokenHash: string }> {
  const { data, error } = await createTestAdminClient().auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: fullName } },
  });
  const tokenHash = data.properties?.hashed_token;
  if (error || !data.user || !tokenHash) throw new Error(`generateLink (invite) failed: ${error?.message}`);
  return { userId: data.user.id, tokenHash };
}

async function openEmailLink(page: Page, type: "recovery" | "invite", tokenHash: string) {
  await open(page, `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`);
}

function fields(page: Page) {
  return {
    password: page.getByLabel("New password", { exact: true }),
    confirm: page.getByLabel("Confirm new password", { exact: true }),
    rules: page.locator("#reset-password-policy li"),
  };
}

async function submit(page: Page, testInfo: TestInfo, name: string) {
  await press(page.getByRole("button", { name }), testInfo);
}

test("a reset link: rules up front, checked on the server, then saved", async ({ page, accounts }, testInfo) => {
  const newPassword = "Fresh-gloves-2027";
  const { email } = await accounts.create({ active: true });
  await openEmailLink(page, "recovery", await recoveryLink(email));

  await expect(page).toHaveURL(/\/reset-password\?flow=recovery$/);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(email);
  await expect(page).toHaveTitle("Choose a new password · SteriCare QC");
  const { password, confirm, rules } = fields(page);
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(confirm).toHaveAttribute("autocomplete", "new-password");
  await expect(rules).toHaveCount(2);
  await expect(rules.nth(0)).toContainText("At least 10 characters");
  await expect(rules.nth(1)).toContainText("Letters and digits");
  await expect(rules.nth(0)).toHaveAttribute("data-met", "false");
  await shot(page, testInfo, "reset-password-recovery");

  // The rules tick off as you type.
  await password.fill("abcdefghij");
  await expect(rules.nth(0)).toHaveAttribute("data-met", "true");
  await expect(rules.nth(1)).toHaveAttribute("data-met", "false");
  await password.fill("abcdefghi1");
  await expect(rules.nth(1)).toHaveAttribute("data-met", "true");
  await shot(page, testInfo, "reset-password-rules-met");

  // Enter in the new password moves on to the empty confirmation.
  await password.fill(newPassword);
  await password.press("Enter");
  await expect(confirm).toBeFocused();

  // The server holds the same line: a mismatch, then a password without digits.
  await confirm.fill(`${newPassword}x`);
  await submit(page, testInfo, "Save new password");
  await expect(page.getByText("The passwords do not match.")).toBeVisible();
  await expect(confirm).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveValue("");
  await expect(password).toBeFocused();
  // Both fields were cleared and focus is back on the first: a screen reader hears why.
  await expect(password).toHaveAccessibleDescription(/^The passwords do not match\./);
  await expect(confirm).toHaveAccessibleDescription("The passwords do not match.");
  await expect(rules.nth(0)).toHaveAttribute("data-met", "false");
  await shot(page, testInfo, "reset-password-mismatch");

  await password.fill("abcdefghijk");
  await confirm.fill("abcdefghijk");
  await submit(page, testInfo, "Save new password");
  await expect(page.getByText("Use both letters and digits.")).toBeVisible();

  await password.fill(newPassword);
  await confirm.fill(newPassword);
  await submit(page, testInfo, "Save new password");
  await expect(page).toHaveURL(/\/inspections$/);

  if (testInfo.project.name === "desktop") {
    // One more sign-in, in one project: the new password works.
    expect(await sessionCookies(email, newPassword)).not.toHaveLength(0);
  }
});

test("an invite link: welcome, then set a password", async ({ page, accounts }, testInfo) => {
  const email = throwawayEmail("signin");
  const { userId, tokenHash } = await inviteLink(email, "E2E Invitee");
  accounts.track(userId);
  // New accounts start inactive; the admin's invite action activates the account it creates.
  await accounts.setActive(userId, true);
  await openEmailLink(page, "invite", tokenHash);

  await expect(page).toHaveURL(/\/reset-password\?flow=invite$/);
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Welcome to SteriCare QC, E2E Invitee.");
  await expect(page.getByRole("main")).toContainText(email);
  await expect(page).toHaveTitle("Set your password · SteriCare QC");
  await shot(page, testInfo, "reset-password-invite");

  const { password, confirm } = fields(page);
  await password.fill("Invited-2026-gloves");
  await confirm.fill("Invited-2026-gloves");
  await submit(page, testInfo, "Set password");
  await expect(page).toHaveURL(/\/inspections$/);
});

test("a password sign-in is sent to the email link instead", async ({ page, context, baseURL }, testInfo) => {
  // The app's own screens set passwords only from an email link. This is UI
  // hardening: Supabase Auth would still take a change from this session.
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await open(page, "/reset-password?flow=recovery");

  await expect(page.getByRole("heading", { level: 1, name: "Use your email link" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "Passwords are set from an invite or reset link opened in the last hour.",
  );
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to inspections" })).toHaveAttribute("href", "/inspections");
  await expect(page).toHaveTitle("Use your email link · SteriCare QC");
  await shot(page, testInfo, "reset-password-signed-in");

  // The way to a new link: sign out (this device only), then "Forgot password?".
  await press(page.getByRole("button", { name: "Sign out" }), testInfo);
  await expect(page).toHaveURL(/\/login$/);
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => /^sb-.+-auth-token/.test(cookie.name))).toHaveLength(0);
});

test("a deactivated account that opens a reset link is signed out", async ({ page, context, accounts }, testInfo) => {
  onlyIn(testInfo, "desktop");
  const { email } = await accounts.create({ active: false });
  await openEmailLink(page, "recovery", await recoveryLink(email));

  // /reset-password → requireUser → /auth/sign-out → /login?error=deactivated
  await expect(page).toHaveURL(/\/login\?error=deactivated$/);
  await expect(page.getByText("This account has been deactivated. Ask your SteriCare administrator.")).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => /^sb-.+-auth-token/.test(cookie.name))).toHaveLength(0);
});
