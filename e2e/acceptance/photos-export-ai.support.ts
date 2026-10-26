import { randomBytes } from "node:crypto";
import { test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { stdEgInspectionData } from "../../lib/export/__fixtures__/std-eg";
import { TemplateDefinitionSchema } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { STD_EG_REPORT_SEED } from "../../lib/templates/definitions";
import { resolveTemplate } from "../../modules";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";

/* ------------------------------------------------------------------ *
 * Temporary rows for the final acceptance of photos, the export and the AI
 * second opinion (BUILD_SPEC 12), made with the secret key and deleted
 * afterwards (e2e/README.md): a draft template E2E_FINAL_PEA_<run> nobody
 * can start from (a copy of the STD_EG seed resolved with the modules of the
 * day), and one draft inspection of inspector@test.local holding the whole
 * STD_EG example report (lib/export/__fixtures__/std-eg.ts) with the carton
 * corrections made, comments, a remark and no lab report yet: the spec
 * attaches it, and the photos, from the capture screen. Teardown removes
 * the inspection's Storage objects (photos, thumbnails, files), then the
 * inspection (deleteTestInspection: its photo and file rows, AI reviews,
 * decisions and audit rows go with it), then the template. Rows an earlier
 * run left behind are swept once they are half an hour old.
 * ------------------------------------------------------------------ */

type AdminClient = ReturnType<typeof createTestAdminClient>;
type Account = keyof typeof TEST_ACCOUNTS;
type Cookie = Awaited<ReturnType<typeof sessionCookies>>[number];

export const CODE_PREFIX = "E2E_FINAL_PEA";
const RUN = randomBytes(3).toString("hex").toUpperCase();
const STALE_MS = 30 * 60 * 1000;
const BUCKETS = ["inspection-photos", "inspection-files"] as const;

/** Reference rows from supabase/seed.sql, which uses fixed ids. */
export const SEED = {
  polyco: { id: "20000000-0000-4000-8000-000000000001", name: "Polyco Healthline" },
  terangNusa: { id: "10000000-0000-4000-8000-000000000002", name: "Terang Nusa Sdn. Bhd." },
} as const;

/** What the inspector wrote, so the export and the AI panel can be checked for it. */
export const WORDS = {
  poNo: "E2E-FINAL-PO-0001 (SO-0001)",
  productName: "E2E final acceptance nitrile examination gloves, blue",
  productCode: "E2E-PC-01",
  factoryGloveCode: "E2E-FGC-01",
  lot: "E2E-FINAL-LOT-M-01",
  gloveType: "Nitrile, powder free",
  remark: "Shipment released; weight below the indicative value noted for the client.",
  comments: {
    weight: "Weighed on the factory scale: 2.9 g against the indicative 3.5 g.",
    visual: "Five thin spots on the body, photographed.",
    dispensing_packing: "Layering checked on 13 dispenser boxes.",
  },
} as const;

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Acceptance fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** The STD_EG example as the inspector left it before attaching the lab report and taking photos. */
function inspectionData() {
  const data = stdEgInspectionData({ corrected: true, labReportFileId: null, comments: WORDS.comments, remark: WORDS.remark });
  const modules = { ...data.modules } as Record<string, Record<string, unknown>>;
  modules.header = {
    ...modules.header,
    poNo: WORDS.poNo,
    productName: WORDS.productName,
    productCode: WORDS.productCode,
    factoryGloveCode: WORDS.factoryGloveCode,
  };
  const order = modules.order_lots as { sizes: Record<string, { lotNumbers: string[] }> };
  modules.order_lots = { sizes: { M: { ...order.sizes.M, lotNumbers: [WORDS.lot] } } };
  return { modules, custom: { glove_type: { gloveType: WORDS.gloveType } } };
}

export type AcceptanceFixture = {
  templateId: string;
  templateCode: string;
  inspectionId: string;
  refNo: string;
  inspectorId: string;
  adminId: string;
  cleanup: () => Promise<{ objectsLeft: string[]; inspectionLeft: boolean; templateLeft: boolean }>;
};

async function testAccountIds(admin: AdminClient) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_ACCOUNTS.inspector, TEST_ACCOUNTS.admin]);
  if (error) fail("finding the test accounts", error);
  const idOf = (email: string) => data.find((person) => person.email === email)?.id ?? fail(`finding ${email}`, null);
  return { inspectorId: idOf(TEST_ACCOUNTS.inspector), adminId: idOf(TEST_ACCOUNTS.admin) };
}

/** Every object in an inspection's folders of both buckets: photos, thumbnails, lab reports. */
export async function inspectionObjects(inspectionId: string, admin: AdminClient = createTestAdminClient()) {
  const found: { bucket: (typeof BUCKETS)[number]; path: string }[] = [];
  for (const bucket of BUCKETS) {
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) fail(`listing ${bucket}/${folder}`, error);
      // Folders come back as entries without an id.
      for (const entry of data) if (entry.id) found.push({ bucket, path: `${folder}/${entry.name}` });
    }
  }
  return found;
}

async function removeInspection(admin: AdminClient, inspectionId: string): Promise<void> {
  const objects = await inspectionObjects(inspectionId, admin);
  for (const bucket of BUCKETS) {
    const paths = objects.filter((object) => object.bucket === bucket).map((object) => object.path);
    if (paths.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) fail(`removing the ${bucket} objects of ${inspectionId}`, error);
  }
  await deleteTestInspection(admin, inspectionId);
}

async function removeTemplates(admin: AdminClient, templateIds: string[]): Promise<void> {
  if (templateIds.length === 0) return;
  const { data: inspections, error } = await admin.from("inspections").select("id").in("template_id", templateIds);
  if (error) fail("finding the templates' inspections", error);
  for (const inspection of inspections) await removeInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", templateIds);
  if (removed.error) fail("deleting the templates", removed.error);
}

/** A template of this fixture with its inspections, their objects first. */
export async function removeAcceptanceTemplate(templateId: string): Promise<void> {
  await removeTemplates(createTestAdminClient(), [templateId]);
}

/** What a run that died half way left: E2E_FINAL_PEA templates over half an hour old, with everything under them. */
export async function sweepAcceptanceLeftovers(): Promise<void> {
  const admin = createTestAdminClient();
  const { data, error } = await admin.from("templates").select("id, code, created_at").like("code", `${CODE_PREFIX}_%`);
  if (error) fail("finding old acceptance templates", error);
  const before = Date.now() - STALE_MS;
  await removeTemplates(
    admin,
    // LIKE reads "_" as any character: only this fixture's codes, and only once someone's run is surely over.
    data.filter((row) => row.code.startsWith(`${CODE_PREFIX}_`) && Date.parse(row.created_at) < before).map((row) => row.id),
  );
}

export async function createAcceptanceFixture(project: string): Promise<AcceptanceFixture> {
  const admin = createTestAdminClient();
  const { inspectorId, adminId } = await testAccountIds(admin);
  const templateCode = `${CODE_PREFIX}_${RUN}_${project.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const definition = TemplateDefinitionSchema.parse({
    // STD_EG's report flow (versions 1 to 4): the STD_EG example the fixture holds was made on it.
    ...STD_EG_REPORT_SEED.definition(),
    code: templateCode,
    name: "Final acceptance: photos, export and AI (temporary)",
  });
  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) fail("resolving the template", { message: JSON.stringify(resolution.problems) });

  // A draft: no inspector can start from it, and only this fixture's inspection uses it.
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({ ...templateRowFields(definition, resolution.template), version: 1, status: "draft" })
    .select("id")
    .single();
  if (templateError) fail("creating the template", templateError);

  const data = inspectionData();
  const header = data.modules.header as { inspectionDate: string };
  // Never an id or a ref_no: the database draws the ref number (e2e/README.md).
  const { data: inspection, error } = await admin
    .from("inspections")
    .insert({
      template_id: template.id,
      inspector_id: inspectorId,
      client_id: SEED.polyco.id,
      manufacturer_id: SEED.terangNusa.id,
      inspection_date: header.inspectionDate,
      // What the capture screen copies into the row (lib/inspections/capture/mirror.ts).
      po_no: WORDS.poNo,
      product_name: WORDS.productName,
      lot_numbers: [WORDS.lot],
      data: data as unknown as NonNullable<Json>,
    })
    .select("id, ref_no")
    .single();
  if (error) {
    await admin.from("templates").delete().eq("id", template.id);
    fail("creating the inspection", error);
  }

  return {
    templateId: template.id,
    templateCode,
    inspectionId: inspection.id,
    refNo: inspection.ref_no,
    inspectorId,
    adminId,
    cleanup: async () => {
      await removeTemplates(admin, [template.id]);
      const objects = await inspectionObjects(inspection.id, admin);
      const { count: inspections } = await admin
        .from("inspections")
        .select("id", { count: "exact", head: true })
        .eq("id", inspection.id);
      const { count: templates } = await admin
        .from("templates")
        .select("id", { count: "exact", head: true })
        .eq("id", template.id);
      return {
        objectsLeft: objects.map((object) => `${object.bucket}/${object.path}`),
        inspectionLeft: (inspections ?? 0) > 0,
        templateLeft: (templates ?? 0) > 0,
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Rows the checks read with the secret key (what is stored, not who sees it)
 * ------------------------------------------------------------------ */

export async function photoRows(inspectionId: string) {
  const { data, error } = await createTestAdminClient()
    .from("inspection_photos")
    .select("id, module_key, target, caption, width, height, flagged, include_in_report, storage_path, thumb_path, created_by, taken_at, created_at")
    .eq("inspection_id", inspectionId)
    .order("created_at");
  if (error) fail("reading the photo rows", error);
  return data;
}

export async function fileRows(inspectionId: string) {
  const { data, error } = await createTestAdminClient()
    .from("inspection_files")
    .select("id, module_key, kind, name, storage_path, created_by")
    .eq("inspection_id", inspectionId)
    .order("created_at");
  if (error) fail("reading the file rows", error);
  return data;
}

export async function inspectionRow(inspectionId: string) {
  const { data, error } = await createTestAdminClient()
    .from("inspections")
    .select("status, result, suggested_result, remarks, submitted_at, updated_at, data")
    .eq("id", inspectionId)
    .single();
  if (error) fail("reading the inspection", error);
  return data;
}

/* ------------------------------------------------------------------ *
 * Sessions and pages
 * ------------------------------------------------------------------ */

/**
 * One sign-in per account and run, shared by every browser context of the
 * spec: the shared project limits sign-ins (about 30 in a few minutes).
 */
export function sessions() {
  const cache = new Map<Account, Cookie[]>();
  const cookiesOf = async (account: Account) => {
    const known = cache.get(account);
    if (known) return known;
    const fresh = await sessionCookies(TEST_ACCOUNTS[account]);
    cache.set(account, fresh);
    return fresh;
  };
  return {
    cookiesOf,
    async signIn(context: BrowserContext, baseURL: string, account: Account) {
      await context.clearCookies();
      const cookies = await cookiesOf(account);
      await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
    },
  };
}

/** A tap where the context has touch, a click elsewhere. */
export async function press(locator: Locator, touch: boolean): Promise<void> {
  if (touch) await locator.tap();
  else await locator.click();
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

/**
 * screenshots/acceptance/<project>-<name>.png. Touch contexts get viewport
 * shots, scrolled (name-1.png, name-2.png ...): a full-page capture drops
 * touch emulation while it resizes (e2e/README.md). Desktop: full page.
 */
export async function shot(page: Page, name: string, touch: boolean, maxParts = 6): Promise<void> {
  const path = (part = "") => `screenshots/acceptance/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  await page.waitForTimeout(300);
  if (!touch) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ ...options, path: path(), fullPage: true });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.min(maxParts, Math.max(1, Math.ceil(height / viewport)));
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: path(parts > 1 ? `-${part + 1}` : "") });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** A viewport shot of what is on screen now. */
export async function view(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `screenshots/acceptance/${test.info().project.name}-${name}.png`,
    animations: "disabled",
    caret: "initial",
  });
}
