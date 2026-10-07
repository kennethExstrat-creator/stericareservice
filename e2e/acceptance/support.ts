import { TemplateDefinitionSchema, type TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { resolveTemplate } from "../../modules";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the acceptance spec sg-and-flows.spec.ts (e2e/README.md,
 * "Rules for the shared database"):
 *
 * - the STD_SG inspection the spec creates through /inspections/new, found
 *   again by its product name (SG_PRODUCT_NAME) when a run died half way;
 * - one draft template E2E_FINAL_SGFLOWS, a copy of the active STD_EG with
 *   `weight` switched off, and one inspection of the test inspector's on it
 *   (inserted without id or ref_no: the database draws the ref number).
 *
 * The template stays a draft, so nobody can start an inspection from it on
 * /inspections/new while Kenneth works. Everything is deleted in afterAll,
 * Storage first, and a run that died is cleaned up by the next.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FLOWS_TEMPLATE_CODE = "E2E_FINAL_SGFLOWS";
/** The STD_SG inspection's product name, set on /inspections/new: how a leftover is found. */
export const SG_PRODUCT_NAME = "E2E FINAL SG acceptance glove (placeholder)";
/** The module the temporary template switches off. */
export const TEMPLATE_OFF = "weight";
/** The module an admin switches off for the one inspection. */
export const OVERRIDE_OFF = "force_at_break";
/**
 * Saved under the switched-off module before the switch (as from an earlier
 * version of the form): text in a numeric cell, which the weight module would
 * report as an error blocking submit, were it on (BUILD_SPEC 6.2 rule 1).
 */
export const STALE_WEIGHT = { sizes: { M: { values: ["2 42", 4.31] } } };

const BUCKETS = ["inspection-photos", "inspection-files"] as const;

// Reference rows from supabase/seed.sql, which uses fixed ids.
export const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
} as const;

export type StoredInspection = {
  id: string;
  ref_no: string;
  status: string;
  data: { modules?: Record<string, unknown>; custom?: Record<string, unknown> };
  module_overrides: Record<string, unknown> | null;
  suggested_result: string | null;
  result: string | null;
  po_no: string | null;
  product_name: string | null;
  updated_at: string;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Acceptance fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

export function adminClient(): AdminClient {
  return createTestAdminClient();
}

export async function testInspectorId(admin: AdminClient): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("email", TEST_ACCOUNTS.inspector).single();
  if (error) fail("finding the test inspector", error);
  return data.id;
}

/** The inspection's photos and files in Storage, then the inspection (Storage first: e2e/README.md). */
export async function removeInspection(admin: AdminClient, inspectionId: string): Promise<void> {
  for (const bucket of BUCKETS) {
    const paths: string[] = [];
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) fail(`listing ${bucket}/${folder}`, error);
      for (const entry of data) if (entry.id) paths.push(`${folder}/${entry.name}`);
    }
    if (paths.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) fail(`removing ${bucket} objects of ${inspectionId}`, error);
  }
  await deleteTestInspection(admin, inspectionId);
}

/** Every row an earlier run of this spec left behind: its template, the inspections on it, and its STD_SG inspections. */
export async function removeLeftovers(admin: AdminClient): Promise<void> {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", FLOWS_TEMPLATE_CODE);
  if (error) fail("finding old templates", error);
  const ids = templates.map((template) => template.id);
  if (ids.length > 0) {
    const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
    if (findError) fail("finding old inspections", findError);
    for (const inspection of inspections) await removeInspection(admin, inspection.id);
    const removed = await admin.from("templates").delete().in("id", ids);
    if (removed.error) fail("deleting the old template", removed.error);
  }
  const inspector = await testInspectorId(admin);
  const { data: sg, error: sgError } = await admin
    .from("inspections")
    .select("id")
    .eq("inspector_id", inspector)
    .eq("product_name", SG_PRODUCT_NAME);
  if (sgError) fail("finding old STD_SG inspections", sgError);
  for (const inspection of sg) await removeInspection(admin, inspection.id);
}

export async function readInspection(admin: AdminClient, inspectionId: string): Promise<StoredInspection> {
  const { data, error } = await admin
    .from("inspections")
    .select("id, ref_no, status, data, module_overrides, suggested_result, result, po_no, product_name, updated_at")
    .eq("id", inspectionId)
    .single();
  if (error) fail("reading the inspection", error);
  return data as unknown as StoredInspection;
}

export async function auditOf(admin: AdminClient, inspectionId: string) {
  const { data, error } = await admin
    .from("audit_log")
    .select("action, changes, actor_id, at")
    .eq("inspection_id", inspectionId)
    .order("at");
  if (error) fail("reading the audit log", error);
  return data;
}

export type FlowsFixture = {
  templateId: string;
  inspectionId: string;
  refNo: string;
  /** The template as resolved: titles of the modules, in screen order. */
  titles: Record<string, string>;
  /** The sections capture lists: included modules and custom modules, in screen order. */
  sectionTitles: string[];
};

/**
 * The active STD_EG, copied as a draft with `weight` switched off, and one
 * inspection on it for the test inspector: size M ordered (20 cases), the
 * sampling plan's 13 gloves for the physical test, and STALE_WEIGHT under the
 * switched-off module.
 */
export async function createFlowsFixture(admin: AdminClient): Promise<FlowsFixture> {
  const { data: base, error: baseError } = await admin
    .from("templates")
    .select("definition")
    .eq("code", "STD_EG")
    .eq("status", "active")
    .single();
  if (baseError) fail("reading the active STD_EG", baseError);
  const copied = TemplateDefinitionSchema.parse(base.definition);
  const definition: TemplateDefinition = {
    ...copied,
    code: FLOWS_TEMPLATE_CODE,
    name: "E2E final: STD_EG without weight (temporary)",
    modules: copied.modules.map((entry) => (entry.key === TEMPLATE_OFF ? { ...entry, include: false } : entry)),
  };
  delete definition.sourceFile;
  if (!definition.modules.some((entry) => entry.key === TEMPLATE_OFF)) {
    fail("switching weight off", { message: "STD_EG has no weight module" });
  }

  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) fail("resolving the template", { message: JSON.stringify(resolution.problems) });
  const resolved = resolution.template;
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({
      ...templateRowFields(definition, resolved),
      definition: definition as unknown as NonNullable<Json>,
      resolved: resolved as unknown as Json,
      version: 1,
      status: "draft",
    })
    .select("id")
    .single();
  if (templateError) fail("creating the template", templateError);

  const inspector = await testInspectorId(admin);
  const { data: inspection, error: inspectionError } = await admin
    .from("inspections")
    .insert({
      template_id: template.id,
      inspector_id: inspector,
      client_id: SEED.polyco,
      manufacturer_id: SEED.hartalega,
      data: {
        modules: {
          order_lots: { sizes: { M: { qtyCases: 20, lotNumbers: ["LOT-E2E-M"] } } },
          sampling_plan: { sizes: { M: { glovesPhysical: 13 } } },
          [TEMPLATE_OFF]: STALE_WEIGHT,
        },
        custom: {},
      } as unknown as NonNullable<Json>,
    })
    .select("id, ref_no")
    .single();
  if (inspectionError) fail("creating the inspection", inspectionError);

  const titles = Object.fromEntries(resolved.modules.map((entry) => [entry.key, entry.title]));
  const sectionTitles: string[] = [];
  for (const entry of resolved.modules) {
    if (entry.include) sectionTitles.push(entry.title);
    for (const custom of resolved.customModules.filter((candidate) => candidate.after === entry.key)) {
      sectionTitles.push(custom.title);
    }
  }
  return { templateId: template.id, inspectionId: inspection.id, refNo: inspection.ref_no, titles, sectionTitles };
}

/** Today in Malaysia (the inspection date's time zone), as a date input takes it. */
export function todayInMalaysia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}
