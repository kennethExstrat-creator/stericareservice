import { expect, test } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import { rowFor, shot, statusOf } from "./support";

// /admin/users on a server without SUPABASE_SECRET_KEY: invites are off and
// the page says why. Opt-in, because the dev server must be started without
// the key (an empty value wins over .env.local):
//
//   SUPABASE_SECRET_KEY= npx next dev -p 3202
//   E2E_SERVER_WITHOUT_SECRET_KEY=1 PLAYWRIGHT_BASE_URL=http://localhost:3202 \
//     npx playwright test e2e/users/no-secret-key.spec.ts

test.skip(!process.env.E2E_SERVER_WITHOUT_SECRET_KEY, "Needs a dev server started without SUPABASE_SECRET_KEY");

test("without the secret key, invites are off and the page says why", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  await page.goto("/admin/users");

  await expect(page.getByRole("alert").filter({ hasText: "Invites are switched off" })).toContainText(
    "SUPABASE_SECRET_KEY",
  );
  await expect(page.getByRole("button", { name: "Invite user" })).toBeDisabled();
  // Sign-in details need the key: no last sign-in column, plain Active / Deactivated.
  await expect(page.getByRole("columnheader", { name: "Last signed in" })).toHaveCount(0);
  await expect(statusOf(rowFor(page, TEST_ACCOUNTS.admin))).toHaveText("Active");
  await shot(page, "no-secret-key");
});
