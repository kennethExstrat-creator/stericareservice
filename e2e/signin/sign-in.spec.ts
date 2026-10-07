import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { throwawayEmail } from "../support/admin";
import { TEST_ACCOUNTS, TEST_PASSWORD } from "../support/session";
import { expect, onlyIn, open, press, shot, test } from "./support";

// Signing in through the form against the live project. Each Supabase call is
// pinned to one project (onlyIn) to stay well inside the per-IP sign-in limit
// that every spec in the repo shares. /inspections may still be a 404 in this
// branch: the specs assert where sign-in lands, not what is there.

async function signInThroughForm(page: Page, testInfo: TestInfo, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await press(page.getByRole("button", { name: "Sign In" }), testInfo);
}

async function authCookies(context: BrowserContext) {
  return (await context.cookies()).filter((cookie) => /^sb-.+-auth-token/.test(cookie.name));
}

test.describe("signing in", () => {
  for (const [project, account] of [
    ["ipad-portrait", "inspector"],
    ["ipad-landscape", "admin"],
    ["desktop", "inspector"],
    ["desktop", "admin"],
  ] as const) {
    test(`the ${account} lands on /inspections (${project})`, async ({ page, context }, testInfo) => {
      onlyIn(testInfo, project);
      await open(page, "/login");
      await signInThroughForm(page, testInfo, TEST_ACCOUNTS[account], TEST_PASSWORD);
      await expect(page).toHaveURL(/\/inspections$/);
      expect(await authCookies(context)).not.toHaveLength(0);

      // Signed in, the sign-in screens send you on.
      await page.goto("/login");
      await expect(page).toHaveURL(/\/inspections$/);
    });
  }

  test("a wrong password gets the generic message and keeps the email", async ({ page, context }, testInfo) => {
    await open(page, "/login");
    await signInThroughForm(page, testInfo, TEST_ACCOUNTS.inspector, "not-the-password-1");

    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toHaveText("Email or password is incorrect.");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email")).toHaveValue(TEST_ACCOUNTS.inspector);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    expect(await authCookies(context)).toHaveLength(0);
    await shot(page, testInfo, "login-wrong-password");
  });

  test("an unknown email reads exactly like a wrong password", async ({ page }, testInfo) => {
    onlyIn(testInfo, "desktop");
    await open(page, "/login");
    await signInThroughForm(page, testInfo, throwawayEmail("signin"), "not-the-password-1");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Email or password is incorrect.");
  });

  test("?next= is honoured", async ({ page }, testInfo) => {
    onlyIn(testInfo, "desktop");
    await open(page, "/login?next=%2Finspections%3Fstatus%3Dsubmitted");
    await signInThroughForm(page, testInfo, TEST_ACCOUNTS.inspector, TEST_PASSWORD);
    await expect(page).toHaveURL(/\/inspections\?status=submitted$/);
  });

  for (const [project, next] of [
    ["ipad-portrait", "https://evil.example/phish"],
    // Collapses to "//evil.example" inside safeNextPath (fixed on main); signIn checks again.
    ["ipad-landscape", "/.//evil.example"],
  ] as const) {
    test(`an external ?next= is ignored: ${next}`, async ({ page }, testInfo) => {
      onlyIn(testInfo, project);
      await open(page, `/login?next=${encodeURIComponent(next)}`);
      await signInThroughForm(page, testInfo, TEST_ACCOUNTS.inspector, TEST_PASSWORD);
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/inspections$/);
    });
  }
});

test.describe("a deactivated account", () => {
  test("is signed straight out again with the deactivated message", async ({ page, context, accounts }, testInfo) => {
    onlyIn(testInfo, "desktop");
    // Inactive profile, auth account not banned: only the app's own check stands in the way.
    const account = await accounts.create({ active: false });

    await open(page, "/login");
    await signInThroughForm(page, testInfo, account.email, account.password);

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "This account has been deactivated. Ask your SteriCare administrator.",
    );
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email")).toHaveValue(account.email);
    expect(await authCookies(context)).toHaveLength(0);
    await shot(page, testInfo, "login-deactivated-account");
  });
});
