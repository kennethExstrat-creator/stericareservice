import { createHash, randomUUID } from "node:crypto";
import { lookupFrom, templateRowFields } from "@/lib/templates";
import { TemplateDefinitionSchema } from "@/lib/schemas/template";
import { resolveTemplate } from "@/modules";
import type { Json } from "../../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection, throwawayEmail } from "../../support/admin";
import { TEST_ACCOUNTS } from "../../support/session";
import type { Session } from "./support";

/*
 * The world the security spec probes, made of throwaway accounts
 * (e2e-finalsec-*@test.local) and rows only they own, set up with the secret
 * key and deleted afterwards (e2e/README.md): Storage objects first, then the
 * inspections through deleteTestInspection(), then the template, then the
 * accounts, team members out of their teams first.
 *
 *   Lena Lead      lead inspector of Max's team; one draft of her own
 *   Lars Lead      lead inspector of Olga's team (Max moves here and back)
 *   Max Member     inspector in Lena's team: drafts, submitted, reopened, approved
 *   Olga Outsider  inspector in Lars's team: one draft
 *   Pia Pending    an account nobody has activated
 *
 * One draft belongs to inspector@test.local, the permanent test account: it
 * is the one an owner deletes. Deleting a draft writes an append-only
 * `deleted` audit row naming who did it, and an account named there can never
 * be deleted, so no throwaway account may be the one who deletes.
 *
 * The template is a draft, so no real inspector can start from it, and its
 * code starts with E2E_FINAL_ as the shared project's rules ask.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const SECURITY_TEMPLATE_CODE = "E2E_FINAL_SEC";
const OWNER = "finalsec";
const PREFIX = `e2e-${OWNER}-`;
const STALE_MS = 30 * 60 * 1000;
/** Hartalega NGC, from supabase/seed.sql. */
const HARTALEGA = "10000000-0000-4000-8000-000000000001";

/** A real 1x1 JPEG: Storage checks the declared type, pages can still show it. */
export const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
export const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

export type Account = { id: string; email: string; password: string; name: string };
export type FixtureInspection = { id: string; ref: string };
export type FixturePhoto = { id: string; path: string; thumb: string };

const INSPECTION_KEYS = [
  "mDraft",
  "mSubmitted",
  "mReopened",
  "mApproved",
  "mDeletable",
  "mBypass",
  "mForAdminDelete",
  "oDraft",
  "lDraft",
  "tDeletable",
] as const;
export type InspectionKey = (typeof INSPECTION_KEYS)[number];

export type SecurityFixture = {
  templateId: string;
  /** inspector@test.local: owns tDeletable only. */
  testInspectorId: string;
  lead: Account;
  lead2: Account;
  member: Account;
  outsider: Account;
  pending: Account;
  inspections: Record<InspectionKey, FixtureInspection>;
  cleanup: () => Promise<void>;
};

export type SecurityMedia = {
  /** Max's signature in the signatures bucket, also on his profile. */
  memberSignature: string;
  mDraftPhoto: FixturePhoto;
  mDraftFile: { id: string; path: string };
  mApprovedPhoto: FixturePhoto;
  mDeletablePhoto: FixturePhoto;
  oDraftPhoto: FixturePhoto;
  tDeletablePhoto: FixturePhoto;
  aiReviewId: string;
};

const DEFINITION = TemplateDefinitionSchema.parse({
  code: SECURITY_TEMPLATE_CODE,
  name: "Security acceptance fixture (temporary)",
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [{ value: "M" }],
  modules: [
    { key: "header", include: true },
    { key: "glove_info", include: true },
    { key: "conclusion", include: true },
  ],
});

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Security fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

async function findAccounts(admin: AdminClient, match: (email: string, createdAt: number) => boolean): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail("listing accounts", error);
    for (const user of data.users) {
      if (user.email && match(user.email.toLowerCase(), Date.parse(user.created_at))) ids.push(user.id);
    }
    if (data.users.length < 1000) break;
  }
  return ids;
}

/** Every object in an inspection's folders, with the secret key (what is there, not who may see it). */
async function removeObjects(admin: AdminClient, inspectionId: string): Promise<void> {
  for (const bucket of ["inspection-photos", "inspection-files"]) {
    const names: string[] = [];
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      for (const entry of data ?? []) if (entry.id) names.push(`${folder}/${entry.name}`);
    }
    if (names.length > 0) {
      const { error } = await admin.storage.from(bucket).remove(names);
      if (error) fail(`removing objects of ${inspectionId}`, error);
    }
  }
}

async function removeInspections(admin: AdminClient, ids: string[]): Promise<void> {
  for (const id of ids) {
    await removeObjects(admin, id);
    await deleteTestInspection(admin, id);
  }
}

async function removeAccounts(admin: AdminClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: inspections, error } = await admin.from("inspections").select("id").in("inspector_id", ids);
  if (error) fail("finding the accounts' inspections", error);
  await removeInspections(admin, inspections.map((row) => row.id));
  for (const id of ids) {
    const { data: signatures } = await admin.storage.from("signatures").list(id, { limit: 100 });
    const names = (signatures ?? []).filter((entry) => entry.id).map((entry) => `${id}/${entry.name}`);
    if (names.length > 0) await admin.storage.from("signatures").remove(names);
  }
  // A lead with team members cannot be deleted (foreign key): empty the teams first.
  const outOfTeams = await admin.from("profiles").update({ lead_id: null }).in("id", ids);
  if (outOfTeams.error) fail("taking the accounts out of their teams", outOfTeams.error);
  const kept: string[] = [];
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (!deleteError || deleteError.status === 404) continue;
    // A record still names it (an append-only audit row): block it so it can do nothing, and say so.
    await admin.from("profiles").update({ active: false, is_lead: false, lead_id: null }).eq("id", id);
    await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    kept.push(`${id} (${deleteError.message})`);
  }
  if (kept.length > 0) fail("deleting accounts", { message: `kept, deactivated and banned: ${kept.join(", ")}` });
}

async function removeTemplates(admin: AdminClient, which: { id: string } | { before: string }): Promise<void> {
  let query = admin.from("templates").select("id").eq("code", SECURITY_TEMPLATE_CODE);
  query = "id" in which ? query.eq("id", which.id) : query.lt("created_at", which.before);
  const { data: templates, error } = await query;
  if (error) fail("finding fixture templates", error);
  const ids = templates.map((row) => row.id);
  if (ids.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (findError) fail("finding fixture inspections", findError);
  await removeInspections(admin, inspections.map((row) => row.id));
  const removed = await admin.from("templates").delete().in("id", ids);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

/** A crashed run's leftovers: this fixture's templates and accounts older than 30 minutes. */
async function removeLeftovers(admin: AdminClient): Promise<void> {
  const before = Date.now() - STALE_MS;
  await removeTemplates(admin, { before: new Date(before).toISOString() });
  const stale = await findAccounts(admin, (email, createdAt) => email.startsWith(PREFIX) && email.endsWith("@test.local") && createdAt < before);
  // Best effort: an account an audit row names stays, blocked (removeAccounts says which).
  await removeAccounts(admin, stale).catch((error: unknown) => console.warn(String(error)));
}

export async function createSecurityFixture(): Promise<SecurityFixture> {
  const admin = createTestAdminClient();
  await removeLeftovers(admin);
  const created: string[] = [];
  let templateId: string | null = null;
  const suffix = randomUUID().slice(0, 4);

  async function account(name: string, profile: { active: boolean; is_lead?: boolean; lead_id?: string } | null): Promise<Account> {
    const email = throwawayEmail(OWNER).toLowerCase();
    const password = `E2e-${randomUUID().slice(0, 13)}-9`;
    const fullName = `${name} ${suffix}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) fail(`creating ${email}`, error);
    created.push(data.user.id);
    if (profile) {
      const { error: profileError } = await admin.from("profiles").update(profile).eq("id", data.user.id);
      if (profileError) fail(`setting up ${email}`, profileError);
    }
    return { id: data.user.id, email, password, name: fullName };
  }

  const cleanup = async () => {
    if (templateId) await removeTemplates(admin, { id: templateId });
    await removeAccounts(admin, created);
  };

  try {
    const lead = await account("E2E Sec Lena Lead", { active: true, is_lead: true });
    const lead2 = await account("E2E Sec Lars Lead", { active: true, is_lead: true });
    const member = await account("E2E Sec Max Member", { active: true, lead_id: lead.id });
    const outsider = await account("E2E Sec Olga Outsider", { active: true, lead_id: lead2.id });
    const pending = await account("E2E Sec Pia Pending", null);
    const testInspector = await admin.from("profiles").select("id").eq("email", TEST_ACCOUNTS.inspector).single();
    if (testInspector.error) fail(`finding ${TEST_ACCOUNTS.inspector}`, testInspector.error);

    const resolution = resolveTemplate(DEFINITION, lookupFrom([]));
    if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });
    const { data: template, error: templateError } = await admin
      .from("templates")
      .insert({ ...templateRowFields(DEFINITION, resolution.template), version: 1, status: "draft" })
      .select("id")
      .single();
    if (templateError) fail("creating the fixture template", templateError);
    templateId = template.id;

    const owners: Record<InspectionKey, Pick<Account, "id">> = {
      mDraft: member,
      mSubmitted: member,
      mReopened: member,
      mApproved: member,
      mDeletable: member,
      mBypass: member,
      mForAdminDelete: member,
      oDraft: outsider,
      lDraft: lead,
      tDeletable: { id: testInspector.data.id },
    };
    const { data: inserted, error: insertError } = await admin
      .from("inspections")
      .insert(
        INSPECTION_KEYS.map((key) => ({
          template_id: template.id,
          inspector_id: owners[key].id,
          manufacturer_id: HARTALEGA,
          po_no: `E2E-FINALSEC-${key}-${suffix}`,
          product_name: "Nitrile examination gloves (security e2e)",
        })),
      )
      .select("id, ref_no, po_no");
    if (insertError) fail("creating the fixture inspections", insertError);
    const inspections = Object.fromEntries(
      INSPECTION_KEYS.map((key) => {
        const row = inserted.find((candidate) => candidate.po_no === `E2E-FINALSEC-${key}-${suffix}`) ?? fail(`finding ${key}`, null);
        return [key, { id: row.id, ref: row.ref_no }];
      }),
    ) as Record<InspectionKey, FixtureInspection>;

    return { templateId: template.id, testInspectorId: testInspector.data.id, lead, lead2, member, outsider, pending, inspections, cleanup };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

/** A photo (and its thumbnail) uploaded and recorded by the inspector, as the upload queue does. */
async function addPhoto(session: Session, inspectionId: string, moduleKey: string): Promise<FixturePhoto> {
  const id = randomUUID();
  const photo = { id, path: `${inspectionId}/${id}.jpg`, thumb: `${inspectionId}/thumbs/${id}.jpg` };
  for (const path of [photo.path, photo.thumb]) {
    const { error } = await session.client.storage.from("inspection-photos").upload(path, TINY_JPEG, { contentType: "image/jpeg" });
    if (error) fail(`uploading ${path} as ${session.email}`, error);
  }
  const { error } = await session.client.from("inspection_photos").insert({
    id,
    inspection_id: inspectionId,
    module_key: moduleKey,
    target: "size:M",
    storage_path: photo.path,
    thumb_path: photo.thumb,
    caption: "Security e2e photo",
  });
  if (error) fail(`recording photo ${id} as ${session.email}`, error);
  return photo;
}

/**
 * Evidence on the fixture's inspections, written by their inspectors, then
 * the status flow moved on with the secret key: Max's submitted, reopened
 * and approved inspections, an AI second opinion on the submitted one with
 * an admin's decision.
 */
export async function addSecurityMedia(
  fixture: SecurityFixture,
  sessions: { member: Session; outsider: Session; testInspector: Session; adminId: string },
): Promise<SecurityMedia> {
  const admin = createTestAdminClient();
  const { inspections } = fixture;

  const mDraftPhoto = await addPhoto(sessions.member, inspections.mDraft.id, "header");
  const fileId = randomUUID();
  const mDraftFile = { id: fileId, path: `${inspections.mDraft.id}/${fileId}.pdf` };
  const upload = await sessions.member.client.storage.from("inspection-files").upload(mDraftFile.path, TINY_PDF, { contentType: "application/pdf" });
  if (upload.error) fail("uploading the lab report", upload.error);
  const fileRow = await sessions.member.client.from("inspection_files").insert({
    id: fileId,
    inspection_id: inspections.mDraft.id,
    module_key: "glove_info",
    kind: "lab_report",
    storage_path: mDraftFile.path,
    name: "security-e2e.pdf",
  });
  if (fileRow.error) fail("recording the lab report", fileRow.error);

  const mApprovedPhoto = await addPhoto(sessions.member, inspections.mApproved.id, "header");
  const mDeletablePhoto = await addPhoto(sessions.member, inspections.mDeletable.id, "header");
  const oDraftPhoto = await addPhoto(sessions.outsider, inspections.oDraft.id, "header");
  const tDeletablePhoto = await addPhoto(sessions.testInspector, inspections.tDeletable.id, "header");

  // Report photo, then the status flow (the guards check each step).
  const inReport = await admin.from("inspection_photos").update({ include_in_report: true }).eq("id", mApprovedPhoto.id);
  if (inReport.error) fail("choosing the report photo", inReport.error);
  const submitted = await admin
    .from("inspections")
    .update({ status: "submitted" })
    .in("id", [inspections.mSubmitted.id, inspections.mReopened.id, inspections.mApproved.id]);
  if (submitted.error) fail("submitting", submitted.error);
  const reopened = await admin.from("inspections").update({ status: "reopened" }).eq("id", inspections.mReopened.id);
  if (reopened.error) fail("reopening", reopened.error);
  const approved = await admin.from("inspections").update({ status: "approved" }).eq("id", inspections.mApproved.id);
  if (approved.error) fail("approving", approved.error);

  const { data: version, error: versionError } = await admin
    .from("inspections")
    .select("updated_at")
    .eq("id", inspections.mSubmitted.id)
    .single();
  if (versionError) fail("reading the submitted version", versionError);
  const findings: Json = [
    {
      id: "F1",
      module: "glove_info",
      size: "M",
      severity: "minor",
      message: "Security e2e finding.",
      evidence: { values: [], boxes: [], photos: [] },
    },
  ];
  const { data: review, error: reviewError } = await admin
    .from("ai_reviews")
    .insert({
      inspection_id: inspections.mSubmitted.id,
      inspection_updated_at: version.updated_at,
      inspection_fingerprint: createHash("sha256").update(inspections.mSubmitted.id).digest("hex"),
      status: "done",
      model: "mock",
      suggested_result: "pass",
      confidence: 0.5,
      summary: "Security e2e review.",
      findings,
      questions: [],
    })
    .select("id")
    .single();
  if (reviewError) fail("storing the AI review", reviewError);
  const decision = await admin
    .from("ai_review_actions")
    .insert({ ai_review_id: review.id, finding_id: "F1", actor_id: sessions.adminId, action: "agree" });
  if (decision.error) fail("storing the admin's decision", decision.error);

  // Max signs, as the profile screen would store it.
  const memberSignature = `${fixture.member.id}/signature.png`;
  const signature = await sessions.member.client.storage.from("signatures").upload(memberSignature, TINY_JPEG, { contentType: "image/jpeg" });
  if (signature.error) fail("uploading the signature", signature.error);
  const signed = await sessions.member.client.from("profiles").update({ signature_path: memberSignature }).eq("id", fixture.member.id);
  if (signed.error) fail("recording the signature", signed.error);

  return { memberSignature, mDraftPhoto, mDraftFile, mApprovedPhoto, mDeletablePhoto, oDraftPhoto, tDeletablePhoto, aiReviewId: review.id };
}
