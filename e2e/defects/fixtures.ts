import type { Json } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the /admin/defects specs, made with the secret key and
 * deleted afterwards (e2e/README.md): a draft template E2E_DEFECTS (a draft,
 * so no new inspection ever picks it), two inspections of the test inspector
 * that use it (one submitted, one draft) with one-off labels in their visual
 * and watertight data, in the canonical shape of docs/DATA_DICTIONARY.md, and
 * the temporary codes the specs add. A run that died half way is cleaned up
 * by the next.
 *
 * Side effects that cannot be undone, by design: each inspection draws a
 * number from the ref sequence, and each deletion leaves an audit row
 * (action "deleted"), visible to admins only.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;
type JsonObject = { [key: string]: Json };

export const TEMPLATE_CODE = "E2E_DEFECTS";
/** Codes the specs add; any left behind are deleted. */
export const TEMP_CODES = ["e2e_defect_x", "e2e_defect_y"] as const;
/** A code the template lists that is not a defect code: the label mapping tab flags it. */
export const NOT_A_CODE = "e2e_not_a_code";

/** The one-off labels in the fixture's data. */
export const LABELS = {
  /** Visual, major, 2 found; the counts already hold stain: 1. */
  tornCuff: "E2E torn cuff",
  /** Visual, minor, 1 found. */
  stickyEdge: "E2E sticky edge",
  /** Watertight "Other :" row, 1 hole. */
  thumbTip: "E2E thumb tip",
  /** On the draft inspection. */
  draft: "E2E draft label",
} as const;

export type DefectsFixture = {
  submitted: { id: string; refNo: string };
  draft: { id: string; refNo: string };
  templateId: string;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Defects fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** As templates.resolved holds it: the seed STD_EG lists, cut down, plus a label whose code does not exist. */
function resolvedTemplate(): JsonObject {
  return {
    format: 2,
    code: TEMPLATE_CODE,
    name: "Defects e2e fixture (temporary)",
    chain: [TEMPLATE_CODE],
    bases: [],
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "M", label: "M" }],
    modules: [
      { key: "header", include: true, title: "Manufacturer Information", labels: {}, config: {} },
      { key: "order_lots", include: true, title: "Order", labels: {}, config: {} },
      {
        key: "watertight",
        include: true,
        title: "Freedom from Holes by watertight test",
        labels: {},
        config: {
          aql: 1.5,
          handSplit: false,
          locations: [
            { code: "hole_crotch", label: "Between fingers (crotch)" },
            { code: "hole_palm", label: "Palm" },
            { code: "hole_finger", label: "Finger" },
            { code: "hole_cuff", label: "Cuff" },
            { code: "hole_other", label: "Other :" },
          ],
        },
      },
      {
        key: "visual",
        include: true,
        title: "Visual Inspection",
        labels: {},
        config: {
          handSplit: false,
          classes: {
            critical: { include: true, aql: 0, defects: [{ code: "embedded_insect", label: "Embedded Insects" }] },
            major: {
              include: true,
              aql: 2.5,
              defects: [
                { code: "stain", label: "Oil stain" },
                { code: "bead_defective", label: "Defective bead" },
                { code: NOT_A_CODE, label: "E2E label without a code" },
              ],
            },
            minor: {
              include: true,
              aql: 4,
              defects: [
                { code: "dirt_small", label: "Small dirt / stain" },
                { code: "bead_defective", label: "Defective beads" },
              ],
            },
          },
        },
      },
      { key: "conclusion", include: true, title: "Conclusion", labels: {}, config: {} },
    ],
    customModules: [],
    report: { title: "Defects e2e fixture", showClientLogo: false },
    sourceFile: null,
  };
}

/** The submitted inspection's data: one-off labels in visual (major, minor) and an Other : hole in watertight. */
export function submittedData(): JsonObject {
  return {
    modules: {
      watertight: {
        sizes: { M: { tested: 80, holes: { hole_palm: 0, hole_other: 1 }, otherDescription: LABELS.thumbTip, unmapped: [] } },
      },
      visual: {
        sizes: {
          M: {
            critical: { inspected: 80, counts: {}, unmapped: [] },
            major: { inspected: 80, counts: { stain: 1 }, unmapped: [{ label: LABELS.tornCuff, count: 2 }] },
            minor: { inspected: 80, counts: {}, unmapped: [{ label: LABELS.stickyEdge, count: 1 }] },
          },
        },
      },
    },
    custom: {},
  };
}

function draftData(): JsonObject {
  return {
    modules: {
      visual: { sizes: { M: { major: { inspected: 80, counts: {}, unmapped: [{ label: LABELS.draft, count: 1 }] } } } },
    },
    custom: {},
  };
}

/** Deletes every row a previous run may have left behind. */
async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const templateIds = templates.map((template) => template.id);

  if (templateIds.length > 0) {
    const { data: inspections, error: findError } = await admin
      .from("inspections")
      .select("id")
      .in("template_id", templateIds);
    if (findError) fail("finding fixture inspections", findError);
    for (const inspection of inspections) await deleteTestInspection(admin, inspection.id);
    const removed = await admin.from("templates").delete().in("id", templateIds);
    if (removed.error) fail("deleting the fixture template", removed.error);
  }

  const codes = await admin.from("defect_codes").delete().in("code", [...TEMP_CODES, NOT_A_CODE]);
  if (codes.error) fail("deleting the temporary codes", codes.error);
}

export async function createDefectsFixture(): Promise<DefectsFixture> {
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

async function insertFixtureRows(admin: AdminClient): Promise<DefectsFixture> {
  const { data: inspector, error: inspectorError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (inspectorError) fail("finding the test inspector", inspectorError);

  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({
      code: TEMPLATE_CODE,
      version: 1,
      product_type: "examination",
      standard: "EN455",
      status: "draft",
      definition: { code: TEMPLATE_CODE, name: "Defects e2e fixture (temporary)", modules: [] },
      resolved: resolvedTemplate(),
    })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  const { data: inserted, error: insertError } = await admin
    .from("inspections")
    .insert([
      { template_id: template.id, inspector_id: inspector.id, po_no: "E2E-DEFECTS-SUBMITTED", data: submittedData() },
      { template_id: template.id, inspector_id: inspector.id, po_no: "E2E-DEFECTS-DRAFT", data: draftData() },
    ])
    .select("id, ref_no, po_no");
  if (insertError) fail("creating the fixture inspections", insertError);
  const byPo = (po: string) => inserted.find((row) => row.po_no === po) ?? fail(`finding inspection ${po}`, null);
  const submitted = byPo("E2E-DEFECTS-SUBMITTED");
  const draft = byPo("E2E-DEFECTS-DRAFT");

  // Every inspection starts as a draft; the status flow moves this one on.
  const moved = await admin.from("inspections").update({ status: "submitted" }).eq("id", submitted.id);
  if (moved.error) fail("submitting the inspection", moved.error);

  return {
    submitted: { id: submitted.id, refNo: submitted.ref_no },
    draft: { id: draft.id, refNo: draft.ref_no },
    templateId: template.id,
    cleanup: () => removeFixtureRows(admin),
  };
}

/** The inspection's data as saved (a check of what an action wrote, never of what a user can see). */
export async function inspectionData(id: string): Promise<{ data: Json; updatedAt: string }> {
  const { data, error } = await createTestAdminClient().from("inspections").select("data, updated_at").eq("id", id).single();
  if (error) fail(`reading inspection ${id}`, error);
  return { data: data.data, updatedAt: data.updated_at };
}

/** The audit rows the mapping action wrote on an inspection. */
export async function mappingEvents(id: string) {
  const { data, error } = await createTestAdminClient()
    .from("audit_log")
    .select("action, changes, actor_id")
    .eq("inspection_id", id)
    .eq("action", "defect_label.mapped")
    .order("id");
  if (error) fail(`reading the audit log of ${id}`, error);
  return data;
}

/** A defect code as stored, or null. */
export async function storedCode(code: string) {
  const { data, error } = await createTestAdminClient()
    .from("defect_codes")
    .select("code, name, description, active")
    .eq("code", code)
    .maybeSingle();
  if (error) fail(`reading code ${code}`, error);
  return data;
}
