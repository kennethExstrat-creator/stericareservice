import type { TablesInsert } from "../../lib/supabase/database.types";
import { createTestAdminClient } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the inspections list specs. There is no capture screen
 * until Phase 2, so the specs insert inspections with the secret key and
 * delete them afterwards: inspections first, then the template and the
 * client they point at. A run that died half way is cleaned up by the next.
 *
 * Side effects that cannot be undone through the API, by design: each
 * inspection draws a number from the ref sequence, and each deletion leaves an
 * audit row (action "deleted"), visible to admins only.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FIXTURE_TEMPLATE_CODE = "E2E_LIST";
export const FIXTURE_CLIENT_NAME = "E2E list client (temporary)";

// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
  terangNusa: "10000000-0000-4000-8000-000000000002",
} as const;

/** A PO with every character PostgREST's filter syntax treats specially. */
export const HOSTILE_PO = "E2E-PO-2,(rev.1)*%";

export type FixtureKey = "A" | "B" | "C";

export type ListFixture = {
  /** Ref numbers by key: A and B belong to the inspector, C to the admin. */
  refs: Record<FixtureKey, string>;
  clientId: string;
  manufacturers: typeof SEED;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Inspections list fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** Deletes every row a previous run may have left behind. */
async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", FIXTURE_TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const templateIds = templates.map((template) => template.id);

  if (templateIds.length > 0) {
    const inspections = await admin.from("inspections").delete().in("template_id", templateIds);
    if (inspections.error) fail("deleting fixture inspections", inspections.error);
    const removed = await admin.from("templates").delete().in("id", templateIds);
    if (removed.error) fail("deleting the fixture template", removed.error);
  }

  const client = await admin.from("clients").delete().eq("name", FIXTURE_CLIENT_NAME);
  if (client.error) fail("deleting the fixture client", client.error);
}

/** Inspections in the shared database that a test account can see. */
export async function countVisibleInspections(account: "inspector" | "admin"): Promise<number> {
  const admin = createTestAdminClient();
  let query = admin.from("inspections").select("id", { count: "exact", head: true });
  if (account === "inspector") {
    const { data, error } = await admin.from("profiles").select("id").eq("email", TEST_ACCOUNTS.inspector).single();
    if (error) fail("finding the inspector", error);
    query = query.eq("inspector_id", data.id);
  }
  const { count, error } = await query;
  if (error) fail("counting inspections", error);
  return count ?? 0;
}

/**
 * Three inspections across both test accounts, each in a different status:
 *   A  inspector  draft      1 Oct  fixture client  Hartalega    no result
 *   B  inspector  submitted  3 Oct  fixture client  Terang Nusa  passed     HOSTILE_PO
 *   C  admin      reopened   2 Oct  Polyco          Terang Nusa  on hold
 */
export async function createListFixture(): Promise<ListFixture> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);

  const { data: people, error: peopleError } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_ACCOUNTS.inspector, TEST_ACCOUNTS.admin]);
  if (peopleError) fail("finding the test accounts", peopleError);
  const idOf = (email: string) => people.find((person) => person.email === email)?.id ?? fail(`finding ${email}`, null);
  const inspectorId = idOf(TEST_ACCOUNTS.inspector);
  const adminId = idOf(TEST_ACCOUNTS.admin);

  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ name: FIXTURE_CLIENT_NAME, notes: "Created and deleted by e2e/list. Safe to delete." })
    .select("id")
    .single();
  if (clientError) fail("creating the fixture client", clientError);

  // A draft template no inspector could start from; only these rows use it.
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({
      code: FIXTURE_TEMPLATE_CODE,
      version: 1,
      product_type: "examination",
      standard: "EN455",
      status: "draft",
      definition: { code: FIXTURE_TEMPLATE_CODE, name: "Inspections list e2e fixture (temporary)", modules: [] },
    })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  const specs: { key: FixtureKey; row: Omit<TablesInsert<"inspections">, "template_id"> }[] = [
    {
      key: "A",
      row: {
        inspector_id: inspectorId,
        inspection_date: "2026-10-01",
        client_id: client.id,
        manufacturer_id: SEED.hartalega,
        po_no: "E2E-LIST-PO-100",
        product_name: "Nitrile examination gloves, blue",
        lot_numbers: ["E2E-LOT-A1", "E2E-LOT-A2"],
      },
    },
    {
      key: "B",
      row: {
        inspector_id: inspectorId,
        inspection_date: "2026-10-03",
        client_id: client.id,
        manufacturer_id: SEED.terangNusa,
        po_no: HOSTILE_PO,
        product_name: "Nitrile examination gloves, white",
        lot_numbers: ["E2E-LOT-B1"],
        result: "pass",
      },
    },
    {
      key: "C",
      row: {
        inspector_id: adminId,
        inspection_date: "2026-10-02",
        client_id: SEED.polyco,
        manufacturer_id: SEED.terangNusa,
        po_no: "E2E-LIST-PO-300",
        product_name: "Safedon nitrile examination gloves",
        lot_numbers: ["E2E-LOT-C3"],
        result: "hold",
      },
    },
  ];

  // Every inspection starts as a draft; the status flow moves B and C on.
  const { data: inserted, error: insertError } = await admin
    .from("inspections")
    .insert(specs.map(({ row }) => ({ ...row, template_id: template.id })))
    .select("id, ref_no, po_no");
  if (insertError) fail("creating the fixture inspections", insertError);

  const insertedAs = (key: FixtureKey) => {
    const po = specs.find((spec) => spec.key === key)?.row.po_no;
    return inserted.find((inspection) => inspection.po_no === po) ?? fail(`finding inspection ${key}`, null);
  };
  const byKey = { A: insertedAs("A"), B: insertedAs("B"), C: insertedAs("C") };

  const submitted = await admin.from("inspections").update({ status: "submitted" }).in("id", [byKey.B.id, byKey.C.id]);
  if (submitted.error) fail("submitting B and C", submitted.error);
  const reopened = await admin.from("inspections").update({ status: "reopened" }).eq("id", byKey.C.id);
  if (reopened.error) fail("reopening C", reopened.error);

  return {
    refs: { A: byKey.A.ref_no, B: byKey.B.ref_no, C: byKey.C.ref_no },
    clientId: client.id,
    manufacturers: SEED,
    cleanup: () => removeFixtureRows(admin),
  };
}
