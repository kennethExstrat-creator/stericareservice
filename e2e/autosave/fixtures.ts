import type { TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { resolveTemplate } from "../../modules";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the reload specs (e2e/README.md): one draft template,
 * resolved against the real modules, and one inspection of the test
 * inspector's. Deleted in afterAll; a run that died half way is cleaned up
 * by the next. Each run of a project draws one number from the live ref
 * sequence.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const AUTOSAVE_TEMPLATE_CODE = "E2E_AUTOSAVE";

const BUCKETS = ["inspection-photos", "inspection-files"] as const;

// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
} as const;

/**
 * header, glove_info, the custom "Site notes" (text, yes/no, number),
 * order_lots with packing_config on its page, tensile (per size),
 * dispensing_safedon (per size, one box at a time on the iPad) and
 * conclusion.
 */
function definition(): TemplateDefinition {
  return {
    code: AUTOSAVE_TEMPLATE_CODE,
    name: "Reload e2e gloves (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true },
      { key: "glove_info", include: true },
      { key: "order_lots", include: true },
      { key: "packing_config", include: true },
      { key: "tensile", include: true },
      { key: "dispensing_safedon", include: true },
      { key: "conclusion", include: true },
    ],
    customModules: [
      {
        key: "e2e_site_notes",
        title: "Site notes",
        after: "glove_info",
        layout: "fields",
        fields: [
          { key: "weather", label: "Weather at the site", type: "text" },
          { key: "sealIntact", label: "Container seal intact", type: "yes_no" },
          { key: "cartons", label: "Cartons on the pallet", type: "number" },
        ],
      },
    ],
    report: { title: "Reload e2e (temporary)", showClientLogo: false },
  };
}

export type AutosaveFixture = {
  inspectionId: string;
  /** The test inspector's id: the writer lock and the local copy are per user. */
  inspectorId: string;
  refNo: string;
  /** Replaces modules' saved data, as another device's save would. */
  setModules: (modules: Record<string, unknown>) => Promise<void>;
  /** The inspection's data as the server has it. */
  stored: () => Promise<{ modules?: Record<string, unknown>; custom?: Record<string, unknown> }>;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Autosave fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** The inspection's photos and files in Storage, then the inspection (Storage first: e2e/README.md). */
async function removeInspection(admin: AdminClient, inspectionId: string) {
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

async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", AUTOSAVE_TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const ids = templates.map((template) => template.id);
  if (ids.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (findError) fail("finding fixture inspections", findError);
  for (const inspection of inspections) await removeInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", ids);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

export async function createAutosaveFixture(): Promise<AutosaveFixture> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);
  try {
    return await insertFixtureRows(admin);
  } catch (error) {
    await removeFixtureRows(admin).catch(() => undefined);
    throw error;
  }
}

async function insertFixtureRows(admin: AdminClient): Promise<AutosaveFixture> {
  const { data: inspector, error: inspectorError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (inspectorError) fail("finding the test inspector", inspectorError);

  const template = definition();
  const resolution = resolveTemplate(template, lookupFrom([]));
  if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });
  const { data: row, error: templateError } = await admin
    .from("templates")
    .insert({
      ...templateRowFields(template, resolution.template),
      definition: template as unknown as NonNullable<Json>,
      resolved: resolution.template as unknown as Json,
      version: 1,
      status: "draft",
    })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  const { data: inspection, error: inspectionError } = await admin
    .from("inspections")
    .insert({
      template_id: row.id,
      inspector_id: inspector.id,
      client_id: SEED.polyco,
      manufacturer_id: SEED.hartalega,
    })
    .select("id, ref_no")
    .single();
  if (inspectionError) fail("creating the fixture inspection", inspectionError);

  const stored = async () => {
    const { data, error } = await admin.from("inspections").select("data").eq("id", inspection.id).single();
    if (error) fail("reading the inspection's data", error);
    return data.data as { modules?: Record<string, unknown>; custom?: Record<string, unknown> };
  };

  return {
    inspectionId: inspection.id,
    inspectorId: inspector.id,
    refNo: inspection.ref_no,
    stored,
    setModules: async (modules) => {
      const current = await stored();
      const data = { modules: { ...current.modules, ...modules }, custom: current.custom ?? {} };
      const written = await admin.from("inspections").update({ data: data as unknown as NonNullable<Json> }).eq("id", inspection.id);
      if (written.error) fail("writing the inspection's data", written.error);
    },
    cleanup: () => removeFixtureRows(admin),
  };
}
