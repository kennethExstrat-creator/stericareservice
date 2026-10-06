import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { makeTestTemplate } from "../../modules/_framework/testing";
import { MODULE_REGISTRY } from "../../modules/registry";
import type { Json } from "../../lib/supabase/database.types";
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
 * The template is resolved against the modules as they are at run time
 * (their default config), so the fixture keeps working as the real
 * modules land; the panel and the export do not depend on their results.
 * ------------------------------------------------------------------ */

type AdminClient = ReturnType<typeof createTestAdminClient>;

/** Reference rows from supabase/seed.sql, which uses fixed ids. */
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  terangNusa: "10000000-0000-4000-8000-000000000002",
} as const;

const PHOTO_BUCKET = "inspection-photos";
const FILE_BUCKET = "inspection-files";

export const EXCLUDED_REASON = "Scale out of calibration; weighed at the lab instead.";

/**
 * Where the AI panel is rendered. The review screen (/inspections/[id]/review)
 * hosts it once the integrator has wired it in; until then point
 * E2E_AI_PANEL_PATH at a page that renders <AiReviewPanel inspectionId={id} />,
 * e.g. E2E_AI_PANEL_PATH=/e2e-ai-panel/{id}.
 */
export function panelPath(inspectionId: string): string {
  const pattern = process.env.E2E_AI_PANEL_PATH?.trim() || "/inspections/{id}/review";
  return pattern.replace("{id}", inspectionId);
}

/** "mock" (default): the dev server runs AI_REVIEW_PROVIDER=mock. "off": nothing is connected. */
export function expectedAiMode(): "mock" | "off" {
  return process.env.E2E_EXPORT_AI?.trim() === "off" ? "off" : "mock";
}

export type ExportFixture = {
  inspectionId: string;
  refNo: string;
  inspectorId: string;
  adminId: string;
  photoIds: { visual: string; untagged: string };
  fileId: string;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Export fixture: ${step} failed: ${error?.message ?? "no data"}`);
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
}: {
  code: string;
  images: { photo: Uint8Array; thumb: Uint8Array };
}): Promise<ExportFixture> {
  const admin = createTestAdminClient();
  await removeFixture(admin, code);
  try {
    return await insertFixture(admin, code, images);
  } catch (error) {
    await removeFixture(admin, code).catch(() => undefined);
    throw error;
  }
}

async function insertFixture(
  admin: AdminClient,
  code: string,
  images: { photo: Uint8Array; thumb: Uint8Array },
): Promise<ExportFixture> {
  const { data: people, error: peopleError } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_ACCOUNTS.inspector, TEST_ACCOUNTS.admin]);
  if (peopleError) fail("finding the test accounts", peopleError);
  const idOf = (email: string) => people.find((person) => person.email === email)?.id ?? fail(`finding ${email}`, null);
  const inspectorId = idOf(TEST_ACCOUNTS.inspector);
  const adminId = idOf(TEST_ACCOUNTS.admin);

  const resolved = makeTestTemplate(
    MODULE_REGISTRY,
    ["header", "glove_info", "order_lots", "packing_config", "weight", "visual", "conclusion"],
    {
      code,
      name: "Export e2e fixture (temporary)",
      chain: [code],
      bases: [],
      customModules: [
        {
          key: "glove_type",
          title: "Glove Type",
          after: "header",
          layout: "fields",
          fields: [{ key: "gloveType", label: "Glove Type", type: "text" }],
        },
      ],
      report: { title: "Preshipment Inspection: Nitrile Disposable Examination Gloves", showClientLogo: false },
    },
  );

  // A draft template no inspector can start from; only this fixture uses it.
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({
      code,
      version: 1,
      product_type: "examination",
      standard: "EN455",
      status: "draft",
      definition: {
        code,
        name: "Export e2e fixture (temporary)",
        scope: { productType: "examination", standard: "EN455" },
        unit: "pcs",
        sizes: [{ value: "M" }],
        modules: resolved.modules.map((module) => ({ key: module.key, include: true })),
      },
      resolved: resolved as unknown as Json,
    })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  const { data: inspection, error: insertError } = await admin
    .from("inspections")
    .insert({
      template_id: template.id,
      inspector_id: inspectorId,
      client_id: SEED.polyco,
      manufacturer_id: SEED.terangNusa,
      po_no: "E2E-EXPORT-PO-0001",
      product_name: "E2E nitrile examination gloves, blue",
      lot_numbers: ["E2E-LOT-M-0001"],
      result: "hold",
      module_overrides: { weight: { reason: EXCLUDED_REASON, by: adminId, at: new Date().toISOString() } },
      data: {
        modules: {
          header: { poNo: "E2E-EXPORT-PO-0001", productName: "E2E nitrile examination gloves, blue" },
          glove_info: {
            surfaceTexture: "Finger-textured",
            indicativeWeight: 3.5,
            colour: "Blue",
            length: "240 mm minimum",
            comment: "Indicative weight from the glove spec sheet.",
          },
          order_lots: { lots: [{ size: "M", qtyCases: 120, lotNumbers: ["E2E-LOT-M-0001"] }] },
          visual: { comment: "Two thin spots on the body, photographed." },
          conclusion: { finalResult: "hold" },
        },
        custom: { glove_type: { gloveType: "Nitrile, powder free" } },
      },
    })
    .select("id, ref_no")
    .single();
  if (insertError) fail("creating the fixture inspection", insertError);

  const photoIds = { visual: randomUUID(), untagged: randomUUID() };
  const fileId = randomUUID();
  const path = (id: string, extension = "jpg") => `${inspection.id}/${id}.${extension}`;
  const uploads: [string, string, Uint8Array, string][] = [
    [PHOTO_BUCKET, path(photoIds.visual), images.photo, "image/jpeg"],
    [PHOTO_BUCKET, `${inspection.id}/thumbs/${photoIds.visual}.jpg`, images.thumb, "image/jpeg"],
    [PHOTO_BUCKET, path(photoIds.untagged), images.photo, "image/jpeg"],
    [FILE_BUCKET, path(fileId, "pdf"), tinyPdf(), "application/pdf"],
  ];
  for (const [bucket, objectName, bytes, contentType] of uploads) {
    const { error } = await admin.storage.from(bucket).upload(objectName, bytes, { contentType, upsert: false });
    if (error) fail(`uploading ${objectName}`, error);
  }

  const photos = await admin.from("inspection_photos").insert([
    {
      id: photoIds.visual,
      inspection_id: inspection.id,
      module_key: "visual",
      target: "size:M/defect:thin_spot",
      storage_path: path(photoIds.visual),
      thumb_path: `${inspection.id}/thumbs/${photoIds.visual}.jpg`,
      caption: "Thin spot on glove body",
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
    module_key: "weight",
    kind: "lab_report",
    storage_path: path(fileId, "pdf"),
    name: "Weight lab report.pdf",
    created_by: inspectorId,
  });
  if (files.error) fail("adding the lab report", files.error);

  // Every inspection starts as a draft; the status flow moves it on.
  const submitted = await admin.from("inspections").update({ status: "submitted" }).eq("id", inspection.id);
  if (submitted.error) fail("submitting the inspection", submitted.error);

  return {
    inspectionId: inspection.id,
    refNo: inspection.ref_no,
    inspectorId,
    adminId,
    photoIds,
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
