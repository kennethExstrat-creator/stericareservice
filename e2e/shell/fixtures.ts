import { lookupFrom, templateRowFields } from "@/lib/templates";
import { TemplateDefinitionSchema } from "@/lib/schemas/template";
import { resolveTemplate } from "@/modules";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the shell specs (e2e/README.md), one set per Playwright
 * project so the three sizes never share a row: a draft template resolved
 * with the real modules (code E2E_SHELL_<PROJECT>) and one draft inspection
 * of it by the test admin, whose gallery holds a photo back while Sign out
 * is tried. Created with the secret key and deleted afterwards: the
 * inspection's Storage objects first, then the inspection through
 * deleteTestInspection(), then the template. A run that died half way is
 * cleaned up by the next.
 *
 * Side effects that cannot be undone through the API, by design: the
 * inspection draws a number from the ref sequence, and its deletion leaves an
 * audit row (action "deleted"), visible to admins only.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const SHELL_CODE = "E2E_SHELL";

/** The buckets that hold an inspection's photos and files, under <inspection id>/. */
const BUCKETS = ["inspection-photos", "inspection-files"] as const;

/** A code per Playwright project: E2E_SHELL_IPAD_PORTRAIT. */
export function shellCodeFor(project: string): string {
  return `${SHELL_CODE}_${project.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function definitionFor(code: string) {
  return TemplateDefinitionSchema.parse({
    code,
    name: "Shell e2e fixture (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [
      { key: "header", include: true },
      { key: "glove_info", include: true },
      { key: "conclusion", include: true },
    ],
  });
}

export type ShellFixture = {
  templateId: string;
  inspectionId: string;
  refNo: string;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Shell fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** Every object in one inspection's folders of both buckets (photos keep their thumbnails in thumbs/). */
async function storedObjects(admin: AdminClient, inspectionId: string): Promise<{ bucket: string; path: string }[]> {
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

/** Every version of the code, the inspections that use them first, each with its Storage objects. */
async function removeShellRows(admin: AdminClient, code: string): Promise<void> {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", code);
  if (error) fail(`finding ${code}`, error);
  const templateIds = templates.map((template) => template.id);
  if (templateIds.length === 0) return;

  const { data: inspections, error: findError } = await admin
    .from("inspections")
    .select("id")
    .in("template_id", templateIds);
  if (findError) fail(`finding the inspections of ${code}`, findError);
  for (const inspection of inspections) {
    const objects = await storedObjects(admin, inspection.id);
    for (const bucket of BUCKETS) {
      const paths = objects.filter((object) => object.bucket === bucket).map((object) => object.path);
      if (paths.length === 0) continue;
      const removed = await admin.storage.from(bucket).remove(paths);
      if (removed.error) fail(`removing ${bucket} objects of ${inspection.id}`, removed.error);
    }
    await deleteTestInspection(admin, inspection.id);
  }

  const removed = await admin.from("templates").delete().in("id", templateIds);
  if (removed.error) fail(`deleting ${code}`, removed.error);
}

/** The template and the admin's draft inspection for one Playwright project. */
export async function createShellFixture(project: string): Promise<ShellFixture> {
  const admin = createTestAdminClient();
  const code = shellCodeFor(project);
  await removeShellRows(admin, code);
  try {
    const definition = definitionFor(code);
    const resolution = resolveTemplate(definition, lookupFrom([]));
    if (!resolution.ok) fail("resolving the template", { message: JSON.stringify(resolution.problems) });

    // A draft: no inspector can start from it, and only this spec's inspection uses it.
    const { data: template, error: templateError } = await admin
      .from("templates")
      .insert({ ...templateRowFields(definition, resolution.template), version: 1, status: "draft" })
      .select("id")
      .single();
    if (templateError) fail("creating the template", templateError);

    const { data: owner, error: ownerError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", TEST_ACCOUNTS.admin)
      .single();
    if (ownerError) fail("finding the test admin", ownerError);

    const { data: inspection, error: inspectionError } = await admin
      .from("inspections")
      .insert({
        template_id: template.id,
        inspector_id: owner.id,
        po_no: `E2E-SHELL-PO-${project.toUpperCase()}`,
        product_name: "Nitrile examination gloves (shell e2e)",
      })
      .select("id, ref_no")
      .single();
    if (inspectionError) fail("creating the inspection", inspectionError);

    return {
      templateId: template.id,
      inspectionId: inspection.id,
      refNo: inspection.ref_no,
      cleanup: () => removeShellRows(admin, code),
    };
  } catch (error) {
    // afterAll gets no fixture to clean up, so remove what was made so far.
    await removeShellRows(admin, code).catch(() => undefined);
    throw error;
  }
}
