import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateCapture } from "@/lib/inspections/capture/evaluate";
import { mirroredColumns } from "@/lib/inspections/capture/mirror";
import { TemplateDefinitionSchema, type TemplateDefinition } from "@/lib/schemas/template";
import { lookupFrom, templateRowFields } from "@/lib/templates";
import { resolveTemplate } from "@/modules";
import type { InspectionData } from "@/modules/_framework";
import type { Database, Json, TablesUpdate } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection, throwawayEmail } from "../support/admin";
import { TEST_ACCOUNTS, TEST_PASSWORD } from "../support/session";

/**
 * The data-integrity acceptance audit's rows (e2e/acceptance/data-integrity.spec.ts),
 * made with the secret key and removed afterwards (e2e/README.md):
 *
 *   - three throwaway accounts (e2e-finaldata-*@test.local): a lead inspector,
 *     an inspector in their team and a second inspector in the same team;
 *   - a throwaway client, so the template below applies to nobody else;
 *   - template E2E_FINAL_DATA_<suffix> version 1, active, for that client at
 *     Hartalega, examination gloves: header, glove_info, order_lots,
 *     packing_config, sampling_plan, carton_sampling and conclusion;
 *   - inspections, made by each test as it needs them (each draws a number
 *     from the live ref sequence), owned by the throwaway inspectors.
 *
 * Teardown: Storage objects of each inspection, every inspection of the
 * template's versions and of the accounts (deleteTestInspection), the
 * template versions (any the run made through the UI too), the client, then
 * the accounts, team members before their lead. Nothing else is touched.
 *
 * The throwaway accounts never delete an inspection themselves: the deletion
 * record (audit_log, append-only) names its actor for good, and an account
 * named in an audit row can never be deleted. Should it happen, teardown
 * deactivates that account instead and says so.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;
export type UserClient = SupabaseClient<Database>;

/** Hartalega NGC, from supabase/seed.sql. */
export const HARTALEGA = { id: "10000000-0000-4000-8000-000000000001", label: "Hartalega NGC" } as const;

const OWNER = "finaldata";
const BUCKETS = ["inspection-photos", "inspection-files"] as const;

export type Account = { id: string; email: string; password: string; name: string };

export type Session = {
  /** Cookies for a browser context, exactly as @supabase/ssr writes them. */
  cookies: { name: string; value: string }[];
  /** The same session as a supabase-js client: REST calls as this user, with RLS. */
  client: UserClient;
  userId: string;
};

export type FixtureInspection = { id: string; refNo: string };

export type DataFixture = {
  suffix: string;
  templateCode: string;
  templateId: string;
  client: { id: string; name: string };
  lead: Account;
  inspector: Account;
  other: Account;
  adminId: string;
  /** One sign-in per account per run (Supabase limits sign-ins), cached. */
  session: (who: "lead" | "inspector" | "other" | "admin") => Promise<Session>;
  /** A new inspection of `owner`'s on the fixture template, its row columns mirrored from `data` as the app writes them. */
  createInspection: (
    owner: "inspector" | "other" | "lead",
    options?: { data?: InspectionData; status?: "draft" | "submitted" | "approved"; productName?: string },
  ) => Promise<FixtureInspection>;
  row: (id: string) => Promise<InspectionRow | null>;
  audit: (id: string) => Promise<AuditRow[]>;
  deletionRecords: (id: string) => Promise<AuditRow[]>;
  template: (id: string) => Promise<TemplateRow | null>;
  templateVersions: () => Promise<TemplateRow[]>;
  cleanup: () => Promise<void>;
};

export type InspectionRow = {
  id: string;
  ref_no: string;
  status: string;
  template_id: string;
  inspector_id: string;
  po_no: string | null;
  product_name: string | null;
  lot_numbers: string[];
  inspection_date: string;
  result: string | null;
  remarks: string | null;
  suggested_result: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
  module_overrides: Json;
  data: { modules: Record<string, Record<string, unknown>>; custom: Record<string, unknown> };
};

export type AuditRow = { id: number; inspection_id: string | null; actor_id: string | null; action: string; changes: Json; at: string };
export type TemplateRow = {
  id: string;
  code: string;
  version: number;
  status: string;
  definition: Json;
  resolved: Json;
  updated_at: string;
};

const INSPECTION_COLUMNS =
  "id, ref_no, status, template_id, inspector_id, po_no, product_name, lot_numbers, inspection_date, result, remarks, suggested_result, submitted_at, approved_by, approved_at, updated_at, module_overrides, data";

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Data acceptance fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

export function definition(code: string, clientId: string): TemplateDefinition {
  return TemplateDefinitionSchema.parse({
    code,
    name: "Final data audit gloves (temporary)",
    scope: { productType: "examination", standard: "EN455", clientId, manufacturerId: HARTALEGA.id },
    unit: "pcs",
    sizes: [{ value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true },
      { key: "glove_info", include: true },
      { key: "order_lots", include: true },
      { key: "packing_config", include: true },
      { key: "sampling_plan", include: true },
      { key: "carton_sampling", include: true },
      { key: "conclusion", include: true },
    ],
    report: { title: "Final data audit (temporary)", showClientLogo: false },
  });
}

/** Today in Malaysia, as the database dates a new inspection. */
export function todayInMalaysia(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * A complete inspection but for the conclusion (which blocks submit until it
 * has a final result and a date): the header, glove information, the order
 * with lots, packing, and carton numbers for size M.
 */
export function readyData(tag: string, overrides: Partial<Record<string, Record<string, unknown>>> = {}): InspectionData {
  const modules: Record<string, Record<string, unknown>> = {
    header: {
      factoryAddress: "Lot 1, Jalan E2E, Sepang (e2e)",
      poNo: `E2E-FD-PO-${tag}`,
      productName: `E2E Final Glove ${tag}`,
      productCode: `PC-${tag}`,
      factoryGloveCode: `FG-${tag}`,
      inspectionDate: todayInMalaysia(),
      mfgDate: "2026-09-01",
      expiryDate: "2029-08-31",
    },
    glove_info: { surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Original blue", length: "240 mm" },
    // 8000 cases of M, so carton numbers 7311 and 7312 are in range (BUILD_SPEC 6.2 rule 6).
    order_lots: { sizes: { M: { qtyCases: 8000, lotNumbers: [`E2E-FD-LOT-${tag}-M`] }, L: { qtyCases: 50, lotNumbers: [`E2E-FD-LOT-${tag}-L`] } } },
    packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000 },
    sampling_plan: {},
    carton_sampling: { sizes: { M: { cartonNumbers: [7311, 7312] } } },
    conclusion: {},
  };
  for (const [key, value] of Object.entries(overrides)) modules[key] = { ...modules[key], ...value };
  return { modules, custom: {} } as InspectionData;
}

/** Signs in once through @supabase/ssr: cookies for the browser, and a client that keeps the session for REST calls. */
async function signInOnce(email: string, password: string): Promise<Session> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase is not configured: copy .env.local into this checkout.");
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  let lastError: { message: string } | null = null;
  // Supabase limits sign-ins: wait a minute and try again once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      return { cookies: [...jar].map(([name, value]) => ({ name, value })), client, userId: data.user.id };
    }
    lastError = error;
    if (!/rate|limit|too many/i.test(error?.message ?? "")) break;
    await new Promise((resolve) => setTimeout(resolve, 65_000));
  }
  throw new Error(`Sign-in failed for ${email}: ${lastError?.message ?? "no user"}`);
}

/** Removes an inspection's Storage objects, then the inspection (Storage first: e2e/README.md). */
async function removeInspection(admin: AdminClient, inspectionId: string): Promise<void> {
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
  await deleteTestInspection(admin, inspectionId);
}

export async function createDataFixture(): Promise<DataFixture> {
  const admin = createTestAdminClient();
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  const templateCode = `E2E_FINAL_DATA_${suffix}`;
  const accounts: string[] = [];
  let clientId: string | null = null;
  const sessions = new Map<string, Promise<Session>>();

  async function account(name: string, profile: TablesUpdate<"profiles">): Promise<Account> {
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
    accounts.push(data.user.id);
    const { error: profileError } = await admin.from("profiles").update(profile).eq("id", data.user.id);
    if (profileError) fail(`setting up ${email}`, profileError);
    return { id: data.user.id, email, password, name: fullName };
  }

  /** Every version of the fixture template (the run may add some through the UI). */
  async function templateVersions(): Promise<TemplateRow[]> {
    const { data, error } = await admin
      .from("templates")
      .select("id, code, version, status, definition, resolved, updated_at")
      .eq("code", templateCode)
      .order("version");
    if (error) fail("reading the template versions", error);
    return data as TemplateRow[];
  }

  const cleanup = async () => {
    const problems: string[] = [];
    const attempt = async (step: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        problems.push(`${step}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const owners = accounts;
    /** The template's versions and every inspection on them or of the accounts, read now: a Server Action may have just added one. */
    const removeTemplatesAndInspections = async () => {
      const templateIds = (await templateVersions().catch(() => [] as TemplateRow[])).map((version) => version.id);
      const inspections = new Set<string>();
      if (templateIds.length > 0) {
        const { data } = await admin.from("inspections").select("id").in("template_id", templateIds);
        for (const row of data ?? []) inspections.add(row.id);
      }
      if (owners.length > 0) {
        const { data } = await admin.from("inspections").select("id").in("inspector_id", owners);
        for (const row of data ?? []) inspections.add(row.id);
      }
      for (const id of inspections) await attempt(`inspection ${id}`, () => removeInspection(admin, id));
      if (templateIds.length > 0) {
        await attempt("templates", async () => {
          const { error } = await admin.from("templates").delete().in("id", templateIds);
          if (error) throw new Error(error.message);
        });
      }
    };
    await removeTemplatesAndInspections();
    if (clientId) {
      const removeClient = async () => {
        const { error } = await admin.from("clients").delete().eq("id", clientId!);
        if (error) throw new Error(error.message);
      };
      try {
        await removeClient();
      } catch {
        // A version made at the last moment still points at the client: once more.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await removeTemplatesAndInspections();
        await attempt("client", removeClient);
      }
    }
    // Team members out of their team first: a lead with a team cannot be deleted.
    if (owners.length > 0) {
      await attempt("teams", async () => {
        const { error } = await admin.from("profiles").update({ lead_id: null }).in("id", owners);
        if (error) throw new Error(error.message);
      });
    }
    for (const id of [...owners].reverse()) {
      await attempt(`account ${id}`, async () => {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (!error || error.status === 404) return;
        // An audit row naming the account as actor (a deletion it made) keeps it, by design: deactivate it instead.
        await admin.from("profiles").update({ active: false, lead_id: null }).eq("id", id);
        throw new Error(`${error.message} (deactivated instead)`);
      });
    }
    if (problems.length > 0) {
      const message = `Data acceptance cleanup left something behind:\n${problems.join("\n")}`;
      // Also on the console: a hook error can be attributed to a test that is expected to fail.
      console.error(message);
      throw new Error(message);
    }
  };

  try {
    const lead = await account("E2E Final Lead", { active: true, is_lead: true });
    const inspector = await account("E2E Final Inspector", { active: true, lead_id: lead.id });
    const other = await account("E2E Final Other", { active: true, lead_id: lead.id });

    const { data: adminProfile, error: adminError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", TEST_ACCOUNTS.admin)
      .single();
    if (adminError) fail("finding the test admin", adminError);

    const clientName = `E2E final data client ${suffix}`;
    const { data: client, error: clientError } = await admin.from("clients").insert({ name: clientName }).select("id").single();
    if (clientError) fail("creating the client", clientError);
    clientId = client.id;

    const template = definition(templateCode, client.id);
    const resolution = resolveTemplate(template, lookupFrom([]));
    if (!resolution.ok) fail("resolving the template", { message: JSON.stringify(resolution.problems) });
    const { data: templateRow, error: templateError } = await admin
      .from("templates")
      .insert({ ...templateRowFields(template, resolution.template), version: 1, status: "active" })
      .select("id")
      .single();
    if (templateError) fail("creating the template", templateError);
    const resolved = resolution.template;

    const ownerOf = { inspector, other, lead } as const;

    const session: DataFixture["session"] = (who) => {
      let pending = sessions.get(who);
      if (!pending) {
        pending =
          who === "admin"
            ? signInOnce(TEST_ACCOUNTS.admin, TEST_PASSWORD)
            : signInOnce(ownerOf[who].email, ownerOf[who].password);
        sessions.set(who, pending);
      }
      return pending;
    };

    const createInspection: DataFixture["createInspection"] = async (owner, options = {}) => {
      const person = ownerOf[owner];
      const data = options.data ?? readyData(randomUUID().slice(0, 4).toUpperCase());
      const columns = mirroredColumns(
        evaluateCapture({
          template: resolved,
          overrides: {},
          data,
          meta: {
            refNo: null,
            inspectionDate: todayInMalaysia(),
            inspector: { id: person.id, name: person.name },
            client: { id: client.id, name: clientName },
            manufacturer: { id: HARTALEGA.id, name: HARTALEGA.label },
          },
        }),
      );
      const { data: inserted, error } = await admin
        .from("inspections")
        .insert({
          ...columns,
          ...(options.productName ? { product_name: options.productName } : {}),
          template_id: templateRow.id,
          inspector_id: person.id,
          client_id: client.id,
          manufacturer_id: HARTALEGA.id,
          data: data as unknown as NonNullable<Json>,
        })
        .select("id, ref_no")
        .single();
      if (error) fail(`creating an inspection of ${owner}`, error);
      if (options.status === "submitted" || options.status === "approved") {
        const submitted = await admin.from("inspections").update({ status: "submitted" }).eq("id", inserted.id);
        if (submitted.error) fail("submitting", submitted.error);
      }
      if (options.status === "approved") {
        const approved = await admin.from("inspections").update({ status: "approved" }).eq("id", inserted.id);
        if (approved.error) fail("approving", approved.error);
      }
      return { id: inserted.id, refNo: inserted.ref_no };
    };

    const row: DataFixture["row"] = async (id) => {
      const { data, error } = await admin.from("inspections").select(INSPECTION_COLUMNS).eq("id", id).maybeSingle();
      if (error) fail(`reading inspection ${id}`, error);
      return data as InspectionRow | null;
    };

    const audit: DataFixture["audit"] = async (id) => {
      const { data, error } = await admin
        .from("audit_log")
        .select("id, inspection_id, actor_id, action, changes, at")
        .eq("inspection_id", id)
        .order("id");
      if (error) fail(`reading the audit log of ${id}`, error);
      return data as AuditRow[];
    };

    const deletionRecords: DataFixture["deletionRecords"] = async (id) => {
      const { data, error } = await admin
        .from("audit_log")
        .select("id, inspection_id, actor_id, action, changes, at")
        .is("inspection_id", null)
        .eq("action", "deleted")
        .eq("changes->>inspection_id", id);
      if (error) fail(`reading the deletion record of ${id}`, error);
      return data as AuditRow[];
    };

    const templateById: DataFixture["template"] = async (id) => {
      const { data, error } = await admin
        .from("templates")
        .select("id, code, version, status, definition, resolved, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error) fail(`reading template ${id}`, error);
      return data as TemplateRow | null;
    };

    return {
      suffix,
      templateCode,
      templateId: templateRow.id,
      client: { id: client.id, name: clientName },
      lead,
      inspector,
      other,
      adminId: adminProfile.id,
      session,
      createInspection,
      row,
      audit,
      deletionRecords,
      template: templateById,
      templateVersions,
      cleanup,
    };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}
