import { devices, expect, test, webkit, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { drawImage } from "../photos/support";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";
import { createFinalFixture, NOTES_SECTION, type FinalFixture } from "./final-fixtures";

/**
 * The capture fixes of the final audit, on the live project (final-fixtures.ts):
 *
 * - A refused reading ("2 42") stays on screen, red with its link, through a
 *   size switch, a section switch and a reload, and the Pending panel names it
 *   (SAFEDON-1). iPad portrait and desktop.
 * - Offline, a section not opened before still shows its form, and one whose
 *   form could not download says so calmly and opens once the connection is
 *   back, by itself or with Try Again (ACC-SGF-1). 12.9 inch iPad.
 * - In WebKit, the iPad's engine, a tap on + tags the next photo with its
 *   size and defect (F1). Both iPads.
 * - The submit confirmation names the result as every pill does, and says
 *   nothing twice for a clean pass (STDEG-6, ACC-SGF-8).
 * - Read-only screens have no Pending list, and a lead is told whose
 *   submitted inspection it is (UX-05, UX-06). 12.9 inch iPad and desktop.
 * - The desktop sidebar shows long section titles on two lines (UX-11).
 *
 * One sign-in per account and project (the sign-in limit, e2e/README.md).
 * Screenshots go to screenshots/capture/final-*.
 */

// The Mac running these is shared with other builds: generous waits, never sleeps.
test.describe.configure({ mode: "serial", timeout: 180_000 });

let fixture: FinalFixture;

test.beforeAll(async () => {
  fixture = await createFinalFixture();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

const INSPECTOR = { email: TEST_ACCOUNTS.inspector };
const ADMIN = { email: TEST_ACCOUNTS.admin };

function project(): string {
  return test.info().project.name;
}

function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/** The iPad layout: section tabs, not the sidebar (every touch screen, and below 1280 px). */
function hasTabs(): boolean {
  return project() !== "desktop";
}

/** A tap on the iPads, a click on the desktop. */
async function press(locator: Locator) {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

const sessions = new Map<string, { name: string; value: string }[]>();

/** Signs in once per account and project; later tests reuse the session's cookies. */
async function signInAs(context: BrowserContext, baseURL: string, account: { email: string; password?: string }) {
  await context.clearCookies();
  let cookies = sessions.get(account.email);
  if (!cookies) {
    cookies = await sessionCookies(account.email, account.password);
    sessions.set(account.email, cookies);
  }
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `screenshots/capture/final-${project()}-${name}.png`,
    animations: "disabled",
    caret: "initial",
  });
}

function savePill(page: Page) {
  return page.locator('[data-slot="save-status"]:visible');
}

/** The open section's frame once its form has loaded and saving has started. */
async function formReady(page: Page) {
  const frame = page.locator('[data-slot="section-frame"]');
  await expect(frame.getByText("Loading the form…")).toHaveCount(0, { timeout: 60_000 });
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
  return frame;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Opens a section from the tab bar (iPad) or the sidebar (desktop), inside the page. */
async function openSection(page: Page, section: { key: string; title: string }) {
  const target = hasTabs()
    ? page.locator(`[role="tab"][data-section="${section.key}"]`)
    : page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${escapeRegExp(section.title)}\\s*,`) });
  await press(target);
  await expect(page.getByRole("heading", { level: 2, name: section.title, exact: true })).toBeVisible();
}

const DIMENSION = { key: "dimensions", title: "Dimension" };
const VISUAL = { key: "visual", title: "Visual Inspection" };

function sizeTab(page: Page, size: string) {
  return page.getByRole("tab", { name: new RegExp(`^Size ${size}\\b`) });
}

/** The reading saved for a glove and measure of a size, as the server has it. */
async function savedReading(size: string, glove: number, measure: string) {
  const { modules } = await fixture.savedData();
  const dimensions = modules.dimensions as { sizes?: Record<string, { gloves?: Record<string, unknown>[] }> } | undefined;
  return dimensions?.sizes?.[size]?.gloves?.[glove]?.[measure] ?? null;
}

/** The refused-entry records this device keeps (lib/offline/refused.ts). */
function refusedRecords(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("stericare-offline");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const values: unknown[] = [];
          const cursor = db.transaction("drafts").objectStore("drafts").openCursor();
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at) {
              db.close();
              resolve(values);
              return;
            }
            if (String(at.key).startsWith("refused:")) values.push(at.value);
            at.continue();
          };
          cursor.onerror = () => reject(cursor.error);
        };
      }),
  );
}

/* ------------------------------------------------------------------ *
 * SAFEDON-1: refused entries outlive their field
 * ------------------------------------------------------------------ */

test("a refused reading stays red with its link through a size switch, a section switch and a reload, and Pending names it", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!["ipad-portrait", "desktop"].includes(project()), "iPad portrait (the finding) and desktop.");
  await signInAs(context, baseURL!, INSPECTOR);
  await page.goto(`/inspections/${fixture.inspectionId}?module=dimensions`);
  await formReady(page);

  await press(sizeTab(page, "S"));
  const cell = page.getByRole("textbox", { name: "Length, No. 3" });
  const problem = page.getByRole("button", { name: /^No\. 3, Length: “2 42” is not stored\./ });
  const refused = async () => {
    await expect(cell).toHaveValue("2 42");
    await expect(cell).toHaveAttribute("aria-invalid", "true");
    await expect(problem).toBeVisible();
  };

  // A stored reading, then text in its place: the text is refused and the reading cleared.
  await cell.fill("242");
  await cell.press("Enter");
  await expect.poll(() => savedReading("S", 2, "length"), { timeout: 15_000 }).toBe(242);
  await cell.fill("2 42");
  await cell.press("Enter");
  await refused();
  await expect.poll(() => savedReading("S", 2, "length"), { timeout: 15_000 }).toBeNull();
  await shot(page, "refused");

  // Another size and back.
  await press(sizeTab(page, "M"));
  await expect(page.getByRole("textbox", { name: "Length, No. 3" })).toHaveValue("");
  await expect(problem).toHaveCount(0);
  await press(sizeTab(page, "S"));
  await refused();

  // Another section and back.
  await openSection(page, VISUAL);
  await openSection(page, DIMENSION);
  await press(sizeTab(page, "S"));
  await refused();

  // A reload: the device kept it.
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
  await page.reload();
  await formReady(page);
  await press(sizeTab(page, "S"));
  await refused();
  await shot(page, "refused-after-reload");

  // Pending names the cell, first in its section's row, and goes there.
  await press(page.getByRole("button", { name: /^Pending/ }));
  const sheet = page.getByRole("dialog", { name: "Pending" });
  const row = sheet.locator(`[data-task="${DIMENSION.key}"]`);
  await expect(row.locator('[data-slot="task-status"]')).toContainText("Length, No. 3: “2 42” to retype");
  await expect(row.locator('[data-slot="task-sizes"]')).toHaveText("S");
  await shot(page, "refused-pending");
  await press(row);
  await expect(sheet).toBeHidden();
  await expect(cell).toBeFocused();

  // A number lets it go, for good.
  await cell.fill("241");
  await cell.press("Enter");
  await expect(cell).not.toHaveAttribute("aria-invalid", "true");
  await expect(problem).toHaveCount(0);
  await expect.poll(() => savedReading("S", 2, "length"), { timeout: 15_000 }).toBe(241);
  await expect.poll(() => refusedRecords(page)).toEqual([]);
  await page.reload();
  await formReady(page);
  await press(sizeTab(page, "S"));
  await expect(cell).toHaveValue("241");
  await expect(cell).not.toHaveAttribute("aria-invalid", "true");
});

test("a refused value in a custom section's number field comes back after a reload, with its reason", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(project() !== "desktop", "One size is enough: the field is the same everywhere.");
  await signInAs(context, baseURL!, INSPECTOR);
  await page.goto(`/inspections/${fixture.inspectionId}?module=${NOTES_SECTION.key}`);
  await formReady(page);
  const field = page.getByRole("textbox", { name: /^Box weight/ });
  await field.fill("3,2,1");
  await field.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  // Under the field (the live region says it once too).
  const reason = page.locator("p", { hasText: /^“3,2,1” is not stored\./ });
  await expect(reason).toBeVisible();

  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
  await page.reload();
  await formReady(page);
  await expect(field).toHaveValue("3,2,1");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toBeVisible();

  await field.fill("3.2");
  await field.press("Enter");
  await expect(reason).toHaveCount(0);
  await expect.poll(async () => (await fixture.savedData()).custom[NOTES_SECTION.key]).toMatchObject({ boxWeight: 3.2 });
});

/* ------------------------------------------------------------------ *
 * ACC-SGF-1: sections opened offline
 * ------------------------------------------------------------------ */

const OFFLINE_SECTIONS = [
  { key: "order_lots", title: "Order" },
  DIMENSION,
  VISUAL,
  { key: "watertight", title: "Freedom From Holes by Watertight Test" },
  { key: "dispensing_safedon", title: "Glove Dispensing Inspection" },
  NOTES_SECTION,
  { key: "conclusion", title: "Conclusion" },
];

test("offline, every section not opened yet still shows its form", async ({ page, context, baseURL }) => {
  test.skip(project() !== "ipad-pro-landscape", "The 12.9 inch iPad of the finding.");
  await signInAs(context, baseURL!, INSPECTOR);
  await page.goto(`/inspections/${fixture.inspectionId}?module=header`);
  await formReady(page);
  // The forms come down while the connection is there.
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  try {
    for (const section of OFFLINE_SECTIONS) {
      await openSection(page, section);
      const frame = page.locator('[data-slot="section-frame"]');
      await expect(frame.getByText("Loading the form…")).toHaveCount(0, { timeout: 5_000 });
      await expect(frame.locator('[data-slot="section-not-loaded"], [data-slot="section-crashed"]')).toHaveCount(0);
    }
    await shot(page, "offline-sections");
  } finally {
    await context.setOffline(false);
  }
});

test("a form that could not download says so calmly, and opens once the connection is back, by itself or with Try Again", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(project() !== "ipad-pro-landscape", "The 12.9 inch iPad of the finding.");
  await signInAs(context, baseURL!, INSPECTOR);
  // The watertight and Safedon forms' code cannot be fetched: each download fails like a dropped signal.
  const watertightCode = formCode("watertight");
  const safedonCode = formCode("dispensing_safedon");
  await page.route(watertightCode, (route) => route.abort("internetdisconnected"));
  await page.route(safedonCode, (route) => route.abort("internetdisconnected"));
  // The dev server downloads each form's code when its section opens (the case on :3000). A production
  // build sends every form's code with the page, so there is no later download to fail.
  let perModuleCode = false;
  page.on("request", (request) => {
    if (/\/_next\/static\/chunks\/modules_/.test(new URL(request.url()).pathname)) perModuleCode = true;
  });
  await page.goto(`/inspections/${fixture.inspectionId}?module=header`);
  await formReady(page);
  await page.waitForLoadState("networkidle");
  test.skip(!perModuleCode, "A production build: every form's code comes with the page, so none can fail to download later.");

  // Offline: the calm notice, no red, no developer. Back online, the section asks again by itself.
  await context.setOffline(true);
  const watertight = OFFLINE_SECTIONS[3];
  await openSection(page, watertight);
  const notice = page.locator('[data-slot="section-not-loaded"]');
  await expect(notice).toHaveAttribute("data-failure", "offline");
  await expect(notice).toContainText("This section opens once the connection is back. Nothing is lost.");
  await expect(notice.getByRole("button", { name: "Try Again" })).toBeVisible();
  await expect(page.locator('[data-slot="section-crashed"]')).toHaveCount(0);
  await shot(page, "offline-not-loaded");
  await page.unroute(watertightCode);
  await context.setOffline(false);
  await expect(notice).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Increase .*Size/ }).first()).toBeVisible();

  // Online, a download that fails: Try Again (or Reload), and it opens.
  const safedon = OFFLINE_SECTIONS[4];
  await openSection(page, safedon);
  await expect(notice).toHaveAttribute("data-failure", "not_loaded");
  await expect(notice).toContainText(`The form for ${safedon.title} did not load.`);
  await expect(notice.getByRole("button", { name: "Reload" })).toBeVisible();
  await shot(page, "online-not-loaded");
  // Asked again while the download still fails: the notice stays, the section works no less.
  await press(notice.getByRole("button", { name: "Try Again" }));
  await expect(notice).toHaveAttribute("data-failure", "not_loaded");
  await page.unroute(safedonCode);
  await press(notice.getByRole("button", { name: "Try Again" }));
  await expect(notice).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('[data-slot="section-crashed"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: safedon.title, exact: true })).toBeVisible();
});

/**
 * Matches the download of a module's form code. Next's dev server names a
 * lazy chunk after its module's folder: /_next/static/chunks/modules_watertight_1m45_h0._.js.
 */
function formCode(moduleKey: string) {
  const pattern = new RegExp(`/_next/static/chunks/modules_${moduleKey}_[^/]*\\.js$`);
  return (url: URL) => pattern.test(url.pathname);
}

/* ------------------------------------------------------------------ *
 * F1: photo tags from a tap, in WebKit
 * ------------------------------------------------------------------ */

test("in WebKit, a tap on + tags the next photo with its size and defect", async ({ baseURL }) => {
  test.skip(!["ipad-portrait", "ipad-pro-landscape"].includes(project()), "The iPads.");
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({
      ...devices["iPad Pro 11"],
      viewport: test.info().project.use.viewport ?? devices["iPad Pro 11"].viewport,
      baseURL,
    });
    await signInAs(context, baseURL!, INSPECTOR);
    const page = await context.newPage();
    await page.goto(`/inspections/${fixture.inspectionId}?module=visual`);
    await formReady(page);
    await sizeTab(page, "M").tap();

    const before = await page.getByRole("spinbutton", { name: "Thin Spot on Glove Body, Size M" }).textContent();
    await page.getByRole("button", { name: "Increase Thin Spot on Glove Body, Size M" }).tap();
    await expect(page.getByRole("spinbutton", { name: "Thin Spot on Glove Body, Size M" })).toHaveText(String(Number(before) + 1));
    // WebKit leaves a tapped button unfocused: the tag comes from the press itself.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BUTTON");
    await expect(page.locator('[data-slot="next-tags"]:visible')).toHaveText(
      "New photos are tagged Size M · Thin Spot on Glove Body.",
    );
    await page.screenshot({ path: `screenshots/capture/final-webkit-${project()}-tagged.png`, animations: "disabled" });

    const photo = await drawImage(page, { name: "thin-spot.jpg", type: "image/jpeg", width: 1200, height: 900, label: "Thin spot" });
    await page.locator('[data-slot="module-photos"][data-module="visual"] input[data-photo-input="library"]').setInputFiles(photo);
    await expect
      .poll(async () => (await fixture.photos()).filter((row) => row.module_key === "visual").map((row) => row.target), {
        timeout: 60_000,
      })
      .toContain("size:M/defect:thin_spot");
    await context.close();
  } finally {
    await browser.close();
  }
});

/* ------------------------------------------------------------------ *
 * STDEG-6, ACC-SGF-8: the submit confirmation
 * ------------------------------------------------------------------ */

test("the submit confirmation names the result as every pill does, and a clean pass says nothing twice", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!["ipad-pro-landscape", "desktop"].includes(project()), "The 12.9 inch iPad and the desktop.");
  await signInAs(context, baseURL!, INSPECTOR);

  const confirm = async (inspectionId: string) => {
    await page.goto(`/inspections/${inspectionId}?module=conclusion`);
    await formReady(page);
    await press(page.getByRole("button", { name: "Submit", exact: true }));
    const dialog = page.getByRole("alertdialog", { name: /^Submit INS-\d{4}-\d+ for Review\?$/ });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  const clean = await confirm(fixture.cleanPassId);
  await expect(clean.locator('[data-slot="status-pill"]')).toHaveText("Passed");
  await expect(clean.locator('[data-slot="suggested-reasons"]')).toHaveCount(0);
  await expect(clean).not.toContainText(/\bPass\.(\s|$)/);
  await shot(page, "submit-clean-pass");
  await press(clean.getByRole("button", { name: "Cancel" }));

  const warned = await confirm(fixture.warnedPassId);
  await expect(warned.locator('[data-slot="status-pill"]')).toHaveText("Passed");
  await expect(warned.locator('[data-slot="suggested-reasons"]')).toHaveText("Warnings: Dye Leak Test.");
  await expect(warned).toContainText("1 warning goes into the report.");
  await expect(warned).not.toContainText(/\b(Pass|Fail|Hold)\b[.:]/);
  await shot(page, "submit-warned-pass");
  await press(warned.getByRole("button", { name: "Cancel" }));
});

/* ------------------------------------------------------------------ *
 * UX-05, UX-06: read-only screens
 * ------------------------------------------------------------------ */

test("read-only screens have no Pending list, and a lead is told whose submitted inspection it is", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!["ipad-pro-landscape", "desktop"].includes(project()), "The 12.9 inch iPad and the desktop.");
  const pending = page.getByRole("button", { name: /^Pending/ });

  // The lead, on a team member's submitted inspection.
  await signInAs(context, baseURL!, fixture.lead);
  await page.goto(`/inspections/${fixture.memberSubmittedId}`);
  const submitted = page.locator('[data-notice="submitted"]');
  await expect(submitted).toContainText(`Submitted for review by ${fixture.member.name}: read-only.`);
  await expect(submitted).not.toContainText("back to you");
  await expect(submitted.getByRole("link", { name: "Open the Review" })).toBeVisible();
  await expect(pending).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot="pending-dot"]')).toHaveCount(0);
  await shot(page, "lead-team-submitted");

  // The member, on their own.
  await signInAs(context, baseURL!, fixture.member);
  await page.goto(`/inspections/${fixture.memberSubmittedId}`);
  await expect(submitted).toContainText("Submitted for review: read-only. An admin can send it back to you for changes.");
  await expect(pending).toHaveCount(0);

  // An admin, on an approved one.
  await signInAs(context, baseURL!, ADMIN);
  await page.goto(`/inspections/${fixture.memberApprovedId}`);
  await expect(page.locator('[data-notice="approved"]')).toContainText("Approved: this inspection is read-only.");
  await expect(pending).toHaveCount(0);
  await shot(page, "admin-approved");

  // Where it can be changed, Pending is there.
  await signInAs(context, baseURL!, INSPECTOR);
  await page.goto(`/inspections/${fixture.inspectionId}`);
  await formReady(page);
  await expect(pending).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * UX-11: the desktop sidebar
 * ------------------------------------------------------------------ */

test("the desktop sidebar shows long section titles on two lines, each named in full", async ({ page, context, baseURL }) => {
  test.skip(project() !== "desktop", "The sidebar is the desktop's.");
  await signInAs(context, baseURL!, INSPECTOR);
  await page.goto(`/inspections/${fixture.inspectionId}?module=${NOTES_SECTION.key}`);
  await formReady(page);
  const sidebar = page.getByRole("navigation", { name: "Sections" });
  const rows = [
    { title: "Dimension", lines: 1 },
    { title: "Manufacturer Information", lines: 2 },
    { title: "Freedom From Holes by Watertight Test", lines: 2 },
    { title: "Glove Dispensing Inspection", lines: 2 },
    { title: NOTES_SECTION.title, lines: 2 },
  ];
  for (const { title, lines } of rows) {
    const button = sidebar.getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}\\s*,`) });
    // Named in full on hover, however it is cut.
    await expect(button).toHaveAttribute("title", title);
    // A long title wraps to a second line (the row grows) instead of being cut short on one.
    const label = button.locator(".line-clamp-2");
    const shown = await label.evaluate((element) =>
      Math.round(element.clientHeight / Number.parseFloat(getComputedStyle(element).lineHeight)),
    );
    expect(shown, title).toBe(lines);
  }
  await page.getByRole("complementary", { name: "Sections and progress" }).screenshot({
    path: `screenshots/capture/final-${project()}-sidebar.png`,
  });
});

/* ------------------------------------------------------------------ *
 * Kenneth: the inspector comment box and the photo box line up
 * ------------------------------------------------------------------ */

test("beside the comment box, the photo box starts and ends with it, and what new photos are tagged with sits under it", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(project() !== "desktop", "Side by side only on a desktop: 1280 px and wider, with no touchscreen.");
  await signInAs(context, baseURL!, INSPECTOR);
  // A per-size module: the size on screen tags new photos from the start, so the tag line shows.
  await page.goto(`/inspections/${fixture.inspectionId}?module=dimensions`);
  const footer = page.locator('section footer:has([data-slot="module-photos"])').first();
  const tags = footer.locator('[data-slot="next-tags"]');
  await expect(tags).toHaveText(/^New photos are tagged Size /);
  // Measured once the photos have loaded: until then "Loading photos…" sits above the photo box and moves it down.
  await expect(footer.locator('[data-slot="photos-loading"]')).toHaveCount(0);
  await footer.scrollIntoViewIfNeeded();
  const comment = await footer.getByRole("textbox").first().boundingBox();
  const photoBox = await footer.locator('[data-slot="photo-add"] > div.border-dashed').boundingBox();
  const tagLine = await tags.boundingBox();
  expect(comment && photoBox && tagLine, "all three are on screen").toBeTruthy();
  expect(Math.abs(comment!.y - photoBox!.y), "the boxes start together").toBeLessThanOrEqual(1);
  expect(Math.abs(comment!.y + comment!.height - (photoBox!.y + photoBox!.height)), "the boxes end together").toBeLessThanOrEqual(1);
  expect(tagLine!.y, "the tag line sits under the photo box").toBeGreaterThanOrEqual(photoBox!.y + photoBox!.height);
  await footer.screenshot({ path: `screenshots/capture/final-${project()}-comment-and-photos.png` });
});
