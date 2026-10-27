import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { expectNoPageScroll } from "../support/layout";
import { sessionCookies, TEST_ACCOUNTS, type SessionCookie } from "../support/session";
import { createThrowaway, deleteAccount, rowFor, shot, statusOf, sweepThrowaways, teamsReady, uidsReady } from "./support";

/**
 * UIDs on /admin/users (Kenneth, 8 October 2026; migration 20261008140000):
 * the UID column and the dialogs, the search by UID, name and email, on its
 * own and inside a lead's team, and rows that stay compact beside the UID
 * column. It types, follows links, opens a dialog and cancels, and changes
 * no account; the desktop row check adds one throwaway account, waiting for
 * activation, and deletes it. Signs the admin in once.
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

test.afterAll(async () => {
  await sweepThrowaways();
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
});

/**
 * A test account as the database holds it (read with the secret key, never
 * to assert what a user sees). Its lead and UID only where the project has
 * those columns (migrations 20261007170000 and 20261008140000).
 */
async function account(email: string): Promise<Account> {
  const admin = createTestAdminClient();
  const { data, error } = await admin.from("profiles").select("id, email, full_name").eq("email", email).single();
  if (error) throw new Error(`Could not read ${email}: ${error.message}`);
  let leadId: string | null = null;
  if (teams) {
    const found = await admin.from("profiles").select("lead_id").eq("id", data.id).single();
    if (found.error) throw new Error(`Could not read the lead inspector of ${email}: ${found.error.message}`);
    leadId = found.data.lead_id;
  }
  let uid: string | null = null;
  if (uids) {
    const found = await admin.from("profiles").select("uid").eq("id", data.id).single();
    if (found.error) throw new Error(`Could not read the UID of ${email}: ${found.error.message}`);
    uid = found.data.uid;
  }
  return { id: data.id, email, name: data.full_name?.trim() || email, uid, leadId };
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

/**
 * Where the row's text wraps inside a word, as "Subramania|m": any line
 * break that is not at a space or after an @, a hyphen or a slash. An
 * address's two halves around its <wbr> are text apart, free to wrap
 * between them. Read from where each character lands on the screen.
 */
async function wordsBrokenIn(row: Locator): Promise<string[]> {
  return row.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      let lineTop: number | null = null;
      for (let i = 0; i < node.data.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getClientRects()[0];
        // Hidden at this size, or a space at the end of a line.
        if (!box || box.width === 0) continue;
        const top = Math.round(box.top);
        if (lineTop !== null && top > lineTop + 1 && !/[\s@/-]/.test(node.data[i - 1]) && !/\s/.test(node.data[i])) {
          broken.push(`${node.data.slice(0, i)}|${node.data.slice(i)}`);
        }
        lineTop = top;
      }
    }
    return broken;
  });
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
      await expect(searchBox(page)).toHaveAttribute("placeholder", "Name, email or phone");
      noUids("The UID column");
      return;
    }
    await expect(page.getByRole("columnheader").first()).toHaveText("UID");
    await expect(searchBox(page)).toHaveAttribute("placeholder", "Name, email, phone or UID");
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

  await test.step("a link to a team shows it whole: the search leaves the box and the address", async () => {
    if (!teams) return;
    await page.goto("/admin/users");
    // The inspector's row links to their lead's team, the lead's row to the team they lead.
    const fromInspector = inspector.leadId === lead.id;
    const from = fromInspector ? inspector : lead;
    await searchBox(page).fill(from.email);
    await expect(rowFor(page, from.email)).toBeVisible();
    await expect(page).toHaveURL(/[?&]q=/);
    const link = rowFor(page, from.email).getByRole("link", {
      name: fromInspector ? new RegExp(`^${escape(lead.name)}: show their team$`) : /^Leads \d+ inspectors?: show the team$/,
    });
    if ((await link.count()) === 0) {
      test.info().annotations.push({ type: "skipped", description: `A link to a team: ${LEAD} leads nobody` });
      return;
    }
    await link.click();
    await expect(page).toHaveURL(new RegExp(`[?&]team=${lead.id}(&|$)`));
    await expect(searchBox(page)).toHaveValue("");
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(summary(page)).toHaveText(new RegExp(`^${escape(lead.name)}'s team: \\d+ inspectors?\\.$`));
    await expect(bodyRows(page).first()).toContainText(lead.email);
  });

  await test.step("the dialogs show the UID beside the name and keep their names", async () => {
    await page.goto("/admin/users");
    await rowFor(page, admin.email).getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Edit Details", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Edit ${admin.name}'s Details`, exact: true })).toBeVisible();
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

test("names and addresses wrap between words at every size, never inside one", async ({ page }) => {
  // Beside the UID column at 820 px an address broke as "inspector@test.lo|cal" before it wrapped after its @.
  await page.goto("/admin/users");
  for (const email of [TEST_ACCOUNTS.admin, TEST_ACCOUNTS.inspector, LEAD]) {
    await expect(rowFor(page, email)).toBeVisible();
    expect(await wordsBrokenIn(rowFor(page, email)), email).toEqual([]);
  }
});

test("rows stay compact on desktop beside the UID column, a long name waiting for activation included", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "Desktop rows: compact, two lines at most (docs/DESIGN.md, Density)");
  // Pending Activation widens the Status column, and the long name needs room beside the UID column.
  const pending = await createThrowaway("Muhammad Hafiz bin Abdul Rahman", { activate: false });
  try {
    await page.goto("/admin/users");
    await expect(statusOf(rowFor(page, pending.email))).toContainText("Pending Activation");
    if (!uids) noUids("The rows beside the UID column (checked without it)");
    for (const email of [TEST_ACCOUNTS.admin, TEST_ACCOUNTS.inspector, LEAD, pending.email]) {
      const row = rowFor(page, email);
      // One line is 35 px around the menu button; two lines of a name, 47 px.
      expect((await row.boundingBox())?.height ?? Infinity, `${email}: two lines at most`).toBeLessThanOrEqual(48);
      expect(await wordsBrokenIn(row), email).toEqual([]);
    }
    await shot(page, "uid-rows");
  } finally {
    await deleteAccount(pending.id);
  }
});
