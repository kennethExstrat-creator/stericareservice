import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { registryWith, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { definition as conclusionModule } from "@/modules/conclusion";
import { RICH_TEXT_EXAMPLE_HTML, RICH_TEXT_EXAMPLE_TEXT, richTextExample } from "@/lib/rich-text/__fixtures__/example";
import { createFakeSupabase, type FakeSupabaseOptions } from "./__fixtures__/fake-supabase";
import {
  IDS,
  makeInspectionData,
  makeInspectionRow,
  makeObjects,
  makeResolvedTemplate,
  makeTables,
  PATHS,
  UPDATED_AT,
} from "./__fixtures__/inspection";
import { canExportInspection } from "./access";
import { buildInspectionExport, type BuildExportOptions } from "./build";
import { INSPECTION_RECORD_SELECT, loadInspectionRecord } from "./record";
import { EXPORT_URL_TTL_SECONDS } from "./sign";

const EXPORTED_AT = "2026-10-06T02:00:00.000Z";
const ADMIN = { id: IDS.admin, role: "admin" } as const;
/** The lead inspector whose team the fixture's inspector is in. */
const LEAD = { id: IDS.lead, role: "inspector", isLead: true } as const;
const NOT_FOUND = { ok: false, reason: "not_found", message: "Inspection not found." } as const;

function setup(options: FakeSupabaseOptions = {}) {
  return createFakeSupabase({ tables: makeTables(), objects: makeObjects(), ...options });
}

async function build(fake = setup(), options: BuildExportOptions = {}) {
  return buildInspectionExport(fake.client, IDS.inspection, {
    registry: TEST_REGISTRY,
    now: () => new Date(EXPORTED_AT),
    viewer: ADMIN,
    ...options,
  });
}

async function exportOf(fake = setup(), options: BuildExportOptions = {}): Promise<InspectionExport> {
  const result = await build(fake, options);
  if (!result.ok) throw new Error(`export failed: ${result.reason} ${result.message}`);
  return result.export;
}

function moduleOf(doc: InspectionExport, key: string) {
  const found = doc.modules.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no module ${key}`);
  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildInspectionExport", () => {
  it("builds a document that validates and survives a JSON round trip", async () => {
    const doc = await exportOf();
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    expect(ExportSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(doc).toMatchObject({
      schemaVersion: "1",
      refNo: "INS-2026-0042",
      status: "submitted",
      timestamps: {
        createdAt: "2026-10-05T01:00:00.123456+00:00",
        // Exactly as stored: it identifies the version an AI review belongs to.
        updatedAt: UPDATED_AT,
        submittedAt: UPDATED_AT,
        approvedAt: null,
        exportedAt: EXPORTED_AT,
      },
      inspector: { id: IDS.inspector, name: "Inspector A", email: "inspector@test.local" },
    });
  });

  it("describes the template version, client and manufacturer, with signed links to the logo and the source form", async () => {
    const fake = setup();
    const doc = await exportOf(fake);
    expect(doc.template).toEqual({
      code: "TEST_EG",
      version: 3,
      standard: "EN455",
      productType: "examination",
      client: { id: IDS.client, name: "Client A" },
      manufacturer: { id: IDS.manufacturer, name: "Manufacturer A · Factory 1" },
      reportTitle: "Preshipment Inspection: Nitrile Disposable Examination Gloves",
      clientLogoUrl: expect.stringContaining(`/client-logos/${PATHS.logo}`),
      sourceFile: expect.stringContaining(`/template-sources/${PATHS.source}`),
      // Every size the template lists, not only those ordered (size M): the report's fixed rows.
      sizes: ["XS", "S", "M", "L", "XL"].map((value) => ({ value, label: value })),
      unit: "pcs",
      pageHeader: null,
    });
    // Every link is signed for 24 hours (BUILD_SPEC 9.1).
    expect(fake.signed.length).toBeGreaterThan(0);
    for (const request of fake.signed) expect(request.expiresIn).toBe(EXPORT_URL_TTL_SECONDS);
    expect(EXPORT_URL_TTL_SECONDS).toBe(86_400);
  });

  it("leaves the client logo out when the template does not show it", async () => {
    const resolved = makeResolvedTemplate({ report: { title: "Report", showClientLogo: false } });
    const fake = setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({}, { resolved })] } });
    const doc = await exportOf(fake);
    expect(doc.template.clientLogoUrl).toBeNull();
    expect(fake.signed.some((request) => request.bucket === "client-logos")).toBe(false);
  });

  it("lists the included modules in template order, with the template's wording, data, computed values, results and comments", async () => {
    const doc = await exportOf();
    expect(doc.modules.map((module) => module.key)).toEqual([
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "weight",
      "visual",
      "conclusion",
    ]);

    const gloveInfo = moduleOf(doc, "glove_info");
    expect(gloveInfo).toMatchObject({
      title: "Glove Information",
      labels: { indicativeWeight: "Indicative weight (size M)" },
      data: { indicativeWeight: 3.5, colour: "Blue" },
      result: { status: "info" },
      comment: "Indicative weight from the glove spec sheet.",
    });
    // The comment is the module's, not part of its data.
    expect(gloveInfo.data).not.toHaveProperty("comment");

    const weight = moduleOf(doc, "weight");
    expect(weight.result.status).toBe("warn");
    expect(weight.computed).toHaveProperty("M");
    expect(weight.comment).toBe("Weighed on the factory scale.");
    // Size L is saved but not ordered: it appears nowhere, only as a warning (6.2 rule 4).
    expect(Object.keys((weight.data as { sizes: object }).sizes)).toEqual(["M"]);
    expect(weight.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["weight_deviation", "size_not_ordered"]),
    );
    expect(weight.warnings.find((warning) => warning.code === "weight_deviation")).toMatchObject({ size: "M" });
  });

  it("carries each module's settings from the template version: its config over the module's defaults", async () => {
    const doc = await exportOf();
    // The weight test module's defaults; the template sets none.
    expect(moduleOf(doc, "weight").config).toEqual({ n: 13, warnThresholdPct: 10 });
    expect(moduleOf(doc, "packing_config").config).toEqual({ innerUnit: "inner box" });
    expect(moduleOf(doc, "carton_sampling").config).toEqual({});
    expect(doc.modules.every((module) => module.config !== undefined)).toBe(true);
  });

  it("exports a config the module refuses as the template has it, beside the invalid_config error", async () => {
    const resolved = makeResolvedTemplate();
    const weight = resolved.modules.find((entry) => entry.key === "weight");
    if (!weight) throw new Error("no weight module");
    weight.config = { n: 0, warnThresholdPct: 10 };
    const doc = await exportOf(setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({}, { resolved })] } }));
    const exported = moduleOf(doc, "weight");
    expect(exported.config).toEqual({ n: 0, warnThresholdPct: 10 });
    expect(exported.errors?.map((error) => error.code)).toContain("invalid_config");
  });

  it("carries warnings and errors per module", async () => {
    const doc = await exportOf();
    expect(moduleOf(doc, "packing_config").warnings.map((warning) => warning.code)).toContain("gloves_per_case_mismatch");
    const cartons = moduleOf(doc, "carton_sampling");
    expect(cartons.result.status).toBe("fail");
    expect(cartons.errors?.map((error) => error.code)).toEqual(["carton_duplicate"]);
    expect(moduleOf(doc, "visual")).toMatchObject({ warnings: [], errors: [] });
  });

  it("lists a module switched off for this inspection with the admin's reason, and keeps it out of the modules", async () => {
    const doc = await exportOf();
    expect(doc.excludedModules).toEqual([{ key: "dimensions", title: "Dimension", reason: "Calipers out for calibration." }]);
    expect(doc.modules.some((module) => module.key === "dimensions")).toBe(false);
  });

  it("exports custom modules with their fields and values", async () => {
    const doc = await exportOf();
    expect(doc.custom).toEqual([
      {
        key: "glove_type",
        title: "Glove Type",
        after: "header",
        layout: "fields",
        fields: [{ key: "gloveType", label: "Glove Type", type: "text" }],
        values: { gloveType: "Nitrile, powder free" },
      },
    ]);
  });

  it("exports photos and files with signed links, in module order, and leaves out what Storage no longer has", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await build();
    if (!result.ok) throw new Error(result.message);
    const { photos, files } = result.export;

    expect(photos.map((photo) => photo.id)).toEqual([IDS.photoWeight, IDS.photoVisual, IDS.photoUntagged, IDS.photoHeic]);
    expect(photos[1]).toEqual({
      id: IDS.photoVisual,
      url: expect.stringContaining(PATHS.photoVisual),
      moduleKey: "visual",
      target: "size:M/defect:thin_spot",
      caption: "Thin spot on glove body",
      takenAt: "2026-10-05T04:10:00+00:00",
      includeInReport: true,
      flagged: false,
      description: null,
      markers: [],
      size: null,
    });
    // Blank tags and captions read as none; a HEIC original keeps its flag.
    expect(photos[2]).toMatchObject({ moduleKey: null, caption: null });
    expect(photos[3]).toMatchObject({ moduleKey: null, flagged: true, url: expect.stringContaining(PATHS.photoHeic) });

    expect(files).toEqual([
      {
        id: IDS.fileLab,
        url: expect.stringContaining(PATHS.fileLab),
        moduleKey: "weight",
        kind: "lab_report",
        name: "Lab report.pdf",
      },
    ]);
    expect(result.skipped).toEqual([{ bucket: "inspection-photos", path: PATHS.photoMissing, id: IDS.photoMissing }]);
    expect(warn).toHaveBeenCalled();
  });

  it("concludes with the computed suggestion and the final result and remark the inspector entered", async () => {
    // The row's remarks column still holds an older copy: the conclusion module is the source.
    const doc = await exportOf();
    expect(doc.conclusion).toEqual({
      suggestedResult: "fail",
      finalResult: "hold",
      remark: "Weight below the indicative value; waiting for the spec sheet.",
      inspector: { id: IDS.inspector, name: "Inspector A" },
      date: null,
      inspectionSummary: null,
      // Data saved before To Sign After Exported existed: signed on the pad, as before.
      signAfterExport: false,
    });
  });

  describe("To Sign After Exported (Kenneth, 13 October 2026)", () => {
    const STROKES = { width: 600, height: 200, strokes: [[40, 150, 120, 60, 200, 140]] };

    /** The export with the real conclusion module, its data as given. */
    async function exportWithConclusion(conclusion: Record<string, unknown>) {
      const data = makeInspectionData();
      data.modules.conclusion = { ...data.modules.conclusion, ...conclusion } as typeof data.modules.conclusion;
      const fake = setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({ data })] } });
      return exportOf(fake, { registry: registryWith({ conclusion: conclusionModule }) });
    }

    it("says so in the conclusion block and sends no drawn signature, so the report leaves the line blank", async () => {
      const doc = await exportWithConclusion({ signature: STROKES, signAfterExport: true });
      expect(doc.conclusion.signAfterExport).toBe(true);
      expect(moduleOf(doc, "conclusion").data).toMatchObject({ signAfterExport: true, signature: null });
      expect(ExportSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    });

    it("sends the drawn signature while it is off", async () => {
      const doc = await exportWithConclusion({ signature: STROKES, signAfterExport: false });
      expect(doc.conclusion.signAfterExport).toBe(false);
      expect(moduleOf(doc, "conclusion").data).toMatchObject({ signAfterExport: false, signature: STROKES });
    });

    it("reads data saved before it existed as off, the signature as drawn", async () => {
      const doc = await exportWithConclusion({ signature: STROKES });
      expect(doc.conclusion.signAfterExport).toBe(false);
      expect(moduleOf(doc, "conclusion").data).toMatchObject({ signAfterExport: false, signature: STROKES });
    });

    it("sends no drawn signature from data it cannot read either, while the saved data has the switch on", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      // An unknown key: the conclusion's data fails its schema and goes out as saved, beside the error.
      const doc = await exportWithConclusion({ signature: STROKES, signAfterExport: true, unknownKey: 1 });
      expect(moduleOf(doc, "conclusion").errors?.map((issue) => issue.code)).toContain("invalid_data");
      expect(moduleOf(doc, "conclusion").data).toMatchObject({ signAfterExport: true, signature: null, unknownKey: 1 });
      error.mockRestore();
    });
  });

  it("gives the inspection summary as HTML and plain text, and keeps the document in the module's data", async () => {
    const data = makeInspectionData();
    data.modules.conclusion = { ...data.modules.conclusion, inspectionSummary: richTextExample() } as typeof data.modules.conclusion;
    const fake = setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({ data })] } });
    // The real conclusion module, which holds the summary.
    const doc = await exportOf(fake, { registry: registryWith({ conclusion: conclusionModule }) });
    expect(doc.conclusion.inspectionSummary).toEqual({ html: RICH_TEXT_EXAMPLE_HTML, text: RICH_TEXT_EXAMPLE_TEXT });
    expect(moduleOf(doc, "conclusion").data.inspectionSummary).toEqual(richTextExample());
    expect(ExportSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("takes the final result from the conclusion module when the row's copy differs", async () => {
    const fake = setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({ result: "pass" })] } });
    expect((await exportOf(fake)).conclusion.finalResult).toBe("hold");
  });

  it("falls back to the row's columns when the conclusion module holds no final result or remark", async () => {
    const data = makeInspectionData();
    data.modules.conclusion = { finalResult: null, remark: "  " } as unknown as typeof data.modules.conclusion;
    const fake = setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({ data, result: "fail" })] } });
    expect((await exportOf(fake)).conclusion).toMatchObject({ finalResult: "fail", remark: "Remark as first saved." });

    const neither = makeInspectionRow({ data, result: null, remarks: null });
    const empty = setup({ tables: { ...makeTables(), inspections: [neither] } });
    expect((await exportOf(empty)).conclusion).toMatchObject({ finalResult: null, remark: null });
  });

  it("names the inspector by email when the profile has no name, and leaves out an address the schema would refuse", async () => {
    const byEmail = setup({
      tables: {
        ...makeTables(),
        inspections: [makeInspectionRow({ inspector: { id: IDS.inspector, full_name: null, email: "qc@example.com" } })],
      },
    });
    expect((await exportOf(byEmail)).inspector).toEqual({ id: IDS.inspector, name: "qc@example.com", email: "qc@example.com" });

    const unreadable = setup({
      tables: { ...makeTables(), inspections: [makeInspectionRow({ inspector: null })] },
    });
    expect((await exportOf(unreadable)).inspector).toEqual({ id: IDS.inspector, name: "Unknown inspector" });
  });

  it("is for the inspection's inspector, their lead inspector or an admin only", async () => {
    expect((await build(setup(), { viewer: { id: IDS.inspector, role: "inspector" } })).ok).toBe(true);
    expect(await build(setup(), { viewer: { id: IDS.otherInspector, role: "inspector" } })).toEqual(NOT_FOUND);
    // The lead of the inspector's team (Kenneth, 27 October 2026), not another team's.
    expect((await build(setup(), { viewer: LEAD })).ok).toBe(true);
    expect(await build(setup(), { viewer: { id: IDS.otherLead, role: "inspector", isLead: true } })).toEqual(NOT_FOUND);
    // Not flagged a lead inspector, as Steri-AI's viewers are not: no way in as their lead.
    expect(await build(setup(), { viewer: { id: IDS.lead, role: "inspector" } })).toEqual(NOT_FOUND);
  });

  it("reads the inspector's lead inspector with the inspection, and keeps it out of the export", async () => {
    expect(INSPECTION_RECORD_SELECT).toContain("inspector:profiles!inspections_inspector_id_fkey(id, full_name, email, lead_id)");
    const loaded = await loadInspectionRecord(setup().client, IDS.inspection);
    expect(loaded.ok && loaded.record.inspector).toEqual({
      id: IDS.inspector,
      fullName: "Inspector A",
      email: "inspector@test.local",
      leadId: IDS.lead,
    });
    expect((await exportOf()).inspector).toEqual({ id: IDS.inspector, name: "Inspector A", email: "inspector@test.local" });
  });

  it("lets no lead inspector in when the inspector is in no team, or their profile cannot be read", async () => {
    const withInspector = (inspector: Record<string, unknown> | null) =>
      setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({ inspector })] } });
    const noTeam = withInspector({ id: IDS.inspector, full_name: "Inspector A", email: "inspector@test.local", lead_id: null });
    expect(await build(noTeam, { viewer: LEAD })).toEqual(NOT_FOUND);
    expect(await build(withInspector(null), { viewer: LEAD })).toEqual(NOT_FOUND);
    // Its inspector and admins still export it.
    expect((await build(withInspector(null), { viewer: { id: IDS.inspector, role: "inspector" } })).ok).toBe(true);
    expect((await build(withInspector(null))).ok).toBe(true);
  });

  it("leaves Steri-AI with the inspector and admins: the record it hands the rule names the lead inside `inspector` only", async () => {
    // lib/inspections/ai passes the record itself, and the panel the whole session user, isLead included.
    const loaded = await loadInspectionRecord(setup().client, IDS.inspection);
    if (!loaded.ok) throw new Error(loaded.message);
    expect(canExportInspection(LEAD, loaded.record)).toBe(false);
    expect(canExportInspection({ id: IDS.inspector, role: "inspector" }, loaded.record)).toBe(true);
    expect(canExportInspection(ADMIN, loaded.record)).toBe(true);
  });

  it("answers not found for an unknown id or one that is not a UUID", async () => {
    const fake = setup();
    expect((await buildInspectionExport(fake.client, "not-a-uuid", { registry: TEST_REGISTRY })).ok).toBe(false);
    const missing = await buildInspectionExport(fake.client, IDS.otherInspector, { registry: TEST_REGISTRY });
    expect(missing).toMatchObject({ ok: false, reason: "not_found" });
    // An id that is not a UUID never reaches the database.
    expect(fake.queries.filter((query) => query.table === "inspections")).toHaveLength(1);
  });

  it("reports an unreadable template version instead of guessing", async () => {
    const fake = setup({ tables: { ...makeTables(), inspections: [makeInspectionRow({}, { resolved: null })] } });
    expect(await build(fake)).toMatchObject({ ok: false, reason: "unreadable_template", message: expect.stringContaining("TEST_EG version 3") });
  });

  it("fails as a whole when Storage cannot sign, so evidence is never dropped silently", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = setup({ failSigning: (bucket) => bucket === "inspection-photos" });
    expect(await build(fake)).toEqual({
      ok: false,
      reason: "storage_error",
      message: "Could not create links to the photos. Try again.",
    });
    expect(error).toHaveBeenCalled();
  });

  it("reports a database error without its details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = setup({
      failQuery: (query) => (query.table === "inspection_files" ? { code: "XX000", message: "secret detail" } : null),
    });
    const result = await build(fake);
    expect(result).toEqual({ ok: false, reason: "database_error", message: "Could not read the files. Try again." });
    expect(error).toHaveBeenCalled();
  });

  it("refuses to hand out a document that fails its schema", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tables = makeTables();
    tables.inspection_photos[0].taken_at = "yesterday";
    const result = await build(setup({ tables }));
    expect(result).toMatchObject({ ok: false, reason: "invalid_export", message: expect.stringContaining("photos.") });
    expect(error).toHaveBeenCalled();
  });
});
