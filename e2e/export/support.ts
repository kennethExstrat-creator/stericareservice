import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { stdEgInspectionData } from "../../lib/export/__fixtures__/std-eg";
import { TemplateDefinitionSchema } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { STD_EG_SEED } from "../../lib/templates/definitions";
import { resolveTemplate } from "../../modules";
import { createTestAdminClient, deleteTestInspection, throwawayEmail } from "../support/admin";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";

/* ------------------------------------------------------------------ *
 * Temporary rows for the export and AI panel specs, created with the
 * secret key and deleted afterwards (e2e/README.md): a draft template
 * nobody can start from (code E2E_EXPORT_*), one submitted inspection of
 * the test inspector that uses it, two photos and a lab report in
 * Storage. Teardown removes the Storage objects, then the inspection
 * (its AI reviews, decisions and audit rows go with it), then the
 * template. A run that died half way is cleaned up by the next.
 *
 * The inspection is the STD_EG example report (tests/fixtures/examples)
 * in the real modules' data shapes (lib/export/__fixtures__/std-eg.ts),
 * on a copy of the STD_EG seed template resolved against the modules as
 * they are at run time. Submitted on hold: the weight warning is open,
 * the labelling check was not done, dimensions were switched off for it,
 * and the force-at-break lab report is attached. So the mock reviewer has
 * three findings to make, and the export carries real module data.
 * ------------------------------------------------------------------ */

type AdminClient = ReturnType<typeof createTestAdminClient>;

/** Reference rows from supabase/seed.sql, which uses fixed ids. */
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  terangNusa: "10000000-0000-4000-8000-000000000002",
} as const;

const PHOTO_BUCKET = "inspection-photos";
const FILE_BUCKET = "inspection-files";

export const EXCLUDED_MODULE = "dimensions";
export const EXCLUDED_REASON = "Calipers out for calibration; measured at the lab instead.";
export const GLOVE_INFO_COMMENT = "Indicative weight from the glove spec sheet.";
export const VISUAL_COMMENT = "Two thin spots on the body, photographed.";
export const GLOVE_TYPE = "Nitrile, powder free";

/** Modules STD_EG includes, in its order, without the one switched off for the fixture. */
export const FIXTURE_MODULES = [
  "header",
  "glove_info",
  "order_lots",
  "packing_config",
  "sampling_plan",
  "carton_sampling",
  "force_at_break",
  "weight",
  "watertight",
  "visual",
  "dispensing_packing",
  "labeling",
  "conclusion",
] as const;

/**
 * Where the AI panel is rendered: the review screen, /inspections/{id}/review.
 * E2E_AI_PANEL_PATH points the specs at another page that renders it,
 * e.g. E2E_AI_PANEL_PATH=/some-page/{id}.
 */
export function panelPath(inspectionId: string): string {
  const pattern = process.env.E2E_AI_PANEL_PATH?.trim() || "/inspections/{id}/review";
  return pattern.replace("{id}", inspectionId);
}

/** "mock" (default): the dev server runs AI_REVIEW_PROVIDER=mock. "off": nothing is connected. */
export function expectedAiMode(): "mock" | "off" {
  return process.env.E2E_EXPORT_AI?.trim() === "off" ? "off" : "mock";
}

/** A photo a spec adds to the fixture, tagged as capture would tag it. */
export type ExtraPhoto = {
  moduleKey: string;
  /** e.g. `size:M/box:1324/level:carton`. */
  target: string | null;
  caption: string | null;
  includeInReport: boolean;
};

export type ExportFixture = {
  inspectionId: string;
  refNo: string;
  inspectorId: string;
  adminId: string;
  /** `scale`: a report photo of the weight module, which the mock reviewer cites with its weight finding. */
  photoIds: { scale: string; untagged: string };
  /** The ids of the spec's own photos, in the order given. */
  extraPhotoIds: string[];
  /** The force-at-break lab report, kept by id in that module's data. */
  fileId: string;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Export fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** The example's header with values that say whose rows these are in the shared database. */
const FIXTURE_HEADER = {
  poNo: "E2E-EXPORT-PO-0001",
  productName: "E2E nitrile examination gloves, blue",
  inspectionDate: "2025-04-11",
} as const;
const FIXTURE_LOT = "E2E-LOT-M-0001";

/**
 * The STD_EG example's data with the fixture's story: the carton errors
 * fixed, the lab report kept by force at break, comments on glove
 * information and visual, labelling not entered, and the inspector's final
 * result hold with no remark.
 */
function fixtureData(labReportFileId: string) {
  const data = stdEgInspectionData({
    labReportFileId,
    comments: { glove_info: GLOVE_INFO_COMMENT, visual: VISUAL_COMMENT },
  });
  const modules = { ...data.modules } as Record<string, Record<string, unknown>>;
  modules.header = { ...modules.header, ...FIXTURE_HEADER };
  const order = modules.order_lots as { sizes: Record<string, { lotNumbers: string[] }> };
  modules.order_lots = { sizes: { M: { ...order.sizes.M, lotNumbers: [FIXTURE_LOT] } } };
  delete modules.labeling;
  modules.conclusion = { ...modules.conclusion, finalResult: "hold", remark: null };
  return { modules, custom: { glove_type: { gloveType: GLOVE_TYPE } } };
}

/** Two JPEGs drawn in the browser: a 1200 x 900 photo of a "glove" with a circled thin spot, and its thumbnail. */
export async function makeImages(browser: Browser): Promise<{ photo: Uint8Array; thumb: Uint8Array }> {
  const page = await browser.newPage();
  try {
    const draw = (width: number, height: number) =>
      page.evaluate(
        async ([w, h]) => {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("no 2d context");
          const ground = context.createLinearGradient(0, 0, w, h);
          ground.addColorStop(0, "#e5eef8");
          ground.addColorStop(1, "#c9ddf4");
          context.fillStyle = ground;
          context.fillRect(0, 0, w, h);
          context.fillStyle = "#3b9aff";
          context.beginPath();
          context.ellipse(w * 0.5, h * 0.55, w * 0.2, h * 0.36, 0, 0, Math.PI * 2);
          context.fill();
          for (let finger = 0; finger < 4; finger += 1) {
            context.beginPath();
            context.ellipse(w * (0.38 + finger * 0.08), h * 0.2, w * 0.035, h * 0.16, 0, 0, Math.PI * 2);
            context.fill();
          }
          context.strokeStyle = "#b91c1c";
          context.lineWidth = Math.max(3, w / 120);
          context.beginPath();
          context.arc(w * 0.56, h * 0.55, w * 0.05, 0, Math.PI * 2);
          context.stroke();
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("toBlob"))), "image/jpeg", 0.8),
          );
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        },
        [width, height] as const,
      );
    return { photo: new Uint8Array(await draw(1200, 900)), thumb: new Uint8Array(await draw(400, 300)) };
  } finally {
    await page.close();
  }
}

/** A one-page PDF, enough for the bucket's type check. */
function tinyPdf(): Uint8Array {
  return new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
}

async function removeObjects(admin: AdminClient, inspectionId: string) {
  for (const bucket of [PHOTO_BUCKET, FILE_BUCKET]) {
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      const names = (data ?? []).filter((entry) => entry.id !== null).map((entry) => `${folder}/${entry.name}`);
      if (names.length > 0) await admin.storage.from(bucket).remove(names);
    }
  }
}

/** Deletes every row and object a previous run of this fixture may have left behind. */
async function removeFixture(admin: AdminClient, code: string) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", code);
  if (error) fail("finding old fixture templates", error);
  const templateIds = templates.map((template) => template.id);
  if (templateIds.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", templateIds);
  if (findError) fail("finding fixture inspections", findError);
  for (const inspection of inspections) {
    await removeObjects(admin, inspection.id);
    await deleteTestInspection(admin, inspection.id);
  }
  const removed = await admin.from("templates").delete().in("id", templateIds);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

export async function createExportFixture({
  code,
  images,
  extraPhotos = [],
}: {
  code: string;
  images: { photo: Uint8Array; thumb: Uint8Array };
  /** More photos, each with a thumbnail, added before the inspection is submitted. */
  extraPhotos?: readonly ExtraPhoto[];
}): Promise<ExportFixture> {
  const admin = createTestAdminClient();
  await removeFixture(admin, code);
  try {
    return await insertFixture(admin, code, images, extraPhotos);
  } catch (error) {
    await removeFixture(admin, code).catch(() => undefined);
    throw error;
  }
}

async function insertFixture(
  admin: AdminClient,
  code: string,
  images: { photo: Uint8Array; thumb: Uint8Array },
  extraPhotos: readonly ExtraPhoto[],
): Promise<ExportFixture> {
  const { data: people, error: peopleError } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_ACCOUNTS.inspector, TEST_ACCOUNTS.admin]);
  if (peopleError) fail("finding the test accounts", peopleError);
  const idOf = (email: string) => people.find((person) => person.email === email)?.id ?? fail(`finding ${email}`, null);
  const inspectorId = idOf(TEST_ACCOUNTS.inspector);
  const adminId = idOf(TEST_ACCOUNTS.admin);

  // STD_EG under the fixture's code, resolved with the modules of the day.
  const definition = TemplateDefinitionSchema.parse({ ...STD_EG_SEED.definition(), code, name: "Export e2e fixture (temporary)" });
  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });

  // A draft template no inspector can start from; only this fixture uses it.
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({ ...templateRowFields(definition, resolution.template), version: 1, status: "draft" })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  const photoIds = { scale: randomUUID(), untagged: randomUUID() };
  const fileId = randomUUID();
  const { data: inspection, error: insertError } = await admin
    .from("inspections")
    .insert({
      template_id: template.id,
      inspector_id: inspectorId,
      client_id: SEED.polyco,
      manufacturer_id: SEED.terangNusa,
      inspection_date: FIXTURE_HEADER.inspectionDate,
      // What the capture screen copies into the row (lib/inspections/capture/mirror.ts).
      po_no: FIXTURE_HEADER.poNo,
      product_name: FIXTURE_HEADER.productName,
      lot_numbers: [FIXTURE_LOT],
      suggested_result: "hold",
      result: "hold",
      module_overrides: { [EXCLUDED_MODULE]: { reason: EXCLUDED_REASON, by: adminId, at: new Date().toISOString() } },
      data: fixtureData(fileId) as unknown as NonNullable<Json>,
    })
    .select("id, ref_no")
    .single();
  if (insertError) fail("creating the fixture inspection", insertError);

  const path = (id: string, extension = "jpg") => `${inspection.id}/${id}.${extension}`;
  const uploads: [string, string, Uint8Array, string][] = [
    [PHOTO_BUCKET, path(photoIds.scale), images.photo, "image/jpeg"],
    [PHOTO_BUCKET, `${inspection.id}/thumbs/${photoIds.scale}.jpg`, images.thumb, "image/jpeg"],
    [PHOTO_BUCKET, path(photoIds.untagged), images.photo, "image/jpeg"],
    [FILE_BUCKET, path(fileId, "pdf"), tinyPdf(), "application/pdf"],
  ];
  for (const [bucket, objectName, bytes, contentType] of uploads) {
    const { error } = await admin.storage.from(bucket).upload(objectName, bytes, { contentType, upsert: false });
    if (error) fail(`uploading ${objectName}`, error);
  }

  const photos = await admin.from("inspection_photos").insert([
    {
      id: photoIds.scale,
      inspection_id: inspection.id,
      module_key: "weight",
      target: "size:M",
      storage_path: path(photoIds.scale),
      thumb_path: `${inspection.id}/thumbs/${photoIds.scale}.jpg`,
      caption: "Scale reading, 13 gloves",
      taken_at: new Date(Date.now() - 3_600_000).toISOString(),
      width: 1200,
      height: 900,
      include_in_report: true,
      created_by: inspectorId,
    },
    // A bulk insert fills a column one row leaves out with null, not its default: list them all.
    {
      id: photoIds.untagged,
      inspection_id: inspection.id,
      module_key: null,
      target: null,
      storage_path: path(photoIds.untagged),
      thumb_path: null,
      caption: "Carton labels, uploaded on the desktop",
      taken_at: new Date(Date.now() - 1_800_000).toISOString(),
      width: 1200,
      height: 900,
      include_in_report: false,
      created_by: inspectorId,
    },
  ]);
  if (photos.error) fail("adding the photos", photos.error);
  const files = await admin.from("inspection_files").insert({
    id: fileId,
    inspection_id: inspection.id,
    module_key: "force_at_break",
    kind: "lab_report",
    storage_path: path(fileId, "pdf"),
    name: "Force at break lab report.pdf",
    created_by: inspectorId,
  });
  if (files.error) fail("adding the lab report", files.error);

  const extraPhotoIds = extraPhotos.map(() => randomUUID());
  for (const [index, extra] of extraPhotos.entries()) {
    const id = extraPhotoIds[index];
    for (const [objectName, bytes] of [
      [path(id), images.photo],
      [`${inspection.id}/thumbs/${id}.jpg`, images.thumb],
    ] as const) {
      const { error } = await admin.storage.from(PHOTO_BUCKET).upload(objectName, bytes, { contentType: "image/jpeg", upsert: false });
      if (error) fail(`uploading ${objectName}`, error);
    }
    const added = await admin.from("inspection_photos").insert({
      id,
      inspection_id: inspection.id,
      module_key: extra.moduleKey,
      target: extra.target,
      storage_path: path(id),
      thumb_path: `${inspection.id}/thumbs/${id}.jpg`,
      caption: extra.caption,
      taken_at: new Date(Date.now() - 900_000 + index * 1000).toISOString(),
      width: 1200,
      height: 900,
      include_in_report: extra.includeInReport,
      created_by: inspectorId,
    });
    if (added.error) fail(`adding the spec's photo ${index + 1}`, added.error);
  }

  // Every inspection starts as a draft; the status flow moves it on.
  const submitted = await admin.from("inspections").update({ status: "submitted" }).eq("id", inspection.id);
  if (submitted.error) fail("submitting the inspection", submitted.error);

  return {
    inspectionId: inspection.id,
    refNo: inspection.ref_no,
    inspectorId,
    adminId,
    photoIds,
    extraPhotoIds,
    fileId,
    cleanup: () => removeFixture(admin, code),
  };
}

/* ------------------------------------------------------------------ *
 * Accounts and requests
 * ------------------------------------------------------------------ */

/** An API request context signed in as `email`, or signed out when no email is given. */
export async function requestAs(baseURL: string, email?: string, password?: string): Promise<APIRequestContext> {
  const cookies = email ? await sessionCookies(email, password) : [];
  const { hostname } = new URL(baseURL);
  return playwrightRequest.newContext({
    baseURL,
    storageState: {
      cookies: cookies.map((cookie) => ({
        ...cookie,
        domain: hostname,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      })),
      origins: [],
    },
  });
}

export type Throwaway = { id: string; email: string; password: string };

/** An inspector account that starts inactive, as every new account does (migration 600). Delete it afterwards. */
export async function createInactiveInspector(): Promise<Throwaway> {
  const admin = createTestAdminClient();
  const email = throwawayEmail("export").toLowerCase();
  const password = `E2e-${randomUUID().slice(0, 13)}-9`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Export e2e inspector (temporary)" },
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  return { id: data.user.id, email, password };
}

export async function activate(account: Throwaway): Promise<void> {
  const { error } = await createTestAdminClient().from("profiles").update({ active: true }).eq("id", account.id);
  if (error) throw new Error(`Could not activate ${account.email}: ${error.message}`);
}

export async function deleteAccount(account: Throwaway): Promise<void> {
  const { error } = await createTestAdminClient().auth.admin.deleteUser(account.id);
  if (error && error.status !== 404) throw new Error(`Could not delete ${account.email}: ${error.message}`);
}

/* ------------------------------------------------------------------ *
 * Page helpers (as in e2e/list)
 * ------------------------------------------------------------------ */

export function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/** A tap on the iPads, a click on the desktop. */
export async function press(locator: Locator): Promise<void> {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

/**
 * screenshots/export/<project>-<name>.png. Full page on the desktop; on the
 * iPads viewport shots, scrolled (name-1.png, name-2.png ...), since a
 * full-page capture drops touch emulation (e2e/README.md).
 */
export async function shot(page: Page, name: string): Promise<void> {
  const path = (part = "") => `screenshots/export/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  // Let toasts finish their entrance.
  await page.waitForTimeout(250);
  if (!isTouch()) {
    // From the top: sticky parts (the sidebar, the column headings) are drawn
    // where the page is scrolled to, e.g. after focus moved down to a field.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ ...options, path: path(), fullPage: true });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.max(1, Math.ceil(height / viewport));
  for (let part = 0; part < parts; part += 1) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: path(parts > 1 ? `-${part + 1}` : "") });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Collects console errors, so hydration mismatches fail the test. */
export function watchConsole(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => errors.filter((text) => /hydrat|did not match|server rendered/i.test(text));
}

export async function expectNoPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

/** On the iPads every control is at least 44 px tall (docs/DESIGN.md). */
export async function expectTouchTarget(locator: Locator): Promise<void> {
  if (!isTouch()) return;
  const box = await locator.boundingBox();
  expect(box, "the control is on screen").not.toBeNull();
  expect(box!.height, "touch target height").toBeGreaterThanOrEqual(44);
}
