import type { Page, TestInfo } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { sessionCookies, signIn, TEST_ACCOUNTS } from "../support/session";
import { expect, onlyIn, open, press, shot, test } from "./support";

// The password screen with a real session from a real email link. The links
// come from the admin API (generateLink), which sends no email, and open
// through /auth/confirm exactly as the emailed ones do. Every account here is a
// throwaway that the accounts fixture deletes after the test. Invitation links
// open Account Creation instead: ./create-account.spec.ts.

/** A reset link as Supabase would email it, without sending anything. */
async function recoveryLink(email: string): Promise<string> {
  const { data, error } = await createTestAdminClient().auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data.properties?.hashed_token;
  if (error || !tokenHash) throw new Error(`generateLink (recovery) failed: ${error?.message}`);
  return tokenHash;
}

async function openEmailLink(page: Page, tokenHash: string) {
  await open(page, `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`);
}

function fields(page: Page) {
  return {
    password: page.getByLabel("New Password", { exact: true }),
    confirm: page.getByLabel("Confirm New Password", { exact: true }),
    rules: page.locator("#reset-password-policy li"),
  };
}

async function submit(page: Page, testInfo: TestInfo, name: string) {
  await press(page.getByRole("button", { name }), testInfo);
}

test("a reset link: rules up front, checked on the server, then saved", async ({ page, accounts }, testInfo) => {
  const newPassword = "Fresh-gloves-2027";
  const { email } = await accounts.create({ active: true });
  await openEmailLink(page, await recoveryLink(email));

  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a New Password" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(email);
  await expect(page).toHaveTitle("Choose a New Password · SteriCare QC");
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
  await submit(page, testInfo, "Save New Password");
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
  await submit(page, testInfo, "Save New Password");
  await expect(page.getByText("Use both letters and digits.")).toBeVisible();

  await password.fill(newPassword);
  await confirm.fill(newPassword);
  await submit(page, testInfo, "Save New Password");
  await expect(page).toHaveURL(/\/inspections$/);

  if (testInfo.project.name === "desktop") {
    // One more sign-in, in one project: the new password works.
    expect(await sessionCookies(email, newPassword)).not.toHaveLength(0);
  }
});

test("a password sign-in is sent to the email link instead", async ({ page, context, baseURL }, testInfo) => {
  // The app's own screens set passwords only from an email link. This is UI
  // hardening: Supabase Auth would still take a change from this session.
  // A session of its own: the test signs it out, which revokes it for anyone sharing it (E2E_SESSION_CACHE).
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector, undefined, { fresh: true });
  await open(page, "/reset-password");

  await expect(page.getByRole("heading", { level: 1, name: "Use Your Email Link" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "Passwords are set from an invite or reset link opened in the last hour.",
  );
  await expect(page.getByLabel("New Password", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Inspections" })).toHaveAttribute("href", "/inspections");
  await expect(page).toHaveTitle("Use Your Email Link · SteriCare QC");
  await shot(page, testInfo, "reset-password-signed-in");

  // The way to a new link: sign out (this device only), then "Forgot Password?".
  await press(page.getByRole("button", { name: "Sign Out" }), testInfo);
  await expect(page).toHaveURL(/\/login$/);
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => /^sb-.+-auth-token/.test(cookie.name))).toHaveLength(0);
});

test("a deactivated account that opens a reset link is signed out", async ({ page, context, accounts }, testInfo) => {
  onlyIn(testInfo, "desktop");
  const { email } = await accounts.create({ active: false });
  await openEmailLink(page, await recoveryLink(email));

  // /reset-password → requireUser → /auth/sign-out → /login?error=deactivated
  await expect(page).toHaveURL(/\/login\?error=deactivated$/);
  await expect(page.getByText("This account has been deactivated. Ask your SteriCare administrator.")).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => /^sb-.+-auth-token/.test(cookie.name))).toHaveLength(0);
});
