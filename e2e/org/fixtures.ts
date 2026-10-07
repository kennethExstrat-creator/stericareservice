import { randomUUID } from "node:crypto";
import { lookupFrom, templateRowFields } from "@/lib/templates";
import { TemplateDefinitionSchema } from "@/lib/schemas/template";
import { resolveTemplate } from "@/modules";
import type { TablesInsert, TablesUpdate } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection, throwawayEmail } from "../support/admin";

/**
 * Two lead inspectors' teams of throwaway accounts (e2e-org-*@test.local)
 * with inspections, for the lead inspector specs (migration 20261007170000).
 * Set up with the secret key and deleted afterwards (e2e/README.md): the
 * inspections through deleteTestInspection(), then the template, then the
 * accounts, team members out of their teams first (a lead with a team cannot
 * be deleted). They have no Storage files.
 *
 *   Lina Lead's team: Ivan (a draft and a submitted inspection), Ida (an approved one)
 *   Leo Lead's team:  Bea (a draft)
 *   Lina's own draft, and Pat, an inspector account nobody has activated yet
 *
 * Names carry the run's suffix, so a crashed run's leftovers never match.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const ORG_TEMPLATE_CODE = "E2E_ORG";
const OWNER = "org";
const PREFIX = `e2e-${OWNER}-`;

export type Account = { id: string; email: string; password: string; name: string };
export type FixtureInspection = { id: string; ref: string };

export type OrgFixture = {
  linaLead: Account;
  ivan: Account;
  ida: Account;
  leoLead: Account;
  bea: Account;
  /** Never activated: an inspector in no team, waiting for an admin. */
  pat: Account;
  inspections: {
    ivanDraft: FixtureInspection;
    ivanSubmitted: FixtureInspection;
    idaApproved: FixtureInspection;
    beaDraft: FixtureInspection;
    linaDraft: FixtureInspection;
  };
  cleanup: () => Promise<void>;
};

const DEFINITION = TemplateDefinitionSchema.parse({
  code: ORG_TEMPLATE_CODE,
  name: "Lead inspector e2e fixture (temporary)",
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [{ value: "M" }],
  modules: [
    { key: "header", include: true },
    { key: "glove_info", include: true },
    { key: "conclusion", include: true },
  ],
});

/** Hartalega NGC, from supabase/seed.sql. */
const HARTALEGA = "10000000-0000-4000-8000-000000000001";

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Lead inspector fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** The e2e-org-* accounts in Supabase Auth, by id. */
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

/** Deletes accounts, their inspections first, team members out of their teams first. */
async function removeAccounts(admin: AdminClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: inspections, error } = await admin.from("inspections").select("id").in("inspector_id", ids);
  if (error) fail("finding the accounts' inspections", error);
  for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
  // Nobody can delete a lead whose team has members (the foreign key), so the teams go first.
  const outOfTeams = await admin.from("profiles").update({ lead_id: null }).in("id", ids);
  if (outOfTeams.error) fail("taking the accounts out of their teams", outOfTeams.error);
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError && deleteError.status !== 404) fail(`deleting account ${id}`, deleteError);
  }
}

/** Deletes fixture templates with their inspections: this run's, or any older than `before` (a crashed run's). */
async function removeTemplates(admin: AdminClient, which: { id: string } | { before: string }): Promise<void> {
  let query = admin.from("templates").select("id").eq("code", ORG_TEMPLATE_CODE);
  query = "id" in which ? query.eq("id", which.id) : query.lt("created_at", which.before);
  const { data: templates, error } = await query;
  if (error) fail("finding fixture templates", error);
  const templateIds = templates.map((template) => template.id);
  if (templateIds.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", templateIds);
  if (findError) fail("finding fixture inspections", findError);
  for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", templateIds);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

const STALE_MS = 30 * 60 * 1000;

/** What a crashed run left: fixture templates and e2e-org-* accounts older than 30 minutes. A run in progress keeps its own. */
async function removeLeftovers(admin: AdminClient): Promise<void> {
  const staleBefore = Date.now() - STALE_MS;
  await removeTemplates(admin, { before: new Date(staleBefore).toISOString() });
  const stale = await findAccounts(
    admin,
    (email, createdAt) => email.startsWith(PREFIX) && email.endsWith("@test.local") && createdAt < staleBefore,
  );
  await removeAccounts(admin, stale);
}

export async function createOrgFixture(): Promise<OrgFixture> {
  const admin = createTestAdminClient();
  await removeLeftovers(admin);
  const created: string[] = [];
  let templateId: string | null = null;
  const suffix = randomUUID().slice(0, 4);

  async function account(name: string, profile: TablesUpdate<"profiles"> | null): Promise<Account> {
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
    // New accounts start inactive; null leaves the profile as the trigger made it.
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
    // Leads first: a lead_id names an active lead inspector.
    const linaLead = await account("E2E Lina Lead", { active: true, is_lead: true });
    const leoLead = await account("E2E Leo Lead", { active: true, is_lead: true });
    const ivan = await account("E2E Ivan Inspector", { active: true, lead_id: linaLead.id });
    const ida = await account("E2E Ida Inspector", { active: true, lead_id: linaLead.id });
    const bea = await account("E2E Bea Inspector", { active: true, lead_id: leoLead.id });
    const pat = await account("E2E Pat Pending", null);

    const resolution = resolveTemplate(DEFINITION, lookupFrom([]));
    if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });
    // A draft template no inspector could start from; only these rows use it.
    const { data: template, error: templateError } = await admin
      .from("templates")
      .insert({ ...templateRowFields(DEFINITION, resolution.template), version: 1, status: "draft" })
      .select("id")
      .single();
    if (templateError) fail("creating the fixture template", templateError);
    templateId = template.id;

    const specs: { key: keyof OrgFixture["inspections"]; row: Omit<TablesInsert<"inspections">, "template_id"> }[] = [
      { key: "ivanDraft", row: { inspector_id: ivan.id, po_no: `E2E-ORG-IVAN-DRAFT-${suffix}` } },
      { key: "ivanSubmitted", row: { inspector_id: ivan.id, po_no: `E2E-ORG-IVAN-SUBMITTED-${suffix}` } },
      { key: "idaApproved", row: { inspector_id: ida.id, po_no: `E2E-ORG-IDA-APPROVED-${suffix}` } },
      { key: "beaDraft", row: { inspector_id: bea.id, po_no: `E2E-ORG-BEA-DRAFT-${suffix}` } },
      { key: "linaDraft", row: { inspector_id: linaLead.id, po_no: `E2E-ORG-LINA-DRAFT-${suffix}` } },
    ];
    const { data: inserted, error: insertError } = await admin
      .from("inspections")
      .insert(
        specs.map(({ row }) => ({
          ...row,
          template_id: template.id,
          manufacturer_id: HARTALEGA,
          product_name: "Nitrile examination gloves (e2e)",
        })),
      )
      .select("id, ref_no, po_no");
    if (insertError) fail("creating the fixture inspections", insertError);
    const byKey = Object.fromEntries(
      specs.map(({ key, row }) => {
        const found = inserted.find((inspection) => inspection.po_no === row.po_no) ?? fail(`finding ${key}`, null);
        return [key, { id: found.id, ref: found.ref_no }];
      }),
    ) as OrgFixture["inspections"];

    // Every inspection starts as a draft; the status flow moves two on.
    const submitted = await admin
      .from("inspections")
      .update({ status: "submitted" })
      .in("id", [byKey.ivanSubmitted.id, byKey.idaApproved.id]);
    if (submitted.error) fail("submitting", submitted.error);
    const approved = await admin.from("inspections").update({ status: "approved" }).eq("id", byKey.idaApproved.id);
    if (approved.error) fail("approving", approved.error);

    return { linaLead, ivan, ida, leoLead, bea, pat, inspections: byKey, cleanup };
  } catch (error) {
    // afterAll gets no fixture to clean up, so remove what was made so far.
    await cleanup().catch(() => undefined);
    throw error;
  }
}
