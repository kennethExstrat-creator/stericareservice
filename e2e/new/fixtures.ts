import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Json } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the /inspections/new specs (e2e/README.md): a client of
 * their own, an active template E2E_NEW scoped to that client at Hartalega
 * (so it only ever applies to that client, whatever else is in the shared
 * database), and one earlier inspection by the test inspector to start from.
 * Everything is deleted afterwards: inspections through
 * deleteTestInspection(), then the template, then the client. A run that died
 * half way is cleaned up by the next.
 *
 * The template is STD_EG from the seed bundle under another code, so the page
 * shows a real template: its modules, sizes and titles.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FIXTURE_TEMPLATE_CODE = "E2E_NEW";
export const FIXTURE_TEMPLATE_NAME = "E2E new inspection template (temporary)";
export const FIXTURE_CLIENT_PREFIX = "E2E new client (temporary)";
/** Hartalega NGC, from supabase/seed.sql (fixed id). */
export const HARTALEGA = { id: "10000000-0000-4000-8000-000000000001", label: "Hartalega NGC" } as const;
/** Terang Nusa, from supabase/seed.sql: no E2E template applies there. */
export const TERANG_NUSA = { id: "10000000-0000-4000-8000-000000000002", label: "Terang Nusa Sdn. Bhd. · TG Factory 40" } as const;

/** What the earlier inspection holds: what start-from-previous must copy, and what it must not. */
export const PREVIOUS = {
  productName: "E2E Nitrile examination gloves, blue",
  header: {
    factoryAddress: "Factory address placeholder",
    productName: "E2E Nitrile examination gloves, blue",
    productCode: "E2E-GN-0001",
    factoryGloveCode: "E2E-FGC-01",
    poNo: "E2E-PO-OLD-0001",
    mfgDate: "2026-08-01",
    expiryDate: "2029-07-31",
    inspectionDate: "2026-09-01",
    comment: "E2E header comment, never copied",
  },
  gloveInfo: { surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: "240 mm minimum" },
  packing: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000, packingMode: "10 boxes per carton" },
  /** Never copied. */
  sampling: { sizes: { M: { cases: 20 } } },
  conclusion: { finalResult: "pass", remark: "E2E remark, never copied" },
} as const;

export type NewFixture = {
  clientId: string;
  clientName: string;
  templateId: string;
  previousId: string;
  previousRef: string;
  inspectorId: string;
  adminId: string;
  /** Hartalega's address as the database holds it: a new inspection's header starts with it. */
  manufacturerAddress: string | null;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`New inspection fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

type BundleEntry = { code: string; definition: Record<string, unknown>; resolved: Record<string, unknown> };

/** STD_EG from lib/templates/definitions/seed-bundle.json, renamed and scoped to the fixture's client. */
function fixtureTemplate(clientId: string) {
  // Specs run from the project root, as playwright.config.ts does (it reads .env.local from there).
  const bundle = JSON.parse(
    readFileSync(join(process.cwd(), "lib/templates/definitions/seed-bundle.json"), "utf8"),
  ) as { templates: BundleEntry[] };
  const base = bundle.templates.find((entry) => entry.code === "STD_EG") ?? fail("finding STD_EG in the seed bundle", null);
  const scope = { productType: "examination", standard: "EN455", clientId, manufacturerId: HARTALEGA.id };
  return {
    definition: { ...base.definition, code: FIXTURE_TEMPLATE_CODE, name: FIXTURE_TEMPLATE_NAME, scope },
    resolved: {
      ...base.resolved,
      code: FIXTURE_TEMPLATE_CODE,
      name: FIXTURE_TEMPLATE_NAME,
      chain: [FIXTURE_TEMPLATE_CODE],
      bases: [],
      scope,
    },
  };
}

/** Deletes every row a previous run may have left behind. */
async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", FIXTURE_TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const templateIds = templates.map((template) => template.id);
  if (templateIds.length > 0) {
    const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", templateIds);
    if (findError) fail("finding fixture inspections", findError);
    for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
    const removed = await admin.from("templates").delete().in("id", templateIds);
    if (removed.error) fail("deleting the fixture template", removed.error);
  }
  const clients = await admin.from("clients").delete().like("name", `${FIXTURE_CLIENT_PREFIX}%`);
  if (clients.error) fail("deleting the fixture client", clients.error);
}

/** Inspections the specs created through the page: deleted with the rest, found by the fixture template. */
export async function inspectionsOfFixture(templateId: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin
    .from("inspections")
    .select("id, ref_no, status, inspector_id, template_id, client_id, manufacturer_id, product_name, inspection_date, data, created_at")
    .eq("template_id", templateId)
    .order("created_at");
  if (error) fail("reading the fixture inspections", error);
  return data;
}

export async function auditOf(inspectionId: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin.from("audit_log").select("action, changes, actor_id").eq("inspection_id", inspectionId);
  if (error) fail("reading the audit log", error);
  return data;
}

export async function createNewFixture(): Promise<NewFixture> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);
  try {
    return await insertFixtureRows(admin);
  } catch (error) {
    await removeFixtureRows(admin).catch(() => undefined);
    throw error;
  }
}

async function insertFixtureRows(admin: AdminClient): Promise<NewFixture> {
  const { data: people, error: peopleError } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_ACCOUNTS.inspector, TEST_ACCOUNTS.admin]);
  if (peopleError) fail("finding the test accounts", peopleError);
  const idOf = (email: string) => people.find((person) => person.email === email)?.id ?? fail(`finding ${email}`, null);

  const { data: manufacturer, error: manufacturerError } = await admin
    .from("manufacturers")
    .select("address")
    .eq("id", HARTALEGA.id)
    .single();
  if (manufacturerError) fail("reading Hartalega", manufacturerError);

  const clientName = `${FIXTURE_CLIENT_PREFIX} ${Math.random().toString(36).slice(2, 6)}`;
  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ name: clientName, notes: "Created and deleted by e2e/new. Safe to delete." })
    .select("id")
    .single();
  if (clientError) fail("creating the fixture client", clientError);

  const { definition, resolved } = fixtureTemplate(client.id);
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({
      code: FIXTURE_TEMPLATE_CODE,
      version: 1,
      product_type: "examination",
      standard: "EN455",
      client_id: client.id,
      manufacturer_id: HARTALEGA.id,
      status: "active",
      definition: definition as Json as NonNullable<Json>,
      resolved: resolved as Json,
    })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  const { data: previous, error: previousError } = await admin
    .from("inspections")
    .insert({
      template_id: template.id,
      inspector_id: idOf(TEST_ACCOUNTS.inspector),
      client_id: client.id,
      manufacturer_id: HARTALEGA.id,
      product_name: PREVIOUS.productName,
      po_no: PREVIOUS.header.poNo,
      inspection_date: "2026-09-01",
      data: {
        modules: {
          header: PREVIOUS.header,
          glove_info: PREVIOUS.gloveInfo,
          packing_config: PREVIOUS.packing,
          sampling_plan: PREVIOUS.sampling,
          conclusion: PREVIOUS.conclusion,
        },
        custom: { glove_type: { gloveType: "E2E powder free, never copied" } },
      },
    })
    .select("id, ref_no")
    .single();
  if (previousError) fail("creating the earlier inspection", previousError);
  const submitted = await admin.from("inspections").update({ status: "submitted" }).eq("id", previous.id);
  if (submitted.error) fail("submitting the earlier inspection", submitted.error);

  return {
    clientId: client.id,
    clientName,
    templateId: template.id,
    previousId: previous.id,
    previousRef: previous.ref_no,
    inspectorId: idOf(TEST_ACCOUNTS.inspector),
    adminId: idOf(TEST_ACCOUNTS.admin),
    manufacturerAddress: manufacturer.address?.trim() || null,
    cleanup: () => removeFixtureRows(admin),
  };
}
