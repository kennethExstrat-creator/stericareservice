import { expect, test, type Locator } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  authMetadataOf,
  chooseRowAction,
  createThrowaway,
  deleteAccount,
  profileOf,
  rowFor,
  setActive,
  shot,
  statusOf,
  sweepThrowaways,
  toast,
} from "./support";

// Change Name on /admin/users (Kenneth, 8 October 2026: "admin should have the
// permission to change the name of user"), on one throwaway account only:
// never inspector@test.local, admin@test.local or lead@test.local. Waiting for
// activation it offers no new name; active or deactivated, it takes one, which
// the profile and Supabase Auth's copy both get.

test.afterAll(async () => {
  await sweepThrowaways();
});

/** The dialog's one field. */
const nameField = (dialog: Locator) => dialog.getByRole("textbox", { name: "Name", exact: true });
const save = (dialog: Locator) => dialog.getByRole("button", { name: "Save", exact: true });

test("an admin changes someone's name, active or deactivated, and it shows at once", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  // Left as the profile trigger made it: pending activation.
  const person = await createThrowaway("E2E Rename Person", { activate: false });
  const suffix = person.email.replace(/^e2e-users-|@test\.local$/g, "");
  const renamed = `E2E Renamed ${suffix}`;
  const again = `E2E Renamed Again ${suffix}`;

  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const row = rowFor(page, person.email);

    await test.step("an account waiting for activation is activated first: no new name yet", async () => {
      await expect(statusOf(row)).toHaveText("Pending Activation");
      await row.getByRole("button", { name: /^Actions for / }).click();
      await expect(page.getByRole("menuitem", { name: "Activate", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Change Name" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await setActive(person.id, true);
      await page.reload();
      await expect(statusOf(row)).toHaveText("Active");
    });

    const dialog = await chooseRowAction(page, row, "Change Name");
    const field = nameField(dialog);

    await test.step("the dialog holds one field, Name, with the name as saved, all of it selected", async () => {
      await expect(dialog.getByRole("heading", { name: `Change ${person.fullName}'s Name`, exact: true })).toBeVisible();
      await expect(field).toHaveValue(person.fullName);
      await expect(field).toBeFocused();
      // Typing replaces it; an arrow key keeps it to edit.
      await expect
        .poll(() => field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
        .toEqual([0, person.fullName.length]);
      await expect(dialog.getByRole("textbox")).toHaveCount(1);
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      await shot(page, "rename-dialog");
    });

    await test.step("an empty name, or one over 100 characters, is refused at the field and saves nothing", async () => {
      await field.fill("   ");
      await save(dialog).click();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription("Enter their name.");
      await expect(field).toBeFocused();
      await shot(page, "rename-empty");

      await field.fill("x".repeat(101));
      await expect(field).not.toHaveAttribute("aria-invalid", "true");
      await save(dialog).click();
      await expect(field).toHaveAccessibleDescription("Keep the name to 100 characters or fewer.");
      // What the admin typed stays, to shorten.
      await expect(field).toHaveValue("x".repeat(101));
      expect((await profileOf(person.id)).full_name).toBe(person.fullName);
    });

    await test.step("Save renames them: the list, the menu, the profile and Supabase Auth's copy", async () => {
      const metadata = await authMetadataOf(person.id);
      await field.fill(`  ${renamed} `);
      await save(dialog).click();
      await expect(toast(page, `${person.fullName} is now ${renamed}.`)).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText(renamed);
      await expect(row).not.toContainText(person.fullName);
      // Back on the row's menu button, which now names them anew.
      await expect(row.getByRole("button", { name: `Actions for ${renamed}`, exact: true })).toBeFocused();
      expect(await profileOf(person.id)).toMatchObject({ full_name: renamed, active: true });
      // Only full_name changed in the metadata Auth keeps.
      expect(await authMetadataOf(person.id)).toEqual({ ...metadata, full_name: renamed });
      await shot(page, "renamed");
    });

    await test.step("Cancel keeps the name as it is", async () => {
      const cancelled = await chooseRowAction(page, row, "Change Name");
      await expect(nameField(cancelled)).toHaveValue(renamed);
      await nameField(cancelled).fill("Not This Name");
      await cancelled.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(cancelled).toBeHidden();
      await expect(row).toContainText(renamed);
      expect((await profileOf(person.id)).full_name).toBe(renamed);
    });

    await test.step("a deactivated account takes a new name too", async () => {
      await setActive(person.id, false);
      await page.reload();
      await expect(statusOf(row)).toHaveText("Deactivated");
      const deactivated = await chooseRowAction(page, row, "Change Name");
      await nameField(deactivated).fill(again);
      await save(deactivated).click();
      await expect(toast(page, `${renamed} is now ${again}.`)).toBeVisible();
      await expect(row).toContainText(again);
      expect(await profileOf(person.id)).toMatchObject({ full_name: again, active: false });
    });
  } finally {
    await deleteAccount(person.id);
  }
});
