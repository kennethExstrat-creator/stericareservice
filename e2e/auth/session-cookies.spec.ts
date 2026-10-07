import { expect, test, type Page, type Response, type Route, type TestInfo } from "@playwright/test";
import { createTestAdminClient, throwawayEmail } from "../support/admin";
import { TEST_ACCOUNTS, TEST_PASSWORD } from "../support/session";
import { onlyIn, open, press, sessionCookiesSet, shot } from "./support";

/*
 * Final audit SEC-05 and SEC-06, through the real screens: signing in and
 * opening an email link go through createAuthClient (lib/supabase/server.ts:
 * the secret key, and on Vercel the visitor's address in Sb-Forwarded-For),
 * and the session cookies are Secure over HTTPS and only there.
 *
 * Over HTTPS is what Vercel tells the app with x-forwarded-proto: https, which
 * the specs add to one request. Run the dev server with VERCEL=1 to send
 * Sb-Forwarded-For as well (the address Next.js records for the local browser).
 *
 * Each test calls Supabase Auth once or twice: they run in desktop, and the
 * plain sign-in also on the 13 inch iPad, to stay inside the per-IP sign-in
 * limit every spec shares.
 */

/** Sends one request on as if it had reached the app over HTTPS, as Vercel forwards it. */
async function overHttps(route: Route) {
  await route.continue({ headers: { ...(await route.request().allHeaders()), "x-forwarded-proto": "https" } });
}

/** Signs in through /login and returns the Server Action's answer, which sets the cookies. */
async function signInThroughForm(page: Page, testInfo: TestInfo, email: string): Promise<Response> {
  await open(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  const answer = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/login");
  await press(page.getByRole("button", { name: "Sign in" }), testInfo);
  return answer;
}

test("signing in over plain http: cookies without Secure, and the user's own client finds the session", async ({ page }, testInfo) => {
  onlyIn(testInfo, ["desktop", "ipad-pro-landscape"]);
  const cookies = await sessionCookiesSet(await signInThroughForm(page, testInfo, TEST_ACCOUNTS.inspector));

  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) {
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    // The dev server on the LAN is plain http: a Secure cookie would be dropped there.
    expect(cookie).not.toMatch(/;\s*Secure/i);
  }
  // The profile check after sign-in read the new session from the cookies: an
  // active inspector lands on the list rather than "deactivated".
  await expect(page).toHaveURL(/\/inspections$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inspections" })).toBeVisible();
  await shot(page, testInfo, "signed-in-over-http");
});

test("signing in over HTTPS: the session cookies are Secure", async ({ page }, testInfo) => {
  onlyIn(testInfo, ["desktop"]);
  await page.route("**/login", (route) => (route.request().method() === "POST" ? overHttps(route) : route.continue()));

  const cookies = await sessionCookiesSet(await signInThroughForm(page, testInfo, TEST_ACCOUNTS.admin));

  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) {
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
  }
  await expect(page).toHaveURL(/\/inspections$/);
});

test("an email link opens a session through the auth client, with Secure cookies over HTTPS", async ({ page }, testInfo) => {
  onlyIn(testInfo, ["desktop"]);
  const admin = createTestAdminClient();
  const email = throwawayEmail("auth");
  const created = await admin.auth.admin.createUser({ email, password: `Throwaway-auth-${Date.now()}`, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Could not create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;

  try {
    // New accounts start inactive; this one is in use, as after an admin's invite.
    const activated = await admin.from("profiles").update({ active: true }).eq("id", userId);
    if (activated.error) throw new Error(`Could not activate ${email}: ${activated.error.message}`);
    // A reset link as Supabase would email it, without sending anything.
    const link = await admin.auth.admin.generateLink({ type: "recovery", email });
    const tokenHash = link.data.properties?.hashed_token;
    if (link.error || !tokenHash) throw new Error(`generateLink failed: ${link.error?.message}`);

    await page.route("**/auth/confirm?**", overHttps);
    const landing = await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`);

    // /auth/confirm checked the link and set the cookies on its redirect.
    const confirm = await landing?.request().redirectedFrom()?.response();
    expect(confirm?.status()).toBe(307);
    const cookies = confirm ? await sessionCookiesSet(confirm) : [];
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    }

    await expect(page).toHaveURL(/\/reset-password\?flow=recovery$/);
    await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(email);
    await shot(page, testInfo, "email-link-landing");
  } finally {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Could not delete ${email}: ${error.message}`);
  }
});
