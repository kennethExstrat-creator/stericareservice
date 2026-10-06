import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Browser } from "@playwright/test";
import { lookupFrom, templateRowFields } from "@/lib/templates";
import { TemplateDefinitionSchema } from "@/lib/schemas/template";
import { resolveTemplate } from "@/modules";
import type { TablesInsert } from "../../lib/supabase/database.types";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";

/**
 * Temporary rows for the review specs, made with the secret key and removed
 * afterwards (e2e/README.md):
 *
 *   A  submitted, for the admin to approve: glove information filled in,
 *      comments on two modules, a custom section, weight switched off with a
 *      reason, and two report photos plus one that is not for the report.
 *      Its remark is only in the conclusion's data, not yet in the row;
 *   B  submitted, for the admin to reopen;
 *   C  a draft of admin@test.local's own, which the inspector must not see,
 *      its final result only in the conclusion's data;
 *   D  submitted, on a template version whose resolved copy cannot be read,
 *      so its results cannot be worked out.
 *
 * A, B and D belong to inspector@test.local. All use draft templates no
 * inspector can start from: version 1 of E2E_REVIEW, resolved with the real
 * modules so its config stays valid as the modules are built, and for D a
 * version 2 whose resolved copy is broken on purpose. Teardown removes the
 * photos' Storage objects, then each inspection through
 * deleteTestInspection() (the service role cannot delete an approved one),
 * then the templates. A run that died half way is cleaned up by the next.
 */

type AdminClient = ReturnType<typeof createTestAdminClient>;

export const FIXTURE_TEMPLATE_CODE = "E2E_REVIEW";
const PHOTO_BUCKET = "inspection-photos";

// Reference rows from supabase/seed.sql, which uses fixed ids.
const SEED = {
  polyco: "20000000-0000-4000-8000-000000000001",
  hartalega: "10000000-0000-4000-8000-000000000001",
} as const;

export const WEIGHT_OFF_REASON = "Scale out of calibration on site; weighed at the lab instead.";
export const GLOVE_INFO_COMMENT = "Indicative weight taken from the spec sheet on the carton.";
export const WATERTIGHT_COMMENT = "Two gloves burst at the cuff while filling; retested with new samples.";
export const REMARK_A = "Shipment accepted. Carton labels clean.";
export const REMARK_B = "Waiting for the lab report on force at break.";
export const PHOTO_CAPTION = "Glove on the measuring board";

const DEFINITION = TemplateDefinitionSchema.parse({
  code: FIXTURE_TEMPLATE_CODE,
  name: "Review e2e fixture (temporary)",
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
  modules: [
    { key: "header", include: true },
    { key: "glove_info", include: true },
    { key: "order_lots", include: true },
    { key: "packing_config", include: true },
    { key: "sampling_plan", include: true },
    { key: "weight", include: true },
    { key: "watertight", include: true },
    { key: "visual", include: true },
    { key: "conclusion", include: true },
  ],
  customModules: [
    {
      key: "glove_type",
      title: "Glove Type",
      after: "header",
      layout: "fields",
      fields: [
        { key: "gloveType", label: "Glove type", type: "select", options: ["Powder-free", "Powdered"] },
        { key: "sterile", label: "Sterile", type: "yes_no" },
      ],
    },
  ],
});

export type ReviewFixture = {
  A: { id: string; refNo: string };
  B: { id: string; refNo: string };
  /** The admin's own draft: an inspection the inspector must not see. */
  C: { id: string; refNo: string };
  /** Submitted, but its template version cannot be read: nothing can be checked. */
  D: { id: string; refNo: string };
  inspectorId: string;
  adminId: string;
  /** Changes B without a status change, as another admin's edit would: its version moves on. */
  touchB: () => Promise<void>;
  cleanup: () => Promise<void>;
};

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`Review fixture: ${step} failed: ${error?.message ?? "no data"}`);
}

/** Every object in an inspection's photo folder, thumbnails included. */
async function removePhotoObjects(admin: AdminClient, inspectionId: string) {
  for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
    const { data, error } = await admin.storage.from(PHOTO_BUCKET).list(folder, { limit: 100 });
    if (error) fail(`listing ${folder}`, error);
    const names = data.filter((entry) => entry.id !== null).map((entry) => `${folder}/${entry.name}`);
    if (names.length === 0) continue;
    const removed = await admin.storage.from(PHOTO_BUCKET).remove(names);
    if (removed.error) fail(`removing the photos in ${folder}`, removed.error);
  }
}

/** Deletes every row and object a previous run may have left behind. */
async function removeFixtureRows(admin: AdminClient) {
  const { data: templates, error } = await admin.from("templates").select("id").eq("code", FIXTURE_TEMPLATE_CODE);
  if (error) fail("finding old fixture templates", error);
  const templateIds = templates.map((template) => template.id);
  if (templateIds.length === 0) return;

  const { data: inspections, error: findError } = await admin
    .from("inspections")
    .select("id")
    .in("template_id", templateIds);
  if (findError) fail("finding fixture inspections", findError);
  for (const inspection of inspections) {
    await removePhotoObjects(admin, inspection.id);
    await deleteTestInspection(admin, inspection.id);
  }
  const removed = await admin.from("templates").delete().in("id", templateIds);
  if (removed.error) fail("deleting the fixture template", removed.error);
}

export async function createReviewFixture(browser: Browser): Promise<ReviewFixture> {
  const admin = createTestAdminClient();
  await removeFixtureRows(admin);
  try {
    return await insertFixtureRows(admin, browser);
  } catch (error) {
    // afterAll gets no fixture to clean up, so remove what was made so far.
    await removeFixtureRows(admin).catch(() => undefined);
    throw error;
  }
}

async function insertFixtureRows(admin: AdminClient, browser: Browser): Promise<ReviewFixture> {
  const { data: people, error: peopleError } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_ACCOUNTS.inspector, TEST_ACCOUNTS.admin]);
  if (peopleError) fail("finding the test accounts", peopleError);
  const idOf = (email: string) => people.find((person) => person.email === email)?.id ?? fail(`finding ${email}`, null);
  const inspectorId = idOf(TEST_ACCOUNTS.inspector);
  const adminId = idOf(TEST_ACCOUNTS.admin);

  const resolution = resolveTemplate(DEFINITION, lookupFrom([]));
  if (!resolution.ok) fail("resolving the fixture template", { message: JSON.stringify(resolution.problems) });

  // A draft template: no inspector can start from it, and only these rows use it.
  const { data: template, error: templateError } = await admin
    .from("templates")
    .insert({ ...templateRowFields(DEFINITION, resolution.template), version: 1, status: "draft" })
    .select("id")
    .single();
  if (templateError) fail("creating the fixture template", templateError);

  // The same definition, but a resolved copy the app cannot read.
  const { data: broken, error: brokenError } = await admin
    .from("templates")
    .insert({ ...templateRowFields(DEFINITION, resolution.template), version: 2, status: "draft", resolved: { broken: true } })
    .select("id")
    .single();
  if (brokenError) fail("creating the unreadable fixture template", brokenError);

  const common = {
    template_id: template.id,
    inspector_id: inspectorId,
    client_id: SEED.polyco,
    manufacturer_id: SEED.hartalega,
    inspection_date: "2026-10-05",
  } satisfies Partial<TablesInsert<"inspections">>;

  const rows: TablesInsert<"inspections">[] = [
    {
      ...common,
      po_no: "E2E-REVIEW-PO-A",
      product_name: "Nitrile examination gloves, blue (E2E review)",
      lot_numbers: ["E2E-LOT-A1", "E2E-LOT-A2"],
      // No remarks column: capture has not copied the conclusion's remark into the row yet.
      result: "pass",
      data: {
        modules: {
          conclusion: { remark: REMARK_A },
          glove_info: {
            surfaceTexture: "Finger-textured",
            indicativeWeight: 3.5,
            colour: "Blue",
            length: "240 mm minimum",
            comment: GLOVE_INFO_COMMENT,
          },
          watertight: { comment: WATERTIGHT_COMMENT },
        },
        custom: { glove_type: { gloveType: "Powder-free", sterile: false } },
      },
      module_overrides: { weight: { reason: WEIGHT_OFF_REASON, by: adminId, at: new Date().toISOString() } },
    },
    {
      ...common,
      po_no: "E2E-REVIEW-PO-B",
      product_name: "Nitrile examination gloves, white (E2E review)",
      lot_numbers: ["E2E-LOT-B1"],
      result: "hold",
      remarks: REMARK_B,
      data: {
        modules: { glove_info: { surfaceTexture: "Smooth", indicativeWeight: 3.2, colour: "White", length: "240 mm minimum" } },
        custom: {},
      },
    },
    {
      ...common,
      inspector_id: adminId,
      po_no: "E2E-REVIEW-PO-C",
      product_name: "Nitrile examination gloves, black (E2E review)",
      // No result column yet: the conclusion's final result stands in.
      data: { modules: { conclusion: { finalResult: "fail" } }, custom: {} },
    },
    {
      ...common,
      template_id: broken.id,
      po_no: "E2E-REVIEW-PO-D",
      product_name: "Nitrile examination gloves, green (E2E review)",
      result: "pass",
    },
  ];
  // defaultToNull: false, so a column one row leaves out takes its default, not null.
  const { data: inserted, error: insertError } = await admin
    .from("inspections")
    .insert(rows, { defaultToNull: false })
    .select("id, ref_no, po_no");
  if (insertError) fail("creating the fixture inspections", insertError);
  const byPo = (po: string) => inserted.find((row) => row.po_no === po) ?? fail(`finding ${po}`, null);
  const A = byPo("E2E-REVIEW-PO-A");
  const B = byPo("E2E-REVIEW-PO-B");
  const C = byPo("E2E-REVIEW-PO-C");
  const D = byPo("E2E-REVIEW-PO-D");

  await addPhotos(admin, browser, A.id, inspectorId);

  // Every inspection starts as a draft; the status flow moves A, B and D on.
  const submitted = await admin.from("inspections").update({ status: "submitted" }).in("id", [A.id, B.id, D.id]);
  if (submitted.error) fail("submitting A, B and D", submitted.error);

  return {
    A: { id: A.id, refNo: A.ref_no },
    B: { id: B.id, refNo: B.ref_no },
    C: { id: C.id, refNo: C.ref_no },
    D: { id: D.id, refNo: D.ref_no },
    inspectorId,
    adminId,
    touchB: async () => {
      const touched = await admin
        .from("inspections")
        .update({ remarks: `${REMARK_B} Updated by another admin.` })
        .eq("id", B.id);
      if (touched.error) fail("changing B", touched.error);
    },
    cleanup: () => removeFixtureRows(admin),
  };
}

/* ------------------------------------------------------------------ *
 * Photos: the design page's placeholder illustrations, drawn in the
 * browser and saved as JPEG, as capture would upload them.
 * ------------------------------------------------------------------ */

async function jpegFromSvg(browser: Browser, svgFile: string, width: number): Promise<Buffer> {
  const svg = readFileSync(svgFile, "utf8");
  const page = await browser.newPage();
  try {
    const base64 = await page.evaluate(
      async ({ svg, width }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.round((width * 3) / 4);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No canvas");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      },
      { svg, width },
    );
    return Buffer.from(base64, "base64");
  } finally {
    await page.close();
  }
}

async function addPhotos(admin: AdminClient, browser: Browser, inspectionId: string, inspectorId: string) {
  const photos = [
    { svg: "public/design/photo-glove.svg", module: "glove_info", target: "size:M", caption: PHOTO_CAPTION, report: true },
    { svg: "public/design/photo-defect.svg", module: "watertight", target: "size:M/defect:hole_cuff", caption: null, report: true },
    { svg: "public/design/photo-carton.svg", module: "header", target: null, caption: "Carton stack", report: false },
  ];
  for (const [index, photo] of photos.entries()) {
    const id = randomUUID();
    const storagePath = `${inspectionId}/${id}.jpg`;
    const thumbPath = `${inspectionId}/thumbs/${id}.jpg`;
    for (const [path, width] of [
      [storagePath, 1024],
      [thumbPath, 400],
    ] as const) {
      const upload = await admin.storage
        .from(PHOTO_BUCKET)
        .upload(path, await jpegFromSvg(browser, photo.svg, width), { contentType: "image/jpeg", upsert: false });
      if (upload.error) fail(`uploading ${path}`, upload.error);
    }
    const { error } = await admin.from("inspection_photos").insert({
      id,
      inspection_id: inspectionId,
      module_key: photo.module,
      target: photo.target,
      caption: photo.caption,
      storage_path: storagePath,
      thumb_path: thumbPath,
      taken_at: new Date(Date.UTC(2026, 9, 5, 2, 10 + index)).toISOString(),
      width: 1024,
      height: 768,
      flagged: false,
      include_in_report: photo.report,
      created_by: inspectorId,
    });
    if (error) fail(`adding photo ${index + 1}`, error);
  }
}
