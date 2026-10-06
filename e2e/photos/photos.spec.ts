import { expect as baseExpect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import { signIn, TEST_ACCOUNTS, TEST_PASSWORD } from "../support/session";
import {
  createOtherInspector,
  createPhotosFixture,
  downloadObject,
  fileRows,
  listObjects,
  photoRows,
  setInspectionStatus,
  sweepPhotosFixtures,
  type PhotosFixture,
} from "./fixtures";
import {
  drawImage,
  expectNoPageScroll,
  expectTouchTarget,
  holdUploads,
  isTouch,
  labReportPdf,
  press,
  shot,
  undecodableHeic,
  viewportShot,
  watchConsole,
  withGpsExif,
} from "./support";
import { THIN_SPOT_LABEL, TITLES } from "./template";

/**
 * Photos and files (BUILD_SPEC 8.1) against the live project, at the three
 * sizes in playwright.config.ts, through the gallery at
 * /inspections/[id]/photos: real images drawn by the browser go in through
 * the file inputs, are processed and queued on the device, upload to
 * Storage, and are retagged, captioned, viewed and deleted. Screenshots go
 * to screenshots/photos/. The tests share one inspection per project and
 * run in order.
 */

// The Mac running these is shared with other builds: generous waits, never sleeps.
const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ mode: "serial", timeout: 180_000 });

let fixture: PhotosFixture;

test.beforeAll(async () => {
  await sweepPhotosFixtures();
  fixture = await createPhotosFixture();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

const galleryPath = () => `/inspections/${fixture.inspectionId}/photos`;
const isDesktop = () => test.info().project.name === "desktop";

function addCard(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Add photos", exact: true }) });
}

function group(page: Page, key: string) {
  return page.locator(`[data-group="${key}"]`);
}

async function chooseOption(page: Page, combobox: ReturnType<Page["getByRole"]>, option: string) {
  await press(combobox);
  await press(page.getByRole("option", { name: option, exact: true }));
  await expect(combobox).toContainText(option);
}

/** The natural size of an image element once it has loaded. */
async function loadedSize(page: Page, selector: ReturnType<Page["locator"]>) {
  await expect(selector).toHaveJSProperty("complete", true);
  return selector.evaluate((img: HTMLImageElement) => ({ width: img.naturalWidth, height: img.naturalHeight }));
}

test("the inspector adds photos and a lab report, then retags, captions, views and deletes them", async ({
  page,
  context,
  baseURL,
}) => {
  const hydration = watchConsole(page);
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto(galleryPath());

  await test.step("an empty gallery offers to add photos", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Photos and files" })).toBeVisible();
    await expect(page.getByText(fixture.refNo, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No photos yet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lab reports and certificates" })).toBeVisible();
    await expect(page).toHaveTitle(`Photos · ${fixture.refNo} · SteriCare QC`);
    if (isTouch()) {
      // The iPad's two buttons (BUILD_SPEC 8.1), as 44 px targets.
      await expect(addCard(page).getByRole("button", { name: "Take photo" })).toBeVisible();
      await expectTouchTarget(addCard(page).getByRole("button", { name: "Add from library" }));
      await expect(addCard(page).getByRole("button", { name: /^Choose photos/ })).toBeHidden();
    } else {
      await expect(addCard(page).getByText(/Drop photos here, several at once/)).toBeVisible();
      await expect(addCard(page).getByRole("button", { name: "Take photo" })).toBeHidden();
    }
    await expect(addCard(page).locator('input[data-photo-input="camera"]')).toHaveAttribute("capture", "environment");
    await expect(addCard(page).locator('input[data-photo-input="library"]')).toHaveAttribute("multiple", "");
    await expectNoPageScroll(page);
    await shot(page, "1-empty");
  });

  const jpeg = await drawImage(page, { name: "glove-length.jpg", type: "image/jpeg", width: 3000, height: 2000, label: "Length" });
  const png = await drawImage(page, { name: "glove-palm.png", type: "image/png", width: 800, height: 600, label: "Palm" });
  const dimensions = group(page, "dimensions");

  await test.step("two photos wait on the device, with a badge, then upload", async () => {
    await chooseOption(page, addCard(page).getByRole("combobox", { name: "Module" }), TITLES.dimensions);
    const held = await holdUploads(page, "inspection-photos");
    // A camera JPEG still carrying its GPS position, and a PNG from the library.
    await addCard(page)
      .locator('input[data-photo-input="library"]')
      .setInputFiles([{ ...jpeg, buffer: withGpsExif(jpeg.buffer) }, png]);

    await expect(dimensions.getByRole("heading", { name: TITLES.dimensions })).toBeVisible();
    await expect(dimensions.locator('[data-slot="photo-card"]')).toHaveCount(2);
    await expect(page.locator('[data-slot="upload-badge"]')).toHaveAttribute("data-count", "2");
    await expect(dimensions.getByText(/Waiting to upload|Uploading/).first()).toBeVisible();
    await expect(dimensions.getByText("2 photos, 2 not uploaded yet")).toBeVisible();
    await shot(page, "2-waiting");

    await held.release();
    await expect(dimensions.locator('[data-slot="photo-card"][data-upload-state="uploaded"]')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('[data-slot="upload-badge"]')).toHaveCount(0);
    await expect(dimensions.getByText("Uploaded", { exact: true })).toHaveCount(2);
  });

  await test.step("processing resized, re-encoded and stripped them; rows and thumbnails are in", async () => {
    const rows = await photoRows(fixture.inspectionId);
    expect(rows).toHaveLength(2);
    const [big, small] = rows;
    expect(big).toMatchObject({ module_key: "dimensions", target: null, width: 2048, height: 1365, flagged: false });
    expect(small).toMatchObject({ module_key: "dimensions", target: null, width: 800, height: 600, flagged: false });
    for (const row of rows) {
      expect(row.created_by).toBe(fixture.inspectorId);
      expect(row.include_in_report).toBe(false);
      expect(row.storage_path).toBe(`${fixture.inspectionId}/${row.id}.jpg`);
      expect(row.thumb_path).toBe(`${fixture.inspectionId}/thumbs/${row.id}.jpg`);
    }
    const stored = await downloadObject("inspection-photos", big.storage_path);
    expect(stored.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(stored.includes(Buffer.from("Exif", "latin1")), "no Exif (and so no GPS) in the upload").toBe(false);
  });

  await test.step("a lab report goes up as it is", async () => {
    const slot = page.locator('[data-slot="file-slot"][data-module="force_at_break"]');
    await expect(slot.getByRole("heading", { name: TITLES.force_at_break })).toBeVisible();
    await slot.locator("input[data-file-input]").setInputFiles({
      name: "force-at-break-report.pdf",
      mimeType: "application/pdf",
      buffer: labReportPdf(),
    });
    await expect(slot.locator('[data-slot="file-row"][data-upload-state="uploaded"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(slot.getByRole("link", { name: /^Open force-at-break-report\.pdf/ })).toHaveAttribute("href", /\/storage\/v1\/object\/sign\/inspection-files\//);
    const files = await fileRows(fixture.inspectionId);
    expect(files).toEqual([
      expect.objectContaining({ module_key: "force_at_break", kind: "lab_report", name: "force-at-break-report.pdf" }),
    ]);
    const pdf = await downloadObject("inspection-files", files[0].storage_path);
    expect(pdf.equals(labReportPdf()), "the file is stored byte for byte").toBe(true);
    await shot(page, "3-uploaded");
  });

  const [bigId, smallId] = (await photoRows(fixture.inspectionId)).map((row) => row.id);

  await test.step("retag and caption: the photo moves to Visual Inspection with its size and defect", async () => {
    const card = dimensions.locator(`[data-photo-id="${bigId}"]`);
    await press(card.getByRole("button", { name: /^Edit tags and caption/ }));
    const dialog = page.getByRole("dialog", { name: /^Edit photo/ });
    await expect(dialog).toBeVisible();
    await chooseOption(page, dialog.getByRole("combobox", { name: "Module" }), TITLES.visual);
    await chooseOption(page, dialog.getByRole("combobox", { name: "Size" }), "M");
    await chooseOption(page, dialog.getByRole("combobox", { name: "Defect" }), THIN_SPOT_LABEL);
    await dialog.getByRole("textbox", { name: "Caption" }).fill("Thin spot near the palm, second glove");
    await expectTouchTarget(dialog.getByRole("combobox", { name: "Module" }));
    await expectTouchTarget(dialog.getByRole("button", { name: "Save" }));
    await viewportShot(page, "4-edit-dialog");
    await press(dialog.getByRole("button", { name: "Save" }));
    await expect(dialog).toBeHidden();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Photo updated." })).toBeVisible();

    const moved = group(page, "visual").locator(`[data-photo-id="${bigId}"]`);
    await expect(moved).toContainText(`Size M · ${THIN_SPOT_LABEL}`);
    await expect(moved).toContainText("Thin spot near the palm, second glove");
    await expect(dimensions.locator('[data-slot="photo-card"]')).toHaveCount(1);
    const row = (await photoRows(fixture.inspectionId)).find((photo) => photo.id === bigId);
    expect(row).toMatchObject({ module_key: "visual", target: "size:M/defect:thin_spot", caption: "Thin spot near the palm, second glove" });
  });

  await test.step("full size, stepping through every module's photos", async () => {
    await press(group(page, "visual").locator(`[data-photo-id="${bigId}"]`).getByRole("button", { name: /^Open photo/ }));
    const viewer = page.locator('[data-slot="photo-viewer"]');
    await expect(viewer).toContainText("Photo 2 of 2");
    await expect(viewer.getByRole("heading")).toHaveText(`${TITLES.visual} · Size M · ${THIN_SPOT_LABEL}`);
    const full = await loadedSize(page, viewer.locator("img"));
    expect(full.width).toBe(2048);
    await viewportShot(page, "5-viewer");
    if (isTouch()) {
      await expectTouchTarget(viewer.getByRole("button", { name: "Next photo" }));
      await press(viewer.getByRole("button", { name: "Next photo" }));
    } else {
      await page.keyboard.press("ArrowRight");
    }
    await expect(viewer).toContainText("Photo 1 of 2");
    await expect(viewer.getByRole("heading")).toHaveText(TITLES.dimensions);
    if (!isTouch()) {
      await page.keyboard.press("ArrowLeft");
      await expect(viewer).toContainText("Photo 2 of 2");
    }
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
  });

  await test.step("delete: the row and both objects go", async () => {
    const card = dimensions.locator(`[data-photo-id="${smallId}"]`);
    await press(card.getByRole("button", { name: /^Delete photo/ }));
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Delete this photo?");
    await viewportShot(page, "6-delete-dialog");
    await press(confirm.getByRole("button", { name: "Delete photo" }));
    await expect(confirm).toBeHidden();
    await expect(page.locator(`[data-photo-id="${smallId}"]`)).toHaveCount(0);
    await expect(dimensions).toHaveCount(0);
    expect((await photoRows(fixture.inspectionId)).map((row) => row.id)).toEqual([bigId]);
    const objects = (await listObjects(fixture.inspectionId)).map((object) => object.path);
    expect(objects.filter((path) => path.includes(smallId))).toEqual([]);
    expect(objects.filter((path) => path.includes(bigId))).toHaveLength(2);
  });

  await test.step("after a reload the thumbnails come from Storage", async () => {
    await page.reload();
    const tile = group(page, "visual").locator(`[data-photo-id="${bigId}"] img`);
    await expect(tile).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/inspection-photos\/.+\/thumbs\//);
    const thumb = await loadedSize(page, tile);
    expect(Math.max(thumb.width, thumb.height)).toBe(400);
    await expectNoPageScroll(page);
    await shot(page, "7-after-reload");
  });

  expect(hydration()).toEqual([]);
});

test("offline, photos wait on the device and upload when the connection is back", async ({ page, context, baseURL }) => {
  test.skip(!isDesktop(), "Once is enough: the queue is the same on every device.");
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto(galleryPath());
  await expect(page.getByRole("heading", { level: 1, name: "Photos and files" })).toBeVisible();
  await chooseOption(page, addCard(page).getByRole("combobox", { name: "Module" }), TITLES.watertight);

  await context.setOffline(true);
  // An HEIC this browser cannot decode: kept as the original and flagged.
  await addCard(page)
    .locator('input[data-photo-input="library"]')
    .setInputFiles({ name: "IMG_0042.HEIC", mimeType: "image/heic", buffer: undecodableHeic() });
  const watertight = group(page, "watertight");
  await expect(watertight.locator('[data-slot="photo-card"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="upload-notice"]').filter({ hasText: "Offline" })).toBeVisible();
  await expect(page.locator('[data-slot="upload-badge"]')).toHaveAttribute("data-count", "1");
  await shot(page, "8-offline");

  await context.setOffline(false);
  await expect(watertight.locator('[data-slot="photo-card"][data-upload-state="uploaded"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(watertight.getByText("Needs conversion")).toBeVisible();
  await expect(page.locator('[data-slot="upload-notice"]')).toHaveCount(0);
  const flagged = (await photoRows(fixture.inspectionId)).find((row) => row.module_key === "watertight");
  expect(flagged).toMatchObject({ flagged: true, thumb_path: null, width: null, height: null });
  expect(flagged?.storage_path).toMatch(/\.heic$/);
  await shot(page, "9-flagged");
});

test("the admin chooses report photos", async ({ page, context, baseURL }) => {
  test.skip(!isDesktop(), "Admin review happens on the desktop.");
  const [photo] = (await photoRows(fixture.inspectionId)).filter((row) => row.module_key === "visual");
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  await page.goto(galleryPath());
  const card = group(page, "visual").locator(`[data-photo-id="${photo.id}"]`);
  const include = card.getByRole("switch");
  await expect(include).not.toBeChecked();
  await include.click();
  await expect(card.getByText("In report", { exact: true })).toBeVisible();
  await expect.poll(async () => (await photoRows(fixture.inspectionId)).find((row) => row.id === photo.id)?.include_in_report).toBe(true);
  await shot(page, "10-admin");

  // The viewer carries the same switch, for choosing while looking.
  await card.getByRole("button", { name: /^Open photo/ }).click();
  const viewer = page.locator('[data-slot="photo-viewer"]');
  await expect(viewer.getByRole("switch", { name: "Include in report" })).toBeChecked();
  await viewportShot(page, "11-admin-viewer");
  await page.keyboard.press("Escape");
});

test("once submitted, the inspector sees the photos read-only", async ({ page, context, baseURL }) => {
  test.skip(!isDesktop(), "The rights are the same on every device.");
  await setInspectionStatus(fixture.inspectionId, "submitted");
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto(galleryPath());
  await expect(page.getByText(/This inspection has been submitted/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add photos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Edit tags and caption|Delete photo)/ })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(group(page, "visual").getByText("In report", { exact: true })).toBeVisible();
  const slot = page.locator('[data-slot="file-slot"][data-module="force_at_break"]');
  await expect(slot.locator("input[data-file-input]")).toHaveCount(0);
  await expect(slot.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await shot(page, "12-submitted");
});

test("an inspector cannot see or change another inspector's photos", async ({ page, context, browser, baseURL }) => {
  test.skip(!isDesktop(), "The rights are the same on every device.");
  await page.goto("/login");
  const jpeg = await drawImage(page, { name: "other.jpg", type: "image/jpeg", width: 400, height: 300, label: "Other" });
  const other = await createOtherInspector(fixture, jpeg.buffer);
  try {
    await test.step("the gallery of their inspection is a 404", async () => {
      await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
      await page.goto(`/inspections/${other.inspectionId}/photos`);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.getByText("Another inspector's photo")).toHaveCount(0);
      await shot(page, "13-other-inspector");
    });

    await test.step("their photo cannot be read, changed or deleted through the API", async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const inspector = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await inspector.auth.signInWithPassword({ email: TEST_ACCOUNTS.inspector, password: TEST_PASSWORD });
      expect(signedIn.error).toBeNull();

      const read = await inspector.from("inspection_photos").select("id").eq("id", other.photoId);
      expect(read.data).toEqual([]);
      const changed = await inspector.from("inspection_photos").update({ caption: "Changed" }).eq("id", other.photoId).select("id");
      expect(changed.data ?? []).toEqual([]);
      const deleted = await inspector.from("inspection_photos").delete().eq("id", other.photoId).select("id");
      expect(deleted.data ?? []).toEqual([]);
      const added = await inspector.from("inspection_photos").insert({
        inspection_id: other.inspectionId,
        storage_path: `${other.inspectionId}/00000000-0000-4000-8000-000000000001.jpg`,
      });
      expect(added.error).not.toBeNull();
      const removed = await inspector.storage.from("inspection-photos").remove([other.storagePath, other.thumbPath]);
      expect(removed.data ?? []).toEqual([]);
      const signedUrl = await inspector.storage.from("inspection-photos").createSignedUrl(other.storagePath, 60);
      expect(signedUrl.error).not.toBeNull();
      const upload = await inspector.storage
        .from("inspection-photos")
        .upload(`${other.inspectionId}/00000000-0000-4000-8000-000000000002.jpg`, jpeg.buffer, { contentType: "image/jpeg" });
      expect(upload.error).not.toBeNull();
      await inspector.auth.signOut();

      const rows = await photoRows(other.inspectionId);
      expect(rows).toEqual([expect.objectContaining({ id: other.photoId, caption: "Another inspector's photo" })]);
      expect((await listObjects(other.inspectionId)).map((object) => object.path).sort()).toEqual(
        [other.storagePath, other.thumbPath].sort(),
      );
    });

    await test.step("their own account sees it", async () => {
      const theirs = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
      try {
        await signIn(theirs, baseURL!, other.account.email, other.account.password);
        const theirPage = await theirs.newPage();
        await theirPage.goto(`/inspections/${other.inspectionId}/photos`);
        await expect(theirPage.locator(`[data-photo-id="${other.photoId}"]`)).toContainText("Another inspector's photo");
      } finally {
        await theirs.close();
      }
    });
  } finally {
    await other.cleanup();
  }
});
