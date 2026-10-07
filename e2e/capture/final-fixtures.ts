import { randomUUID } from "node:crypto";
import type { TemplateDefinition } from "../../lib/schemas/template";
import type { Json } from "../../lib/supabase/database.types";
import { lookupFrom, templateRowFields } from "../../lib/templates";
import { resolveTemplate } from "../../modules";
import { createTestAdminClient, deleteTestInspection, throwawayEmail } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the capture fixes of the final audit (final.spec.ts),
 * made for each project's run and deleted in afterAll (e2e/README.md):
 *
 * - E2E_FINAL_CAPTURE: header, the order (S and M), Dimension, Visual,
 *   watertight, Safedon's dispensing with a custom "onsite notes" section
 *   after it, and the conclusion. One draft of the test inspector's: refused
 *   entries, sections opened offline, photo tags, the desktop sidebar.
 * - E2E_FINAL_SUBMIT: header (PO only), the order (M), the dye leak test
 *   (13 pouches planned) and the conclusion. Two drafts with nothing left to
 *   do: a clean pass and a pass with a warning (the submit confirmation).
 * - A lead inspector and a member of their team (throwaway
 *   e2e-final-capture-*@test.local accounts), with the member's submitted
 *   and approved inspections: the read-only screens.
 *
 * A crashed run's templates are removed at the next start, and its accounts
 * once they are 30 minutes old. Each run of a project draws six numbers from
 * the live ref sequence.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FINAL_CAPTURE_CODE = "E2E_FINAL_CAPTURE";
export const FINAL_SUBMIT_CODE = "E2E_FINAL_SUBMIT";
const CODES = [FINAL_CAPTURE_CODE, FINAL_SUBMIT_CODE];
const OWNER = "final-capture";
const PREFIX = `e2e-${OWNER}-`;
const STALE_MS = 30 * 60 * 1000;
const BUCKETS = ["inspection-photos", "inspection-files"] as const;

// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
} as const;

/** The custom section after Safedon's dispensing, whose title starts like it (the sidebar's two lines). */
export const NOTES_SECTION = { key: "dispensing_notes", title: "Glove Dispensing Inspection: onsite notes" } as const;

function captureDefinition(): TemplateDefinition {
  return {
    code: FINAL_CAPTURE_CODE,
    name: "Final audit capture e2e (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true },
      { key: "order_lots", include: true },
      { key: "dimensions", include: true },
      { key: "visual", include: true },
      { key: "watertight", include: true },
      { key: "dispensing_safedon", include: true, config: { boxesPerSize: { default: 3 } } },
      { key: "conclusion", include: true },
    ],
    customModules: [
      {
        key: NOTES_SECTION.key,
        title: NOTES_SECTION.title,
        after: "dispensing_safedon",
        layout: "fields",
        fields: [
          { key: "notes", label: "Notes", type: "text" },
          { key: "boxWeight", label: "Box weight", type: "number", unit: "g" },
        ],
      },
    ],
    report: { title: "Final audit capture e2e (temporary)", showClientLogo: false },
  };
}

function submitDefinition(): TemplateDefinition {
  return {
    code: FINAL_SUBMIT_CODE,
    name: "Final audit submit e2e (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "M" }],
    modules: [
      {
        key: "header",
        include: true,
        config: {
          fields: {
            factoryAddress: false,
            poNo: true,
            productName: false,
            productCode: false,
            factoryGloveCode: false,
            inspectionDate: false,
            mfgDate: false,
            expiryDate: false,
          },
        },
      },
      { key: "order_lots", include: true },
      { key: "dye_leak", include: true, config: { n: 13 } },
      { key: "conclusion", include: true },
    ],
    report: { title: "Final audit submit e2e (temporary)", showClientLogo: false },
  };
}

/** Sizes S and M ordered. */
const CAPTURE_DATA = { order_lots: { sizes: { S: { qtyCases: 100 }, M: { qtyCases: 200 } } } } as const;

/** Nothing left to do: 13 pouches tested, none failed (a clean pass), or 5 of 13 (a pass with a warning). */
function submitData(pouchesTested: number) {
  return {
    header: { poNo: "PO-E2E-FINAL" },
    order_lots: { sizes: { M: { qtyCases: 10, lotNumbers: ["LOT-E2E-FINAL"] } } },
    dye_leak: { sizes: { M: { pouchesTested, pouchesFailed: 0 } } },
    conclusion: { finalResult: "pass", date: "2026-10-07" },
  };
}

export type Account = { id: string; email: string; password: string; name: string };

export type FinalFixture = {
  /** The test inspector's draft on E2E_FINAL_CAPTURE. */
  inspectionId: string;
  refNo: string;
  /** The test inspector's drafts on E2E_FINAL_SUBMIT, ready to submit. */
  cleanPassId: string;
  warnedPassId: string;
  lead: Account;
  member: Account;
  /** The member's inspections. */
  memberSubmittedId: string;
  memberApprovedId: string;
  /** The draft's saved data. */
  savedData: () => Promise<{ modules: Record<string, unknown>; custom: Record<string, unknown> }>;
  /** The draft's photos, as stored. */
  photos: () => Promise<{ module_key: string | null; target: string | null }[]>;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Final capture fixture: ${step} failed: ${error?.message ?? "no data"}`);
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

/** The fixture's templates with every inspection made from them. */
async function removeTemplates(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").in("code", CODES);
  if (error) fail("finding the fixture templates", error);
  const ids = templates.map((template) => template.id);
  if (ids.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (findError) fail("finding the fixture inspections", findError);
  for (const inspection of inspections) await removeInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", ids);
  if (removed.error) fail("deleting the fixture templates", removed.error);
}

/** The e2e-final-capture-* accounts in Supabase Auth that `keep` selects, by id. */
async function findAccounts(admin: AdminClient, keep: (createdAt: number) => boolean): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail("listing accounts", error);
    for (const user of data.users) {
      const email = user.email?.toLowerCase() ?? "";
      if (email.startsWith(PREFIX) && email.endsWith("@test.local") && keep(Date.parse(user.created_at))) ids.push(user.id);
    }
    if (data.users.length < 1000) break;
  }
  return ids;
}

/** Deletes accounts, their inspections first, the team member out of the team first (a lead with a team cannot go). */
async function removeAccounts(admin: AdminClient, ids: readonly string[]) {
  if (ids.length === 0) return;
  const { data: inspections, error } = await admin.from("inspections").select("id").in("inspector_id", [...ids]);
  if (error) fail("finding the accounts' inspections", error);
  for (const inspection of inspections) await removeInspection(admin, inspection.id);
  const outOfTeams = await admin.from("profiles").update({ lead_id: null }).in("id", [...ids]);
  if (outOfTeams.error) fail("taking the accounts out of their team", outOfTeams.error);
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError && deleteError.status !== 404) fail(`deleting account ${id}`, deleteError);
  }
}

export async function createFinalFixture(): Promise<FinalFixture> {
  const admin = createTestAdminClient();
  await removeTemplates(admin);
  await removeAccounts(admin, await findAccounts(admin, (createdAt) => createdAt < Date.now() - STALE_MS));
  const created: string[] = [];
  const cleanup = async () => {
    await removeTemplates(admin);
    await removeAccounts(admin, created);
  };
  try {
    return { ...(await insertRows(admin, created)), cleanup };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

async function insertTemplate(admin: AdminClient, definition: TemplateDefinition): Promise<string> {
  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) fail(`resolving ${definition.code}`, { message: JSON.stringify(resolution.problems) });
  // A draft template: no inspector could start from it; only these rows use it.
  const { data, error } = await admin
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
  if (error) fail(`creating ${definition.code}`, error);
  return data.id;
}

async function insertRows(admin: AdminClient, created: string[]): Promise<Omit<FinalFixture, "cleanup">> {
  const suffix = randomUUID().slice(0, 4);
  async function account(name: string, profile: { is_lead?: boolean; lead_id?: string }): Promise<Account> {
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
    // New accounts start inactive (e2e/README.md).
    const { error: profileError } = await admin.from("profiles").update({ active: true, ...profile }).eq("id", data.user.id);
    if (profileError) fail(`activating ${email}`, profileError);
    return { id: data.user.id, email, password, name: fullName };
  }

  const { data: inspector, error: inspectorError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (inspectorError) fail("finding the test inspector", inspectorError);

  // The lead first: a lead_id names an active lead inspector.
  const lead = await account("E2E Final Lead", { is_lead: true });
  const member = await account("E2E Final Member", { lead_id: lead.id });

  const captureTemplate = await insertTemplate(admin, captureDefinition());
  const submitTemplate = await insertTemplate(admin, submitDefinition());
  const rows = [
    { key: "draft", template_id: captureTemplate, inspector_id: inspector.id, modules: CAPTURE_DATA },
    { key: "cleanPass", template_id: submitTemplate, inspector_id: inspector.id, modules: submitData(13) },
    { key: "warnedPass", template_id: submitTemplate, inspector_id: inspector.id, modules: submitData(5) },
    { key: "memberSubmitted", template_id: captureTemplate, inspector_id: member.id, modules: CAPTURE_DATA },
    { key: "memberApproved", template_id: captureTemplate, inspector_id: member.id, modules: CAPTURE_DATA },
  ] as const;
  const ids: Partial<Record<(typeof rows)[number]["key"], { id: string; ref: string }>> = {};
  for (const row of rows) {
    // Inserts never send id or ref_no: the database draws the ref number.
    const { data, error } = await admin
      .from("inspections")
      .insert({
        template_id: row.template_id,
        inspector_id: row.inspector_id,
        client_id: SEED.polyco,
        manufacturer_id: SEED.hartalega,
        data: { modules: row.modules, custom: {} } as unknown as NonNullable<Json>,
      })
      .select("id, ref_no")
      .single();
    if (error) fail(`creating the ${row.key} inspection`, error);
    ids[row.key] = { id: data.id, ref: data.ref_no };
  }
  const get = (key: (typeof rows)[number]["key"]) => ids[key] ?? fail(`finding the ${key} inspection`, null);

  // Every inspection starts as a draft; the status flow moves the member's on.
  const submitted = await admin
    .from("inspections")
    .update({ status: "submitted" })
    .in("id", [get("memberSubmitted").id, get("memberApproved").id]);
  if (submitted.error) fail("submitting the member's inspections", submitted.error);
  const approved = await admin.from("inspections").update({ status: "approved" }).eq("id", get("memberApproved").id);
  if (approved.error) fail("approving the member's inspection", approved.error);

  const draftId = get("draft").id;
  return {
    inspectionId: draftId,
    refNo: get("draft").ref,
    cleanPassId: get("cleanPass").id,
    warnedPassId: get("warnedPass").id,
    lead,
    member,
    memberSubmittedId: get("memberSubmitted").id,
    memberApprovedId: get("memberApproved").id,
    savedData: async () => {
      const { data, error } = await admin.from("inspections").select("data").eq("id", draftId).single();
      if (error) fail("reading the draft's data", error);
      const stored = data.data as { modules?: Record<string, unknown>; custom?: Record<string, unknown> };
      return { modules: stored.modules ?? {}, custom: stored.custom ?? {} };
    },
    photos: async () => {
      const { data, error } = await admin.from("inspection_photos").select("module_key, target").eq("inspection_id", draftId);
      if (error) fail("reading the draft's photos", error);
      return data;
    },
  };
}
