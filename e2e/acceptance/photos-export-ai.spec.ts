import { mkdir, writeFile } from "node:fs/promises";
import { expect as baseExpect, devices, test, webkit, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { STATUS_LABEL } from "../../lib/design/status";
import { ExportSchema, type InspectionExport } from "../../lib/schemas/export";
import { drawImage, labReportPdf } from "../photos/support";
import { createTestAdminClient } from "../support/admin";
import { exportCoverage } from "./export-coverage";
import {
  createAcceptanceFixture,
  fileRows,
  inspectionObjects,
  inspectionRow,
  photoRows,
  press,
  SEED,
  sessions,
  shot,
  sweepAcceptanceLeftovers,
  view,
  watchConsole,
  WORDS,
  type AcceptanceFixture,
} from "./support";

/**
 * BUILD_SPEC 12, final acceptance of three done-whens on one inspection,
 * against the live project and a production build (AI second opinion on the
 * mock provider):
 *
 *   Phase 2  "photos taken in at least three modules show correctly on
 *            desktop": on the iPad (this project's touch viewport) the
 *            inspector takes generated JPEGs from the capture screen's own
 *            file inputs in four modules, each with what the module has in
 *            focus (a size, a defect, a box, a packaging level), attaches the
 *            force-at-break lab report there and submits; at 1440 x 900 the
 *            gallery and the review show every photo with its tags.
 *   Phase 3  "the export validates and contains everything needed to write
 *            the report without opening the app": the export of the filled
 *            STD_EG inspection validates against ExportSchema, carries every
 *            target of every field of the STD_EG report in the coverage
 *            inventory (lib/coverage), and links the photos and the lab
 *            report with working 24-hour signed URLs.
 *   Phase 3  "the AI review panel shows mock findings next to the
 *            inspector's results": an admin requests the second opinion and
 *            the panel shows the system's results, the inspector's and the
 *            mock's findings side by side.
 *
 * Before the capture, WebKit (the engine of Chrome and Safari on the iPad)
 * checks that a defect counted with a tap on + tags the next photo, as
 * Chromium's tap does by focusing the button.
 *
 * Runs on the iPad projects only (ipad-pro-landscape is Kenneth's 13 inch
 * iPad); the desktop checks open their own 1440 x 900 context. One
 * inspection per run, as each draws a live ref number; everything it made
 * is deleted in afterAll, Storage objects first. Screenshots and the export
 * go to screenshots/acceptance/.
 */

const expect = baseExpect.configure({ timeout: 20_000 });

test.skip(({ hasTouch }) => !hasTouch, "The capture runs on an iPad project; the desktop checks open their own context.");

const TITLES = {
  weight: "Weight (g) - average of 13 gloves per size",
  visual: "Visual Inspection",
  dispensing_packing: "Glove Packing Check",
  labeling: "Packaging Labeling Inspection",
  force_at_break: "Force At Break in Newton (Refer to attached where applicable)",
} as const;

type PhotoModule = "weight" | "visual" | "dispensing_packing" | "labeling";

/** The photos, module by module, in screen order: how each is taken, and the tags it must carry. */
const PLAN: readonly {
  module: PhotoModule;
  input: "camera" | "library";
  files: readonly { name: string; width: number; height: number; label: string }[];
  /** What the module is shown to have in focus first: a field tapped, a box list opened. */
  focus: (frame: Locator, page: Page) => Promise<void>;
  /** The tag line under the photo, the module aside (the gallery's section names it). */
  tags: string;
  target: string;
}[] = [
  {
    module: "weight",
    input: "camera",
    files: [{ name: "scale-13-gloves.jpg", width: 3000, height: 2000, label: "Scale" }],
    focus: (frame) => frame.getByRole("textbox", { name: "Weight (g), No. 1", exact: true }).tap(),
    tags: "Size M",
    target: "size:M",
  },
  {
    module: "visual",
    input: "library",
    files: [
      { name: "thin-spot-1.jpg", width: 1600, height: 1200, label: "Thin spot 1" },
      { name: "thin-spot-2.jpg", width: 900, height: 1200, label: "Spot 2" },
    ],
    // The count itself: a tapped + takes no focus on WebKit (checked on its own below).
    focus: (frame) => frame.getByRole("spinbutton", { name: "Thin spot on glove body, Size M", exact: true }).tap(),
    tags: "Size M · Thin spot on glove body",
    target: "size:M/defect:thin_spot",
  },
  {
    module: "dispensing_packing",
    input: "library",
    files: [{ name: "dispenser-box-13.jpg", width: 2400, height: 1800, label: "Box 13" }],
    focus: async (frame, page) => {
      await frame.getByRole("combobox", { name: "Box #, Item 1", exact: true }).tap();
      await page.keyboard.press("Escape");
    },
    tags: "Size M · Box 13",
    target: "size:M/box:13",
  },
  {
    module: "labeling",
    input: "camera",
    files: [{ name: "carton-label-1324.jpg", width: 1024, height: 768, label: "Carton" }],
    focus: async (frame, page) => {
      await frame.getByRole("combobox", { name: "Box # 1, Carton Box, size M", exact: true }).tap();
      await page.keyboard.press("Escape");
    },
    tags: "Size M · Box 1324 · Carton Box",
    target: "size:M/box:1324/level:carton",
  },
];

/** STD_EG's modules (BUILD_SPEC 11), in its order. */
const STD_EG_MODULES = [
  "header",
  "glove_info",
  "order_lots",
  "packing_config",
  "sampling_plan",
  "carton_sampling",
  "dimensions",
  "force_at_break",
  "weight",
  "watertight",
  "visual",
  "dispensing_packing",
  "labeling",
  "conclusion",
];

const LAB_REPORT = { name: "force-at-break-lab-report.pdf", mimeType: "application/pdf", buffer: labReportPdf() };
const DESKTOP = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

let fixture: AcceptanceFixture;
const accounts = sessions();

test.beforeAll(async ({}, testInfo) => {
  await sweepAcceptanceLeftovers();
  fixture = await createAcceptanceFixture(testInfo.project.name);
});

test.afterAll(async () => {
  if (!fixture) return;
  const left = await fixture.cleanup();
  // Nothing of the run is left: no objects, no inspection, no template.
  expect(left).toEqual({ objectsLeft: [], inspectionLeft: false, templateLeft: false });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionFrame(page: Page): Locator {
  return page.locator('[data-slot="section-frame"]');
}

async function formLoaded(page: Page): Promise<void> {
  await expect(sectionFrame(page).getByText("Loading the form…")).toHaveCount(0);
}

/** A section from the iPad's tab bar. */
async function openSection(page: Page, title: string): Promise<Locator> {
  await press(page.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: new RegExp(`^${escapeRegExp(title)}`) }), true);
  await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  await formLoaded(page);
  return sectionFrame(page);
}

function nextTags(frame: Locator): Locator {
  return frame.locator('[data-slot="next-tags"]');
}

/** The thumbnail or full-size image once it has loaded. */
async function naturalSize(image: Locator) {
  await expect(image).toHaveJSProperty("complete", true);
  return image.evaluate((element: HTMLImageElement) => ({ width: element.naturalWidth, height: element.naturalHeight }));
}

/**
 * The inspection's photos in screen order, as the gallery and the export
 * list them: by module in the template's order, then as taken.
 */
async function photosInOrder(inspectionId: string) {
  const rank = (key: string | null) => PLAN.findIndex((plan) => plan.module === key);
  const time = (value: string | null) => (value ? Date.parse(value) : 0);
  return (await photoRows(inspectionId)).sort(
    (a, b) =>
      rank(a.module_key) - rank(b.module_key) ||
      time(a.taken_at) - time(b.taken_at) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

async function expectNoPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(0);
}

test("photos from four modules on the iPad, the export and the AI second opinion on the desktop", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(900_000);
  const hydration = watchConsole(page);
  const capturePath = `/inspections/${fixture.inspectionId}`;

  await test.step("WebKit, the iPad's engine: a defect counted with a tap on + tags the next photo", async () => {
    let engine;
    try {
      engine = await webkit.launch();
    } catch (error) {
      testInfo.annotations.push({ type: "skipped step", description: `WebKit is not installed: ${String(error).split("\n")[0]}` });
      return;
    }
    try {
      const ipad = await engine.newContext({ ...devices["iPad Pro 11"], viewport: page.viewportSize()!, baseURL });
      await accounts.signIn(ipad, baseURL!, "inspector");
      const tab = await ipad.newPage();
      await tab.goto(`${capturePath}?module=visual`);
      await formLoaded(tab);
      const frame = sectionFrame(tab);
      const count = frame.getByRole("spinbutton", { name: "Thin spot on glove body, Size M", exact: true });
      await expect(count).toHaveAttribute("aria-valuenow", "5");
      await frame.getByRole("button", { name: "Increase Thin spot on glove body, Size M", exact: true }).tap();
      await expect(count).toHaveAttribute("aria-valuenow", "6");
      await view(tab, "0-webkit-visual-after-plus");
      // BUILD_SPEC 8.1: tagged with the size and the defect in focus, as a Chromium tap tags it.
      await expect
        .soft(nextTags(frame), "WebKit: the defect just counted with + is what the next photo is tagged with")
        .toHaveText("New photos are tagged Size M · Thin spot on glove body.", { timeout: 5_000 });
      // The count back as the example has it, saved before the iPad's own browser opens the inspection.
      await frame.getByRole("button", { name: "Decrease Thin spot on glove body, Size M", exact: true }).tap();
      await expect(count).toHaveAttribute("aria-valuenow", "5");
      await expect(tab.locator('[data-slot="save-status"]:visible').first()).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
      await ipad.close();
    } finally {
      await engine.close();
    }
    const visual = (await inspectionRow(fixture.inspectionId)).data as { modules: { visual: { sizes: { M: { major: { counts: Record<string, number> } } } } } };
    expect(visual.modules.visual.sizes.M.major.counts.thin_spot).toBe(5);
  });

  await accounts.signIn(context, baseURL!, "inspector");

  await test.step("iPad: photos from the capture screen's file inputs in four modules, each tagged with its focus", async () => {
    await page.goto(`${capturePath}?module=weight`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(fixture.refNo);
    await formLoaded(page);
    for (const [index, plan] of PLAN.entries()) {
      const frame = index === 0 ? sectionFrame(page) : await openSection(page, TITLES[plan.module]);
      await expect(page.getByRole("heading", { level: 2, name: TITLES[plan.module], exact: true })).toBeVisible();
      const slot = frame.locator(`[data-slot="module-photos"][data-module="${plan.module}"]`);
      // The iPad's two buttons (BUILD_SPEC 8.1).
      await expect(slot.getByRole("button", { name: "Take photo" })).toBeVisible();
      await expect(slot.getByRole("button", { name: "Add from library" })).toBeVisible();
      await plan.focus(frame, page);
      await expect(nextTags(frame)).toHaveText(`New photos are tagged ${plan.tags}.`);
      const files = [];
      for (const file of plan.files) files.push(await drawImage(page, { ...file, type: "image/jpeg" }));
      await slot.locator(`input[data-photo-input="${plan.input}"]`).setInputFiles(files);
      const cards = slot.locator('[data-slot="photo-card"]');
      await expect(cards).toHaveCount(plan.files.length);
      for (const card of await cards.all()) await expect(card).toContainText(plan.tags);
      await expect(cards.and(page.locator('[data-upload-state="uploaded"]'))).toHaveCount(plan.files.length, { timeout: 60_000 });
      await slot.scrollIntoViewIfNeeded();
      await slot.screenshot({ path: `screenshots/acceptance/${testInfo.project.name}-1-ipad-${plan.module}-photos.png`, animations: "disabled" });
      await view(page, `1-ipad-${plan.module}`);
    }
  });

  await test.step("iPad: the lab report attached in force at break, kept by the module", async () => {
    const frame = await openSection(page, TITLES.force_at_break);
    await expect(frame.locator('[data-slot="lab-report"]')).toContainText("Not attached");
    const slot = frame.locator('[data-slot="file-slot"][data-module="force_at_break"]');
    await slot.locator("input[data-file-input]").setInputFiles(LAB_REPORT);
    await expect(slot.locator('[data-slot="file-row"][data-upload-state="uploaded"]')).toHaveCount(1, { timeout: 60_000 });
    await expect(frame.locator('[data-slot="lab-report"]')).toContainText("Attached");
    await view(page, "2-ipad-lab-report");
  });

  await test.step("every photo and its thumbnail are in Storage, processed and tagged as taken", async () => {
    await expect(page.locator('[data-slot="upload-badge"]:visible')).toHaveCount(0, { timeout: 90_000 });
    const expected = PLAN.flatMap((plan) => plan.files.map(() => ({ module_key: plan.module, target: plan.target })));
    await expect.poll(async () => (await photoRows(fixture.inspectionId)).length, { timeout: 60_000 }).toBe(expected.length);
    const rows = await photosInOrder(fixture.inspectionId);
    expect(rows.map(({ module_key, target }) => ({ module_key, target }))).toEqual(expected);
    for (const row of rows) {
      expect(row).toMatchObject({ flagged: false, include_in_report: false, created_by: fixture.inspectorId });
      expect(row.taken_at).not.toBeNull();
      expect(Math.max(row.width ?? 0, row.height ?? 0)).toBeLessThanOrEqual(2048);
      expect(row.storage_path).toBe(`${fixture.inspectionId}/${row.id}.jpg`);
      expect(row.thumb_path).toBe(`${fixture.inspectionId}/thumbs/${row.id}.jpg`);
    }
    // The 3000 px camera photo came down to 2048 px on its long edge (BUILD_SPEC 8.1).
    expect(rows.find((row) => row.module_key === "weight")).toMatchObject({ width: 2048, height: 1365 });
    const files = await fileRows(fixture.inspectionId);
    expect(files).toEqual([
      expect.objectContaining({ module_key: "force_at_break", kind: "lab_report", name: LAB_REPORT.name, created_by: fixture.inspectorId }),
    ]);
    const objects = (await inspectionObjects(fixture.inspectionId)).map((object) => `${object.bucket}/${object.path}`).sort();
    expect(objects).toEqual(
      [
        ...rows.flatMap((row) => [`inspection-photos/${row.storage_path}`, `inspection-photos/${row.thumb_path}`]),
        `inspection-files/${files[0].storage_path}`,
      ].sort(),
    );
    const stored = (await inspectionRow(fixture.inspectionId)).data as { modules: { force_at_break: { labReport: string | null } } };
    expect(stored.modules.force_at_break.labReport).toBe(files[0].id);
  });

  await test.step("iPad: submit, with nothing left to upload", async () => {
    await press(page.getByRole("button", { name: "Submit", exact: true }), true);
    const dialog = page.getByRole("alertdialog", { name: `Submit ${fixture.refNo} for review?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Submit for review" })).toBeEnabled({ timeout: 30_000 });
    await view(page, "3-ipad-submit");
    await press(dialog.getByRole("button", { name: "Submit for review" }), true);
    await expect(page).toHaveURL(new RegExp(`/inspections/${fixture.inspectionId}/review$`), { timeout: 60_000 });
    const row = await inspectionRow(fixture.inspectionId);
    expect(row).toMatchObject({ status: "submitted", result: "pass", remarks: WORDS.remark });
  });

  const photos = (await photosInOrder(fixture.inspectionId)).map((row) => {
    const plan = PLAN.find((entry) => entry.module === row.module_key)!;
    return { id: row.id, module: plan.module, title: TITLES[plan.module], tags: plan.tags };
  });

  const desktop: BrowserContext = await browser.newContext({ ...DESKTOP, baseURL });
  try {
    const screen = await desktop.newPage();
    const desktopHydration = watchConsole(screen);

    await test.step("desktop, the inspector: the gallery shows every photo in its module with its tags, read-only", async () => {
      await accounts.signIn(desktop, baseURL!, "inspector");
      await screen.goto(`${capturePath}/photos`);
      await expect(screen.getByRole("heading", { level: 1, name: "Photos and files" })).toBeVisible();
      await expect(screen.getByText(/This inspection has been submitted/)).toBeVisible();
      await expect(screen.getByRole("heading", { name: "Add photos", exact: true })).toHaveCount(0);
      for (const key of ["weight", "visual", "dispensing_packing", "labeling"] as const) {
        const group = screen.locator(`[data-group="${key}"]`);
        await expect(group.getByRole("heading", { name: TITLES[key], exact: true })).toBeVisible();
        await expect(group.locator('[data-slot="photo-card"]')).toHaveCount(photos.filter((photo) => photo.module === key).length);
      }
      for (const photo of photos) {
        const card = screen.locator(`[data-group="${photo.module}"] [data-photo-id="${photo.id}"]`);
        await expect(card.locator("figcaption p").first()).toHaveText(photo.tags);
        await expect(card.getByRole("button", { name: /^(Edit tags and caption|Delete photo)/ })).toHaveCount(0);
        const thumb = card.locator("img");
        await expect(thumb).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/inspection-photos\/.+\/thumbs\//);
        const size = await naturalSize(thumb);
        expect(Math.max(size.width, size.height)).toBe(400);
      }
      await expect(screen.locator('[data-slot="file-slot"][data-module="force_at_break"]')).toContainText(LAB_REPORT.name);
      await expectNoPageScroll(screen);
      await shot(screen, "4-desktop-gallery-inspector", false);

      // Full size, the arrow keys walking every module's photos in screen order.
      await screen.locator(`[data-photo-id="${photos[0].id}"]`).getByRole("button", { name: /^Open photo/ }).click();
      const viewer = screen.locator('[data-slot="photo-viewer"]');
      for (const [index, photo] of photos.entries()) {
        await expect(viewer).toContainText(`Photo ${index + 1} of ${photos.length}`);
        await expect(viewer.getByRole("heading")).toHaveText(`${photo.title} · ${photo.tags}`);
        if (index === 0) {
          expect((await naturalSize(viewer.locator("img"))).width).toBe(2048);
          await view(screen, "5-desktop-viewer");
        }
        if (index < photos.length - 1) await screen.keyboard.press("ArrowRight");
      }
      await screen.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
    });

    await test.step("desktop, the admin: every photo chosen for the report in the gallery", async () => {
      await accounts.signIn(desktop, baseURL!, "admin");
      await screen.goto(`${capturePath}/photos`);
      for (const photo of photos) {
        const card = screen.locator(`[data-photo-id="${photo.id}"]`);
        await card.getByRole("switch").click();
        await expect(card.getByText("In report", { exact: true })).toBeVisible();
      }
      await expect
        .poll(async () => (await photoRows(fixture.inspectionId)).every((row) => row.include_in_report))
        .toBe(true);
      await shot(screen, "6-desktop-gallery-admin", false);
    });

    await test.step("desktop, the admin: the review shows the report photos with their module and tags", async () => {
      await screen.goto(`${capturePath}/review`);
      await expect(screen.getByRole("heading", { level: 1, name: fixture.refNo })).toBeVisible();
      await expect(screen.getByText(`${photos.length} of ${photos.length} photos marked for the report.`)).toBeVisible();
      for (const photo of photos) {
        const tile = screen.locator(`[data-photo="${photo.id}"]`);
        await expect(tile).toBeVisible();
        // The same tags the gallery shows, after the module's title.
        await expect.soft(tile.locator("figcaption p").first(), `review tags of the ${photo.module} photo`).toHaveText(`${photo.title} · ${photo.tags}`);
        const thumb = await naturalSize(tile.locator("img"));
        expect(Math.max(thumb.width, thumb.height)).toBe(400);
        const full = await desktop.request.get((await tile.locator("a").getAttribute("href"))!);
        expect(full.status()).toBe(200);
        expect(full.headers()["content-type"]).toContain("image/jpeg");
      }
      await expectNoPageScroll(screen);
      await shot(screen, "7-desktop-review-photos", false);
      await screen
        .locator("ul")
        .filter({ has: screen.locator("[data-photo]") })
        .screenshot({ path: `screenshots/acceptance/${testInfo.project.name}-7-desktop-review-report-photos.png`, animations: "disabled" });
    });

    let doc: InspectionExport | undefined;
    await test.step("the export validates and holds every field of the STD_EG report", async () => {
      const response = await desktop.request.get(`/api/inspections/${fixture.inspectionId}/export`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-disposition"]).toBe(`attachment; filename="${fixture.refNo}-export.json"`);
      const body = await response.json();
      await testInfo.attach("export.json", { body: JSON.stringify(body, null, 2), contentType: "application/json" });
      await mkdir("screenshots/acceptance", { recursive: true });
      await writeFile(`screenshots/acceptance/${testInfo.project.name}-export.json`, JSON.stringify(body, null, 2));
      const parsed = ExportSchema.safeParse(body);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))).toBe(true);
      if (!parsed.success) return;
      doc = parsed.data;

      const row = await inspectionRow(fixture.inspectionId);
      expect(doc).toMatchObject({ refNo: fixture.refNo, status: "submitted", inspector: { id: fixture.inspectorId } });
      expect(doc.template).toMatchObject({
        code: fixture.templateCode,
        version: 1,
        standard: "EN455",
        productType: "examination",
        client: { id: SEED.polyco.id, name: SEED.polyco.name },
        manufacturer: { id: SEED.terangNusa.id },
      });
      expect(doc.modules.map((module) => module.key)).toEqual(STD_EG_MODULES);
      expect(doc.excludedModules).toEqual([]);
      expect(doc.custom).toEqual([expect.objectContaining({ key: "glove_type", values: { gloveType: WORDS.gloveType } })]);
      for (const [key, comment] of Object.entries(WORDS.comments)) {
        expect(doc.modules.find((module) => module.key === key)?.comment).toBe(comment);
      }
      expect(doc.conclusion).toMatchObject({
        suggestedResult: row.suggested_result,
        finalResult: "pass",
        remark: WORDS.remark,
        inspector: { id: fixture.inspectorId },
      });
      // Submit is blocked while errors exist: none in a submitted export.
      for (const entry of doc.modules) expect(entry.errors ?? [], `${entry.key} errors`).toEqual([]);

      // Every target of every field of the STD_EG report (lib/coverage/sources.ts).
      const coverage = exportCoverage(doc, "report_STD_EG");
      await testInfo.attach("coverage.json", { body: JSON.stringify(coverage, null, 2), contentType: "application/json" });
      await writeFile(`screenshots/acceptance/${testInfo.project.name}-coverage.json`, JSON.stringify(coverage, null, 2));
      expect(coverage.fields).toBeGreaterThan(100);
      expect.soft(coverage.gaps, "fields of the STD_EG report the export does not carry").toEqual([]);
      // Filled in: only the description of an "Other" hole, with no such hole, is empty.
      expect.soft(coverage.empty.map((entry) => entry.target)).toEqual(["watertight.otherDescription"]);
    });

    await test.step("the export links every photo and the lab report with working 24-hour signed URLs", async () => {
      if (!doc) throw new Error("No export to check.");
      const stored = await photoRows(fixture.inspectionId);
      // In screen order: by module in the template's order, then as taken.
      expect(doc.photos.map((photo) => photo.moduleKey)).toEqual(photos.map((photo) => photo.module));
      expect(doc.photos.map((photo) => photo.id).sort()).toEqual(photos.map((photo) => photo.id).sort());
      for (const photo of doc.photos) {
        const row = stored.find((entry) => entry.id === photo.id)!;
        expect(photo).toMatchObject({ moduleKey: row.module_key, target: row.target, includeInReport: true, flagged: false });
        expect(photo.takenAt).not.toBeNull();
        const image = await desktop.request.get(photo.url);
        expect(image.status()).toBe(200);
        expect(image.headers()["content-type"]).toContain("image/jpeg");
        expect((await image.body()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
        const token = new URL(photo.url).searchParams.get("token") ?? "";
        const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
        expect(claims.exp - claims.iat).toBe(24 * 60 * 60);
      }
      const forceAtBreak = doc.modules.find((module) => module.key === "force_at_break")!;
      expect(forceAtBreak.computed).toMatchObject({ labReportAttached: true });
      expect(doc.files).toEqual([
        expect.objectContaining({ id: forceAtBreak.data.labReport, moduleKey: "force_at_break", kind: "lab_report", name: LAB_REPORT.name }),
      ]);
      const pdf = await desktop.request.get(doc.files[0].url);
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).equals(LAB_REPORT.buffer), "the lab report is the file the inspector attached").toBe(true);
    });

    await test.step("desktop, the admin: the AI second opinion's mock findings beside the system's and the inspector's results", async () => {
      if (!doc) throw new Error("No export to check.");
      const exported = doc;
      await screen.goto(`${capturePath}/review`);
      const panel = screen.getByTestId("ai-panel");
      await expect(panel.getByRole("heading", { level: 2, name: "AI second opinion" })).toBeVisible();
      await expect(panel.getByTestId("ai-review-not-connected"), "the server runs the mock reviewer").toHaveCount(0);
      await press(panel.getByRole("button", { name: "Request AI second opinion" }), false);
      const comparison = panel.getByTestId("ai-comparison");
      await expect(comparison).toBeVisible({ timeout: 90_000 });
      await expect(panel.getByTestId("ai-review-meta")).toContainText("Mock reviewer (test data only)");

      // The three columns of BUILD_SPEC 9.2, under one heading row at this width.
      for (const title of ["System (computed)", "Inspector", "AI second opinion"]) {
        await expect(comparison.getByText(title, { exact: true }).first()).toBeVisible();
      }

      const overall = comparison.locator("section[data-section$='-overall']");
      await expect(overall).toContainText("Suggested result");
      await expect(overall).toContainText("Final result");
      await expect(overall).toContainText(WORDS.remark);
      await expect(overall).toContainText("Mock second opinion (test data, no AI model).");

      // A finding for every module the export does not pass, in that module's row, beside its results.
      const attention = exported.modules.filter((module) => ["fail", "warn", "not_done"].includes(module.result.status));
      expect(attention.map((module) => module.key)).toContain("weight");
      await expect(comparison.locator("article[data-finding]")).toHaveCount(attention.length);
      for (const section of attention) {
        const row = comparison.locator(`section[data-section$='-${section.key}']`);
        const cells = row.locator(":scope > div > div");
        await expect(cells).toHaveCount(3);
        await expect(cells.nth(0)).toContainText(STATUS_LABEL[section.result.status]);
        if (section.comment) await expect(cells.nth(1)).toContainText(section.comment);
        await expect(cells.nth(2).locator("article[data-finding]")).toContainText(section.title);
        // Side by side: one line, left to right.
        const [system, inspector, ai] = await Promise.all([0, 1, 2].map((index) => cells.nth(index).boundingBox()));
        expect(Math.abs(system!.y - inspector!.y)).toBeLessThan(4);
        expect(Math.abs(inspector!.y - ai!.y)).toBeLessThan(4);
        expect(system!.x).toBeLessThan(inspector!.x);
        expect(inspector!.x).toBeLessThan(ai!.x);
      }

      // The weight finding cites the scale photo, which opens.
      const weight = comparison.locator("section[data-section$='-weight']");
      await expect(weight).toContainText(WORDS.comments.weight);
      const scale = photos.find((photo) => photo.module === "weight")!;
      const evidence = weight.locator(`a[href*="${scale.id}"]`).first();
      await expect(evidence).toBeVisible();
      await expect(evidence.locator("img")).toHaveJSProperty("complete", true);
      // What the admin sees at 1440 x 900, the toast gone: the panel from its heading down.
      await expect(screen.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
      await shot(screen, "8-desktop-ai-panel", false);
      await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await view(screen, "8-desktop-ai-panel-view");

      const { data: reviews } = await createTestAdminClient()
        .from("ai_reviews")
        .select("status, model, suggested_result")
        .eq("inspection_id", fixture.inspectionId);
      expect(reviews).toEqual([expect.objectContaining({ status: "done", model: "mock" })]);
      await expect(overall).toContainText(STATUS_LABEL[reviews![0].suggested_result as keyof typeof STATUS_LABEL]);
    });

    expect.soft(desktopHydration()).toEqual([]);
  } finally {
    await desktop.close();
  }
  expect.soft(hydration()).toEqual([]);
});
