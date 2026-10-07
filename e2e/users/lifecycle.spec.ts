import { expect, test, type Browser } from "@playwright/test";
import { sessionCookies, signIn, TEST_ACCOUNTS } from "../support/session";
import {
  chooseRowAction,
  chromeNames,
  createThrowaway,
  deleteAccount,
  isBanned,
  pickRole,
  profileOf,
  roleRadios,
  rowFor,
  shot,
  statusOf,
  sweepThrowaways,
  teamsReady,
  toast,
} from "./support";

// One throwaway account through its whole life on /admin/users: promoted,
// deactivated (its open session is blocked and it cannot sign in again),
// reactivated (access returns), demoted, then deleted.

test.afterAll(async () => {
  await sweepThrowaways();
});

/** A separate browser for the throwaway account, signed in as it. */
async function browserOf(browser: Browser, baseURL: string, email: string, password: string) {
  const context = await browser.newContext({ baseURL });
  await signIn(context, baseURL, email, password);
  return { context, page: await context.newPage() };
}

test("an admin changes a role, deactivates and reactivates an account", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  test.setTimeout(120_000);
  const person = await createThrowaway("E2E Lifecycle Person");
  // Opened inside the try, so the account is deleted even if signing it in fails.
  let opened: Awaited<ReturnType<typeof browserOf>> | undefined;

  try {
    const theirs = await browserOf(browser, baseURL!, person.email, person.password);
    opened = theirs;
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const row = rowFor(page, person.email);
    await expect(statusOf(row)).toHaveText("Active");
    await expect(row).toContainText("Inspector");

    await test.step("as an inspector they get a 404 on the admin page", async () => {
      const response = await theirs.page.goto("/admin/users");
      expect(response?.status()).toBe(404);
      await expect(theirs.page.getByRole("heading", { name: "Users", level: 1 })).toHaveCount(0);
    });

    await test.step("make them an admin", async () => {
      const dialog = await chooseRowAction(page, row, "Change Role");
      await expect(dialog).toContainText(`Change ${person.fullName}'s Role`);
      // Named as a screen reader hears them, in Chrome's own tree (getByRole finds names Chrome may not have).
      expect(await chromeNames(dialog, "radio")).toEqual(roleRadios(await teamsReady()));
      await pickRole(dialog, "Admin");
      await shot(page, "make-admin-confirm");
      await dialog.getByRole("button", { name: "Save Role", exact: true }).click();
      await expect(toast(page, `${person.fullName} is now an admin.`)).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText("Admin");
    });

    await test.step("their open session now reaches the admin page", async () => {
      const response = await theirs.page.goto("/admin/users");
      expect(response?.status()).toBe(200);
      await expect(theirs.page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    });

    await test.step("deactivate them", async () => {
      const dialog = await chooseRowAction(page, row, "Deactivate");
      await expect(dialog).toContainText(`Deactivate ${person.fullName}?`);
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await shot(page, "deactivate-confirm");
      await dialog.getByRole("button", { name: "Deactivate" }).click();
      await expect(toast(page, `${person.fullName} is deactivated and has lost access.`)).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(statusOf(row)).toHaveText("Deactivated");
      expect(await profileOf(person.id)).toMatchObject({ active: false });
      expect(await isBanned(person.id)).toBe(true);
      await shot(page, "deactivated");
    });

    await test.step("the session they already had is blocked on its next page load", async () => {
      await theirs.page.goto("/admin/users");
      await expect(theirs.page).toHaveURL(/\/login\?error=deactivated$/);
      // The sign-out route cleared their cookie: they stay out.
      await theirs.page.goto("/admin/users");
      await expect(theirs.page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers$/);
    });

    await test.step("they cannot sign in again", async () => {
      await expect(sessionCookies(person.email, person.password)).rejects.toThrow(/banned/i);
    });

    await test.step("reactivate them", async () => {
      const dialog = await chooseRowAction(page, row, "Reactivate");
      await expect(dialog).toContainText(`Reactivate ${person.fullName}?`);
      await shot(page, "reactivate-confirm");
      await dialog.getByRole("button", { name: "Reactivate" }).click();
      await expect(toast(page, `${person.fullName} is active and can sign in.`)).toBeVisible();
      await expect(statusOf(row)).toHaveText("Active");
      expect(await profileOf(person.id)).toMatchObject({ active: true, role: "admin" });
      expect(await isBanned(person.id)).toBe(false);
    });

    await test.step("access returns: they sign in and reach the admin page", async () => {
      const again = await browserOf(browser, baseURL!, person.email, person.password);
      try {
        const response = await again.page.goto("/admin/users");
        expect(response?.status()).toBe(200);
        await expect(again.page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
      } finally {
        await again.context.close();
      }
    });

    await test.step("make them an inspector again: the admin page is a 404 once more", async () => {
      const dialog = await chooseRowAction(page, row, "Change Role");
      // An inspector would need a lead inspector's team (e2e/org covers that); a lead inspector needs none.
      const teams = await teamsReady();
      await pickRole(dialog, teams ? "Lead Inspector" : "Inspector");
      await dialog.getByRole("button", { name: "Save Role", exact: true }).click();
      await expect(
        toast(page, teams ? `${person.fullName} is now a lead inspector.` : `${person.fullName} is now an inspector.`),
      ).toBeVisible();
      await expect(row).toContainText(teams ? "Lead Inspector" : "Inspector");

      const again = await browserOf(browser, baseURL!, person.email, person.password);
      try {
        const response = await again.page.goto("/admin/users");
        expect(response?.status()).toBe(404);
      } finally {
        await again.context.close();
      }
    });
  } finally {
    await opened?.context.close();
    await deleteAccount(person.id);
  }
});
