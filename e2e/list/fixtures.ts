import { lookupFrom, templateRowFields } from "@/lib/templates";
import { TemplateDefinitionSchema } from "@/lib/schemas/template";
import { resolveTemplate } from "@/modules";
import type { TablesInsert } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the inspections list specs, inserted with the secret key
 * (quicker and more varied than creating them through the screens) and
 * deleted afterwards (e2e/README.md): each inspection through
 * deleteTestInspection(), since the service role may not delete an approved
 * one, then the template and the client they point at. Only the draft made
 * for Delete (createDraftWithEvidence) has Storage files, removed before its
 * row. A run that died half way is cleaned up by the next.
 *
 * The template is resolved with the real modules, so a row's Continue, Review
 * or View opens a capture screen or a review that renders like any other.
 *
 * Side effects that cannot be undone through the API, by design: each
 * inspection draws a number from the ref sequence, and each deletion leaves an
 * audit row (action "deleted"), visible to admins only.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FIXTURE_TEMPLATE_CODE = "E2E_LIST";
export const FIXTURE_CLIENT_NAME = "E2E list client (temporary)";

const DEFINITION = TemplateDefinitionSchema.parse({
  code: FIXTURE_TEMPLATE_CODE,
  name: "Inspections list e2e fixture (temporary)",
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
  modules: [
    { key: "header", include: true },
    { key: "glove_info", include: true },
    { key: "conclusion", include: true },
  ],
});

// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
  terangNusa: "10000000-0000-4000-8000-000000000002",
} as const;

/** A PO with every character PostgREST's filter syntax treats specially. */
export const HOSTILE_PO = "E2E-PO-2,(rev.1)*%";

/** E's lot as an iPad keyboard saves it: only the first letter in capitals (printed E2E-LOT-E5 style). */
export const MIXED_CASE_LOT = "Lt-E2E-E5";
/** E's sampled cartons (size M), a blank cell between them as the grid saves it. */
export const E_CARTONS = [97531, 97532] as const;

export type FixtureKey = "A" | "B" | "C" | "D" | "E";

export type ListFixture = {
  /** Ref numbers by key: A, B, D and E belong to the inspector, C to the admin. */
  refs: Record<FixtureKey, string>;
  /** Inspection ids by key, for the pages a row opens. */
  ids: Record<FixtureKey, string>;
  clientId: string;
  manufacturers: typeof SEED;
  /** The fixture template and the inspector, for drafts a test makes of its own. */
  templateId: string;
  inspectorId: string;
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
    const { data: inspections, error: findError } = await admin
      .from("inspections")
      .select("id")
      .in("template_id", templateIds);
    if (findError) fail("finding fixture inspections", findError);
    for (const inspection of inspections) {
      // Only the draft made for Delete has Storage files; remove them first (e2e/README.md).
      const left = await storedObjects(inspection.id);
      if (left.photos.length > 0) await admin.storage.from(PHOTO_BUCKET).remove(left.photos);
      if (left.files.length > 0) await admin.storage.from(FILE_BUCKET).remove(left.files);
      await deleteTestInspection(admin, inspection.id);
    }
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
 * Five inspections across both test accounts, one in each status, and a
 * draft just started:
 *   A  inspector  draft      1 Oct   fixture client  Hartalega    no result
 *   B  inspector  submitted  3 Oct   fixture client  Terang Nusa  passed     HOSTILE_PO
 *   C  admin      reopened   2 Oct   Polyco          Terang Nusa  on hold
 *   D  inspector  approved   30 Sep  Polyco          Hartalega    failed
 *   E  inspector  draft      29 Sep  no client, manufacturer, product or PO yet;
 *                                    lot MIXED_CASE_LOT, cartons E_CARTONS
 */
export async function createListFixture(): Promise<ListFixture> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);
  try {
    return await insertFixtureRows(admin);
  } catch (error) {
    // afterAll gets no fixture to clean up, so remove what was made so far.
    await removeFixtureRows(admin).catch(() => undefined);
    throw error;
  }
}

async function insertFixtureRows(admin: AdminClient): Promise<ListFixture> {
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

  const resolution = resolveTemplate(DEFINITION, lookupFrom([]));
  if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });

  // A draft template no inspector could start from; only these rows use it.
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({ ...templateRowFields(DEFINITION, resolution.template), version: 1, status: "draft" })
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
    {
      key: "D",
      row: {
        inspector_id: inspectorId,
        inspection_date: "2026-09-30",
        client_id: SEED.polyco,
        manufacturer_id: SEED.hartalega,
        po_no: "E2E-LIST-PO-400",
        product_name: "Nitrile examination gloves, long cuff",
        lot_numbers: ["E2E-LOT-D4"],
        result: "fail",
      },
    },
    {
      // Nothing chosen or typed in the header yet: the row shows dashes, and
      // says "No PO yet" and so on to screen readers only.
      key: "E",
      row: {
        inspector_id: inspectorId,
        inspection_date: "2026-09-29",
        lot_numbers: [MIXED_CASE_LOT],
        data: {
          modules: { carton_sampling: { sizes: { M: { cartonNumbers: [E_CARTONS[0], null, E_CARTONS[1]] } } } },
          custom: {},
        },
      },
    },
  ];

  // Every inspection starts as a draft; the status flow moves B, C and D on.
  // A field a row leaves out takes the column's default (an empty data for
  // A to D), not null.
  const { data: inserted, error: insertError } = await admin
    .from("inspections")
    .insert(
      specs.map(({ row }) => ({ ...row, template_id: template.id })),
      { defaultToNull: false },
    )
    .select("id, ref_no, po_no");
  if (insertError) fail("creating the fixture inspections", insertError);

  // Each has its own PO; E is the one without.
  const insertedAs = (key: FixtureKey) => {
    const po = specs.find((spec) => spec.key === key)?.row.po_no ?? null;
    return inserted.find((inspection) => inspection.po_no === po) ?? fail(`finding inspection ${key}`, null);
  };
  const byKey = { A: insertedAs("A"), B: insertedAs("B"), C: insertedAs("C"), D: insertedAs("D"), E: insertedAs("E") };

  const submitted = await admin
    .from("inspections")
    .update({ status: "submitted" })
    .in("id", [byKey.B.id, byKey.C.id, byKey.D.id]);
  if (submitted.error) fail("submitting B, C and D", submitted.error);
  const reopened = await admin.from("inspections").update({ status: "reopened" }).eq("id", byKey.C.id);
  if (reopened.error) fail("reopening C", reopened.error);
  const approved = await admin.from("inspections").update({ status: "approved" }).eq("id", byKey.D.id);
  if (approved.error) fail("approving D", approved.error);

  return {
    refs: { A: byKey.A.ref_no, B: byKey.B.ref_no, C: byKey.C.ref_no, D: byKey.D.ref_no, E: byKey.E.ref_no },
    ids: { A: byKey.A.id, B: byKey.B.id, C: byKey.C.id, D: byKey.D.id, E: byKey.E.id },
    clientId: client.id,
    manufacturers: SEED,
    templateId: template.id,
    inspectorId,
    cleanup: () => removeFixtureRows(admin),
  };
}

/* ------------------------------------------------------------------ *
 * Search by carton number, and by lot in any case
 * ------------------------------------------------------------------ */

/** The migration that adds the search columns (SEARCH_COLUMNS_MIGRATION in lib/inspections/query.ts). */
export const SEARCH_MIGRATION = "20261007191137_inspection_search_columns.sql";

/**
 * Whether the project has the search columns carton_numbers and
 * lot_numbers_upper. Until it does, asking for them answers 42703 (no such
 * column), and the list searches refs, POs and lots as typed or in capitals.
 */
export async function searchColumnsAreLive(): Promise<boolean> {
  const admin = createTestAdminClient();
  const { error } = await admin.from("inspections").select("id, carton_numbers, lot_numbers_upper").limit(0);
  if (error?.code === "42703") return false;
  if (error) fail("asking for the search columns", error);
  return true;
}

/* ------------------------------------------------------------------ *
 * Delete
 * ------------------------------------------------------------------ */

/** The migration that adds the list's Delete (supabase/migrations). */
export const DELETE_MIGRATION = "20261007151500_delete_draft_inspection.sql";

/**
 * Whether the project has delete_draft_inspection(). The secret key may not
 * call it (it is granted to signed-in users only), so a project that has it
 * answers "permission denied" and nothing runs; one that does not answers
 * PGRST202 (no such function).
 */
export async function deleteFunctionIsLive(): Promise<boolean> {
  const admin = createTestAdminClient();
  const { error } = await admin.rpc("delete_draft_inspection", { inspection_id: "00000000-0000-4000-8000-000000000000" });
  return error?.code !== "PGRST202";
}

const PHOTO_BUCKET = "inspection-photos";
const FILE_BUCKET = "inspection-files";

export type StoredObjects = { photos: string[]; files: string[] };

/** Every object in an inspection's folders, thumbnails included. */
export async function storedObjects(inspectionId: string): Promise<StoredObjects> {
  const admin = createTestAdminClient();
  async function list(bucket: string, folder: string): Promise<string[]> {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
    if (error) fail(`listing ${bucket}/${folder}`, error);
    const names: string[] = [];
    for (const entry of data) {
      // Folders come back without an id.
      if (entry.id === null) names.push(...(await list(bucket, `${folder}/${entry.name}`)));
      else names.push(`${folder}/${entry.name}`);
    }
    return names.sort();
  }
  return { photos: await list(PHOTO_BUCKET, inspectionId), files: await list(FILE_BUCKET, inspectionId) };
}

export type DraftWithEvidence = {
  id: string;
  refNo: string;
  /** What is in Storage for it: a photo and its thumbnail, a lab report. */
  objects: StoredObjects;
  /** Removes whatever is left of it: Storage objects first, then the inspection. */
  cleanup: () => Promise<void>;
};

/**
 * A draft of the inspector with a photo, its thumbnail and a lab report,
 * in the rows and in Storage, dated 2 Oct 2026 so it sits between B and A.
 */
export async function createDraftWithEvidence(fixture: ListFixture): Promise<DraftWithEvidence> {
  const admin = createTestAdminClient();
  const { data: draft, error } = await admin
    .from("inspections")
    .insert({
      template_id: fixture.templateId,
      inspector_id: fixture.inspectorId,
      inspection_date: "2026-10-02",
      client_id: fixture.clientId,
      manufacturer_id: SEED.hartalega,
      po_no: "E2E-LIST-PO-DEL",
      product_name: "Nitrile examination gloves, to delete",
    })
    .select("id, ref_no")
    .single();
  if (error) fail("creating the draft to delete", error);
  const id = draft.id;

  async function cleanup() {
    const left = await storedObjects(id);
    if (left.photos.length > 0) await admin.storage.from(PHOTO_BUCKET).remove(left.photos);
    if (left.files.length > 0) await admin.storage.from(FILE_BUCKET).remove(left.files);
    const { data: still } = await admin.from("inspections").select("id").eq("id", id).maybeSingle();
    if (still) await deleteTestInspection(admin, id);
  }

  try {
    const photo = crypto.randomUUID();
    const file = crypto.randomUUID();
    const objects: StoredObjects = {
      photos: [`${id}/${photo}.jpg`, `${id}/thumbs/${photo}.jpg`],
      files: [`${id}/${file}.pdf`],
    };
    // Bytes enough for Storage, which checks the declared type, not the content.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    for (const path of objects.photos) {
      const uploaded = await admin.storage.from(PHOTO_BUCKET).upload(path, jpeg, { contentType: "image/jpeg" });
      if (uploaded.error) fail(`uploading ${path}`, uploaded.error);
    }
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
    const uploaded = await admin.storage.from(FILE_BUCKET).upload(objects.files[0], pdf, { contentType: "application/pdf" });
    if (uploaded.error) fail(`uploading ${objects.files[0]}`, uploaded.error);

    const photoRow = await admin.from("inspection_photos").insert({
      id: photo,
      inspection_id: id,
      module_key: "glove_info",
      storage_path: objects.photos[0],
      thumb_path: objects.photos[1],
      created_by: fixture.inspectorId,
    });
    if (photoRow.error) fail("adding the photo row", photoRow.error);
    const fileRow = await admin.from("inspection_files").insert({
      id: file,
      inspection_id: id,
      module_key: "glove_info",
      kind: "lab_report",
      storage_path: objects.files[0],
      name: "lab-report.pdf",
      created_by: fixture.inspectorId,
    });
    if (fileRow.error) fail("adding the file row", fileRow.error);

    return { id, refNo: draft.ref_no, objects, cleanup };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

/** The record of an inspection's deletion, which outlives it (admins only; read here with the secret key). */
export async function deletionRecord(inspectionId: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin
    .from("audit_log")
    .select("inspection_id, actor_id, changes")
    .eq("action", "deleted")
    .eq("changes->>inspection_id", inspectionId);
  if (error) fail("reading the deletion record", error);
  return data;
}
