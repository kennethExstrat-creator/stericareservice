import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database, Json } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the /inspections/new specs (e2e/README.md): a client
 * and two manufacturers of their own, one active template for each level of
 * the most specific rule (BUILD_SPEC 4.4), and one earlier inspection by the
 * test inspector to start from. Every template is scoped to the fixture's
 * client or to its manufacturer A, so it only ever applies to picks of the
 * fixture's own rows, whatever else is in the shared database; manufacturer
 * B has none, so with no client only a standard template (no client, no
 * manufacturer) can apply there. No standard template is made here: it would
 * apply to anyone's new inspection while it existed.
 *
 *   E2E_NEW     the client at Hartalega   client and manufacturer   STD_EG
 *   E2E_NEW_CM  the client at A           client and manufacturer   STD_EG
 *   E2E_NEW_C   the client, anywhere      client                    STD_EG, no product name in its header
 *   E2E_NEW_M   anyone at A               manufacturer              SAFEDON_EG
 *
 * The templates are seed templates from the seed bundle under other codes,
 * so the page shows real templates: their modules, sizes and titles.
 * Everything is deleted afterwards: inspections through
 * deleteTestInspection(), then the templates, the client and the
 * manufacturers. A run that died half way is cleaned up by the next.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FIXTURE_TEMPLATE_CODE = "E2E_NEW";
export const FIXTURE_TEMPLATE_NAME = "E2E new inspection template (temporary)";
/** One template per level below the fixture's own (see above). */
export const LEVEL_TEMPLATES = {
  clientManufacturer: { code: "E2E_NEW_CM", name: "E2E new: the client at manufacturer A (temporary)" },
  client: { code: "E2E_NEW_C", name: "E2E new: the client anywhere (temporary)" },
  manufacturer: { code: "E2E_NEW_M", name: "E2E new: anyone at manufacturer A (temporary)" },
} as const;
const FIXTURE_CODES = [FIXTURE_TEMPLATE_CODE, ...Object.values(LEVEL_TEMPLATES).map((entry) => entry.code)];
export const FIXTURE_CLIENT_PREFIX = "E2E new client (temporary)";
export const FIXTURE_MANUFACTURER_PREFIX = "E2E new manufacturer";
/** Hartalega NGC, from supabase/seed.sql (fixed id). */
export const HARTALEGA = { id: "10000000-0000-4000-8000-000000000001", label: "Hartalega NGC" } as const;
/** Polyco Healthline, from supabase/seed.sql (fixed id): SAFEDON_EG's client once the seeds are live. */
export const POLYCO = { id: "20000000-0000-4000-8000-000000000001", label: "Polyco Healthline" } as const;

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
  order: { sizes: { M: { qtyCases: 400, lotNumbers: ["E2E-LOT-M-0001"], packingSite: null } } },
  sampling: { sizes: { M: { cases: 20 } } },
  cartons: { sizes: { M: { cartonNumbers: [32, 578] } } },
  conclusion: { finalResult: "pass", remark: "E2E remark, never copied" },
} as const;

export type FixtureManufacturer = { id: string; label: string; address: string | null };

export type NewFixture = {
  clientId: string;
  clientName: string;
  /** Has E2E_NEW_CM (with the client) and E2E_NEW_M (anyone). */
  manufacturerA: FixtureManufacturer;
  /** Has no template of its own. */
  manufacturerB: FixtureManufacturer;
  /** E2E_NEW's id. */
  templateId: string;
  /** Every fixture template's id, by code. */
  templateIds: Record<string, string>;
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

type ResolvedModule = { key: string; include: boolean; title: string; labels: Record<string, string>; config: Record<string, unknown> };
type Resolved = Record<string, unknown> & { modules: ResolvedModule[] };
type BundleEntry = { code: string; definition: Record<string, unknown>; resolved: Resolved };
type Scope = {
  productType: Database["public"]["Enums"]["product_type"];
  standard: Database["public"]["Enums"]["standard_code"];
  clientId?: string;
  manufacturerId?: string;
};

/** The seed bundle, as scripts/seed-templates.mts reads it (specs run from the project root, as playwright.config.ts). */
function seedBundle(): BundleEntry[] {
  return (JSON.parse(readFileSync(join(process.cwd(), "lib/templates/definitions/seed-bundle.json"), "utf8")) as { templates: BundleEntry[] })
    .templates;
}

export function seedTemplate(code: "STD_EG" | "SAFEDON_EG" | "STD_SG"): BundleEntry {
  return seedBundle().find((entry) => entry.code === code) ?? fail(`finding ${code} in the seed bundle`, null);
}

/** The keys of the modules a seed template switches on, in its order. */
export function includedModules(code: "STD_EG" | "SAFEDON_EG" | "STD_SG"): string[] {
  return seedTemplate(code)
    .resolved.modules.filter((entry) => entry.include)
    .map((entry) => entry.key);
}

/**
 * A seed template's resolution under another code, name and scope, with a
 * definition that stands on its own (no extends): what the editor would
 * have saved for it.
 */
function fixtureTemplate(
  from: "STD_EG" | "SAFEDON_EG",
  code: string,
  name: string,
  scope: Scope,
  change: (resolved: Resolved) => Resolved = (resolved) => resolved,
) {
  const base = seedTemplate(from).resolved;
  const resolved = change({ ...base, code, name, chain: [code], bases: [], scope });
  const definition = {
    code,
    name,
    scope,
    unit: resolved.unit,
    sizes: resolved.sizes,
    modules: resolved.modules.map(({ key, include, title, labels, config }) => ({ key, include, title, labels, config }) as Record<string, unknown>),
    ...(Array.isArray(resolved.customModules) && resolved.customModules.length > 0 ? { customModules: resolved.customModules } : {}),
    ...(resolved.report ? { report: resolved.report } : {}),
  };
  return {
    code,
    version: 1,
    product_type: scope.productType,
    standard: scope.standard,
    client_id: scope.clientId ?? null,
    manufacturer_id: scope.manufacturerId ?? null,
    status: "active" as const,
    definition: definition as unknown as NonNullable<Json>,
    resolved: resolved as unknown as Json,
  };
}

/** The header's product name switched off: the form then takes none. */
function withoutProductName(resolved: Resolved): Resolved {
  return {
    ...resolved,
    modules: resolved.modules.map((entry) =>
      entry.key === "header"
        ? { ...entry, config: { ...entry.config, fields: { ...(entry.config.fields as Record<string, boolean>), productName: false } } }
        : entry,
    ),
  };
}

/** Deletes every row a previous run may have left behind. */
async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").in("code", FIXTURE_CODES);
  if (error) fail("finding old fixture templates", error);
  const templateIds = templates.map((template) => template.id);
  if (templateIds.length > 0) {
    const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", templateIds);
    if (findError) fail("finding fixture inspections", findError);
    for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
    const removed = await admin.from("templates").delete().in("id", templateIds);
    if (removed.error) fail("deleting the fixture templates", removed.error);
  }
  const clients = await admin.from("clients").delete().like("name", `${FIXTURE_CLIENT_PREFIX}%`);
  if (clients.error) fail("deleting the fixture client", clients.error);
  const manufacturers = await admin.from("manufacturers").delete().like("name", `${FIXTURE_MANUFACTURER_PREFIX}%`);
  if (manufacturers.error) fail("deleting the fixture manufacturers", manufacturers.error);
}

/** Inspections the specs created through the page: deleted with the rest, found by their template. */
export async function inspectionsOfFixture(templateId: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin
    .from("inspections")
    .select(
      "id, ref_no, status, inspector_id, template_id, client_id, manufacturer_id, product_name, po_no, lot_numbers, inspection_date, suggested_result, result, remarks, data, created_at",
    )
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

/**
 * The active standard templates for a product type (no client, no
 * manufacturer), in the order the rule takes them: by code, then the
 * highest version. The first is what a pick with nothing more specific gets.
 */
export async function standardTemplates(productType: "examination" | "surgical") {
  const { data, error } = await createTestAdminClient()
    .from("templates")
    .select("code, version")
    .eq("status", "active")
    .eq("product_type", productType)
    .is("client_id", null)
    .is("manufacturer_id", null);
  if (error) fail("reading the standard templates", error);
  return data.sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);
}

/** Whether STD_EG, SAFEDON_EG and STD_SG are active (scripts/seed-templates.mts has run). */
export async function seedTemplatesLive(): Promise<boolean> {
  const { data, error } = await createTestAdminClient()
    .from("templates")
    .select("code")
    .eq("status", "active")
    .in("code", ["STD_EG", "SAFEDON_EG", "STD_SG"]);
  if (error) fail("reading the seed templates", error);
  return new Set(data.map((row) => row.code)).size === 3;
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

  const { data: hartalega, error: hartalegaError } = await admin.from("manufacturers").select("address").eq("id", HARTALEGA.id).single();
  if (hartalegaError) fail("reading Hartalega", hartalegaError);

  const run = Math.random().toString(36).slice(2, 6);
  const clientName = `${FIXTURE_CLIENT_PREFIX} ${run}`;
  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ name: clientName, notes: "Created and deleted by e2e/new. Safe to delete." })
    .select("id")
    .single();
  if (clientError) fail("creating the fixture client", clientError);

  const manufacturer = async (letter: "A" | "B", address: string | null): Promise<FixtureManufacturer> => {
    const label = `${FIXTURE_MANUFACTURER_PREFIX} ${letter} (temporary) ${run}`;
    const { data, error } = await admin
      .from("manufacturers")
      .insert({ name: label, address, notes: "Created and deleted by e2e/new. Safe to delete." })
      .select("id")
      .single();
    if (error) fail(`creating manufacturer ${letter}`, error);
    return { id: data.id, label, address };
  };
  const manufacturerA = await manufacturer("A", `E2E factory address ${run}, temporary`);
  const manufacturerB = await manufacturer("B", null);

  const examination = (standard: Scope["standard"], clientId?: string, manufacturerId?: string): Scope => ({
    productType: "examination",
    standard,
    ...(clientId ? { clientId } : {}),
    ...(manufacturerId ? { manufacturerId } : {}),
  });
  const rows = [
    fixtureTemplate("STD_EG", FIXTURE_TEMPLATE_CODE, FIXTURE_TEMPLATE_NAME, examination("EN455", client.id, HARTALEGA.id)),
    fixtureTemplate(
      "STD_EG",
      LEVEL_TEMPLATES.clientManufacturer.code,
      LEVEL_TEMPLATES.clientManufacturer.name,
      examination("EN455", client.id, manufacturerA.id),
    ),
    fixtureTemplate("STD_EG", LEVEL_TEMPLATES.client.code, LEVEL_TEMPLATES.client.name, examination("EN455", client.id), withoutProductName),
    fixtureTemplate(
      "SAFEDON_EG",
      LEVEL_TEMPLATES.manufacturer.code,
      LEVEL_TEMPLATES.manufacturer.name,
      examination("ASTM_D6319", undefined, manufacturerA.id),
    ),
  ];
  const { data: templates, error: templateError } = await admin.from("templates").insert(rows).select("id, code");
  if (templateError) fail("creating the fixture templates", templateError);
  const templateIds = Object.fromEntries(templates.map((row) => [row.code, row.id]));

  const { data: previous, error: previousError } = await admin
    .from("inspections")
    .insert({
      template_id: templateIds[FIXTURE_TEMPLATE_CODE],
      inspector_id: idOf(TEST_ACCOUNTS.inspector),
      client_id: client.id,
      manufacturer_id: HARTALEGA.id,
      product_name: PREVIOUS.productName,
      po_no: PREVIOUS.header.poNo,
      lot_numbers: [...PREVIOUS.order.sizes.M.lotNumbers],
      inspection_date: "2026-09-01",
      data: {
        modules: {
          header: PREVIOUS.header,
          glove_info: PREVIOUS.gloveInfo,
          order_lots: PREVIOUS.order,
          packing_config: PREVIOUS.packing,
          sampling_plan: PREVIOUS.sampling,
          carton_sampling: PREVIOUS.cartons,
          conclusion: PREVIOUS.conclusion,
        },
        custom: { glove_type: { gloveType: "E2E powder free, never copied" } },
      } as unknown as NonNullable<Json>,
    })
    .select("id, ref_no")
    .single();
  if (previousError) fail("creating the earlier inspection", previousError);
  const submitted = await admin.from("inspections").update({ status: "submitted" }).eq("id", previous.id);
  if (submitted.error) fail("submitting the earlier inspection", submitted.error);

  return {
    clientId: client.id,
    clientName,
    manufacturerA,
    manufacturerB,
    templateId: templateIds[FIXTURE_TEMPLATE_CODE],
    templateIds,
    previousId: previous.id,
    previousRef: previous.ref_no,
    inspectorId: idOf(TEST_ACCOUNTS.inspector),
    adminId: idOf(TEST_ACCOUNTS.admin),
    manufacturerAddress: hartalega.address?.trim() || null,
    cleanup: () => removeFixtureRows(admin),
  };
}
