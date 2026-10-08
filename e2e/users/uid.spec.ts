import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { expectNoPageScroll } from "../support/layout";
import { sessionCookies, TEST_ACCOUNTS, type SessionCookie } from "../support/session";
import { rowFor, shot, teamsReady, uidsReady } from "./support";

/**
 * UIDs on /admin/users (Kenneth, 8 October 2026; migration 20261008140000):
 * the UID column and the dialogs, and the search by UID, name and email, on
 * its own and inside a lead's team. Read-only: it types, opens a dialog and
 * cancels, and changes no account. Signs the admin in once.
 *
 * Until the project in .env.local has run the migration, the screen has no
 * UID column and searches names and emails only: the UID checks are then
 * skipped (each says so in the report), and the unit tests in
 * app/(app)/admin/users and tests/db/profile-uid.test.ts cover them.
 */

const UID_PROJECTS = ["desktop", "ipad-pro-landscape"];
const LEAD = "lead@test.local";

test.describe.configure({ mode: "serial" });

type Account = { id: string; email: string; name: string; uid: string | null; leadId: string | null };

let cookies: SessionCookie[];
let uids = false;
let teams = false;

test.beforeAll(async () => {
  [uids, teams] = await Promise.all([uidsReady(), teamsReady()]);
  cookies = await sessionCookies(TEST_ACCOUNTS.admin);
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
});

/** A test account as the database holds it (read with the secret key, never to assert what a user sees). */
async function account(email: string): Promise<Account> {
  const admin = createTestAdminClient();
  const { data, error } = await admin.from("profiles").select("id, email, full_name, lead_id").eq("email", email).single();
  if (error) throw new Error(`Could not read ${email}: ${error.message}`);
  let uid: string | null = null;
  if (uids) {
    const found = await admin.from("profiles").select("uid").eq("id", data.id).single();
    if (found.error) throw new Error(`Could not read the UID of ${email}: ${found.error.message}`);
    uid = found.data.uid;
  }
  return { id: data.id, email, name: data.full_name?.trim() || email, uid, leadId: data.lead_id };
}

function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/** Records why a UID check did not run, in the report. */
function noUids(what: string): void {
  test.info().annotations.push({ type: "skipped", description: `${what}: the project has not run migration 20261008140000` });
}

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search", exact: true });
const bodyRows = (page: Page) => page.locator("tbody tr");
const uidCell = (row: Locator) => row.locator('td[data-slot="uid"]');
const summary = (page: Page) => page.locator('p[role="status"]');
/** Clear Search in the list (the one in the box is its icon button). */
const clearInList = (page: Page) => page.locator("tbody").getByRole("button", { name: "Clear Search", exact: true });

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Collects hydration errors: the rows are drawn on the server and chosen in the browser. */
function watchHydration(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => errors.filter((text) => /hydrat|did not match|server rendered/i.test(text));
}

test("the UID column, and the search by UID, name and email", async ({ page }) => {
  test.skip(!UID_PROJECTS.includes(test.info().project.name), "UIDs and the search: desktop and ipad-pro-landscape");
  const [admin, inspector, lead] = await Promise.all([
    account(TEST_ACCOUNTS.admin),
    account(TEST_ACCOUNTS.inspector),
    account(LEAD),
  ]);
  const hydration = watchHydration(page);

  await page.goto("/admin/users");
  await expect(rowFor(page, admin.email)).toBeVisible();
  const everyone = await bodyRows(page).count();

  await test.step("the UID column comes first, one SC- number per person, on one line in tabular figures", async () => {
    if (!uids) {
      await expect(page.getByRole("columnheader", { name: "UID", exact: true })).toHaveCount(0);
      await expect(searchBox(page)).toHaveAttribute("placeholder", "Name or email");
      noUids("The UID column");
      return;
    }
    await expect(page.getByRole("columnheader").first()).toHaveText("UID");
    await expect(searchBox(page)).toHaveAttribute("placeholder", "Name, email or UID");
    for (const person of [admin, inspector, lead]) {
      await expect(uidCell(rowFor(page, person.email))).toHaveText(person.uid!);
    }
    const all = await page.locator('tbody td[data-slot="uid"]').allTextContents();
    expect(all.length).toBe(everyone);
    for (const uid of all) expect(uid).toMatch(/^SC-(\d{4}|[1-9]\d{4,})$/);
    expect(new Set(all).size, "every UID once").toBe(all.length);
    const style = await uidCell(rowFor(page, admin.email)).evaluate((cell) => {
      const computed = getComputedStyle(cell);
      return { whiteSpace: computed.whiteSpace, numeric: computed.fontVariantNumeric };
    });
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.numeric).toContain("tabular-nums");
    await shot(page, "uid-column");
  });

  await test.step("the search finds someone by name, as it is typed", async () => {
    await searchBox(page).fill(lead.name);
    await expect(rowFor(page, lead.email)).toBeVisible();
    await expect(rowFor(page, admin.email)).toHaveCount(0);
    await expect(rowFor(page, inspector.email)).toHaveCount(0);
    for (const row of await bodyRows(page).all()) await expect(row).toContainText(new RegExp(escape(lead.name), "i"));
    await expect(summary(page)).toHaveText(new RegExp(`^\\d+ of ${everyone} people\\.$`));
    await shot(page, "uid-search-name");
  });

  await test.step("by email", async () => {
    await searchBox(page).fill(inspector.email);
    await expect(rowFor(page, inspector.email)).toBeVisible();
    await expect(rowFor(page, admin.email)).toHaveCount(0);
    await expect(rowFor(page, lead.email)).toHaveCount(0);
    for (const row of await bodyRows(page).all()) await expect(row).toContainText(inspector.email);
  });

  await test.step("by UID, as shown or in small letters", async () => {
    if (!uids) {
      noUids("The search by UID");
      return;
    }
    for (const typed of [inspector.uid!, inspector.uid!.toLowerCase()]) {
      await searchBox(page).fill(typed);
      await expect(bodyRows(page)).toHaveCount(1);
      await expect(rowFor(page, inspector.email)).toBeVisible();
      await expect(summary(page)).toHaveText(`1 of ${everyone} people.`);
    }
    await shot(page, "uid-search-uid");
  });

  await test.step("says when nobody matches; Clear Search there brings everyone back and the keyboard to the box", async () => {
    await searchBox(page).fill("zz-nobody-zz");
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText("Nobody matches “zz-nobody-zz”.");
    await expect(summary(page)).toHaveText(`0 of ${everyone} people.`);
    if (isTouch()) expect((await clearInList(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await shot(page, "uid-search-nobody");
    await clearInList(page).click();
    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
    await expect(bodyRows(page)).toHaveCount(everyone);
    await expect(summary(page)).toHaveText(`${everyone} people.`);
  });

  await test.step("Escape and the box's own Clear Search empty it", async () => {
    await searchBox(page).fill("lead");
    await searchBox(page).press("Escape");
    await expect(searchBox(page)).toHaveValue("");
    await searchBox(page).fill("lead");
    const clear = page.getByRole("button", { name: "Clear Search", exact: true }).first();
    await clear.click();
    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
    if (isTouch()) {
      // 44 px on touch (docs/DESIGN.md, Density): the field, and the button's hit area inside it.
      const field = page.locator('[data-slot="input-group"]').filter({ has: searchBox(page) });
      expect((await field.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  await test.step("the address keeps the search, so a reload does too", async () => {
    await searchBox(page).fill(inspector.email);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${escape(encodeURIComponent(inspector.email))}(&|$)`));
    await page.reload();
    await expect(searchBox(page)).toHaveValue(inspector.email);
    await expect(rowFor(page, inspector.email)).toBeVisible();
    await expect(rowFor(page, admin.email)).toHaveCount(0);
  });

  await test.step("the search works inside the team the Team picker shows", async () => {
    if (!teams) return;
    await page.getByRole("combobox", { name: "Team", exact: true }).click();
    await page.getByRole("option", { name: new RegExp(`^${escape(lead.name)}'s Team \\(\\d+\\)$`) }).click();
    await expect(page).toHaveURL(new RegExp(`team=${lead.id}`));
    await expect(page).toHaveURL(new RegExp(`[?&]q=${escape(encodeURIComponent(inspector.email))}(&|$)`));
    await expect(searchBox(page)).toHaveValue(inspector.email);
    if (inspector.leadId === lead.id) {
      await expect(rowFor(page, inspector.email)).toBeVisible();
      await expect(summary(page)).toHaveText(new RegExp(`^${escape(lead.name)}'s team: 1 of \\d+ (people|person)\\.$`));
    }
    await searchBox(page).fill(admin.email);
    await expect(bodyRows(page).first()).toContainText(`Nobody in ${lead.name}'s team matches “${admin.email}”.`);
    await shot(page, "uid-search-team");
    await clearInList(page).click();
    await expect(bodyRows(page).first()).toContainText(lead.email);
    await expect(summary(page)).toHaveText(new RegExp(`^${escape(lead.name)}'s team: \\d+ inspectors?\\.$`));
  });

  await test.step("the dialogs show the UID beside the name and keep their names", async () => {
    await page.goto("/admin/users");
    await rowFor(page, admin.email).getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Change Name", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Change ${admin.name}'s Name`, exact: true })).toBeVisible();
    if (uids) {
      await expect(dialog.locator('[data-slot="uid"]')).toHaveText(`UID ${admin.uid}`);
      await shot(page, "uid-dialog");
    } else {
      await expect(dialog.locator('[data-slot="uid"]')).toHaveCount(0);
      noUids("The UID in the dialogs");
    }
    // Read-only: nothing is saved.
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  expect(hydration()).toEqual([]);
});

test("the search and the Team picker fit every size, at a finger's reach", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(rowFor(page, TEST_ACCOUNTS.admin)).toBeVisible();
  await expectNoPageScroll(page);

  const search = page.locator('[data-slot="input-group"]').filter({ has: searchBox(page) });
  const searchBoxSize = (await search.boundingBox())!;
  expect(searchBoxSize.width).toBeGreaterThan(200);
  if (isTouch()) expect(searchBoxSize.height).toBeGreaterThanOrEqual(44);

  if (teams) {
    const picker = (await page.getByRole("combobox", { name: "Team", exact: true }).boundingBox())!;
    if (isTouch()) expect(picker.height).toBeGreaterThanOrEqual(44);
    // Side by side from 768 px.
    if (page.viewportSize()!.width >= 768) expect(Math.abs(picker.y - searchBoxSize.y)).toBeLessThan(4);
  }

  // A search leaves the page as wide as the window.
  await searchBox(page).fill(TEST_ACCOUNTS.inspector);
  await expect(rowFor(page, TEST_ACCOUNTS.inspector)).toBeVisible();
  await expectNoPageScroll(page);
  await shot(page, "uid-toolbar");
});
