import { randomBytes } from "node:crypto";
import type { ResolvedTemplate, TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, resolveTemplate } from "../../lib/templates";
import { STD_EG_SEED } from "../../lib/templates/definitions";
import { MODULE_REGISTRY } from "../../modules/registry";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";

/**
 * Temporary rows for the BUILD_SPEC 12 Phase 3 done-when (e2e/README.md): per
 * Playwright project a client of its own and a base template, an active copy
 * of STD_EG under an E2E_ADMIN code, scoped to that client so it never
 * applies to an inspection someone else starts. The spec builds a new
 * template on the base through the screens and starts an inspection from
 * it; everything under the run's codes is deleted in afterAll: the source
 * files in Storage, the inspections (deleteTestInspection), the templates,
 * then the client. A run that died half way is cleaned up by the next one
 * once its rows are half an hour old.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const CODE_PREFIX = "E2E_ADMIN";
const RUN = randomBytes(3).toString("hex").toUpperCase();
const STALE_MS = 30 * 60 * 1000;
const SOURCES = "template-sources";
const CLIENT_PREFIX = "E2E admin flow client";

/** A seeded manufacturer (supabase/seed.sql uses fixed ids). */
export const HARTALEGA = { id: "10000000-0000-4000-8000-000000000001", label: "Hartalega NGC" } as const;

/**
 * This run's code for a project, by the project's initials: E2E_ADMIN_1A2B3C_IP_BASE
 * for ipad-portrait, _IPL_ for ipad-pro-landscape. A template code takes 40
 * characters at most, which the project's full name could pass.
 */
export function codeFor(project: string, name: string): string {
  const initials = project
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return `${CODE_PREFIX}_${RUN}_${initials}_${name}`;
}

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Admin template flow fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** STD_EG as its seed writes it (BUILD_SPEC 11), under a code of this run and scoped to the run's client. */
export function baseDefinition(code: string, clientId: string): TemplateDefinition {
  const std = STD_EG_SEED.definition();
  return {
    ...std,
    code,
    name: "E2E admin flow: STD_EG copy (temporary)",
    scope: { ...std.scope, clientId },
  };
}

function resolved(definition: TemplateDefinition): ResolvedTemplate {
  const resolution = resolveTemplate(definition, { getBase: lookupFrom([]), registry: MODULE_REGISTRY });
  if (!resolution.ok) throw new Error(`${definition.code} does not resolve: ${JSON.stringify(resolution.problems)}`);
  return resolution.template;
}

export type FlowFixture = {
  clientId: string;
  clientName: string;
  base: { id: string; code: string; definition: TemplateDefinition; resolved: ResolvedTemplate };
  /** The code the spec gives its new template. */
  newCode: string;
  /** A code another admin takes while the New Template form is open. */
  takenCode: string;
  inspectorId: string;
  cleanup: () => Promise<void>;
};

export async function createFlowFixture(project: string): Promise<FlowFixture> {
  const admin = createTestAdminClient();
  await removeStale(admin);
  const clientName = `${CLIENT_PREFIX} ${RUN} ${project} (temporary)`;
  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ name: clientName, notes: "Created and deleted by e2e/admin-template-flow. Safe to delete." })
    .select("id")
    .single();
  if (clientError) fail("creating the client", clientError);

  const codes = { base: codeFor(project, "BASE"), created: codeFor(project, "NEW"), taken: codeFor(project, "TAKEN") };
  const cleanup = () => removeRun(admin, Object.values(codes), client.id);
  try {
    const definition = baseDefinition(codes.base, client.id);
    const template = resolved(definition);
    const { data: base, error } = await admin
      .from("templates")
      .insert({
        code: definition.code,
        version: 1,
        status: "active",
        extends_code: null,
        product_type: definition.scope.productType,
        standard: definition.scope.standard,
        client_id: client.id,
        manufacturer_id: null,
        definition: definition as unknown as NonNullable<Json>,
        resolved: template as unknown as Json,
      })
      .select("id")
      .single();
    if (error) fail(`creating ${definition.code}`, error);

    const { data: inspector, error: inspectorError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", "inspector@test.local")
      .single();
    if (inspectorError) fail("finding the test inspector", inspectorError);

    return {
      clientId: client.id,
      clientName,
      base: { id: base.id, code: definition.code, definition, resolved: template },
      newCode: codes.created,
      takenCode: codes.taken,
      inspectorId: inspector.id,
      cleanup,
    };
  } catch (problem) {
    await cleanup().catch(() => undefined);
    throw problem;
  }
}

/** Another admin's template, made while the New Template form is open: a draft of its own, scoped to the run's client. */
export async function takeCode(code: string, clientId: string): Promise<void> {
  const definition: TemplateDefinition = {
    code,
    name: "E2E admin flow: taken code (temporary)",
    scope: { productType: "examination", standard: "EN455", clientId },
    unit: "pcs",
    sizes: [{ value: "M" }],
    modules: [],
  };
  const { error } = await createTestAdminClient()
    .from("templates")
    .insert({
      code,
      version: 1,
      status: "draft",
      product_type: "examination",
      standard: "EN455",
      client_id: clientId,
      definition: definition as unknown as NonNullable<Json>,
    });
  if (error) fail(`taking ${code}`, error);
}

export async function templatesOfCode(code: string) {
  const { data, error } = await createTestAdminClient()
    .from("templates")
    .select("id, version, status, extends_code, client_id, manufacturer_id, product_type, standard, source_file_path, coverage_confirmed_at, coverage_confirmed_by, definition, resolved")
    .eq("code", code)
    .order("version");
  if (error) fail(`reading ${code}`, error);
  return data;
}

export async function inspectionRow(id: string) {
  const { data, error } = await createTestAdminClient()
    .from("inspections")
    .select("id, template_id, inspector_id, client_id, manufacturer_id, status, data")
    .eq("id", id)
    .single();
  if (error) fail(`reading inspection ${id}`, error);
  return data;
}

/** Every object under a folder of template-sources, at any depth. */
async function listObjects(admin: AdminClient, folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(SOURCES).list(folder, { limit: 1000 });
  if (error) fail(`listing ${folder}`, error);
  const paths: string[] = [];
  for (const entry of data) {
    const path = `${folder}/${entry.name}`;
    if (entry.id === null) paths.push(...(await listObjects(admin, path)));
    else paths.push(path);
  }
  return paths;
}

/** Whether Storage still holds anything under a code's folder. */
export async function storedFiles(code: string): Promise<string[]> {
  return listObjects(createTestAdminClient(), code);
}

/** The codes' source files, the inspections that use them, the templates (children first), then the client. */
async function removeTemplates(admin: AdminClient, codes: readonly string[]): Promise<void> {
  for (const code of codes) {
    const objects = await listObjects(admin, code);
    if (objects.length > 0) {
      const removed = await admin.storage.from(SOURCES).remove(objects);
      if (removed.error) fail(`removing the files of ${code}`, removed.error);
    }
  }
  const { data: rows, error } = await admin.from("templates").select("id, extends_code").in("code", [...codes]);
  if (error) fail("finding the run's templates", error);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  const { data: inspections, error: inspectionError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (inspectionError) fail("finding the run's inspections", inspectionError);
  for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
  // A template that extends another goes first: nothing then refers to the base.
  const children = rows.filter((row) => row.extends_code !== null).map((row) => row.id);
  for (const batch of [children, ids.filter((id) => !children.includes(id))]) {
    if (batch.length === 0) continue;
    const deleted = await admin.from("templates").delete().in("id", batch);
    if (deleted.error) fail("deleting the run's templates", deleted.error);
  }
}

async function removeRun(admin: AdminClient, codes: readonly string[], clientId: string): Promise<void> {
  await removeTemplates(admin, codes);
  const { error } = await admin.from("clients").delete().eq("id", clientId);
  if (error) fail("deleting the run's client", error);
}

/** What a run that died half way left: E2E_ADMIN templates and clients over half an hour old. */
async function removeStale(admin: AdminClient): Promise<void> {
  const before = Date.now() - STALE_MS;
  const { data: rows, error } = await admin.from("templates").select("code, created_at").like("code", `${CODE_PREFIX}%`);
  if (error) fail("finding stale templates", error);
  const stale = [
    ...new Set(
      rows
        .filter((row) => row.code.startsWith(`${CODE_PREFIX}_`) && Date.parse(row.created_at) < before)
        .map((row) => row.code),
    ),
  ];
  if (stale.length > 0) await removeTemplates(admin, stale);
  const { data: clients, error: clientError } = await admin
    .from("clients")
    .select("id, created_at")
    .like("name", `${CLIENT_PREFIX} %`);
  if (clientError) fail("finding stale clients", clientError);
  for (const client of clients.filter((entry) => Date.parse(entry.created_at) < before)) {
    const { error: deleteError } = await admin.from("clients").delete().eq("id", client.id);
    if (deleteError) console.warn(`Admin template flow fixture: kept a stale client: ${deleteError.message}`);
  }
}
