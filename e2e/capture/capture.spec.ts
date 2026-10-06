import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { Json } from "../../lib/supabase/database.types";
import { createTestAdminClient } from "../support/admin";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import { createCaptureFixture, type CaptureFixture } from "./fixtures";

/**
 * /inspections/[id], the capture screen (BUILD_SPEC 8 and 10), against the
 * live project at the three sizes in playwright.config.ts. One temporary
 * template and inspection per project (fixtures.ts); the tests run in order
 * on the same inspection. Screenshots go to screenshots/capture/.
 */

test.describe.configure({ mode: "serial" });

let fixture: CaptureFixture;

test.beforeAll(async () => {
  fixture = await createCaptureFixture();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

function isTouch() {
  return Boolean(test.info().project.use.hasTouch);
}

function isDesktop() {
  return test.info().project.name === "desktop";
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled.
 */
async function shot(page: Page, name: string) {
  const path = (part = "") => `screenshots/capture/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  if (!isTouch()) {
    await page.screenshot({ ...options, path: path(), fullPage: true });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.min(4, Math.max(1, Math.ceil(height / viewport)));
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: path(parts > 1 ? `-${part + 1}` : "") });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** A viewport shot, for dialogs and sheets. */
async function viewportShot(page: Page, name: string) {
  await page.screenshot({
    path: `screenshots/capture/${test.info().project.name}-${name}.png`,
    animations: "disabled",
    caret: "initial",
  });
}

/** A tap on the iPads, a click on the desktop. */
async function press(locator: Locator) {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

/** Collects console errors, so hydration mismatches fail the test. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => errors.filter((text) => /hydrat|did not match|server rendered/i.test(text));
}

async function expectNoPageScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

/**
 * The capture kit's sticky offsets (docs/CAPTURE_KIT.md): --capture-sticky-top
 * is where the screen's own bars end (the shell's top bar and, below 1280 px,
 * the section bar, measured while it is stuck), nothing is stuck at the
 * bottom, and the page's scroll padding clears at least the top bars.
 */
async function expectStickyOffsets(page: Page) {
  // Scrolled just past the section bar's place (with room to scroll, however
  // short the section is), so it is stuck while its section is on screen.
  await page.evaluate(() => {
    document.body.style.paddingBottom = "3000px";
    const bar = document.querySelector<HTMLElement>('[data-slot="capture-bar"]');
    if (bar && bar.getClientRects().length > 0) {
      window.scrollBy(0, bar.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(bar).top) || 0) + 40);
    }
  });
  const read = () =>
    page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-slot="capture-screen"]');
      const bar = document.querySelector<HTMLElement>('[data-slot="capture-bar"]');
      const top = Number.parseFloat(root?.style.getPropertyValue("--capture-sticky-top") ?? "");
      const shown = bar !== null && bar.getClientRects().length > 0;
      return {
        top,
        bottom: Number.parseFloat(root?.style.getPropertyValue("--capture-sticky-bottom") ?? ""),
        barBottom: shown ? Math.round(bar.getBoundingClientRect().bottom) : 0,
        clears: Number.parseFloat(document.documentElement.style.scrollPaddingTop) >= top,
      };
    });
  if (isDesktop()) {
    // From 1280 px there is no top bar and the sidebar takes the sections.
    await expect.poll(read).toEqual({ top: 0, bottom: 0, barBottom: 0, clears: true });
  } else {
    await expect
      .poll(async () => {
        const offsets = await read();
        return offsets.top > 0 && Math.abs(offsets.top - offsets.barBottom) <= 1 && offsets.bottom === 0 && offsets.clears;
      }, { message: "--capture-sticky-top is where the stuck section bar ends" })
      .toBe(true);
  }
  await page.evaluate(() => {
    document.body.style.paddingBottom = "";
    window.scrollTo(0, 0);
  });
}

async function signInAs(context: BrowserContext, baseURL: string, account: keyof typeof TEST_ACCOUNTS) {
  await context.clearCookies();
  await signIn(context, baseURL, TEST_ACCOUNTS[account]);
}

/** The save pill on screen (the bar below 1280 px, the sidebar from 1280 px). */
function savePill(page: Page) {
  return page.locator('[data-slot="save-status"]:visible');
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Opens a section from the tab bar (iPad) or the sidebar (desktop). */
async function openSection(page: Page, title: string) {
  const name = new RegExp(`^${escapeRegExp(title)}`);
  const target = isDesktop()
    ? page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name })
    : page.getByRole("tab", { name });
  await press(target);
  await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
}

async function storedData(inspectionId: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin.from("inspections").select("data, status, module_overrides").eq("id", inspectionId).single();
  if (error) throw new Error(error.message);
  return data;
}

test("the inspector opens the inspection and moves between sections", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}`);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(fixture.refNo);
  await expect(page).toHaveTitle(new RegExp(fixture.refNo));
  await expect(savePill(page)).toHaveAttribute("data-state", "saved");
  // The first section is open: the header.
  await expect(page.getByRole("heading", { level: 2, name: "Manufacturer Information" })).toBeVisible();
  const frame = page.locator('[data-slot="section-frame"]');
  if (isDesktop()) {
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Sections" })).toBeHidden();
    // Beside the sidebar the open section is a region named by its title.
    await expect(frame).not.toHaveAttribute("role", "tabpanel");
    await expect(page.getByRole("region", { name: "Manufacturer Information" })).toBeVisible();
  } else {
    await expect(page.getByRole("tablist", { name: "Sections" })).toBeVisible();
    // The open section is the selected tab's panel, named by that tab (WAI-ARIA tabs).
    const tab = page.getByRole("tab", { selected: true });
    await expect(frame).toHaveAttribute("role", "tabpanel");
    await expect(frame).toHaveAttribute("id", (await tab.getAttribute("aria-controls"))!);
    await expect(frame).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
    // The header's actions take their own row under the title, which keeps the full width.
    const title = await page.getByRole("heading", { level: 1 }).boundingBox();
    const photos = await page.getByRole("link", { name: "Photos" }).boundingBox();
    expect(photos!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
  }
  await shot(page, "open");

  await openSection(page, "Glove Information");
  await expect(page).toHaveURL(/module=glove_info/);
  await expectStickyOffsets(page);
  await openSection(page, "Site notes");
  await openSection(page, "Weight (g)");
  await expect(page.getByText("This section arrives in a later build.")).toBeVisible();
  await expectNoPageScroll(page);
  await shot(page, "stub-section");
  expect(hydration()).toEqual([]);
});

test("typing into glove information saves, and the value is there after a reload", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByRole("heading", { level: 2, name: "Glove Information" })).toBeVisible();

  const colour = page.getByLabel("Glove colour");
  await expect(colour).toBeEditable();
  await colour.fill("Blue");
  const weight = page.getByLabel("Indicative weight (size M)");
  await weight.fill("3.5");
  await weight.press("Tab");

  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ modules: { glove_info: { colour: "Blue", indicativeWeight: 3.5 } } });
  await expect(savePill(page)).toHaveAttribute("data-state", "saved");
  await shot(page, "glove-info-saved");

  await page.reload();
  await expect(page.getByLabel("Glove colour")).toHaveValue("Blue");
  await expect(page.getByLabel("Indicative weight (size M)")).toHaveValue("3.5");

  // A custom section of the template saves the same way.
  await openSection(page, "Site notes");
  await page.getByLabel("Weather at the site").fill("Dry, 31 °C");
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ custom: { e2e_site_notes: { weather: "Dry, 31 °C" } } });
  await shot(page, "custom-section");
  expect(hydration()).toEqual([]);
});

test("a field mapped to the glove colour keeps fast typing and an edit mid-word", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}`);
  await openSection(page, "Site notes");

  const mapped = page.getByLabel("Colour for the report");
  await expect(mapped).toBeEditable();
  await mapped.fill("");
  await mapped.pressSequentially("Midnight blue");
  await expect(mapped).toHaveValue("Midnight blue");
  // Back to the end of "Midnight", then two more characters: they land where the caret is.
  for (let step = 0; step < " blue".length; step++) await mapped.press("ArrowLeft");
  await mapped.pressSequentially("-x", { delay: 150 });
  await expect(mapped).toHaveValue("Midnight-x blue");
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ modules: { glove_info: { colour: "Midnight-x blue" } } });

  // It is the glove information's own colour.
  await openSection(page, "Glove Information");
  await expect(page.getByLabel("Glove colour")).toHaveValue("Midnight-x blue");
  expect(hydration()).toEqual([]);
});

test("a custom grid takes numbers in bordered cells, like the text cells beside them", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}`);
  await openSection(page, "Box checks");

  const weight = page.getByLabel("Box weight, Box 1");
  const note = page.getByLabel("Box note, Box 1");
  await expect(weight).toBeEditable();
  // Something to tap: a bordered field as tall as the text field in the next row.
  await expect(weight).toHaveCSS("border-top-style", "solid");
  expect(Number.parseFloat(await weight.evaluate((input) => getComputedStyle(input).borderTopWidth))).toBeGreaterThan(0);
  const [weightBox, noteBox] = await Promise.all([weight.boundingBox(), note.boundingBox()]);
  expect(Math.abs(weightBox!.height - noteBox!.height)).toBeLessThanOrEqual(1);
  if (isTouch()) expect(weightBox!.height).toBeGreaterThanOrEqual(44);

  await weight.fill("12.5");
  // Enter stores it and walks along the row of numbers.
  await weight.press("Enter");
  await expect(page.getByLabel("Box weight, Box 2")).toBeFocused();
  await note.fill("Seal torn");
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ custom: { e2e_box_checks: { boxWeight: [12.5], boxNote: ["Seal torn"] } } });
  await shot(page, "custom-grid");
});

test("a number typed just before Photos is saved, though the tap leaves the focus in it", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  const weight = page.getByLabel("Indicative weight (size M)");
  await expect(weight).toBeEditable();
  await weight.fill("4.2");
  await expect(weight).toBeFocused();
  // Safari on the iPad does not move focus on a tap: a script's click does the same here.
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href$="/photos"]')?.click());
  await expect(page).toHaveURL(/\/photos$/);
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ modules: { glove_info: { indicativeWeight: 4.2 } } });
});

test("a change made just before leaving the screen reaches the server", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, "inspector");
  // Into the inspection from the list inside the app, so Back leaves the screen at once, well
  // inside the autosave's 800 ms wait.
  await page.goto("/inspections");
  await page.waitForLoadState("networkidle");
  // Until the app has hydrated a push goes nowhere: push again until it lands.
  await expect(async () => {
    await page.evaluate(
      (href) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(href),
      `/inspections/${fixture.inspectionId}?module=glove_info`,
    );
    await expect(page).toHaveURL(/module=glove_info/, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  const colour = page.getByLabel("Glove colour");
  await expect(colour).toBeEditable();
  await colour.fill("Navy");
  await page.goBack();
  await expect(page).toHaveURL(/\/inspections$/);
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 10_000 })
    .toMatchObject({ modules: { glove_info: { colour: "Navy" } } });
});

test("without a connection the pill says Offline (will sync), then saves", async ({ page, context, baseURL }) => {
  test.skip(!isDesktop(), "One size is enough: the pill is the same component everywhere.");
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByLabel("Glove colour")).toBeEditable();

  await context.setOffline(true);
  await page.getByLabel("Glove length").fill("240 mm minimum");
  await expect(savePill(page)).toHaveAttribute("data-state", "offline", { timeout: 15_000 });
  await viewportShot(page, "offline");
  await context.setOffline(false);
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ modules: { glove_info: { length: "240 mm minimum" } } });
});

test("a change kept on this device while saves fail comes back after a reload, and is saved", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!isDesktop(), "One size is enough: the local copy is the same everywhere.");
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  const texture = page.getByLabel("Glove surface texture");
  await expect(texture).toBeEditable();

  // The signal drops for saves only (Server Actions are POSTs): the page itself still reloads.
  await page.route("**/*", (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await texture.fill("Textured fingertips");
  await expect(savePill(page)).toHaveAttribute("data-state", "offline", { timeout: 15_000 });
  await page.unroute("**/*");

  await page.reload();
  await expect(page.getByText("Unsaved changes from this device were restored")).toBeVisible();
  await expect(page.getByLabel("Glove surface texture")).toHaveValue("Textured fingertips");
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ modules: { glove_info: { surfaceTexture: "Textured fingertips" } } });
  await expect(savePill(page)).toHaveAttribute("data-state", "saved");
});

test("an edit saved on another device meanwhile asks which version to keep", async ({ page, context, baseURL }) => {
  test.skip(!isDesktop(), "One size is enough: the question is the same everywhere.");
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  const colour = page.getByLabel("Glove colour");
  await expect(colour).toBeEditable();

  // Another device saves a different colour (a plain update moves updated_at on).
  const admin = createTestAdminClient();
  const { data } = await storedData(fixture.inspectionId);
  const stored = data as { modules: Record<string, Record<string, unknown>>; custom: Record<string, unknown> };
  const elsewhere = {
    ...stored,
    modules: { ...stored.modules, glove_info: { ...stored.modules.glove_info, colour: "Green" } },
  };
  const { error } = await admin
    .from("inspections")
    .update({ data: elsewhere as unknown as NonNullable<Json> })
    .eq("id", fixture.inspectionId);
  if (error) throw new Error(error.message);

  // This device changes it too: the save finds a version it never saw and stops to ask.
  await colour.fill("Purple");
  const dialog = page.getByRole("alertdialog", { name: "This inspection was changed on another device" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await viewportShot(page, "conflict");
  await press(dialog.getByRole("button", { name: "Keep the changes on this device" }));
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
    .toMatchObject({ modules: { glove_info: { colour: "Purple" } } });
  await expect(savePill(page)).toHaveAttribute("data-state", "saved");
});

test("a section switched off on another device leaves this screen at the next save", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!isDesktop(), "One size is enough: the save is the same everywhere.");
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  const colour = page.getByLabel("Glove colour");
  await expect(colour).toBeEditable();
  const sections = page.getByRole("navigation", { name: "Sections" });
  await expect(sections).not.toContainText("Switched off");

  // An admin switches packing off elsewhere: only the overrides column moves, the data stays.
  const admin = createTestAdminClient();
  const { data: account, error: accountError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.admin)
    .single();
  if (accountError) throw new Error(accountError.message);
  const switchedOff = { packing_config: { reason: "Not ordered (e2e)", by: account.id, at: new Date().toISOString() } };
  const { error } = await admin.from("inspections").update({ module_overrides: switchedOff }).eq("id", fixture.inspectionId);
  if (error) throw new Error(error.message);
  try {
    // The next save lands on top of that change and brings it back.
    await colour.fill("Olive");
    await expect(sections).toContainText("Switched off", { timeout: 15_000 });
    await expect(sections.getByRole("button", { name: /^Packing configuration\s*, switched off/ })).toBeVisible();
    await expect
      .poll(async () => (await storedData(fixture.inspectionId)).data, { timeout: 15_000 })
      .toMatchObject({ modules: { glove_info: { colour: "Olive" } } });
    await expect(savePill(page)).toHaveAttribute("data-state", "saved");
  } finally {
    const restored = await admin.from("inspections").update({ module_overrides: {} }).eq("id", fixture.inspectionId);
    if (restored.error) throw new Error(restored.error.message);
  }
});

test("submit with errors is blocked, and each error links to its section", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}`);
  await expect(savePill(page)).toHaveAttribute("data-state", "saved");

  await press(page.getByRole("button", { name: "Submit", exact: true }));
  const sheet = page.getByRole("dialog", { name: "Before you submit" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("alert")).toContainText("before submitting");
  const conclusion = sheet.getByRole("button", { name: /Conclusion must be complete before submit/ });
  await expect(conclusion).toBeVisible();
  await viewportShot(page, "submit-blocked");

  await press(conclusion);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { level: 2, name: "Conclusion" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Conclusion" })).toBeFocused();
  expect((await storedData(fixture.inspectionId)).status).toBe("draft");

  // The required custom field is listed too, and its link focuses the field.
  await press(page.getByRole("button", { name: /^Issues/ }));
  await press(page.getByRole("dialog", { name: "Issues" }).getByRole("button", { name: /Container seal intact is required/ }));
  await expect(page.getByRole("heading", { level: 2, name: "Site notes" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Container seal intact" }).getByRole("radio").first()).toBeFocused();
  await shot(page, "issue-link");
});

test("an admin switches a section off for this inspection, and back on", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, "admin");
  await page.goto(`/inspections/${fixture.inspectionId}?module=packing_config`);
  await expect(page.getByRole("heading", { level: 2, name: "Packing configuration" })).toBeVisible();

  await press(page.getByRole("button", { name: "Switch off" }));
  const dialog = page.getByRole("dialog", { name: /Switch off Packing configuration/ });
  await expect(dialog).toBeVisible();
  // A reason is required.
  await press(dialog.getByRole("button", { name: "Switch off" }));
  await expect(dialog.getByText("Say why this section is switched off.")).toBeVisible();
  await dialog.getByLabel("Reason").fill("Not part of this order (e2e)");
  await viewportShot(page, "switch-off-dialog");
  await press(dialog.getByRole("button", { name: "Switch off" }));
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Packing configuration is switched off for this inspection.").first()).toBeVisible();
  // The Switch off button went with the section's controls: focus is on the section's title.
  await expect(page.getByRole("heading", { level: 2, name: "Packing configuration" })).toBeFocused();
  await expect(page.getByText("Not part of this order (e2e)")).toBeVisible();
  await expect
    .poll(async () => (await storedData(fixture.inspectionId)).module_overrides)
    .toMatchObject({ packing_config: { reason: "Not part of this order (e2e)" } });
  await shot(page, "switched-off");

  await page.reload();
  await expect(page.getByText("Not part of this order (e2e)")).toBeVisible();
  if (isDesktop()) await expect(page.getByRole("navigation", { name: "Sections" })).toContainText("Switched off");

  await press(page.getByRole("button", { name: "Switch back on" }));
  await expect(page.getByRole("button", { name: "Switch off" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Packing configuration" })).toBeFocused();
  await expect.poll(async () => (await storedData(fixture.inspectionId)).module_overrides).toEqual({});

  // Both changes are in the audit log, with the reason (log_inspection_event).
  const { data: logged, error } = await createTestAdminClient()
    .from("audit_log")
    .select("action, changes")
    .eq("inspection_id", fixture.inspectionId)
    .eq("action", "module_override")
    .order("id");
  if (error) throw new Error(error.message);
  expect(logged).toEqual([
    { action: "module_override", changes: { module: "packing_config", include: false, reason: "Not part of this order (e2e)" } },
    {
      action: "module_override",
      changes: { module: "packing_config", include: true, previousReason: "Not part of this order (e2e)" },
    },
  ]);
});

test("a second tab on the same inspection is read-only, with no red save pill", async ({ page, context, baseURL }) => {
  test.skip(!isDesktop(), "One size is enough: the lock is the same everywhere.");
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByLabel("Glove colour")).toBeEditable();

  const second = await context.newPage();
  try {
    await second.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
    await expect(second.getByText("This inspection is open in another tab on this device.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(second.getByLabel("Glove colour")).not.toBeEditable();
    // Nothing is wrong here: the notice says what to do, and no pill says "Not saved".
    await expect(savePill(second)).toHaveCount(0);
    await viewportShot(second, "second-tab");
  } finally {
    await second.close();
  }
});

test("submitted on another device: the next save is refused, with the review and Reload to go on", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  const colour = page.getByLabel("Glove colour");
  await expect(colour).toBeEditable();

  await fixture.setStatus("submitted");
  await colour.fill("Teal");
  const notice = page.locator('[data-notice="save-error"]');
  await expect(notice).toContainText("Not saved.", { timeout: 15_000 });
  await expect(notice.getByRole("link", { name: "Open the review" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(colour).not.toBeEditable();
  // The header follows what the save found.
  await expect(page.getByRole("heading", { level: 1 }).locator('[data-status="submitted"]')).toBeVisible();
  await shot(page, "refused-save");
});

test("a submitted inspection is read-only for the inspector", async ({ page, context, baseURL }) => {
  if ((await storedData(fixture.inspectionId)).status !== "submitted") await fixture.setStatus("submitted");
  await signInAs(context, baseURL!, "inspector");
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByText("Submitted for review: read-only.")).toBeVisible();
  await expect(page.getByLabel("Glove colour")).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
  await shot(page, "read-only");
});

test("an inspection that cannot be opened is not found, inside the shell", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, "inspector");
  await page.goto("/inspections/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page).toHaveTitle(/Page not found/);
  // One frame: the shell's, with its navigation. Not the standalone page's logo bar inside it.
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Main"]:visible')).toHaveCount(1);
  await shot(page, "not-found");
});
