import { expect, test, type Page } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  accountExists,
  chooseRowAction,
  createInvitee,
  deleteAccount,
  detailsOf,
  rowFor,
  shot,
  statusOf,
  sweepThrowaways,
  toast,
} from "./support";

// Invitations not yet answered on /admin/users (Kenneth, 27 October 2026: an
// invited user "goes to Account Creation page where Name, Email, Phone is
// being filled in"): until its person creates it, an invited account is
// Invited, named by its email, and its menu offers Resend Invite, Copy Invite
// Link and Cancel Invite, never a password link. Throwaway accounts only,
// made without a password as an invite makes them. Nothing is emailed but by
// Resend Invite, once, on desktop: the live project refuses the test.local
// addresses before any email.

test.afterAll(async () => {
  await sweepThrowaways();
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const actionsFor = (page: Page, email: string) =>
  rowFor(page, email).getByRole("button", { name: `Actions for ${email}`, exact: true });

test("an invited account is Invited, by its email, with the invitation actions and no password link", async ({
  page,
  context,
  baseURL,
}) => {
  const invitee = await createInvitee();
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const row = rowFor(page, invitee.email);
    await expect(statusOf(row)).toHaveText("Invited");
    // No name yet: the list names them by their email.
    await expect(actionsFor(page, invitee.email)).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await shot(page, "invited-row");

    await actionsFor(page, invitee.email).click();
    for (const item of ["Resend Invite", "Copy Invite Link", "Edit Details", "Change Role", "Cancel Invite", "Deactivate"]) {
      await expect(page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("menuitem", { name: "Send Password Link" })).toHaveCount(0);
    await shot(page, "invited-menu");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await test.step("Edit Details says what they enter on Account Creation replaces these", async () => {
      const dialog = await chooseRowAction(page, row, "Edit Details");
      await expect(dialog).toContainText("They have not created their account yet: the name and phone number they enter then replace these.");
      await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toBeHidden();
    });
  } finally {
    await deleteAccount(invitee.id);
  }
});

test("Copy Invite Link asks first, then copies a link on /auth/confirm that signs them in once", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  test.skip(test.info().project.name !== "desktop", "Makes sign-in links: desktop only");
  test.setTimeout(90_000);
  const invitee = await createInvitee();
  /** Opens a link in a browser of the invitee's own and returns where it ends. */
  const follow = async (link: string) => {
    const theirs = await browser.newContext({ baseURL });
    try {
      const theirPage = await theirs.newPage();
      await theirPage.goto(link);
      return theirPage.url();
    } finally {
      await theirs.close();
    }
  };
  /** Copy Invite Link from the row's menu, through to the link. */
  const copyLink = async () => {
    const dialog = await chooseRowAction(page, rowFor(page, invitee.email), "Copy Invite Link");
    await dialog.getByRole("button", { name: "Create Link", exact: true }).click();
    const field = dialog.getByRole("textbox", { name: "Invite Link", exact: true });
    await expect(field).toBeVisible();
    return { dialog, field, link: await field.inputValue() };
  };

  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/admin/users");

    let first = "";
    await test.step("it asks before making a link, since a new one stops every earlier one working", async () => {
      const dialog = await chooseRowAction(page, rowFor(page, invitee.email), "Copy Invite Link");
      await expect(dialog.getByRole("heading", { name: `Create an Invite Link for ${invitee.email}?`, exact: true })).toBeVisible();
      await expect(dialog).toContainText("Any link sent or copied before stops working");
      await shot(page, "invite-link-confirm");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step("Create Link copies an invite link and shows it, with Copy Link", async () => {
      const { dialog, field, link } = await copyLink();
      first = link;
      expect(link).toMatch(new RegExp(`^${escape(baseURL!)}/auth/confirm\\?token_hash=[0-9a-f]+&type=invite$`));
      await expect(dialog.getByRole("heading", { name: `Invite Link for ${invitee.email}`, exact: true })).toBeVisible();
      await expect(dialog.getByRole("status")).toHaveText("Copied. Paste it into WhatsApp or another chat to send it.");
      await expect(toast(page, `Invite link for ${invitee.email} copied.`)).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
      // Selected, ready to copy by hand.
      await expect(field).toBeFocused();
      await expect(field).toHaveAttribute("readonly", "");
      await shot(page, "invite-link");

      await page.evaluate(() => navigator.clipboard.writeText(""));
      await dialog.getByRole("button", { name: "Copy Link", exact: true }).click();
      await expect(toast(page, "Invite link copied.")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(dialog).toBeHidden();
      // Nothing changed on the account.
      expect(await detailsOf(invitee.id)).toMatchObject({ full_name: null, joined_at: null });
    });

    await test.step("the link signs them in, once", async () => {
      expect(await follow(first)).not.toMatch(/\/login/);
      expect(await follow(first)).toMatch(/\/login\?error=link_invalid$/);
    });

    await test.step("once they opened it, a new link is a magic link, checked as an email link", async () => {
      const { dialog, link } = await copyLink();
      expect(link).toMatch(new RegExp(`^${escape(baseURL!)}/auth/confirm\\?token_hash=[0-9a-f]+&type=email$`));
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      expect(await follow(link)).not.toMatch(/\/login/);
    });
  } finally {
    await deleteAccount(invitee.id);
  }
});

test("Resend Invite emails a new link, or says plainly why not", async ({ page, context, baseURL }) => {
  // One email at most per run: Supabase's built-in mailer allows a few an hour.
  test.skip(test.info().project.name !== "desktop", "Sends an email: desktop only");
  const invitee = await createInvitee();
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const dialog = await chooseRowAction(page, rowFor(page, invitee.email), "Resend Invite");
    await expect(dialog.getByRole("heading", { name: `Resend the Invite to ${invitee.email}?`, exact: true })).toBeVisible();
    await expect(dialog).toContainText(`We email ${invitee.email} a new link to create their account`);
    await shot(page, "resend-invite-confirm");
    await dialog.getByRole("button", { name: "Resend Invite", exact: true }).click();

    // Sent (custom SMTP), or refused with the reason: the live project refuses test.local before any email.
    const sent = toast(page, `A new invite went to ${invitee.email}.`);
    const refused = dialog.getByRole("alert");
    await expect(sent.or(refused)).toBeVisible({ timeout: 20_000 });
    if (await refused.isVisible()) {
      await expect(refused).toContainText(/could not be sent|refused this address/);
      await expect(refused).toContainText("Copy Invite Link");
    }
    await shot(page, "resend-invite-result");
  } finally {
    await deleteAccount(invitee.id);
  }
});

test("Cancel Invite removes an account nobody created, after asking", async ({ page, context, baseURL }) => {
  const invitee = await createInvitee();
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const row = rowFor(page, invitee.email);

    const dialog = await chooseRowAction(page, row, "Cancel Invite");
    await expect(dialog.getByRole("heading", { name: `Cancel the Invite to ${invitee.email}?`, exact: true })).toBeVisible();
    // The way out first, and not called Cancel beside Cancel Invite.
    await expect(dialog.getByRole("button", { name: "Keep Invite", exact: true })).toBeFocused();
    await shot(page, "cancel-invite-confirm");
    await dialog.getByRole("button", { name: "Keep Invite", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await accountExists(invitee.id)).toBe(true);

    const again = await chooseRowAction(page, row, "Cancel Invite");
    await again.getByRole("button", { name: "Cancel Invite", exact: true }).click();
    await expect(
      toast(page, `The invite to ${invitee.email} is cancelled: its link no longer works, and the address can be invited again.`),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(await accountExists(invitee.id)).toBe(false);
    await shot(page, "cancel-invite-done");
  } finally {
    await deleteAccount(invitee.id);
  }
});
