import { randomBytes } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedModuleConfigs, TEMPLATES } from "../../lib/coverage";
import type { JsonValue } from "../../lib/schemas/common";
import type { ResolvedTemplate, TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, resolveTemplate, type TemplateBase } from "../../lib/templates";
import { stubModule } from "../../modules/_framework";
import type { ModuleRegistry } from "../../modules/_framework";
import { MODULE_REGISTRY } from "../../modules/registry";
import { MODULE_KEYS } from "../../lib/schemas/module-result";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the template screens: a client of their own, templates
 * whose code starts with E2E_TEMPLATES, an inspection that uses one (to
 * freeze it), and their files in the template-sources bucket. Created with
 * the secret key and deleted in afterAll (e2e/README.md): Storage files, then
 * inspections through deleteTestInspection(), then the templates, then the
 * client. Rows a crashed run left behind are removed by the next run once
 * they are half an hour old.
 *
 * Every template that is ever active here is scoped to the run's own client,
 * so it can only apply to a new inspection for that client: never to an
 * inspection someone starts in the shared project meanwhile.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const CODE_PREFIX = "E2E_TEMPLATES";
const RUN = randomBytes(3).toString("hex").toUpperCase();
const STALE_MS = 30 * 60 * 1000;
const BUCKET = "template-sources";

/** Clients this spec creates: `E2E templates client <run> (temporary)`. */
const CLIENT_PREFIX = "E2E templates client";
const CLIENT_NAME = `${CLIENT_PREFIX} ${RUN} (temporary)`;

/** A seeded manufacturer (supabase/seed.sql uses fixed ids). */
export const HARTALEGA = "10000000-0000-4000-8000-000000000001";

export function fixtureCode(name: string): string {
  return `${CODE_PREFIX}_${RUN}_${name}`;
}

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Templates fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/* ------------------------------------------------------------------ *
 * Definitions
 * ------------------------------------------------------------------ */

/**
 * The shared base of ROOT: active from the start, so ROOT's page links to
 * it. Scoped to the run's client at Hartalega, which no real inspection is
 * for.
 */
export function baseDefinition(code: string, clientId: string): TemplateDefinition {
  return {
    code,
    name: "E2E templates: shared base (temporary)",
    scope: { productType: "examination", standard: "custom", clientId, manufacturerId: HARTALEGA },
    unit: "pcs",
    sizes: [{ value: "M" }],
    modules: [
      { key: "header", include: true },
      { key: "conclusion", include: true },
    ],
    report: { title: "E2E templates shared base", showClientLogo: false },
  };
}

/**
 * The template whose whole life the desktop run plays out, scoped to the
 * run's client. Built on the base above, which is no seed template, so it
 * has no field inventory: the checklist is the last tick. It lists every
 * module, so the order is its own.
 */
export function rootDefinition(
  code: string,
  { baseCode, clientId }: { baseCode: string; clientId: string },
): TemplateDefinition {
  return {
    code,
    name: "E2E templates: base template (temporary)",
    extends: baseCode,
    scope: { productType: "examination", standard: "custom", clientId },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M", label: "Medium" }, { value: "L" }],
    modules: [
      { key: "header", include: true, labels: { poNo: "PO / SO Number", client: "Client Name" } },
      { key: "glove_info", include: false },
      { key: "order_lots", include: true },
      { key: "watertight", include: true, title: "Watertight test" },
      { key: "visual", include: true },
      { key: "conclusion", include: true },
    ],
    customModules: [
      {
        key: "glove_type",
        title: "Glove Type",
        after: "header",
        layout: "fields",
        fields: [{ key: "gloveType", label: "Glove Type", type: "text" }],
      },
    ],
    report: { title: "E2E templates test report", showClientLogo: false },
  };
}

/** STD_EG as its seed writes it (lib/coverage), in memory only: the base of the inventory fixture. */
export function stdEgDefinition(): TemplateDefinition {
  const spec = TEMPLATES.STD_EG;
  return {
    code: "STD_EG",
    name: spec.name,
    scope: { productType: spec.scope.productType, standard: spec.scope.standard },
    unit: spec.unit,
    sizes: spec.sizes.map((size) => ({ ...size })),
    modules: seedModuleConfigs("STD_EG").map((entry) => ({
      key: entry.key,
      include: entry.include,
      title: entry.title,
      ...(Object.keys(entry.labels).length > 0 ? { labels: entry.labels } : {}),
      config: entry.config as unknown as Record<string, JsonValue>,
    })),
    customModules: spec.customModules.map((custom) => ({
      key: custom.key,
      title: custom.title,
      after: custom.after,
      layout: custom.layout,
      fields: custom.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        ...(field.hint ? { hint: field.hint } : {}),
      })),
    })),
    report: { title: (spec.report.titleLines ?? [spec.name]).join(": "), showClientLogo: spec.report.showClientLogo },
  };
}

/**
 * A client-style template on top of STD_EG: its chain reaches a seed, so the
 * checklist lists STD_EG's forms. It drops force at break, so those fields
 * show as left out.
 */
export function childDefinition(code: string): TemplateDefinition {
  return {
    code,
    name: "E2E templates: client variant of STD_EG (temporary)",
    extends: "STD_EG",
    scope: { productType: "examination", standard: "EN455", manufacturerId: HARTALEGA },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true, labels: { poNo: "PO Number" } },
      { key: "force_at_break", include: false },
    ],
  };
}

const STUB_REGISTRY = Object.fromEntries(
  MODULE_KEYS.map((key) => [key, stubModule({ key, title: MODULE_REGISTRY[key].title, perSize: MODULE_REGISTRY[key].perSize })]),
) as unknown as ModuleRegistry;

/**
 * Resolved against the app's modules, as the editor would. Should a module's
 * schema refuse a seed setting, fall back to placeholder modules: the page
 * then shows the settings problem, which is what it is for.
 */
export function resolveFixture(definition: TemplateDefinition, bases: TemplateBase[] = []): ResolvedTemplate {
  const getBase = lookupFrom(bases);
  const real = resolveTemplate(definition, { getBase, registry: MODULE_REGISTRY });
  if (real.ok) return real.template;
  const loose = resolveTemplate(definition, { getBase, registry: STUB_REGISTRY });
  if (loose.ok) return loose.template;
  throw new Error(`Fixture ${definition.code} does not resolve: ${JSON.stringify(loose.problems)}`);
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

export type FixtureTemplate = { id: string; code: string; version: number };

export type FixtureClient = { id: string; name: string };

/** The run's own client: the scope of every template this spec activates. */
export async function insertClient(): Promise<FixtureClient> {
  const { data, error } = await createTestAdminClient()
    .from("clients")
    .insert({ name: CLIENT_NAME, notes: "Created and deleted by e2e/templates. Safe to delete." })
    .select("id, name")
    .single();
  if (error) fail("creating the fixture client", error);
  return data;
}

/** Whether a client row still exists. */
export async function clientExists(id: string): Promise<boolean> {
  const { data, error } = await createTestAdminClient().from("clients").select("id").eq("id", id).maybeSingle();
  if (error) fail(`reading client ${id}`, error);
  return data !== null;
}

export async function insertTemplate(
  definition: TemplateDefinition,
  resolved: ResolvedTemplate,
  { version = 1, status = "draft" as const }: { version?: number; status?: "draft" | "active" | "retired" } = {},
): Promise<FixtureTemplate> {
  const admin = createTestAdminClient();
  const { data, error } = await admin
    .from("templates")
    .insert({
      code: definition.code,
      version,
      status,
      extends_code: definition.extends ?? null,
      product_type: definition.scope.productType,
      standard: definition.scope.standard,
      client_id: definition.scope.clientId ?? null,
      manufacturer_id: definition.scope.manufacturerId ?? null,
      definition: definition as unknown as NonNullable<Json>,
      resolved: resolved as unknown as Json,
    })
    .select("id, code, version")
    .single();
  if (error) fail(`creating template ${definition.code}`, error);
  return data;
}

/**
 * A draft whose definition does not parse and that never resolved, as a
 * half-made template or another spec's fixture can be: the page must still
 * explain itself.
 */
export async function insertUnresolvedTemplate(code: string): Promise<FixtureTemplate> {
  const { data, error } = await createTestAdminClient()
    .from("templates")
    .insert({
      code,
      version: 1,
      status: "draft",
      product_type: "examination",
      standard: "custom",
      definition: { code, name: "E2E templates: unresolved draft (temporary)", modules: [] },
    })
    .select("id, code, version")
    .single();
  if (error) fail(`creating template ${code}`, error);
  return data;
}

export async function templateRow(id: string) {
  const { data, error } = await createTestAdminClient()
    .from("templates")
    .select("id, code, version, status, source_file_path, coverage_confirmed_at, coverage_confirmed_by, definition, resolved")
    .eq("id", id)
    .single();
  if (error) fail(`reading template ${id}`, error);
  return data;
}

export async function templatesOfCode(code: string) {
  const { data, error } = await createTestAdminClient()
    .from("templates")
    .select("id, version, status, source_file_path, coverage_confirmed_at, definition")
    .eq("code", code)
    .order("version");
  if (error) fail(`reading the versions of ${code}`, error);
  return data;
}

/** A code's active version in the live project, or null when it has none. */
export async function activeVersionOf(code: string): Promise<number | null> {
  const { data, error } = await createTestAdminClient()
    .from("templates")
    .select("version")
    .eq("code", code)
    .eq("status", "active")
    .maybeSingle();
  if (error) fail(`reading the active version of ${code}`, error);
  return data?.version ?? null;
}

/** An inspection by the test inspector that uses the template: the version is frozen from then on. */
export async function insertInspection(templateId: string): Promise<{ id: string; ref_no: string }> {
  const admin = createTestAdminClient();
  const { data: inspector, error: findError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (findError) fail("finding the test inspector", findError);
  const { data, error } = await admin
    .from("inspections")
    .insert({
      template_id: templateId,
      inspector_id: inspector.id,
      po_no: "E2E-TEMPLATES-PO",
      product_name: "E2E templates fixture (temporary)",
    })
    .select("id, ref_no")
    .single();
  if (error) fail("creating the fixture inspection", error);
  return data;
}

/** Every object under a folder of template-sources, at any depth. */
async function listObjects(admin: AdminClient, folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) fail(`listing ${folder}`, error);
  const paths: string[] = [];
  for (const entry of data) {
    const path = `${folder}/${entry.name}`;
    if (entry.id === null) paths.push(...(await listObjects(admin, path)));
    else paths.push(path);
  }
  return paths;
}

/**
 * Deletes the templates and the client of this run (all of them) and of older
 * runs that are more than half an hour old: the templates' Storage files,
 * the inspections that use them, the templates, then the clients. Never
 * touches another code or another spec's client.
 */
export async function removeFixtures(): Promise<void> {
  const admin = createTestAdminClient();
  const staleBefore = Date.now() - STALE_MS;
  const { data: rows, error } = await admin.from("templates").select("id, code, created_at").like("code", "E2E%");
  if (error) fail("finding fixture templates", error);
  const mine = rows.filter(
    (row) =>
      row.code.startsWith(`${CODE_PREFIX}_`) &&
      (row.code.startsWith(fixtureCode("")) || Date.parse(row.created_at) < staleBefore),
  );

  for (const code of new Set(mine.map((row) => row.code))) {
    const objects = await listObjects(admin, code);
    if (objects.length > 0) {
      const removed = await admin.storage.from(BUCKET).remove(objects);
      if (removed.error) fail(`removing the files of ${code}`, removed.error);
    }
  }

  const ids = mine.map((row) => row.id);
  if (ids.length > 0) {
    const { data: inspections, error: inspectionError } = await admin.from("inspections").select("id").in("template_id", ids);
    if (inspectionError) fail("finding fixture inspections", inspectionError);
    for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);

    const deleted = await admin.from("templates").delete().in("id", ids);
    if (deleted.error) fail("deleting fixture templates", deleted.error);
  }

  // Last: the templates scoped to a client held on to it.
  const { data: clients, error: clientError } = await admin
    .from("clients")
    .select("id, name, created_at")
    .like("name", `${CLIENT_PREFIX} %`);
  if (clientError) fail("finding fixture clients", clientError);
  for (const client of clients) {
    const thisRun = client.name === CLIENT_NAME;
    if (!thisRun && Date.parse(client.created_at) >= staleBefore) continue;
    const { error: deleteError } = await admin.from("clients").delete().eq("id", client.id);
    // An older run's client that something else now uses stays: it harms nothing.
    if (deleteError && thisRun) fail(`deleting ${client.name}`, deleteError);
    if (deleteError) console.warn(`Templates fixture: kept ${client.name}: ${deleteError.message}`);
  }
}

/** Whether Storage still holds anything under a code's folder. */
export async function storedFiles(code: string): Promise<string[]> {
  return listObjects(createTestAdminClient(), code);
}

/* ------------------------------------------------------------------ *
 * Page helpers
 * ------------------------------------------------------------------ */

export function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled:
 * name.png, or name-1.png, name-2.png ... for a longer page.
 */
export async function shot(page: Page, name: string): Promise<void> {
  const path = (part = "") => `screenshots/templates/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  // Let toasts and dialogs finish their 100-150 ms entrance first.
  await page.waitForTimeout(300);
  if (!isTouch()) {
    // From the top: the sticky sidebar is drawn where the window was scrolled to.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ ...options, path: path(), fullPage: true });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.min(12, Math.max(1, Math.ceil(height / viewport)));
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: path(parts > 1 ? `-${part + 1}` : "") });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Picks a file through the page's own button, as an admin does: the button
 * opens the hidden file input. Until the page has hydrated the button does
 * nothing, so the click is retried until the file chooser opens (setting the
 * input's files directly would skip the button, and before hydration nothing
 * would upload).
 */
export async function chooseFile(
  page: Page,
  button: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await expect(async () => {
    const chooser = page.waitForEvent("filechooser", { timeout: 2_000 });
    await button.click();
    await (await chooser).setFiles(file);
  }).toPass({ timeout: 30_000 });
}

/**
 * Opens a confirmation dialog through its button. Until the page has
 * hydrated (just after a load or reload) a click does nothing, so it clicks
 * again until the dialog shows.
 */
export async function openDialog(page: Page, button: Locator): Promise<Locator> {
  const dialog = page.getByRole("alertdialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await button.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return dialog;
}

/** A tap on the iPads, a click on the desktop. */
export async function press(locator: Locator): Promise<void> {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

export const toast = (page: Page, text: string | RegExp): Locator =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

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

/** A tiny but real PDF: what an admin uploads as the source form. */
export const SOURCE_PDF = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj",
    "2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj",
    "3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]>> endobj",
    "trailer <</Root 1 0 R>>",
    "%%EOF",
    "",
  ].join("\n"),
);
