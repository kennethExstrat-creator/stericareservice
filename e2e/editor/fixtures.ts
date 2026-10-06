import type { Json } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary templates for the template editor specs (e2e/README.md): drafts
 * with an E2E_EDITOR code, created with the secret key and deleted
 * afterwards, every version of the code. The template in use gets one
 * inspection by the test inspector, deleted first through
 * deleteTestInspection(). A run that died half way is cleaned up by the next.
 *
 * Side effects that cannot be undone, by design: the one inspection draws a
 * number from the ref sequence and leaves a "deleted" audit row. Only the
 * desktop run makes it, so a full run uses one ref number.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const EDITOR_CODE = "E2E_EDITOR";
export const TEMPLATE_NAME = "E2E editor template (temporary)";

/** A code per Playwright project, so the three sizes never share a row: E2E_EDITOR_IPAD_PORTRAIT. */
export function codeFor(project: string, suffix = ""): string {
  return `${EDITOR_CODE}_${project.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}${suffix}`;
}

/**
 * A template of its own (no extends), shaped like STD_EG's first modules.
 * Until the report modules land most are stubs, which take any settings; the
 * worked example, glove_info, has real labels and settings.
 */
export function definitionFor(code: string, name = TEMPLATE_NAME) {
  return {
    code,
    name,
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true },
      { key: "glove_info", include: true },
      { key: "order_lots", include: true },
      { key: "packing_config", include: true },
      { key: "sampling_plan", include: true },
      { key: "watertight", include: true },
      { key: "visual", include: true },
      { key: "conclusion", include: true },
    ],
  };
}

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Template editor fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** Deletes every version of a code, and the inspections that use them first. */
export async function removeTemplates(admin: AdminClient, code: string) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", code);
  if (error) fail(`finding ${code}`, error);
  const ids = templates.map((template) => template.id);
  if (ids.length === 0) return;
  const { data: inspections, error: findError } = await admin.from("inspections").select("id").in("template_id", ids);
  if (findError) fail(`finding the inspections of ${code}`, findError);
  for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
  const removed = await admin.from("templates").delete().in("id", ids);
  if (removed.error) fail(`deleting ${code}`, removed.error);
}

export type EditorFixture = { id: string; code: string; cleanup: () => Promise<void> };

/**
 * A draft no inspection uses, with no resolution yet: the editor resolves it
 * and Save stores it. `retired` instead makes a version that reads only and
 * that no inspection can start from, so it never meets other specs.
 */
export async function createDraftTemplate(code: string, status: "draft" | "retired" = "draft"): Promise<EditorFixture> {
  const admin = createTestAdminClient();
  await removeTemplates(admin, code);
  const { data, error } = await admin
    .from("templates")
    .insert({
      code,
      version: 1,
      product_type: "examination",
      standard: "EN455",
      status,
      definition: definitionFor(code) as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (error) fail(`creating ${code}`, error);
  return { id: data.id, code, cleanup: () => removeTemplates(admin, code) };
}

/** A draft that one inspection uses, so it can no longer change (BUILD_SPEC 4.2 rule 8). */
export async function createUsedTemplate(code: string): Promise<EditorFixture> {
  const fixture = await createDraftTemplate(code);
  const admin = createTestAdminClient();
  try {
    const { data: inspector, error } = await admin
      .from("profiles")
      .select("id")
      .eq("email", TEST_ACCOUNTS.inspector)
      .single();
    if (error) fail("finding the test inspector", error);
    const inserted = await admin
      .from("inspections")
      .insert({ template_id: fixture.id, inspector_id: inspector.id, po_no: "E2E-EDITOR-PO-1" })
      .select("id")
      .single();
    if (inserted.error) fail("creating the inspection that uses it", inserted.error);
  } catch (problem) {
    await fixture.cleanup().catch(() => undefined);
    throw problem;
  }
  return fixture;
}

/** The stored row, to check what Save wrote. */
export async function storedTemplate(id: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin
    .from("templates")
    .select("code, version, status, definition, resolved, updated_at")
    .eq("id", id)
    .single();
  if (error) fail(`reading template ${id}`, error);
  return data;
}

/** Every version of a code, oldest first. */
export async function versionsOf(code: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin.from("templates").select("id, version, status").eq("code", code).order("version");
  if (error) fail(`reading the versions of ${code}`, error);
  return data;
}
