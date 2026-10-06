import { randomUUID } from "node:crypto";
import { ResolvedTemplateSchema } from "../../lib/schemas/template";
import { createTestAdminClient, deleteTestInspection, throwawayEmail } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";
import { PHOTOS_TEMPLATE_CODE, photosResolvedTemplate, photosTemplateDefinition } from "./template";

/**
 * Temporary rows for the photo specs (e2e/README.md): a draft template
 * E2E_PHOTOS, one inspection of inspector@test.local per run of the spec,
 * and, for the isolation check, a throwaway inspector with an inspection and
 * a photo of their own. Everything is removed afterwards, Storage objects
 * first, then the inspections (deleteTestInspection), the template and the
 * throwaway account. A run that died half way is cleaned up by the next.
 *
 * Side effects that cannot be undone through the API, by design: each
 * inspection draws a number from the ref sequence, and each deletion leaves
 * an audit row ("deleted"), visible to admins only.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

const OWNER = "photos";
const THROWAWAY_PREFIX = `e2e-${OWNER}-`;
const HARTALEGA = "10000000-0000-4000-8000-000000000001";
const BUCKETS = ["inspection-photos", "inspection-files"] as const;
const STALE_MS = 30 * 60 * 1000;

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Photos fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

export type PhotosFixture = {
  inspectionId: string;
  refNo: string;
  inspectorId: string;
  adminId: string;
  cleanup: () => Promise<void>;
};

export type OtherInspector = {
  account: { id: string; email: string; password: string };
  inspectionId: string;
  photoId: string;
  storagePath: string;
  thumbPath: string;
};

/** Every object in one inspection's folders of both buckets. */
async function listObjectsWith(admin: AdminClient, inspectionId: string): Promise<{ bucket: string; path: string }[]> {
  const found: { bucket: string; path: string }[] = [];
  for (const bucket of BUCKETS) {
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) fail(`listing ${bucket}/${folder}`, error);
      // Folders come back as entries without an id.
      for (const entry of data) if (entry.id) found.push({ bucket, path: `${folder}/${entry.name}` });
    }
  }
  return found;
}

async function removeInspection(admin: AdminClient, inspectionId: string): Promise<void> {
  const objects = await listObjectsWith(admin, inspectionId);
  for (const bucket of BUCKETS) {
    const paths = objects.filter((object) => object.bucket === bucket).map((object) => object.path);
    if (paths.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) fail(`removing ${bucket} objects of ${inspectionId}`, error);
  }
  await deleteTestInspection(admin, inspectionId);
}

/** Inspections of the fixture template, then the template itself. */
async function removeFixtureRows(admin: AdminClient): Promise<void> {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", PHOTOS_TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const templateIds = templates.map((template) => template.id);
  if (templateIds.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", templateIds);
  if (findError) fail("finding fixture inspections", findError);
  for (const inspection of inspections) await removeInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", templateIds);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

/** Throwaway inspectors of these specs: this run's, and any older than 30 minutes a crashed run left. */
async function sweepThrowaways(admin: AdminClient, keep: ReadonlySet<string> = new Set()): Promise<void> {
  const staleBefore = Date.now() - STALE_MS;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail("listing accounts", error);
    for (const user of data.users) {
      const email = user.email?.toLowerCase() ?? "";
      if (!email.startsWith(THROWAWAY_PREFIX) || !email.endsWith("@test.local") || keep.has(user.id)) continue;
      if (Date.parse(user.created_at) > staleBefore) continue;
      await admin.auth.admin.deleteUser(user.id);
    }
    if (data.users.length < 1000) break;
  }
}

async function testAccountIds(admin: AdminClient): Promise<{ inspectorId: string; adminId: string }> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_ACCOUNTS.inspector, TEST_ACCOUNTS.admin]);
  if (error) fail("finding the test accounts", error);
  const idOf = (email: string) => data.find((person) => person.email === email)?.id ?? fail(`finding ${email}`, null);
  return { inspectorId: idOf(TEST_ACCOUNTS.inspector), adminId: idOf(TEST_ACCOUNTS.admin) };
}

/** The template (created once per run, shared by the projects) and a fresh draft inspection of the inspector. */
export async function createPhotosFixture(): Promise<PhotosFixture> {
  // The gallery must read it as a real template, or the specs would test its fallback.
  const parsed = ResolvedTemplateSchema.safeParse(photosResolvedTemplate());
  if (!parsed.success) throw new Error(`Photos fixture: the template does not resolve: ${parsed.error.message}`);
  const admin = createTestAdminClient();
  const { inspectorId, adminId } = await testAccountIds(admin);

  let templateId: string;
  const existing = await admin.from("templates").select("id").eq("code", PHOTOS_TEMPLATE_CODE).maybeSingle();
  if (existing.error) fail("finding the fixture template", existing.error);
  if (existing.data) {
    templateId = existing.data.id;
  } else {
    const { data, error } = await admin
      .from("templates")
      .insert({
        code: PHOTOS_TEMPLATE_CODE,
        version: 1,
        product_type: "examination",
        standard: "EN455",
        status: "draft",
        definition: photosTemplateDefinition(),
        resolved: photosResolvedTemplate(),
      })
      .select("id")
      .single();
    if (error) fail("creating the fixture template", error);
    templateId = data.id;
  }

  const { data: inspection, error } = await admin
    .from("inspections")
    .insert({
      template_id: templateId,
      inspector_id: inspectorId,
      manufacturer_id: HARTALEGA,
      po_no: "E2E-PHOTOS-PO-1",
      product_name: "Nitrile examination gloves (photos e2e)",
    })
    .select("id, ref_no")
    .single();
  if (error) fail("creating the fixture inspection", error);

  return {
    inspectionId: inspection.id,
    refNo: inspection.ref_no,
    inspectorId,
    adminId,
    cleanup: async () => {
      await removeInspection(admin, inspection.id);
      // The last project's run takes the template with it; an earlier one leaves it for the next.
      const { count } = await admin
        .from("inspections")
        .select("id", { count: "exact", head: true })
        .eq("template_id", templateId);
      if (count === 0) await admin.from("templates").delete().eq("id", templateId);
    },
  };
}

/** Removes everything a crashed run may have left: the template's inspections, the template, stale throwaways. */
export async function sweepPhotosFixtures(): Promise<void> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);
  await sweepThrowaways(admin);
}

/**
 * Another inspector, with an inspection and one photo of their own (row and
 * objects written with the secret key, as their upload would have).
 */
export async function createOtherInspector(templateFrom: PhotosFixture, jpeg: Buffer): Promise<OtherInspector & { cleanup: () => Promise<void> }> {
  const admin = createTestAdminClient();
  const email = throwawayEmail(OWNER).toLowerCase();
  const password = `E2e-${randomUUID().slice(0, 13)}-9`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Other Inspector (photos e2e)" },
  });
  if (createError) fail(`creating ${email}`, createError);
  const accountId = created.user.id;

  let inspectionId: string | null = null;
  const cleanup = async () => {
    if (inspectionId) await removeInspection(admin, inspectionId);
    await admin.auth.admin.deleteUser(accountId);
  };

  try {
    const activated = await admin.from("profiles").update({ active: true }).eq("id", accountId);
    if (activated.error) fail("activating the other inspector", activated.error);

    const { data: template, error: templateError } = await admin
      .from("inspections")
      .select("template_id")
      .eq("id", templateFrom.inspectionId)
      .single();
    if (templateError) fail("reading the fixture template", templateError);

    const { data: inspection, error } = await admin
      .from("inspections")
      .insert({
        template_id: template.template_id,
        inspector_id: accountId,
        manufacturer_id: HARTALEGA,
        po_no: "E2E-PHOTOS-PO-OTHER",
        product_name: "Nitrile examination gloves (another inspector)",
      })
      .select("id")
      .single();
    if (error) fail("creating the other inspection", error);
    inspectionId = inspection.id;

    const photoId = randomUUID();
    const storagePath = `${inspection.id}/${photoId}.jpg`;
    const thumbPath = `${inspection.id}/thumbs/${photoId}.jpg`;
    for (const path of [storagePath, thumbPath]) {
      const { error: uploadError } = await admin.storage
        .from("inspection-photos")
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      if (uploadError) fail(`uploading ${path}`, uploadError);
    }
    const { error: rowError } = await admin.from("inspection_photos").insert({
      id: photoId,
      inspection_id: inspection.id,
      module_key: "dimensions",
      target: "size:M",
      storage_path: storagePath,
      thumb_path: thumbPath,
      caption: "Another inspector's photo",
      created_by: accountId,
    });
    if (rowError) fail("inserting the other photo", rowError);

    return { account: { id: accountId, email, password }, inspectionId: inspection.id, photoId, storagePath, thumbPath, cleanup };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

/** Every object in an inspection's folders of both buckets (the secret key: what is there, not who sees it). */
export async function listObjects(inspectionId: string): Promise<{ bucket: string; path: string }[]> {
  return listObjectsWith(createTestAdminClient(), inspectionId);
}

export async function photoRows(inspectionId: string) {
  const { data, error } = await createTestAdminClient()
    .from("inspection_photos")
    .select("id, module_key, target, caption, width, height, flagged, include_in_report, storage_path, thumb_path, created_by")
    .eq("inspection_id", inspectionId)
    .order("created_at");
  if (error) fail("reading photo rows", error);
  return data;
}

export async function fileRows(inspectionId: string) {
  const { data, error } = await createTestAdminClient()
    .from("inspection_files")
    .select("id, module_key, kind, name, storage_path")
    .eq("inspection_id", inspectionId)
    .order("created_at");
  if (error) fail("reading file rows", error);
  return data;
}

export async function downloadObject(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await createTestAdminClient().storage.from(bucket).download(path);
  if (error) fail(`downloading ${bucket}/${path}`, error);
  return Buffer.from(await data.arrayBuffer());
}

export async function setInspectionStatus(inspectionId: string, status: "submitted" | "reopened" | "approved") {
  const { error } = await createTestAdminClient().from("inspections").update({ status }).eq("id", inspectionId);
  if (error) fail(`setting status ${status}`, error);
}
