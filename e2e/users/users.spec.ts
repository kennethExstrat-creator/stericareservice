import { expect, test } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  chooseRowAction,
  createThrowaway,
  deleteAccount,
  deleteAccountsWithEmail,
  profileByEmail,
  profileOf,
  rowFor,
  shot,
  statusOf,
  sweepThrowaways,
  pickRole,
  teamsReady,
  throwawayAddress,
  toast,
} from "./support";

// /admin/users: who can reach it, the list, the invite dialog and accounts
// waiting for activation. The lifecycle of one account (role, deactivate,
// reactivate) is in lifecycle.spec.ts; lead inspectors and their teams in
// e2e/org. Every spec here runs on a project with or without lead
// inspectors (migration 20261007170000): without, the screen sets roles only.

test.afterAll(async () => {
  await sweepThrowaways();
});

test("signed out, /admin/users sends you to sign in and back", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers$/);
  await shot(page, "signed-out");
});

test("an inspector gets a 404 for /admin/users", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);

  const response = await page.goto("/admin/users");

  expect(response?.status()).toBe(404);
  // The app's own 404 page ("Page not found") or Next's default one.
  await expect(page.getByText(/page not found|could not be found/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Users", level: 1 })).toHaveCount(0);
  await expect(page.getByText(TEST_ACCOUNTS.admin)).toHaveCount(0);
  // Nothing names the page: not the tab title, not the HTML.
  expect(await page.locator("title").allTextContents()).not.toContainEqual(expect.stringContaining("Users"));
  expect(await response?.text()).not.toContain("Users · SteriCare QC");
  await shot(page, "inspector-404");
});

test("the admin sees everyone, with themselves marked and protected", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);

  const response = await page.goto("/admin/users");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Users · SteriCare QC");
  await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();

  const me = rowFor(page, TEST_ACCOUNTS.admin);
  await expect(me).toContainText("You");
  await expect(me).toContainText("Admin");
  await expect(statusOf(me)).toHaveText("Active");

  const inspector = rowFor(page, TEST_ACCOUNTS.inspector);
  await expect(inspector).toContainText("Inspector");
  await expect(inspector).not.toContainText("You");

  for (const header of ["Name", "Role", "Status", "Last signed in"]) {
    await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
  }
  const teams = await teamsReady();
  if (teams) {
    // Each lead's team, one at a time (e2e/org checks the teams themselves).
    await expect(page.getByRole("combobox", { name: "Team", exact: true })).toBeVisible();
    // The Lead inspector column from 1024 px; below that the lead sits under the role.
    if (page.viewportSize()!.width >= 1024) {
      await expect(page.getByRole("columnheader", { name: "Lead inspector" })).toBeVisible();
    }
  } else {
    await expect(page.getByTestId("teams-missing")).toContainText("20261007170000_lead_inspectors.sql");
  }
  // The date each person was added: its own column from 1024 px, under the name below that.
  if (page.viewportSize()!.width >= 1024) {
    await expect(page.getByRole("columnheader", { name: "Added" })).toBeVisible();
  } else {
    await expect(me.getByText(/^Added \d{1,2} \w{3} \d{4}$/)).toBeVisible();
  }
  // Compact rows with a mouse (docs/DESIGN.md, Density); 44 px controls on touch.
  if (test.info().project.name === "desktop") {
    for (const row of [me, inspector]) {
      const height = (await row.boundingBox())?.height ?? 0;
      expect(height).toBeGreaterThanOrEqual(32);
      expect(height).toBeLessThanOrEqual(36);
    }
  } else {
    const trigger = me.getByRole("button", { name: /^Actions for / });
    expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await shot(page, "admin-list");

  // No way to lock yourself out: no deactivate, no demotion.
  await me.getByRole("button", { name: /^Actions for / }).click();
  await expect(page.getByRole("menuitem", { name: "Send password link" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Deactivate" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Change role" })).toHaveCount(0);
  await shot(page, "admin-own-menu");
  await page.keyboard.press("Escape");

  await inspector.getByRole("button", { name: /^Actions for / }).click();
  for (const item of ["Change role", "Send password link", "Deactivate", ...(teams ? ["Change lead inspector"] : [])]) {
    await expect(page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
  }
  await shot(page, "admin-row-menu");
  await page.keyboard.press("Escape");
});

test("the invite dialog explains every problem in place", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  await page.goto("/admin/users");

  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a user" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /^Inspector\b/ })).toBeChecked();
  if (await teamsReady()) {
    // Inspector, Lead inspector or Admin; an inspector's lead is asked for.
    await expect(dialog.getByRole("radio", { name: /^Lead inspector\b/ })).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Lead inspector" })).toBeVisible();
  }
  await shot(page, "invite-dialog");

  await test.step("an empty form marks both fields", async () => {
    await dialog.getByRole("button", { name: "Send invite" }).click();
    const name = dialog.getByLabel("Full name");
    const email = dialog.getByLabel("Email");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText("Enter their full name.")).toBeVisible();
    await expect(dialog.getByText("Enter their email address.")).toBeVisible();
    // The error text is the field's description, and focus goes to the first problem.
    await expect(name).toHaveAccessibleDescription("Enter their full name.");
    await expect(name).toBeFocused();
    await shot(page, "invite-errors");
  });

  await test.step("an address that already has an account stops before any email, and every choice stays", async () => {
    await dialog.getByLabel("Full name").fill("Someone Else");
    await dialog.getByLabel("Email").fill(TEST_ACCOUNTS.inspector.toUpperCase());
    await expect(dialog.getByText("Enter their full name.")).toHaveCount(0);
    // React resets a form after its action: the role must not flip back to Inspector when the invite is refused.
    await pickRole(dialog, "Admin");
    await dialog.getByRole("button", { name: "Send invite" }).click();
    await expect(dialog.getByText(/That email already has an account/)).toBeVisible();
    await expect(dialog.getByLabel("Email")).toHaveValue(TEST_ACCOUNTS.inspector.toUpperCase());
    await expect(dialog.getByLabel("Full name")).toHaveValue("Someone Else");
    await expect(dialog.getByRole("radio", { name: /^Admin\b/ })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /^Inspector\b/ })).not.toBeChecked();
    await shot(page, "invite-existing");
  });

  await test.step("Cancel closes it, and it opens again empty", async () => {
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Invite user" }).click();
    await expect(dialog.getByLabel("Email")).toHaveValue("");
    await expect(dialog.getByText(/already has an account/)).toHaveCount(0);
  });
});

test("an invite to a new address is sent, or refused with a clear reason", async ({ page, context, baseURL }) => {
  // One real invite per run: Supabase's built-in mailer allows a few emails an
  // hour and only delivers to the project's team.
  test.skip(test.info().project.name !== "desktop", "Sends an email: desktop only");

  const email = throwawayAddress();
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Invite user" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a user" });
    await dialog.getByLabel("Full name").fill("E2E Invitee");
    await dialog.getByLabel("Email").fill(email);
    // An inspector would need a lead inspector first; a lead inspector needs none.
    if (await teamsReady()) await pickRole(dialog, "Lead inspector");
    await dialog.getByRole("button", { name: "Send invite" }).click();

    // Three outcomes, each with a clear message:
    // - sent (custom SMTP, or the address belongs to the project's team);
    // - the built-in mailer refuses a non-team address: points at custom SMTP;
    // - Supabase refuses the address itself before any email. The live
    //   project does this for @test.local (the domain cannot receive mail).
    const sent = toast(page, `Invite sent to ${email}.`);
    const notSent = dialog.getByRole("alert").filter({ hasText: "could not be sent" });
    const rejected = dialog.getByRole("alert").filter({ hasText: "Supabase refused this address" });
    await expect(sent.or(notSent).or(rejected)).toBeVisible({ timeout: 20_000 });
    await shot(page, "invite-result");

    if (await sent.isVisible()) {
      // New accounts start inactive; the invite activates the one it created.
      await expect(dialog).toBeHidden();
      await expect(statusOf(rowFor(page, email))).toHaveText("Active");
      expect(await profileByEmail(email)).toMatchObject({ active: true, role: "inspector", full_name: "E2E Invitee" });
    } else if (await notSent.isVisible()) {
      await expect(notSent).toContainText("custom SMTP");
      await expect(rowFor(page, email)).toHaveCount(0);
    } else {
      // Shown at the field the admin typed it in, and nothing was created.
      const field = dialog.getByLabel("Email");
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription(/Supabase refused this address/);
      await expect(field).toHaveValue(email);
      expect(await profileByEmail(email)).toBeNull();
    }
  } finally {
    await deleteAccountsWithEmail(email);
  }
});

test("a new account starts as pending activation, and Activate lets it in", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  // Left exactly as the profile trigger made it: new accounts start inactive.
  const person = await createThrowaway("E2E Pending Person", { activate: false });
  /** Signs the throwaway in, in its own browser, and returns where /admin/users takes it. */
  const theirVisit = async () => {
    const theirs = await browser.newContext({ baseURL });
    try {
      await signIn(theirs, baseURL!, person.email, person.password);
      const theirPage = await theirs.newPage();
      const response = await theirPage.goto("/admin/users");
      return { status: response?.status(), url: theirPage.url() };
    } finally {
      await theirs.close();
    }
  };

  try {
    expect(await profileOf(person.id)).toMatchObject({ active: false, role: "inspector" });

    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const row = rowFor(page, person.email);
    await expect(statusOf(row)).toHaveText("Pending activation");
    await expect(row).toContainText("Never");
    await row.scrollIntoViewIfNeeded();
    await shot(page, "pending-activation");

    await test.step("until an admin activates it, the account sees nothing", async () => {
      // Supabase Auth lets the password through; the app turns them away.
      expect((await theirVisit()).url).toMatch(/\/login\?error=deactivated$/);
    });

    await test.step("a refused sign-in leaves it pending, not deactivated", async () => {
      await page.reload();
      await expect(statusOf(row)).toHaveText("Pending activation");
      await expect(row).not.toContainText("Never");
    });

    await test.step("Activate lets it in", async () => {
      const dialog = await chooseRowAction(page, row, "Activate");
      await expect(dialog).toContainText(`Activate ${person.fullName}?`);
      const teams = await teamsReady();
      // An inspector in no team is asked for a role and a lead first: a lead inspector needs none.
      if (teams) await pickRole(dialog, "Lead inspector");
      await shot(page, "activate-confirm");
      await dialog.getByRole("button", { name: "Activate" }).click();

      await expect(
        toast(page, `${person.fullName} is active and can sign in.${teams ? " They are a lead inspector." : ""}`),
      ).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(statusOf(row)).toHaveText("Active");
      expect(await profileOf(person.id)).toMatchObject({ active: true, role: "inspector" });
      // An active inspector: past the session guard, and a 404 on the admin page.
      expect(await theirVisit()).toMatchObject({ status: 404, url: expect.stringMatching(/\/admin\/users$/) });
    });
  } finally {
    await deleteAccount(person.id);
  }
});
