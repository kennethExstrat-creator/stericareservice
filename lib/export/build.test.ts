import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportPartSchema, ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { createFakeSupabase, type FakeSupabaseOptions } from "./__fixtures__/fake-supabase";
import {
  IDS,
  makeInspectionData,
  makeInspectionRow,
  makeObjects,
  makePartObjects,
  makePartRow,
  makePartTables,
  makeResolvedTemplate,
  makeTables,
  PART_PATHS,
  PATHS,
  UPDATED_AT,
} from "./__fixtures__/inspection";
import { buildInspectionExport, exportFromEvaluation, type BuildExportOptions } from "./build";
import { evaluateRecord } from "./evaluate";
import { loadInspectionRecord } from "./record";
import { EXPORT_URL_TTL_SECONDS } from "./sign";

const EXPORTED_AT = "2026-10-06T02:00:00.000Z";
const ADMIN = { id: IDS.admin, role: "admin" } as const;

function setup(options: FakeSupabaseOptions = {}) {
  return createFakeSupabase({ tables: makeTables(), objects: makeObjects(), ...options });
}

async function build(fake = setup(), options: BuildExportOptions = {}, id: string = IDS.inspection) {
  return buildInspectionExport(fake.client, id, {
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
    });
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

  it("is for the inspection's inspector or an admin only", async () => {
    expect((await build(setup(), { viewer: { id: IDS.inspector, role: "inspector" } })).ok).toBe(true);
    expect(await build(setup(), { viewer: { id: IDS.otherInspector, role: "inspector" } })).toEqual({
      ok: false,
      reason: "not_found",
      message: "Inspection not found.",
    });
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

/* PO parts (lib/inspections/parts.ts): the fixture's inspection with two more POs. */
describe("buildInspectionExport for an inspection of several POs", () => {
  const INSPECTOR = { id: IDS.inspector, role: "inspector" } as const;

  function setupParts(options: FakeSupabaseOptions = {}) {
    return setup({ tables: makePartTables(), objects: makePartObjects(), ...options });
  }

  /** The export asked for by one part's id. */
  function buildFrom(id: string, fake = setupParts(), options: BuildExportOptions = {}) {
    return build(fake, options, id);
  }

  function partsOf(doc: InspectionExport) {
    if (!doc.parts) throw new Error("the export has no parts");
    return doc.parts;
  }

  it("is one document: the first part's export, with the other parts' exports in part order", async () => {
    const doc = await exportOf(setupParts());
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    // The first part stands for the inspection: its fields are as for an inspection of one PO.
    expect(doc).toMatchObject({ refNo: "INS-2026-0042", status: "submitted" });
    expect(moduleOf(doc, "header").data).toMatchObject({ poNo: "PO-0001" });
    expect(doc.photos.map((photo) => photo.id)).toEqual([IDS.photoWeight, IDS.photoVisual, IDS.photoUntagged, IDS.photoHeic]);
    expect(doc.conclusion).toMatchObject({ finalResult: "hold" });

    // Stored part 3 first: the parts come in the order they were added.
    const [second, third] = partsOf(doc);
    expect(partsOf(doc).map((part) => part.refNo)).toEqual(["INS-2026-0043", "INS-2026-0044"]);
    // Each keeps its own PO, lots, photos, files and conclusion.
    expect(moduleOf(second, "header").data).toMatchObject({ poNo: "PO-0002" });
    expect(moduleOf(third, "order_lots").data).toEqual({ lots: [{ size: "M", qtyCases: 3000, lotNumbers: ["LOT-M-0003"] }] });
    expect(second.photos).toEqual([
      expect.objectContaining({ id: IDS.photoPart2, url: expect.stringContaining(PART_PATHS.photoPart2) }),
    ]);
    expect([third.photos, second.files, third.files]).toEqual([[], [], []]);
    expect(second.conclusion).toMatchObject({ finalResult: "pass", remark: "Remark for PO-0002." });
    // One export time for all; no part holds parts.
    for (const part of [second, third]) {
      expect(part.timestamps.exportedAt).toBe(EXPORTED_AT);
      expect(part).not.toHaveProperty("parts");
    }
  });

  it("is the same document from any part's id", async () => {
    const fromFirst = await exportOf(setupParts());
    for (const id of [IDS.part2, IDS.part3]) {
      const result = await buildFrom(id);
      expect(result.ok && result.export).toEqual(fromFirst);
    }
  });

  it("has no parts for an inspection of one PO", async () => {
    expect(await exportOf()).not.toHaveProperty("parts");
  });

  it("is for the parts' inspector or an admin only, from any part", async () => {
    for (const id of [IDS.inspection, IDS.part2, IDS.part3]) {
      expect((await buildFrom(id, setupParts(), { viewer: INSPECTOR })).ok).toBe(true);
      expect(await buildFrom(id, setupParts(), { viewer: { id: IDS.otherInspector, role: "inspector" } })).toEqual({
        ok: false,
        reason: "not_found",
        message: "Inspection not found.",
      });
    }
  });

  it("refuses the whole inspection when one part is not the viewer's to export", async () => {
    // The parts share their inspector; only broken data has a part of someone else's.
    const tables = makePartTables();
    tables.inspections = tables.inspections.map((row) =>
      row.id === IDS.part3 ? makePartRow(3, { inspector_id: IDS.otherInspector }) : row,
    );
    expect(await build(setupParts({ tables }), { viewer: INSPECTOR })).toEqual({
      ok: false,
      reason: "not_found",
      message: "Inspection not found.",
    });
    expect((await build(setupParts({ tables }))).ok).toBe(true);
  });

  it("answers not found when the first part cannot be read, so a part never stands in for the inspection", async () => {
    const tables = makePartTables();
    tables.inspections = tables.inspections.filter((row) => row.id !== IDS.inspection);
    expect(await buildFrom(IDS.part2, setupParts({ tables }))).toEqual({
      ok: false,
      reason: "not_found",
      message: "Inspection not found.",
    });
  });

  it("fails as a whole when a part cannot be evaluated, naming that part", async () => {
    const tables = makePartTables();
    const broken = makePartRow(3);
    broken.template = { ...(broken.template as object), resolved: null };
    tables.inspections = tables.inspections.map((row) => (row.id === IDS.part3 ? broken : row));
    expect(await build(setupParts({ tables }))).toMatchObject({
      ok: false,
      reason: "unreadable_template",
      message: expect.stringContaining("INS-2026-0044"),
    });
  });

  it("lists what every part left out of Storage", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const objects = makePartObjects();
    objects["inspection-photos"] = objects["inspection-photos"].filter((path) => path !== PART_PATHS.photoPart2);
    const result = await build(setupParts({ objects }));
    if (!result.ok) throw new Error(result.message);
    expect(partsOf(result.export)[0].photos).toEqual([]);
    expect(result.skipped).toEqual([
      { bucket: "inspection-photos", path: PATHS.photoMissing, id: IDS.photoMissing },
      { bucket: "inspection-photos", path: PART_PATHS.photoPart2, id: IDS.photoPart2 },
    ]);
  });

  it("reports a failed read of the parts as a database error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = setupParts({
      failQuery: (query) => (query.filters.some((filter) => filter.op === "or") ? { code: "XX000", message: "secret detail" } : null),
    });
    expect(await build(fake)).toEqual({
      ok: false,
      reason: "database_error",
      message: "Could not read the inspection's POs. Try again.",
    });
    expect(error).toHaveBeenCalled();
  });

  it("keeps a part's own export to that part: the second opinion's document never holds parts", async () => {
    const fake = setupParts();
    const loaded = await loadInspectionRecord(fake.client, IDS.part2);
    if (!loaded.ok) throw new Error(loaded.message);
    const evaluation = evaluateRecord(loaded.record, TEST_REGISTRY);
    if (!evaluation.ok) throw new Error(evaluation.message);
    const result = await exportFromEvaluation(fake.client, loaded.record, evaluation.evaluated);
    if (!result.ok) throw new Error(result.message);
    expect(result.export).not.toHaveProperty("parts");
    expect(result.export).toMatchObject({ refNo: "INS-2026-0043", photos: [expect.objectContaining({ id: IDS.photoPart2 })] });
    expect(ExportPartSchema.safeParse(result.export).success).toBe(true);
  });
});
