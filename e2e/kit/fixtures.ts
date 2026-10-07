import type { TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { resolveTemplate } from "../../modules";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the kit specs (e2e/README.md): one draft template,
 * resolved against the real modules, with the modules whose screens use the
 * kit's browser-only parts (a measurement grid, quantity cells, box pickers,
 * Safedon's box switcher, one-off defect rows, the documents and loading tag
 * lines), and one inspection of the test inspector's. Everything is deleted
 * in afterAll; a run that died half way is cleaned up by the next.
 *
 * Each run of a project draws one number from the live ref sequence.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const KIT_TEMPLATE_CODE = "E2E_GLUE_KIT";

const BUCKETS = ["inspection-photos", "inspection-files"] as const;

// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
} as const;

/** Safedon's boxes per size here: few enough to step through to the end. */
export const SAFEDON_BOXES = 3;

export function kitDefinition(): TemplateDefinition {
  return {
    code: KIT_TEMPLATE_CODE,
    name: "Kit e2e gloves (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true },
      { key: "order_lots", include: true },
      { key: "dimensions", include: true },
      { key: "visual", include: true },
      { key: "dispensing_safedon", include: true, config: { boxesPerSize: { default: SAFEDON_BOXES } } },
      { key: "labeling", include: true },
      { key: "documents", include: true },
      { key: "loading", include: true },
      { key: "conclusion", include: true },
    ],
    report: { title: "Kit e2e (temporary)", showClientLogo: false },
  };
}

/** Sizes S and M ordered; one carton picked for size M's carton labelling. */
export const KIT_DATA = {
  order_lots: { sizes: { S: { qtyCases: 100 }, M: { qtyCases: 200 } } },
  labeling: { sizes: { M: { carton: { inspected: 1, boxNos: [253] } } } },
} as const;

export type KitFixture = {
  inspectionId: string;
  refNo: string;
  /** Submits the inspection, as the status flow would: read-only from then on. */
  setStatus: (status: "submitted") => Promise<void>;
  /** The inspection's saved modules. */
  modules: () => Promise<Record<string, unknown>>;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Kit fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** The inspection's photos and files in Storage, then the inspection (Storage first: e2e/README.md). */
async function removeInspection(admin: AdminClient, inspectionId: string) {
  for (const bucket of BUCKETS) {
    const paths: string[] = [];
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) fail(`listing ${bucket}/${folder}`, error);
      // Folders come back as entries without an id.
      for (const entry of data) if (entry.id) paths.push(`${folder}/${entry.name}`);
    }
    if (paths.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) fail(`removing ${bucket} objects of ${inspectionId}`, error);
  }
  await deleteTestInspection(admin, inspectionId);
}

/** Deletes every row a previous run may have left behind. */
async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", KIT_TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const ids = templates.map((template) => template.id);
  if (ids.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (findError) fail("finding fixture inspections", findError);
  for (const inspection of inspections) await removeInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", ids);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

export async function createKitFixture(): Promise<KitFixture> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);
  try {
    return await insertFixtureRows(admin);
  } catch (error) {
    await removeFixtureRows(admin).catch(() => undefined);
    throw error;
  }
}

async function insertFixtureRows(admin: AdminClient): Promise<KitFixture> {
  const { data: inspector, error: inspectorError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (inspectorError) fail("finding the test inspector", inspectorError);

  const definition = kitDefinition();
  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({
      ...templateRowFields(definition, resolution.template),
      definition: definition as unknown as NonNullable<Json>,
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
      template_id: template.id,
      inspector_id: inspector.id,
      client_id: SEED.polyco,
      manufacturer_id: SEED.hartalega,
      data: { modules: KIT_DATA, custom: {} } as unknown as NonNullable<Json>,
    })
    .select("id, ref_no")
    .single();
  if (inspectionError) fail("creating the fixture inspection", inspectionError);

  return {
    inspectionId: inspection.id,
    refNo: inspection.ref_no,
    setStatus: async (status) => {
      const { error } = await admin.from("inspections").update({ status }).eq("id", inspection.id);
      if (error) fail(`moving the inspection to ${status}`, error);
    },
    modules: async () => {
      const { data, error } = await admin.from("inspections").select("data").eq("id", inspection.id).single();
      if (error) fail("reading the inspection's data", error);
      return (data.data as { modules?: Record<string, unknown> }).modules ?? {};
    },
    cleanup: () => removeFixtureRows(admin),
  };
}
