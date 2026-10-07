import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { resolveTemplate } from "../../modules";
import { drawImage, watchConsole } from "../photos/support";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";

/**
 * The capture screen's halves of two fixes first made on the review, as an
 * admin on a draft of the test inspector's:
 *
 * - the inspector's HOLD reads On hold, with the pause icon, on the
 *   Conclusion section's pill and its tab (the sidebar row on the desktop),
 *   not an amber Warning, and counts as done (ACC-SGF-7);
 * - a reason typed for switching a module off, and a photo's caption, are
 *   still there after a reload, and go once cancelled or sent (UX-08).
 *
 * Temporary rows (e2e/README.md, "Rules for the shared database"): a draft
 * template E2E_FOLLOWUP_CAPTURE, one inspection made from it (the
 * conclusion HOLD, with its date) and one photo of the conclusion with its
 * thumbnail in Storage, made for each project's run and deleted in
 * afterAll, Storage first; a crashed run's are removed at the next start.
 * Each run of a project draws one number from the live ref sequence. One
 * sign-in per project. Screenshots go to screenshots/capture/followups-*.
 *
 *   npx next dev -p 3921
 *   PLAYWRIGHT_BASE_URL=http://localhost:3921 npx playwright test e2e/capture/followups.spec.ts \
 *     --project=ipad-portrait --project=ipad-pro-landscape --project=desktop
 */

// The Mac running these is shared with other builds: generous waits, never sleeps.
test.describe.configure({ mode: "serial", timeout: 180_000 });

const CODE = "E2E_FOLLOWUP_CAPTURE";
const PHOTO_BUCKET = "inspection-photos";
const BUCKETS = [PHOTO_BUCKET, "inspection-files"] as const;
// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
} as const;

const SAVED_CAPTION = "Carton label, as found";
const TYPED_CAPTION = "Carton label, as found: the lot number is smudged";
const NEW_CAPTION = "Carton label: lot number smudged, retaken";
const TYPED_REASON = "Not part of this client's order.\nThe glove spec sheet comes with the lab report.";
const SENT_REASON = "Not part of this client's order (e2e).";

type AdminClient = ReturnType<typeof createTestAdminClient>;

type Fixture = {
  inspectionId: string;
  photoId: string;
  /** The photo's caption as stored. */
  photoCaption: () => Promise<string | null>;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Capture follow-ups fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

function definition(): TemplateDefinition {
  return {
    code: CODE,
    name: "Capture follow-ups e2e (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }],
    modules: [
      { key: "header", include: true },
      { key: "glove_info", include: true },
      { key: "order_lots", include: true },
      { key: "conclusion", include: true },
    ],
    report: { title: "Capture follow-ups e2e (temporary)", showClientLogo: false },
  };
}

/** The template's inspections, their Storage objects first, then the template. */
async function removeRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", CODE);
  if (error) fail("finding the fixture template", error);
  const ids = templates.map((template) => template.id);
  if (ids.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (findError) fail("finding the fixture inspections", findError);
  for (const { id } of inspections) {
    for (const bucket of BUCKETS) {
      const paths: string[] = [];
      for (const folder of [id, `${id}/thumbs`]) {
        const { data, error: listError } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
        if (listError) fail(`listing ${bucket}/${folder}`, listError);
        // Folders come back as entries without an id.
        for (const entry of data) if (entry.id) paths.push(`${folder}/${entry.name}`);
      }
      if (paths.length === 0) continue;
      const removed = await admin.storage.from(bucket).remove(paths);
      if (removed.error) fail(`removing ${bucket} objects of ${id}`, removed.error);
    }
    await deleteTestInspection(admin, id);
  }
  const removed = await admin.from("templates").delete().in("id", ids);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

async function createFixture(browser: Browser): Promise<Fixture> {
  const admin = createTestAdminClient();
  await removeRows(admin);
  try {
    return await insertRows(admin, browser);
  } catch (error) {
    await removeRows(admin).catch(() => undefined);
    throw error;
  }
}

async function insertRows(admin: AdminClient, browser: Browser): Promise<Fixture> {
  const { data: inspector, error: inspectorError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (inspectorError) fail("finding the test inspector", inspectorError);

  const resolution = resolveTemplate(definition(), lookupFrom([]));
  if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });
  // A draft template: no inspector could start from it; only this inspection uses it.
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({
      ...templateRowFields(definition(), resolution.template),
      definition: definition() as unknown as NonNullable<Json>,
      resolved: resolution.template as unknown as Json,
      version: 1,
      status: "draft",
    })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  // Inserts never send id or ref_no: the database draws the ref number. The inspector chose HOLD, with its date.
  const data = {
    modules: { order_lots: { sizes: { M: { qtyCases: 10 } } }, conclusion: { finalResult: "hold", date: "2026-10-07" } },
    custom: {},
  };
  const { data: inspection, error: inspectionError } = await admin
    .from("inspections")
    .insert({
      template_id: template.id,
      inspector_id: inspector.id,
      client_id: SEED.polyco,
      manufacturer_id: SEED.hartalega,
      data: data as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (inspectionError) fail("creating the fixture inspection", inspectionError);

  // One photo of the conclusion, uploaded with its thumbnail, as the inspector's device would have.
  const page = await browser.newPage();
  const photo = await drawImage(page, { name: "label.jpg", type: "image/jpeg", width: 1200, height: 900, label: "Carton label" });
  const thumb = await drawImage(page, { name: "label-thumb.jpg", type: "image/jpeg", width: 400, height: 300, label: "Carton label" });
  await page.close();
  const photoId = randomUUID();
  const path = `${inspection.id}/${photoId}.jpg`;
  const thumbPath = `${inspection.id}/thumbs/${photoId}.jpg`;
  for (const [objectName, bytes] of [
    [path, photo.buffer],
    [thumbPath, thumb.buffer],
  ] as const) {
    const { error } = await admin.storage.from(PHOTO_BUCKET).upload(objectName, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) fail(`uploading ${objectName}`, error);
  }
  const added = await admin.from("inspection_photos").insert({
    id: photoId,
    inspection_id: inspection.id,
    module_key: "conclusion",
    target: null,
    storage_path: path,
    thumb_path: thumbPath,
    caption: SAVED_CAPTION,
    taken_at: new Date(Date.now() - 600_000).toISOString(),
    width: 1200,
    height: 900,
    include_in_report: false,
    created_by: inspector.id,
  });
  if (added.error) fail("adding the photo", added.error);

  return {
    inspectionId: inspection.id,
    photoId,
    photoCaption: async () => {
      const { data: row, error } = await admin.from("inspection_photos").select("caption").eq("id", photoId).single();
      if (error) fail("reading the photo's caption", error);
      return row.caption;
    },
    cleanup: () => removeRows(admin),
  };
}

let fixture: Fixture;
/** The test admin's session: one sign-in per project, for every test (the shared sign-in limit). */
let adminCookies: { name: string; value: string }[];

test.beforeAll(async ({ browser }) => {
  adminCookies = await sessionCookies(TEST_ACCOUNTS.admin);
  fixture = await createFixture(browser);
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

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

/** Puts the test admin's session into the test's browser context. */
async function signInAsAdmin(context: BrowserContext, baseURL: string) {
  await context.addCookies(adminCookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

/** A viewport shot (dialogs, which a full-page capture would cut; touch emulation stays on). */
async function shot(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: `screenshots/capture/followups-${project()}-${name}.png`, animations: "disabled", caret: "initial" });
}

/** The open section's frame once its form has loaded and saving has started. */
async function formReady(page: Page) {
  const frame = page.locator('[data-slot="section-frame"]');
  await expect(frame.getByText("Loading the form…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
  return frame;
}

/** The capture screen's drafts this tab keeps (lib/drafts/tab-draft.ts). */
function captureDrafts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(window.sessionStorage).filter(
      (key) => key.startsWith("stericare:capture-draft:") || key.startsWith("stericare:photo-draft:"),
    ),
  );
}

/** Focused, the caret at the end of what is there: where the user stopped. */
async function expectCaretAtEnd(field: Locator) {
  await expect(field).toBeFocused();
  const [caret, length] = await field.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.value.length]);
  expect(caret).toBe(length);
}

/* ------------------------------------------------------------------ *
 * ACC-SGF-7: HOLD reads On hold
 * ------------------------------------------------------------------ */

test("the inspector's HOLD reads On hold on the Conclusion's pill and its tab or sidebar row, and counts as done", async ({
  page,
  context,
  baseURL,
}) => {
  const hydration = watchConsole(page);
  await signInAsAdmin(context, baseURL!);
  await page.goto(`/inspections/${fixture.inspectionId}?module=conclusion`);
  const frame = await formReady(page);
  await expect(page.getByRole("heading", { level: 2, name: "Conclusion", exact: true })).toBeVisible();

  // The section's pill: On hold, the pause icon, the hold tint.
  const pill = frame.locator('header [data-slot="status-pill"]');
  await expect(pill).toHaveAttribute("data-status", "hold");
  await expect(pill).toHaveText("On hold");
  await expect(pill.locator("svg.lucide-circle-pause")).toHaveCount(1);
  await expect(frame.locator("header")).not.toContainText("Warning");

  if (hasTabs()) {
    // The tab's chip: the pause glyph, read as On hold.
    const tab = page.locator('[role="tab"][data-section="conclusion"]');
    const chip = tab.locator('[data-slot="result-chip"]');
    await expect(chip).toHaveAttribute("data-status", "hold");
    await expect(chip).toHaveText("On hold");
    await expect(tab).not.toContainText("Warning");
    // Done on the progress bar under the tabs.
    await expect(page.locator('[data-slot="progress-tracker"]:visible')).toContainText("Conclusion: Done");
  } else {
    // The sidebar's row: done, and on hold.
    const row = page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Conclusion\s*,/ });
    await expect(row).toContainText(", Done");
    await expect(row.locator('[data-slot="result-chip"]')).toHaveAttribute("data-status", "hold");
    await expect(row).toContainText("On hold");
    await expect(row).not.toContainText("Warning");
  }
  await shot(page, "conclusion-hold");
  expect(hydration()).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * UX-08: typed words survive a reload
 * ------------------------------------------------------------------ */

test("an admin's reason for switching a module off survives a reload, and goes once cancelled or sent", async ({
  page,
  context,
  baseURL,
}) => {
  const hydration = watchConsole(page);
  await signInAsAdmin(context, baseURL!);
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await formReady(page);
  const switchOff = page.locator('[data-action="switch-off"]');
  const dialog = page.getByRole("dialog", { name: "Switch Off Glove Information?" });
  const reason = dialog.getByRole("textbox", { name: "Reason" });

  await press(switchOff);
  await expect(reason).toHaveValue("");
  await reason.fill(TYPED_REASON);
  expect(await captureDrafts(page)).toEqual([expect.stringContaining(":switch-off:")]);

  // A reload: the dialog opens on the reason as it was, going on where it stopped.
  await page.reload();
  await formReady(page);
  await expect(dialog).toBeHidden();
  await press(switchOff);
  await expect(reason).toHaveValue(TYPED_REASON);
  await expectCaretAtEnd(reason);
  await shot(page, "switch-off-after-reload");

  // Cancelled, it goes.
  await press(dialog.getByRole("button", { name: "Cancel" }));
  await expect(dialog).toBeHidden();
  expect(await captureDrafts(page)).toEqual([]);
  await press(switchOff);
  await expect(reason).toHaveValue("");

  // Sent, it is the module's reason, no longer a draft; switched back on, the dialog starts empty.
  await reason.fill(SENT_REASON);
  await press(dialog.getByRole("button", { name: "Switch Off", exact: true }));
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Glove Information is switched off for this inspection.").first()).toBeVisible();
  await expect(page.getByText(SENT_REASON)).toBeVisible();
  expect(await captureDrafts(page)).toEqual([]);
  await press(page.getByRole("button", { name: "Switch Back On" }));
  await press(switchOff);
  await expect(reason).toHaveValue("");
  await press(dialog.getByRole("button", { name: "Cancel" }));
  await expect(dialog).toBeHidden();
  expect(hydration()).toEqual([]);
});

test("a photo's caption survives a reload, and goes once cancelled or saved", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await signInAsAdmin(context, baseURL!);
  await page.goto(`/inspections/${fixture.inspectionId}?module=conclusion`);
  await formReady(page);
  const edit = page
    .locator(`[data-slot="photo-card"][data-photo-id="${fixture.photoId}"]`)
    .getByRole("button", { name: /^Edit tags and caption:/ });
  const dialog = page.getByRole("dialog", { name: /^Edit Photo/ });
  const caption = dialog.getByRole("textbox", { name: "Caption" });

  await press(edit);
  await expect(caption).toHaveValue(SAVED_CAPTION);
  await caption.fill(TYPED_CAPTION);
  expect(await captureDrafts(page)).toEqual([expect.stringContaining(`:caption:`)]);

  // A reload: the dialog opens on the caption as typed, focused where it stopped.
  await page.reload();
  await formReady(page);
  await press(edit);
  await expect(caption).toHaveValue(TYPED_CAPTION);
  await expectCaretAtEnd(caption);
  await shot(page, "caption-after-reload");

  // Cancelled, it goes: the saved caption is back.
  await press(dialog.getByRole("button", { name: "Cancel" }));
  await expect(dialog).toBeHidden();
  expect(await captureDrafts(page)).toEqual([]);
  await press(edit);
  await expect(caption).toHaveValue(SAVED_CAPTION);

  // Saved, it is the photo's caption, no longer a draft.
  await caption.fill(NEW_CAPTION);
  await press(dialog.getByRole("button", { name: "Save", exact: true }));
  await expect(dialog).toBeHidden();
  await expect.poll(() => fixture.photoCaption(), { timeout: 15_000 }).toBe(NEW_CAPTION);
  expect(await captureDrafts(page)).toEqual([]);
  await press(edit);
  await expect(caption).toHaveValue(NEW_CAPTION);
  await press(dialog.getByRole("button", { name: "Cancel" }));
  await expect(dialog).toBeHidden();
  expect(hydration()).toEqual([]);
});
