import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Json, TablesInsert, TablesUpdate } from "../../../lib/supabase/database.types";
import type { InspectionData } from "../../../modules/_framework";
import { createTestAdminClient, deleteTestInspection, throwawayEmail } from "../../support/admin";
import { TEST_ACCOUNTS } from "../../support/session";
import { safedonEgData, stdEgData, stdSgData } from "./example-data";

/**
 * Rows for the UX audit (e2e/README.md), one set per Playwright project:
 *
 *   inspector@test.local: a STD_EG draft holding the example report as entered
 *     (its submit error kept), a SAFEDON_EG draft holding its example, a
 *     STD_SG draft with two sizes ordered, and a submitted SAFEDON_EG
 *     inspection, finished, for the review.
 *   A throwaway lead inspector (e2e-fux-<p>-*@test.local) leading two
 *     throwaway inspectors: one with a submitted inspection, one with none
 *     (the empty list).
 *
 * The real templates (STD_EG, SAFEDON_EG, STD_SG active) are only read.
 * Created with the secret key and deleted afterwards: each inspection's
 * Storage objects, the inspection through deleteTestInspection(), any
 * E2E_FINAL_UX_<PROJECT> template an older run made for the template editor
 * (gone with Admin > Templates: Kenneth, 26 October 2026), then the
 * accounts, team members before their lead. A fresh set
 * draws five numbers from the ref sequence.
 *
 * UX_AUDIT_KEEP=1 keeps the set after the run, and the next run of the
 * project puts it back as it started (data, status, photos) instead of
 * drawing new numbers: for working on the audit itself. A run without it
 * deletes everything at the end, leftovers of a crashed run included.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

const BUCKETS = ["inspection-photos", "inspection-files"] as const;

/** supabase/seed.sql's fixed ids. */
const POLYCO = "20000000-0000-4000-8000-000000000001";
const HARTALEGA = "10000000-0000-4000-8000-000000000001";
const TERANG_NUSA = "10000000-0000-4000-8000-000000000002";

export const KEEP_FIXTURE = process.env.UX_AUDIT_KEEP === "1";

export type Account = { id: string; email: string; password: string; name: string };
export type FixtureInspection = { id: string; ref: string };
type InspectionKey = "stdEg" | "safedon" | "stdSg" | "submitted" | "memberSubmitted";

export type UxFixture = {
  code: string;
  poPrefix: string;
  inspections: Record<InspectionKey, FixtureInspection>;
  lead: Account;
  member: Account;
  newcomer: Account;
  /** Replaces a draft's data, as another device's save would. */
  setData: (id: string, data: InspectionData) => Promise<void>;
  /** Sets a draft's PO column, null as on a draft whose header has no PO yet. */
  setPo: (id: string, po: string | null) => Promise<void>;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`UX audit fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** The project's short name in codes, PO numbers and account emails. */
export function projectTag(project: string): { code: string; po: string; owner: string } {
  const upper = project.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const short: Record<string, string> = {
    "ipad-portrait": "ip",
    "ipad-landscape": "il",
    "ipad-pro-landscape": "ipl",
    desktop: "dt",
    "webkit-ipad-portrait": "wk",
  };
  return {
    code: `E2E_FINAL_UX_${upper}`,
    po: `E2E-FINAL-UX-${upper.replace(/_/g, "-")}`,
    owner: `fux-${short[project] ?? "x"}`,
  };
}

async function removeMedia(admin: AdminClient, inspectionId: string) {
  for (const bucket of BUCKETS) {
    const paths: string[] = [];
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) fail(`listing ${bucket}/${folder}`, error);
      for (const entry of data) if (entry.id) paths.push(`${folder}/${entry.name}`);
    }
    if (paths.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) fail(`removing ${bucket} objects of ${inspectionId}`, error);
  }
}

async function removeInspection(admin: AdminClient, inspectionId: string) {
  await removeMedia(admin, inspectionId);
  await deleteTestInspection(admin, inspectionId);
}

async function accounts(admin: AdminClient, prefix: string): Promise<{ id: string; email: string; name: string }[]> {
  const found: { id: string; email: string; name: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail("listing accounts", error);
    for (const user of data.users) {
      const email = user.email?.toLowerCase() ?? "";
      if (email.startsWith(prefix) && email.endsWith("@test.local")) {
        found.push({ id: user.id, email, name: String(user.user_metadata?.full_name ?? "") });
      }
    }
    if (data.users.length < 1000) break;
  }
  return found;
}

async function removeAccounts(admin: AdminClient, ids: string[]) {
  if (ids.length === 0) return;
  const { data: inspections, error } = await admin.from("inspections").select("id").in("inspector_id", ids);
  if (error) fail("finding the accounts' inspections", error);
  for (const inspection of inspections) await removeInspection(admin, inspection.id);
  // Team members out of their teams first: a lead with a team cannot be deleted.
  const out = await admin.from("profiles").update({ lead_id: null }).in("id", ids);
  if (out.error) fail("taking the accounts out of their teams", out.error);
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError && deleteError.status !== 404) fail(`deleting account ${id}`, deleteError);
  }
}

/**
 * Every inspection id this project's runs created, kept on disk (git-ignored
 * screenshots/): a row whose PO was changed on screen is still found.
 */
function ledgerPath(project: string): string {
  return `screenshots/acceptance-ux/.fixture-ids-${project}.json`;
}

function readLedger(project: string): string[] {
  try {
    return JSON.parse(readFileSync(ledgerPath(project), "utf8")) as string[];
  } catch {
    return [];
  }
}

function writeLedger(project: string, ids: string[]) {
  mkdirSync(dirname(ledgerPath(project)), { recursive: true });
  writeFileSync(ledgerPath(project), JSON.stringify([...new Set(ids)], null, 2));
}

/** Everything of this project's set: inspections, an older run's template, the accounts. */
async function removeProjectRows(admin: AdminClient, project: string) {
  const tag = projectTag(project);
  const { data: inspections, error } = await admin.from("inspections").select("id").like("po_no", `${tag.po}-%`);
  if (error) fail("finding the fixture inspections", error);
  const ids = new Set([...inspections.map((inspection) => inspection.id), ...readLedger(project)]);
  if (ids.size > 0) {
    // Only rows that still exist, and only test inspectors' (deleteTestInspection refuses the rest).
    const { data: live, error: liveError } = await admin.from("inspections").select("id").in("id", [...ids]);
    if (liveError) fail("finding the ledger's inspections", liveError);
    for (const inspection of live) await removeInspection(admin, inspection.id);
  }
  writeLedger(project, []);
  const { data: templates, error: templateError } = await admin.from("templates").select("id").eq("code", tag.code);
  if (templateError) fail("finding the fixture templates", templateError);
  if (templates.length > 0) {
    const ids = templates.map((template) => template.id);
    const { data: using, error: usingError } = await admin.from("inspections").select("id").in("template_id", ids);
    if (usingError) fail("finding inspections of the fixture templates", usingError);
    for (const inspection of using) await removeInspection(admin, inspection.id);
    const removed = await admin.from("templates").delete().in("id", ids);
    if (removed.error) fail("deleting the fixture templates", removed.error);
  }
  await removeAccounts(admin, (await accounts(admin, `e2e-${tag.owner}-`)).map((account) => account.id));
}

async function activeTemplateId(admin: AdminClient, code: string): Promise<string> {
  const { data, error } = await admin.from("templates").select("id").eq("code", code).eq("status", "active").single();
  if (error) fail(`finding the active ${code}`, error);
  return data.id;
}

/** SAFEDON_EG's newest version: retired since 26 October 2026, it stands for the old Safedon inspections. */
async function newestTemplateId(admin: AdminClient, code: string): Promise<string> {
  const { data, error } = await admin
    .from("templates")
    .select("id")
    .eq("code", code)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (error) fail(`finding ${code}`, error);
  return data.id;
}

type Spec = {
  key: InspectionKey;
  owner: "inspector" | "member";
  template: string;
  row: Omit<TablesInsert<"inspections">, "template_id" | "inspector_id" | "data">;
  data: InspectionData;
  submitted: boolean;
};

/**
 * The header's PO and product name are the inspection's po_no and
 * product_name (lib/inspections/capture/mirror.ts): every save writes them
 * back. The header data carries the row's own, so a save keeps the PO this
 * fixture finds its rows by.
 */
function withRowHeader(spec: Spec): Spec {
  const modules = spec.data.modules as Record<string, Record<string, unknown> | undefined>;
  const header = { ...(modules.header ?? {}), poNo: spec.row.po_no ?? null, productName: spec.row.product_name ?? null };
  return { ...spec, data: { ...spec.data, modules: { ...modules, header } } as InspectionData };
}

function specs(po: string, templates: { stdEg: string; safedon: string; stdSg: string }): Spec[] {
  return rawSpecs(po, templates).map(withRowHeader);
}

function rawSpecs(po: string, templates: { stdEg: string; safedon: string; stdSg: string }): Spec[] {
  return [
    {
      key: "stdEg",
      owner: "inspector",
      template: templates.stdEg,
      row: {
        client_id: POLYCO,
        manufacturer_id: HARTALEGA,
        po_no: `${po}-STD`,
        product_name: "Nitrile examination gloves, powder free (UX audit)",
      },
      data: stdEgData({ unmapped: "Pinhole at the cuff edge, seen only against the light (UX audit)" }),
      submitted: false,
    },
    {
      key: "safedon",
      owner: "inspector",
      template: templates.safedon,
      row: {
        client_id: POLYCO,
        manufacturer_id: TERANG_NUSA,
        po_no: `${po}-SAFEDON`,
        product_name: "Safedon nitrile examination gloves (UX audit)",
      },
      data: safedonEgData(),
      submitted: false,
    },
    {
      key: "stdSg",
      owner: "inspector",
      template: templates.stdSg,
      row: {
        client_id: null,
        manufacturer_id: HARTALEGA,
        po_no: `${po}-SG`,
        product_name: "Sterile latex surgical gloves (UX audit)",
      },
      data: stdSgData(),
      submitted: false,
    },
    {
      key: "submitted",
      owner: "inspector",
      template: templates.safedon,
      row: {
        client_id: POLYCO,
        manufacturer_id: TERANG_NUSA,
        po_no: `${po}-SUBMITTED`,
        product_name: "Safedon nitrile examination gloves, submitted (UX audit)",
      },
      data: safedonEgData({ finished: true }),
      submitted: true,
    },
    {
      key: "memberSubmitted",
      owner: "member",
      template: templates.stdEg,
      row: {
        client_id: POLYCO,
        manufacturer_id: HARTALEGA,
        po_no: `${po}-TEAM`,
        product_name: "Nitrile examination gloves, team (UX audit)",
      },
      data: stdEgData({ finished: true, unmapped: "Cuff rolled inward on several gloves of the same box, hard to unroll (UX audit)" }),
      submitted: true,
    },
  ];
}

export async function createUxFixture(project: string): Promise<UxFixture> {
  const admin = createTestAdminClient();
  const tag = projectTag(project);
  const suffix = randomUUID().slice(0, 4);

  const [stdEg, safedon, stdSg] = await Promise.all([
    activeTemplateId(admin, "STD_EG"),
    newestTemplateId(admin, "SAFEDON_EG"),
    activeTemplateId(admin, "STD_SG"),
  ]);
  const { data: inspector, error: inspectorError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (inspectorError) fail("finding the test inspector", inspectorError);

  // ---- Accounts: kept ones get a new password; otherwise made afresh. ----
  const existing = await accounts(admin, `e2e-${tag.owner}-`);
  const byName = (name: string) => existing.find((account) => account.name.startsWith(name));
  const reuse = KEEP_FIXTURE && Boolean(byName("E2E Lena Lead") && byName("E2E Milo Member") && byName("E2E Nora Newcomer"));
  if (!reuse) await removeProjectRows(admin, project);

  const created: string[] = [];
  async function account(name: string, profile: TablesUpdate<"profiles">): Promise<Account> {
    const password = `E2e-${randomUUID().slice(0, 13)}-9`;
    const kept = reuse ? byName(name) : undefined;
    if (kept) {
      const { error } = await admin.auth.admin.updateUserById(kept.id, { password });
      if (error) fail(`resetting the password of ${kept.email}`, error);
      return { id: kept.id, email: kept.email, password, name: kept.name };
    }
    const email = throwawayEmail(tag.owner).toLowerCase();
    const fullName = `${name} ${suffix}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) fail(`creating ${email}`, error);
    created.push(data.user.id);
    // New accounts start inactive.
    const { error: profileError } = await admin.from("profiles").update(profile).eq("id", data.user.id);
    if (profileError) fail(`setting up ${email}`, profileError);
    return { id: data.user.id, email, password, name: fullName };
  }

  const cleanup = async () => {
    if (KEEP_FIXTURE) return;
    await removeProjectRows(admin, project);
    await removeAccounts(admin, created);
  };

  try {
    const lead = await account("E2E Lena Lead", { active: true, is_lead: true });
    const member = await account("E2E Milo Member", { active: true, lead_id: lead.id });
    const newcomer = await account("E2E Nora Newcomer", { active: true, lead_id: lead.id });

    const { data: kept, error: keptError } = await admin
      .from("inspections")
      .select("id, ref_no, po_no, status")
      .like("po_no", `${tag.po}-%`);
    if (keptError) fail("finding kept inspections", keptError);

    const inspections = {} as UxFixture["inspections"];
    for (const spec of specs(tag.po, { stdEg, safedon, stdSg })) {
      const ownerId = spec.owner === "inspector" ? inspector.id : member.id;
      const found = kept.find((row) => row.po_no === spec.row.po_no);
      const fits = found && (spec.submitted ? found.status === "submitted" || found.status === "reopened" : found.status === "draft");
      if (found && fits) {
        // Back as it started: the data, no photos or files, the status.
        await removeMedia(admin, found.id);
        for (const table of ["inspection_photos", "inspection_files"] as const) {
          const removed = await admin.from(table).delete().eq("inspection_id", found.id);
          if (removed.error) fail(`clearing ${table} of ${found.ref_no}`, removed.error);
        }
        const patch: TablesUpdate<"inspections"> = {
          data: spec.data as unknown as NonNullable<Json>,
          module_overrides: {},
          ...(found.status === "reopened" ? { status: "submitted" as const } : {}),
        };
        const { error } = await admin.from("inspections").update(patch).eq("id", found.id);
        if (error) fail(`resetting ${found.ref_no}`, error);
        inspections[spec.key] = { id: found.id, ref: found.ref_no };
        continue;
      }
      if (found) await removeInspection(admin, found.id);
      const { data: inserted, error } = await admin
        .from("inspections")
        .insert({
          ...spec.row,
          template_id: spec.template,
          inspector_id: ownerId,
          data: spec.data as unknown as NonNullable<Json>,
        })
        .select("id, ref_no")
        .single();
      if (error) fail(`creating the ${spec.key} inspection`, error);
      writeLedger(project, [...readLedger(project), inserted.id]);
      if (spec.submitted) {
        const moved = await admin
          .from("inspections")
          .update({ status: "submitted", result: "pass", remarks: "Shipment accepted (UX audit)." })
          .eq("id", inserted.id);
        if (moved.error) fail(`submitting ${inserted.ref_no}`, moved.error);
      }
      inspections[spec.key] = { id: inserted.id, ref: inserted.ref_no };
    }

    return {
      code: tag.code,
      poPrefix: tag.po,
      inspections,
      lead,
      member,
      newcomer,
      setData: async (id, data) => {
        const { error } = await admin.from("inspections").update({ data: data as unknown as NonNullable<Json> }).eq("id", id);
        if (error) fail(`writing the data of ${id}`, error);
      },
      setPo: async (id, po) => {
        const { error } = await admin.from("inspections").update({ po_no: po }).eq("id", id);
        if (error) fail(`setting the PO of ${id}`, error);
      },
      cleanup,
    };
  } catch (error) {
    if (!KEEP_FIXTURE) {
      await removeProjectRows(admin, project).catch(() => undefined);
      await removeAccounts(admin, created).catch(() => undefined);
    }
    throw error;
  }
}

/** Deletes a project's set whatever UX_AUDIT_KEEP says (the last run of the audit). */
export async function removeUxFixture(project: string) {
  await removeProjectRows(createTestAdminClient(), project);
}
