import { isDeepStrictEqual } from "node:util";
import { DEFAULT_GLOSSARY } from "../../lib/schemas/ai-settings";
import type { Json } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the /admin/defects specs, made with the secret key and
 * deleted afterwards (e2e/README.md): a draft template E2E_DEFECTS (a draft,
 * so no new inspection ever picks it), two inspections of the test inspector
 * that use it (one submitted, one draft) with an order and one-off labels in
 * their visual and watertight data, in the canonical shape of
 * docs/DATA_DICTIONARY.md and the modules' schemas, and the temporary codes
 * the specs add. A run that died half way is cleaned up by the next.
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
  /** Visual, major: 2 in size M (whose counts already hold stain: 1) and 1 in size L, spelt in lower case there. */
  tornCuff: "E2E torn cuff",
  /** Visual, minor, 1 found in size M. */
  stickyEdge: "E2E sticky edge",
  /** Watertight "Other :" row, 1 hole in size M. */
  thumbTip: "E2E thumb tip",
  /** On the draft inspection. */
  draft: "E2E draft label",
  /** Visual, major, 3 found in size XL, which is not in the order: it counts nowhere, so it is not listed. */
  unordered: "E2E unordered label",
  /** Visual, major, added in size M but counted 0: nothing was found, so it is not listed either. */
  nothingFound: "E2E nothing found",
} as const;

/** The order: sizes M and L (BUILD_SPEC 6.2 rule 4: the only sizes any module counts). */
export const ORDER = {
  sizes: {
    M: { qtyCases: 10, lotNumbers: ["E2E-LOT-M"], packingSite: null },
    L: { qtyCases: 5, lotNumbers: ["E2E-LOT-L"], packingSite: null },
  },
} satisfies JsonObject;

export type DefectsFixture = {
  submitted: { id: string; refNo: string };
  draft: { id: string; refNo: string };
  templateId: string;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Defects fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/**
 * As templates.resolved holds it: the seed STD_EG lists, cut down, plus a
 * label whose code does not exist, a location the template rewords, and
 * SAFEDON_EG's dispensing faults (so the map dialog never suggests them, or
 * a hole location, for a visual defect, whatever templates the project has).
 */
function resolvedTemplate(): JsonObject {
  return {
    format: 2,
    code: TEMPLATE_CODE,
    name: "Defects e2e fixture (temporary)",
    chain: [TEMPLATE_CODE],
    bases: [],
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [
      { value: "M", label: "M" },
      { value: "L", label: "L" },
    ],
    modules: [
      { key: "header", include: true, title: "Manufacturer Information", labels: {}, config: {} },
      { key: "order_lots", include: true, title: "Order", labels: {}, config: { fields: { packingSite: false } } },
      {
        key: "watertight",
        include: true,
        title: "Freedom from Holes by watertight test",
        // The template's wording over its list's, as the module shows it.
        labels: { hole_crotch: "Crotch (between fingers)" },
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
      {
        key: "dispensing_safedon",
        include: true,
        title: "Glove Dispensing Inspection",
        labels: {},
        config: {
          defects: [
            { code: "no_cuff", label: "No cuff", hint: "" },
            { code: "finger_out", label: "Finger out", hint: "" },
            { code: "faulty_cuff", label: "Faulty cuff", hint: "" },
          ],
          glovesPerPack: 125,
          maxRatePct: 5,
          boxesPerSize: { default: 13 },
        },
      },
      { key: "conclusion", include: true, title: "Conclusion", labels: {}, config: {} },
    ],
    customModules: [],
    report: { title: "Defects e2e fixture", showClientLogo: false },
    sourceFile: null,
  };
}

/**
 * The submitted inspection's data, as the modules save it (a count of 0 is
 * no key): the order, one-off labels in visual (major, in two sizes, and
 * minor) and an Other : hole in watertight; and two that count nowhere: one
 * in a size not in the order, one counted 0.
 */
export function submittedData(): JsonObject {
  return {
    modules: {
      order_lots: ORDER,
      watertight: {
        sizes: {
          M: { tested: 80, holes: { hole_other: 1 }, otherDescription: LABELS.thumbTip, unmapped: [] },
          L: { tested: 80, holes: {}, otherDescription: null, unmapped: [] },
        },
      },
      visual: {
        sizes: {
          M: {
            critical: { inspected: 80, counts: {}, unmapped: [] },
            major: {
              inspected: 80,
              counts: { stain: 1 },
              unmapped: [
                { label: LABELS.tornCuff, count: 2 },
                { label: LABELS.nothingFound, count: 0 },
              ],
            },
            minor: { inspected: 80, counts: {}, unmapped: [{ label: LABELS.stickyEdge, count: 1 }] },
          },
          L: {
            critical: { inspected: 80, counts: {}, unmapped: [] },
            major: { inspected: 80, counts: {}, unmapped: [{ label: LABELS.tornCuff.toLowerCase(), count: 1 }] },
            minor: { inspected: 80, counts: {}, unmapped: [] },
          },
          XL: { major: { inspected: 80, counts: {}, unmapped: [{ label: LABELS.unordered, count: 3 }] } },
        },
      },
    },
    custom: {},
  };
}

function draftData(): JsonObject {
  return {
    modules: {
      order_lots: { sizes: { M: ORDER.sizes.M } },
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

/** Another admin's change to a code, made behind the page's back. */
export async function changeCode(code: string, values: { name?: string; description?: string | null }) {
  const { error } = await createTestAdminClient().from("defect_codes").update(values).eq("code", code);
  if (error) fail(`changing code ${code}`, error);
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

/* ------------------------------------------------------------------ *
 * Shortforms (ai_settings.glossary: one live list, not a fixture row)
 * ------------------------------------------------------------------ */

/** The throwaway shortform the specs add. The list is live, so it is removed afterwards whatever happened. */
export const TEMP_SHORTFORM = "ZZE2E";

const isTemp = (entry: Json) =>
  typeof entry === "object" && entry !== null && !Array.isArray(entry) && typeof entry.short === "string" && entry.short.toUpperCase() === TEMP_SHORTFORM;

async function storedGlossary(admin: AdminClient): Promise<Json[] | null> {
  const { data, error } = await admin.from("ai_settings").select("glossary").eq("id", true).maybeSingle();
  if (error) fail("reading the shortforms", error);
  return Array.isArray(data?.glossary) ? data.glossary : null;
}

/** The throwaway shortform as saved, or null. */
export async function storedShortform(): Promise<Json | null> {
  return (await storedGlossary(createTestAdminClient()))?.find(isTemp) ?? null;
}

/**
 * Takes the throwaway shortform out of the saved list, leaving every other
 * entry as it is. A list that is then just the starting list goes back to
 * null, which means the starting list: on a project that never saved one,
 * the spec's first save wrote the whole starting list, and a copy left there
 * would stop later changes to DEFAULT_GLOSSARY from reaching it.
 */
export async function removeTempShortform(): Promise<void> {
  const admin = createTestAdminClient();
  const list = await storedGlossary(admin);
  if (!list) return;
  const rest = list.filter((entry) => !isTemp(entry));
  const glossary = isDeepStrictEqual(rest, DEFAULT_GLOSSARY) ? null : rest;
  if (glossary !== null && rest.length === list.length) return;
  const { error } = await admin.from("ai_settings").update({ glossary }).eq("id", true);
  if (error) fail("removing the throwaway shortform", error);
}
