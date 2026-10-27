import { expect, test } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  chooseRowAction,
  createThrowaway,
  createThrowawayRole,
  deleteAccount,
  deleteAccountsWithEmail,
  deleteRole,
  detailsOf,
  expectRoleRadios,
  profileByEmail,
  profileOf,
  roleOf,
  roleRadio,
  rolesReady,
  rowFor,
  shot,
  statusOf,
  sweepThrowawayRoles,
  sweepThrowaways,
  pickRole,
  teamsReady,
  throwawayAddress,
  toast,
} from "./support";

// /admin/users: who can reach it, the list, the invite dialog and accounts
// waiting for activation. The lifecycle of one account (role, deactivate,
// reactivate) is in lifecycle.spec.ts, Edit Details in details.spec.ts,
// invitations not yet answered in invites.spec.ts; lead inspectors and their
// teams in e2e/org. Every spec here runs on a project with or without lead
// inspectors (migration 20261007170000): without, the screen sets roles only.
// Custom roles (migration 20261027150000) are made for one spec and deleted.

test.afterAll(async () => {
  await sweepThrowaways();
  await sweepThrowawayRoles();
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
  // The app's own 404 page ("Page Not Found") or Next's default one.
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

  for (const header of ["Name", "Role", "Status", "Last Signed In"]) {
    await expect(page.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
  }
  // Email and Phone have their own columns from 1280 and 1440 px without a touchscreen; elsewhere they sit under
  // the name (the desktop project is 1440 px wide).
  for (const header of ["Email", "Phone"]) {
    await expect(page.getByRole("columnheader", { name: header, exact: true })).toBeVisible({
      visible: test.info().project.name === "desktop",
    });
  }
  const teams = await teamsReady();
  if (teams) {
    // Each lead's team, one at a time (e2e/org checks the teams themselves).
    await expect(page.getByRole("combobox", { name: "Team", exact: true })).toBeVisible();
    // The Lead Inspector column from 1024 px; below that the lead sits under the role.
    if (page.viewportSize()!.width >= 1024) {
      await expect(page.getByRole("columnheader", { name: "Lead Inspector", exact: true })).toBeVisible();
    }
  } else {
    await expect(page.getByTestId("teams-missing")).toContainText("20261007170000_lead_inspectors.sql");
  }
  // The date each person was added: its own column from 1024 px, under the name below that.
  if (page.viewportSize()!.width >= 1024) {
    await expect(page.getByRole("columnheader", { name: "Added", exact: true })).toBeVisible();
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

  // No way to lock yourself out: no deactivate, no demotion. Your own details you can change.
  await me.getByRole("button", { name: /^Actions for / }).click();
  await expect(page.getByRole("menuitem", { name: "Edit Details", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Send Password Link", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Deactivate" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Change Role" })).toHaveCount(0);
  await shot(page, "admin-own-menu");
  await page.keyboard.press("Escape");
  // Gone, not only closing: Edit Details is in both menus, and a menu animates out.
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Menu items are labels, in Title Case (Kenneth, 8 October 2026).
  await inspector.getByRole("button", { name: /^Actions for / }).click();
  const items = ["Edit Details", "Change Role", "Send Password Link", "Deactivate", ...(teams ? ["Change Lead Inspector"] : [])];
  for (const item of items) {
    await expect(page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
  }
  // Invitations are for accounts not yet created: someone who signs in has none of them.
  for (const item of ["Resend Invite", "Copy Invite Link", "Cancel Invite"]) {
    await expect(page.getByRole("menuitem", { name: item, exact: true })).toHaveCount(0);
  }
  await shot(page, "admin-row-menu");
  await page.keyboard.press("Escape");
});

test("the invite dialog explains every problem in place", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  await page.goto("/admin/users");

  await page.getByRole("button", { name: "Invite User", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a User", exact: true });
  await expect(dialog).toBeVisible();
  // Inspector to start with: the least anyone is given.
  await expect(roleRadio(dialog, "Inspector")).toBeChecked();
  const teams = await teamsReady();
  if (teams) {
    // An inspector's lead is asked for.
    await expect(roleRadio(dialog, "Lead Inspector")).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Lead Inspector" })).toBeVisible();
  }
  // Each role named and described as a screen reader hears it, in Chrome's own tree (getByRole finds the
  // names even where Chrome has none): the built-in roles first, then any custom roles.
  await expectRoleRadios(dialog, teams);
  // Send Email, as before, or Create Link, a link to send by hand; the button says which.
  await expect(dialog.getByRole("radio", { name: "Send Email", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Create Link", exact: true })).not.toBeChecked();
  await shot(page, "invite-dialog");

  // The address and the role only: the invitee gives their own name, phone and password on Account Creation.
  await expect(dialog.getByRole("textbox")).toHaveCount(1);
  await expect(dialog.getByLabel("Full Name")).toHaveCount(0);
  await expect(dialog).toContainText("They create their account from a link: their name, phone and password.");

  await test.step("Create Link names the button for it, and Send Email back again", async () => {
    await dialog.getByRole("radio", { name: "Create Link", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Create Link", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send Invite", exact: true })).toHaveCount(0);
    await dialog.getByRole("radio", { name: "Send Email", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Send Invite", exact: true })).toBeVisible();
  });

  await test.step("an empty form marks the email", async () => {
    await dialog.getByRole("button", { name: "Send Invite", exact: true }).click();
    const email = dialog.getByLabel("Email", { exact: true });
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText("Enter their email address.")).toBeVisible();
    // The error text is the field's description, and focus goes to the problem.
    await expect(email).toHaveAccessibleDescription("Enter their email address.");
    await expect(email).toBeFocused();
    await shot(page, "invite-errors");
  });

  await test.step("an address that already has an account stops before any email, and every choice stays", async () => {
    await dialog.getByLabel("Email", { exact: true }).fill(TEST_ACCOUNTS.inspector.toUpperCase());
    await expect(dialog.getByText("Enter their email address.")).toHaveCount(0);
    // React resets a form after its action: the role must not flip back to Inspector when the invite is refused.
    await pickRole(dialog, "Admin");
    await dialog.getByRole("button", { name: "Send Invite", exact: true }).click();
    await expect(dialog.getByText(/That email already has an account/)).toBeVisible();
    await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(TEST_ACCOUNTS.inspector.toUpperCase());
    await expect(roleRadio(dialog, "Admin")).toBeChecked();
    await expect(roleRadio(dialog, "Inspector")).not.toBeChecked();
    await shot(page, "invite-existing");
  });

  await test.step("Cancel closes it, and it opens again empty", async () => {
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Invite User", exact: true }).click();
    await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue("");
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
    await page.getByRole("button", { name: "Invite User", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a User", exact: true });
    await dialog.getByLabel("Email", { exact: true }).fill(email);
    // An inspector would need a lead inspector first; a lead inspector needs none.
    if (await teamsReady()) await pickRole(dialog, "Lead Inspector");
    await dialog.getByRole("button", { name: "Send Invite", exact: true }).click();

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
      // New accounts start inactive; the invite activates the one it created. Invited, by its email, until
      // its person creates it on Account Creation: no name yet.
      await expect(dialog).toBeHidden();
      await expect(statusOf(rowFor(page, email))).toHaveText("Invited");
      const profile = await profileByEmail(email);
      expect(profile).toMatchObject({ active: true, role: "inspector", full_name: null });
      expect(await detailsOf(profile!.id)).toMatchObject({ phone: null, joined_at: null });
    } else if (await notSent.isVisible()) {
      await expect(notSent).toContainText("custom SMTP");
      await expect(rowFor(page, email)).toHaveCount(0);
    } else {
      // Shown at the field the admin typed it in, and nothing was created.
      const field = dialog.getByLabel("Email", { exact: true });
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
    await expect(statusOf(row)).toHaveText("Pending Activation");
    await expect(row).toContainText("Never");
    await row.scrollIntoViewIfNeeded();
    await shot(page, "pending-activation");

    await test.step("until an admin activates it, the account sees nothing", async () => {
      // Supabase Auth lets the password through; the app turns them away.
      expect((await theirVisit()).url).toMatch(/\/login\?error=deactivated$/);
    });

    await test.step("a refused sign-in leaves it pending, not deactivated", async () => {
      await page.reload();
      await expect(statusOf(row)).toHaveText("Pending Activation");
      await expect(row).not.toContainText("Never");
    });

    await test.step("Activate lets it in", async () => {
      const dialog = await chooseRowAction(page, row, "Activate");
      await expect(dialog).toContainText(`Activate ${person.fullName}?`);
      const teams = await teamsReady();
      // An inspector in no team is asked for a role and a lead first: a lead inspector needs none.
      if (teams) await pickRole(dialog, "Lead Inspector");
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

test("a custom role that sees every inspection: given in Change Role, named in the list, and still a 404 on /admin/users", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  test.skip(!(await rolesReady()), "Needs supabase/migrations/20261027150000_roles_and_permissions.sql on the project");
  // One account and one role, on one project: desktop only.
  test.skip(test.info().project.name !== "desktop", "Changes a throwaway account's role: desktop only");
  test.setTimeout(90_000);
  const role = await createThrowawayRole("all");
  const person = await createThrowaway("E2E Custom Role Person");
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const row = rowFor(page, person.email);

    await test.step("Change Role offers it after the built-in roles, saying what it sees, and gives it", async () => {
      const dialog = await chooseRowAction(page, row, "Change Role");
      await expectRoleRadios(dialog, await teamsReady());
      await expect(roleRadio(dialog, role.name)).toHaveAccessibleDescription("Sees All Inspections");
      await pickRole(dialog, role.name);
      // Every inspection in sight: no lead to choose.
      await expect(dialog.getByRole("combobox", { name: "Lead Inspector" })).toHaveCount(0);
      await shot(page, "custom-role");
      await dialog.getByRole("button", { name: "Save Role", exact: true }).click();
      await expect(toast(page, `${person.fullName}'s role is now ${role.name}.`)).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(row.locator('[data-slot="role"]')).toHaveText(role.name);
      // The role's id, and in no team: the database gives the level its access.
      expect(await roleOf(person.id)).toMatchObject({ role_id: role.id, role: "admin", is_lead: false, lead_id: null });
    });

    await test.step("they see every inspection, but never the Users page: that is the Admin role's alone", async () => {
      const theirs = await browser.newContext({ baseURL });
      try {
        await signIn(theirs, baseURL!, person.email, person.password, { fresh: true });
        const theirPage = await theirs.newPage();
        const response = await theirPage.goto("/admin/users");
        expect(response?.status()).toBe(404);
        await expect(theirPage.getByRole("heading", { name: "Users", level: 1 })).toHaveCount(0);
        expect(await response?.text()).not.toContain("Users · SteriCare QC");
      } finally {
        await theirs.close();
      }
    });
  } finally {
    // The account first: a role someone has is kept.
    await deleteAccount(person.id);
    await deleteRole(role.id);
  }
});
