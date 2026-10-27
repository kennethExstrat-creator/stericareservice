import { expect, test, type Locator } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  authMetadataOf,
  chooseRowAction,
  createThrowaway,
  deleteAccount,
  detailsOf,
  profileOf,
  rowFor,
  setActive,
  shot,
  statusOf,
  sweepThrowaways,
  toast,
} from "./support";

// Edit Details on /admin/users (Kenneth, 8 October 2026: "admin should have the
// permission to change the name of user"; 27 October 2026: "User info should
// be name, phone, email, role, UID"), on one throwaway account only: never
// inspector@test.local, admin@test.local or lead@test.local. Waiting for
// activation it offers no new details; active or deactivated, it takes a name
// and a phone number, which the profile gets, and the name Supabase Auth's
// copy too.

test.afterAll(async () => {
  await sweepThrowaways();
});

const nameField = (dialog: Locator) => dialog.getByRole("textbox", { name: "Name", exact: true });
const phoneField = (dialog: Locator) => dialog.getByRole("textbox", { name: "Phone (Optional)", exact: true });
const save = (dialog: Locator) => dialog.getByRole("button", { name: "Save", exact: true });

const PHONE = "+60 12-345 6789";
const PHONE_HINT = "With the country code if it is outside Malaysia, e.g. +60 12-345 6789.";

test("an admin edits someone's name and phone, active or deactivated, and they show at once", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  // Left as the profile trigger made it: pending activation.
  const person = await createThrowaway("E2E Details Person", { activate: false });
  const suffix = person.email.replace(/^e2e-users-|@test\.local$/g, "");
  const renamed = `E2E Renamed ${suffix}`;
  const again = `E2E Renamed Again ${suffix}`;

  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin/users");
    const row = rowFor(page, person.email);

    await test.step("an account waiting for activation is activated first: no new details yet", async () => {
      await expect(statusOf(row)).toHaveText("Pending Activation");
      await row.getByRole("button", { name: /^Actions for / }).click();
      await expect(page.getByRole("menuitem", { name: "Activate", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Edit Details" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await setActive(person.id, true);
      await page.reload();
      await expect(statusOf(row)).toHaveText("Active");
    });

    const dialog = await chooseRowAction(page, row, "Edit Details");
    const name = nameField(dialog);
    const phone = phoneField(dialog);

    await test.step("the dialog holds Name, as saved and all of it selected, and Phone (Optional), empty", async () => {
      await expect(dialog.getByRole("heading", { name: `Edit ${person.fullName}'s Details`, exact: true })).toBeVisible();
      await expect(name).toHaveValue(person.fullName);
      await expect(name).toBeFocused();
      // Typing replaces it; an arrow key keeps it to edit.
      await expect
        .poll(() => name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
        .toEqual([0, person.fullName.length]);
      await expect(phone).toHaveValue("");
      await expect(phone).toHaveAttribute("type", "tel");
      await expect(phone).toHaveAccessibleDescription(PHONE_HINT);
      await expect(dialog.getByRole("textbox")).toHaveCount(2);
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      if (test.info().project.name !== "desktop") {
        // 44 px on touch (docs/DESIGN.md, Density).
        for (const field of [name, phone]) expect((await field.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await shot(page, "details-dialog");
    });

    await test.step("an empty name, one over 100 characters, or a phone number that is not one is refused at its field", async () => {
      await name.fill("   ");
      await save(dialog).click();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toHaveAccessibleDescription("Enter their name.");
      await expect(name).toBeFocused();
      await shot(page, "details-empty-name");

      await name.fill("x".repeat(101));
      await expect(name).not.toHaveAttribute("aria-invalid", "true");
      await save(dialog).click();
      await expect(name).toHaveAccessibleDescription("Keep the name to 100 characters or fewer.");
      // What the admin typed stays, to shorten.
      await expect(name).toHaveValue("x".repeat(101));

      await name.fill(person.fullName);
      await phone.fill("call me");
      await save(dialog).click();
      await expect(phone).toHaveAttribute("aria-invalid", "true");
      await expect(phone).toHaveAccessibleDescription("Enter a phone number, like +60 12-345 6789 or 012-345 6789.");
      await expect(phone).toBeFocused();
      await expect(phone).toHaveValue("call me");
      await shot(page, "details-bad-phone");
      expect(await detailsOf(person.id)).toMatchObject({ full_name: person.fullName, phone: null });
    });

    await test.step("Save keeps both: the list, the menu, the profile and Supabase Auth's copy of the name", async () => {
      const metadata = await authMetadataOf(person.id);
      await name.fill(`  ${renamed} `);
      await phone.fill(` ${PHONE} `);
      await save(dialog).click();
      await expect(toast(page, `${person.fullName} is now ${renamed}. Their phone number is now ${PHONE}.`)).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText(renamed);
      await expect(row).not.toContainText(person.fullName);
      // Its own column on desktop, under the name on iPad.
      await expect(row).toContainText(PHONE);
      // Back on the row's menu button, which now names them anew.
      await expect(row.getByRole("button", { name: `Actions for ${renamed}`, exact: true })).toBeFocused();
      expect(await detailsOf(person.id)).toMatchObject({ full_name: renamed, phone: PHONE });
      // Only full_name changed in the metadata Auth keeps.
      expect(await authMetadataOf(person.id)).toEqual({ ...metadata, full_name: renamed });
      await shot(page, "details-saved");
    });

    await test.step("the search finds them by their phone number, however it is spaced", async () => {
      const search = page.getByRole("searchbox", { name: "Search", exact: true });
      for (const typed of ["012-345 6789", "60123456789"]) {
        await search.fill(typed);
        await expect(row).toBeVisible();
      }
      await search.fill("");
    });

    await test.step("Cancel keeps the details as they are", async () => {
      const cancelled = await chooseRowAction(page, row, "Edit Details");
      await expect(nameField(cancelled)).toHaveValue(renamed);
      await expect(phoneField(cancelled)).toHaveValue(PHONE);
      await nameField(cancelled).fill("Not This Name");
      await cancelled.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(cancelled).toBeHidden();
      await expect(row).toContainText(renamed);
      expect((await profileOf(person.id)).full_name).toBe(renamed);
    });

    await test.step("a deactivated account takes new details too, the phone left blank to remove it", async () => {
      await setActive(person.id, false);
      await page.reload();
      await expect(statusOf(row)).toHaveText("Deactivated");
      const deactivated = await chooseRowAction(page, row, "Edit Details");
      await nameField(deactivated).fill(again);
      await phoneField(deactivated).fill("");
      await save(deactivated).click();
      await expect(toast(page, `${renamed} is now ${again}. Their phone number is removed.`)).toBeVisible();
      await expect(row).toContainText(again);
      await expect(row).not.toContainText(PHONE);
      expect(await detailsOf(person.id)).toMatchObject({ full_name: again, phone: null });
      expect(await profileOf(person.id)).toMatchObject({ active: false });
    });
  } finally {
    await deleteAccount(person.id);
  }
});
