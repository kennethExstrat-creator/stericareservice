import { throwawayEmail } from "../support/admin";
import { expect, onlyIn, open, press, shot, test } from "./support";

// One real reset request per run, in one project: Supabase's built-in mailer
// allows a few emails an hour. The address belongs to no account, so Supabase
// answers without sending anything, and the screen must look exactly as it
// does for a real account.

test("a reset request always gets the same confirmation", async ({ page }, testInfo) => {
  onlyIn(testInfo, "desktop");
  const email = throwawayEmail("signin");

  await open(page, "/forgot-password");
  await page.getByLabel("Email").fill(email.toUpperCase());
  await press(page.getByRole("button", { name: "Send reset link" }), testInfo);

  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If an account exists for that email, a reset link is on its way.",
  );
  await expect(page.getByText(`Email entered: ${email}`)).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await shot(page, testInfo, "forgot-password-sent");

  await press(page.getByRole("link", { name: "Back to sign in" }), testInfo);
  await expect(page).toHaveURL(/\/login$/);
});
