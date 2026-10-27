import { expect, test, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { sessionCookies, TEST_ACCOUNTS, type SessionCookie } from "../support/session";
import {
  accountExists,
  chooseRowAction,
  createThrowaway,
  deleteAccount,
  profileByEmail,
  rowFor,
  setActive,
  shot,
  statusOf,
  sweepThrowaways,
  toast,
  uidsReady,
} from "./support";

// Delete Permanently on /admin/users (Kenneth, 27 October 2026: "admin should
// be able to permanently delete deactivated users"): only a Deactivated or
// Pending Activation account offers it, never an active one or your own.
// The dialog checks first whether QC records keep the person, then asks for
// their UID (their email on a project without UIDs) before Delete
// Permanently works. Throwaway accounts with no QC records only: a record
// made here would keep its throwaway for good (the history is never
// deleted), so the refusals are covered by the unit tests in
// app/(app)/admin/users. Signs the admin in once.

let cookies: SessionCookie[];
let uids = false;

test.beforeAll(async () => {
  [uids, cookies] = await Promise.all([uidsReady(), sessionCookies(TEST_ACCOUNTS.admin)]);
});

test.afterAll(async () => {
  await sweepThrowaways();
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
});

/** A throwaway account's UID, where the project has UIDs (migration 20261008140000). */
async function uidOf(id: string): Promise<string | null> {
  if (!uids) return null;
  const { data, error } = await createTestAdminClient().from("profiles").select("uid").eq("id", id).single();
  if (error) throw new Error(`Could not read the UID of ${id}: ${error.message}`);
  return data.uid;
}

const openMenu = (page: Page, email: string) => rowFor(page, email).getByRole("button", { name: /^Actions for / }).click();

test("only a deactivated or pending account offers Delete Permanently, never an active one or your own", async ({ page }) => {
  const active = await createThrowaway("E2E Delete Active");
  // Left as the profile trigger made it: pending activation.
  const pending = await createThrowaway("E2E Delete Pending", { activate: false });
  try {
    await page.goto("/admin/users");

    await test.step("an active account offers Deactivate, not Delete Permanently", async () => {
      await openMenu(page, active.email);
      await expect(page.getByRole("menuitem", { name: "Deactivate", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Delete Permanently" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    });

    await test.step("your own account never offers it", async () => {
      await openMenu(page, TEST_ACCOUNTS.admin);
      await expect(page.getByRole("menuitem", { name: "Edit Details", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Delete Permanently" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    });

    await test.step("an account waiting for activation offers Activate, then Delete Permanently, in red", async () => {
      await expect(statusOf(rowFor(page, pending.email))).toHaveText("Pending Activation");
      await openMenu(page, pending.email);
      await expect(page.getByRole("menuitem", { name: "Activate", exact: true })).toBeVisible();
      const item = page.getByRole("menuitem", { name: "Delete Permanently", exact: true });
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute("data-variant", "destructive");
      await shot(page, "delete-pending-menu");
      await page.keyboard.press("Escape");
    });
  } finally {
    await deleteAccount(active.id);
    await deleteAccount(pending.id);
  }
});

test("Delete Permanently checks first, asks for the UID, then removes the account for good", async ({ page }) => {
  test.setTimeout(90_000);
  const person = await createThrowaway("E2E Delete Person");
  try {
    // Deactivated: inactive, and changed since sign-up.
    await setActive(person.id, false);
    const uid = await uidOf(person.id);
    // What the box asks for: their UID, or their email on a project without UIDs.
    const word = uid ?? person.email;
    await page.goto("/admin/users");
    const row = rowFor(page, person.email);
    await expect(statusOf(row)).toHaveText("Deactivated");

    const dialog = await chooseRowAction(page, row, "Delete Permanently");
    const keep = dialog.getByRole("button", { name: "Keep", exact: true });
    const box = dialog.getByRole("textbox", { name: `Type ${word} to Confirm`, exact: true });
    const remove = dialog.getByRole("button", { name: "Delete Permanently", exact: true });

    await test.step("the server's check comes first: nothing keeps them, so it says what goes", async () => {
      await expect(dialog.getByRole("heading", { name: `Delete ${person.fullName} Permanently?`, exact: true })).toBeVisible();
      // The way out has focus as the dialog opens, and keeps it when the check's answer comes.
      await expect(keep).toBeFocused();
      await expect(dialog).toContainText(`This removes ${uid ?? person.fullName} for good: their login and profile. This cannot be undone.`);
      await expect(keep).toBeFocused();
    });

    await test.step("Delete Permanently waits for their UID, typed in any case", async () => {
      await expect(remove).toBeDisabled();
      await box.fill("SC-0000");
      await expect(remove).toBeDisabled();
      await box.fill(word.toLowerCase());
      await expect(remove).toBeEnabled();
      await shot(page, "delete-confirm");
    });

    await test.step("Keep leaves the account as it is", async () => {
      await keep.click();
      await expect(dialog).toBeHidden();
      expect(await accountExists(person.id)).toBe(true);
    });

    await test.step("typed again, it goes for good: the row, the login and the profile", async () => {
      const again = await chooseRowAction(page, row, "Delete Permanently");
      const boxAgain = again.getByRole("textbox", { name: `Type ${word} to Confirm`, exact: true });
      // A new dialog starts empty: nothing typed carries over.
      await expect(boxAgain).toHaveValue("");
      await boxAgain.fill(word);
      await again.getByRole("button", { name: "Delete Permanently", exact: true }).click();
      await expect(
        toast(page, `${person.fullName}${uid ? ` (${uid})` : ""} is deleted for good: their login and profile are gone.`),
      ).toBeVisible();
      await expect(row).toHaveCount(0);
      expect(await accountExists(person.id)).toBe(false);
      expect(await profileByEmail(person.email)).toBeNull();
      await shot(page, "delete-done");
    });
  } finally {
    await deleteAccount(person.id);
  }
});
