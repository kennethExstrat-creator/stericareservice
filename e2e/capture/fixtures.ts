import type { TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { resolveTemplate } from "../../modules";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the capture specs (e2e/README.md): one template,
 * resolved against whichever modules are built at the time, and one
 * inspection of the test inspector's. The template is a draft, so no
 * inspector could start from it; only this inspection uses it. Everything
 * is deleted in afterAll, a run that died half way is cleaned up by the next.
 *
 * Each run of a project draws one number from the live ref sequence.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FIXTURE_TEMPLATE_CODE = "E2E_CAPTURE";

// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
} as const;

/** header, glove_info, a custom section, order_lots, packing_config, weight and conclusion. */
export function fixtureDefinition(): TemplateDefinition {
  return {
    code: FIXTURE_TEMPLATE_CODE,
    name: "Capture e2e gloves (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true },
      { key: "glove_info", include: true },
      { key: "order_lots", include: true },
      { key: "packing_config", include: true },
      { key: "weight", include: true },
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
          { key: "sealIntact", label: "Container seal intact", type: "yes_no", required: true },
        ],
      },
    ],
    report: { title: "Capture e2e (temporary)", showClientLogo: false },
  };
}

export type CaptureFixture = {
  inspectionId: string;
  refNo: string;
  /** Sets the inspection's status through the status flow, as an admin would. */
  setStatus: (status: "submitted" | "reopened" | "approved") => Promise<void>;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Capture fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** Deletes every row a previous run may have left behind. */
async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", FIXTURE_TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const ids = templates.map((template) => template.id);
  if (ids.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (findError) fail("finding fixture inspections", findError);
  for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", ids);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

export async function createCaptureFixture(): Promise<CaptureFixture> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);
  try {
    return await insertFixtureRows(admin);
  } catch (error) {
    await removeFixtureRows(admin).catch(() => undefined);
    throw error;
  }
}

async function insertFixtureRows(admin: AdminClient): Promise<CaptureFixture> {
  const { data: inspector, error: inspectorError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (inspectorError) fail("finding the test inspector", inspectorError);

  const definition = fixtureDefinition();
  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) {
    fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });
  }
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
    cleanup: () => removeFixtureRows(admin),
  };
}
