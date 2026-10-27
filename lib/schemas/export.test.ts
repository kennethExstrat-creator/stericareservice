import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { ExportSchema, type InspectionExport } from "./export";

function parse(doc: unknown) {
  return ExportSchema.safeParse(doc);
}

function issuePaths(doc: unknown): string[] {
  const result = parse(doc);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

function moduleOf(doc: InspectionExport, key: string) {
  const found = doc.modules.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Fixture has no ${key} module`);
  return found;
}

describe("ExportSchema", () => {
  it("accepts the STD_EG fixture and survives a JSON round trip unchanged", () => {
    const doc = makeStdEgExport();
    expect(parse(doc).success).toBe(true);
    const roundTripped = JSON.parse(JSON.stringify(doc));
    expect(ExportSchema.parse(roundTripped)).toEqual(doc);
  });

  it("accepts excluded modules, custom modules and optional fields", () => {
    const doc = makeStdEgExport();
    doc.excludedModules.push({ key: "documents", title: "Documents", reason: "Not in this client's scope." });
    doc.custom.push({
      key: "humidity",
      title: "Warehouse humidity",
      after: "packing_config",
      layout: "fields",
      fields: [{ key: "rh", label: "Relative humidity", type: "number", unit: "%" }],
      values: { rh: 62 },
    });
    delete doc.inspector.email;
    moduleOf(doc, "carton_sampling").errors = [];
    expect(parse(doc).success).toBe(true);
  });

  it("pins the schema version", () => {
    expect(parse({ ...makeStdEgExport(), schemaVersion: "2" }).success).toBe(false);
  });

  it("rejects module keys outside the library", () => {
    const doc = makeStdEgExport();
    Object.assign(doc.modules[0], { key: "labelling" });
    expect(issuePaths(doc)).toContain("modules.0.key");
  });

  it("rejects a module listed twice, or both included and excluded", () => {
    const twice = makeStdEgExport();
    twice.modules.push(structuredClone(moduleOf(twice, "weight")));
    expect(issuePaths(twice)).toContain("modules");

    const both = makeStdEgExport();
    both.excludedModules.push({ key: "weight", title: "Weight", reason: "Not needed." });
    expect(issuePaths(both)).toContain("modules");
  });

  it("accepts photos and files not tagged with a module, as the database allows", () => {
    const doc = makeStdEgExport();
    doc.photos[2].moduleKey = null;
    doc.files[0].moduleKey = null;
    expect(ExportSchema.parse(doc)).toEqual(doc);
  });

  it("reads an empty or blank module tag as untagged, which the database columns allow", () => {
    const doc = makeStdEgExport();
    doc.photos[0].moduleKey = "";
    doc.files[0].moduleKey = "   ";
    const parsed = ExportSchema.parse(doc);
    expect(parsed.photos[0].moduleKey).toBeNull();
    expect(parsed.files[0].moduleKey).toBeNull();
    expect(parsed.photos[1].moduleKey).toBe(doc.photos[1].moduleKey);
  });

  it("still requires the module tag: untagged is null, not missing", () => {
    const doc = makeStdEgExport();
    Reflect.deleteProperty(doc.photos[0], "moduleKey");
    Reflect.deleteProperty(doc.files[0], "moduleKey");
    expect(issuePaths(doc)).toEqual(expect.arrayContaining(["photos.0.moduleKey", "files.0.moduleKey"]));
  });

  it("keeps custom module keys apart from library module keys", () => {
    const customModule = (key: string) => ({
      key,
      title: "Extra checks",
      layout: "fields" as const,
      fields: [],
      values: {},
    });
    const clash = makeStdEgExport();
    // STD_EG has no custom module of its own (Glove Type is in Glove Information since 11 October 2026).
    expect(clash.custom).toEqual([]);
    clash.custom.push(customModule("weight"));
    expect(issuePaths(clash)).toEqual(["custom.0.key"]);

    // Reserved even when the template leaves that module out, so a later template version can add it.
    const reserved = makeStdEgExport();
    expect(reserved.modules.some((module) => module.key === "documents")).toBe(false);
    reserved.custom.push(customModule("documents"));
    expect(issuePaths(reserved)).toEqual(["custom.0.key"]);
  });

  it("rejects duplicate photo and file ids", () => {
    const doc = makeStdEgExport();
    doc.photos.push({ ...doc.photos[0] });
    doc.files.push({ ...doc.files[0] });
    expect(issuePaths(doc)).toEqual(expect.arrayContaining(["photos", "files"]));
  });

  it.each([
    ["NaN", Number.NaN],
    ["undefined", undefined],
    ["a Date", new Date(0)],
    ["a BigInt", BigInt(1)],
  ])("rejects %s in module data, which JSON cannot carry", (_label, value) => {
    const doc = makeStdEgExport();
    Object.assign(moduleOf(doc, "weight"), { computed: { M: { average: value } } });
    expect(parse(doc).success).toBe(false);
  });

  it("only accepts http(s) URLs for photos, files and logos", () => {
    const photo = makeStdEgExport();
    photo.photos[0].url = "javascript:alert(1)";
    expect(issuePaths(photo)).toContain("photos.0.url");

    const logo = makeStdEgExport();
    logo.template.clientLogoUrl = "ftp://example.com/logo.png";
    expect(issuePaths(logo)).toContain("template.clientLogoUrl");
  });

  it("requires timestamps with an offset and plain calendar dates", () => {
    const noOffset = makeStdEgExport();
    noOffset.timestamps.updatedAt = "2024-07-13T09:12:00";
    expect(issuePaths(noOffset)).toContain("timestamps.updatedAt");

    const postgres = makeStdEgExport();
    postgres.timestamps.updatedAt = "2024-07-13T09:12:00.123456+00:00";
    expect(parse(postgres).success).toBe(true);

    const badDate = makeStdEgExport();
    badDate.conclusion.date = "13/07/2024";
    expect(issuePaths(badDate)).toContain("conclusion.date");
  });

  it("requires uuids for people, photos and files", () => {
    const doc = makeStdEgExport();
    doc.inspector.id = "inspector-a";
    doc.photos[0].id = "photo-1";
    expect(issuePaths(doc)).toEqual(expect.arrayContaining(["inspector.id", "photos.0.id"]));
  });

  it("carries To Sign After Exported in the conclusion block, and accepts a document written before it", () => {
    for (const signAfterExport of [true, false]) {
      const doc = makeStdEgExport();
      doc.conclusion.signAfterExport = signAfterExport;
      expect(ExportSchema.parse(JSON.parse(JSON.stringify(doc))).conclusion.signAfterExport).toBe(signAfterExport);
    }
    const older = makeStdEgExport();
    delete older.conclusion.signAfterExport;
    expect(parse(older).success).toBe(true);
    const wrong = makeStdEgExport();
    Object.assign(wrong.conclusion, { signAfterExport: "yes" });
    expect(issuePaths(wrong)).toContain("conclusion.signAfterExport");
  });

  it("accepts open results on a draft", () => {
    const doc = makeStdEgExport();
    doc.status = "draft";
    doc.timestamps.submittedAt = null;
    doc.conclusion = { suggestedResult: null, finalResult: null, remark: null, inspector: null, date: null };
    moduleOf(doc, "visual").result = { status: "not_done", summary: "Minor defects not entered." };
    expect(parse(doc).success).toBe(true);
  });

  it("references each lab report by its file id and sizes in force at break's data, and lists that file with a signed URL", () => {
    const doc = makeStdEgExport();
    const forceAtBreak = moduleOf(doc, "force_at_break");
    expect(forceAtBreak.data.labReports).toEqual([{ fileId: FIXTURE_IDS.fileLabReport, sizes: ["M"] }]);
    expect(forceAtBreak.computed.labReportAttached).toBe(true);
    // The report service matches each id in the module's list to the file it may fetch.
    expect(doc.files).toEqual([
      {
        id: FIXTURE_IDS.fileLabReport,
        url: expect.stringMatching(/^https:\/\//),
        moduleKey: "force_at_break",
        kind: "lab_report",
        name: "Force at break lab report.pdf",
      },
    ]);
  });

  it("accepts a module without its config, as documents written before it existed", () => {
    const doc = makeStdEgExport();
    expect(moduleOf(doc, "weight").config).toBeDefined();
    delete moduleOf(doc, "weight").config;
    expect(parse(doc).success).toBe(true);
  });

  it("rejects a config that JSON cannot carry", () => {
    const doc = makeStdEgExport();
    Object.assign(moduleOf(doc, "weight"), { config: { warnThresholdPct: Number.NaN } });
    expect(issuePaths(doc)).toContain("modules.8.config.warnThresholdPct");
  });

  it("keeps the template's sizes, unit and running header, and accepts a document written before them", () => {
    const doc = makeStdEgExport();
    // Every size STD_EG lists, though only M was ordered: the report's fixed rows.
    expect(doc.template).toMatchObject({
      sizes: ["XS", "S", "M", "L", "XL"].map((value) => ({ value, label: value })),
      unit: "pcs",
      pageHeader: null,
    });
    doc.template.sizes = [{ value: "M", label: "Medium" }];
    doc.template.unit = "pairs";
    doc.template.pageHeader = "Pre-shipment Inspection : {po} {product}";
    expect(ExportSchema.parse(JSON.parse(JSON.stringify(doc))).template).toEqual(doc.template);

    const older = makeStdEgExport();
    delete older.template.sizes;
    delete older.template.unit;
    delete older.template.pageHeader;
    expect(parse(older).success).toBe(true);
  });

  it("rejects a template unit, size name or running header it cannot carry", () => {
    const unit = makeStdEgExport();
    Object.assign(unit.template, { unit: "boxes" });
    expect(issuePaths(unit)).toContain("template.unit");

    const label = makeStdEgExport();
    label.template.sizes = [{ value: "M", label: "" }];
    expect(issuePaths(label)).toContain("template.sizes.0.label");

    const header = makeStdEgExport();
    header.template.pageHeader = "";
    expect(issuePaths(header)).toContain("template.pageHeader");
  });

  it("carries the Report page's options, and reads a document written before them with the defaults (Kenneth, 27 October 2026)", () => {
    const doc = makeStdEgExport();
    // The example saves none: the defaults.
    expect(doc.report).toEqual({
      template: "standard_preshipment",
      pageSize: "a4",
      omittedSections: [],
      includePhotos: true,
      photosPerStep: 4,
      photoSize: "medium",
      title: "Pre-Shipment Inspection Report",
      showClientName: true,
      includeSummary: true,
      includeSignature: true,
      footerNote: null,
    });
    doc.report = { ...doc.report, pageSize: "letter", omittedSections: ["weight"], photoSize: "large", footerNote: "Confidential." };
    expect(ExportSchema.parse(JSON.parse(JSON.stringify(doc))).report).toEqual(doc.report);

    const older: Record<string, unknown> = { ...makeStdEgExport() };
    delete older.report;
    expect(ExportSchema.parse(older).report).toEqual(makeStdEgExport().report);
    // An option added later reads as its default, too.
    expect(ExportSchema.parse({ ...makeStdEgExport(), report: { pageSize: "letter" } }).report).toEqual({ ...makeStdEgExport().report, pageSize: "letter" });
  });

  it("rejects report options it cannot carry", () => {
    const paths = (report: Record<string, unknown>) => issuePaths({ ...makeStdEgExport(), report: { ...makeStdEgExport().report, ...report } });
    expect(paths({ pageSize: "a3" })).toContain("report.pageSize");
    expect(paths({ photosPerStep: 5 })).toContain("report.photosPerStep");
    expect(paths({ title: "" })).toContain("report.title");
    expect(paths({ footerNote: "" })).toContain("report.footerNote");
    expect(paths({ omittedSections: [""] })).toContain("report.omittedSections.0");
  });
});

/*
 * The fixture is built through the real modules (lib/ai/__fixtures__/std-eg-export.ts),
 * so these pin what the export carries for the STD_EG example: a module whose
 * shapes or results change has to change them knowingly.
 */
describe("the STD_EG export of the real modules", () => {
  const doc = makeStdEgExport();

  it("lists STD_EG's modules in template order, its Glove Type in Glove Information", () => {
    expect(doc.modules.map((module) => module.key)).toEqual([
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "dimensions",
      "force_at_break",
      "weight",
      "watertight",
      "visual",
      "dispensing_packing",
      "labeling",
      "conclusion",
    ]);
    expect(doc.custom).toEqual([]);
    const gloveInfo = doc.modules.find((module) => module.key === "glove_info");
    expect(gloveInfo?.data).toMatchObject({ gloveType: "Nitrile, powder free" });
  });

  it("reproduces expected results B: every module passes or informs, weight warns, and box 2336 is a warning", () => {
    const statuses = Object.fromEntries(doc.modules.map((module) => [module.key, module.result.status]));
    expect(statuses).toEqual({
      header: "info",
      glove_info: "info",
      order_lots: "info",
      packing_config: "info",
      sampling_plan: "info",
      carton_sampling: "pass",
      dimensions: "pass",
      force_at_break: "pass",
      weight: "warn",
      watertight: "pass",
      visual: "pass",
      dispensing_packing: "pass",
      labeling: "pass",
      conclusion: "pass",
    });
    // Box 2336 is not among size M's sampled box/carton numbers: a warning in the export, never an error (Kenneth, 13 October 2026).
    expect(doc.modules.flatMap((module) => module.warnings.map((warning) => [module.key, warning.code, warning.size]))).toEqual([
      ["weight", "weight_deviation", "M"],
      ["dispensing_packing", "box_not_in_carton_list", "M"],
    ]);
    expect(moduleOf(doc, "dispensing_packing").warnings[0].message).toBe("Box/Carton #2336 is not in M's sampled box/carton numbers.");
    expect(doc.modules.flatMap((module) => module.errors ?? [])).toEqual([]);
    expect(doc.conclusion).toMatchObject({ suggestedResult: "pass", finalResult: "pass", remark: null, date: "2025-04-12" });
  });

  it("is signed on the pad, as the report was: the drawn strokes in the conclusion's data", () => {
    expect(doc.conclusion.signAfterExport).toBe(false);
    expect(moduleOf(doc, "conclusion").data).toMatchObject({
      signAfterExport: false,
      signature: { width: 600, height: 200, strokes: [expect.any(Array)] },
    });
  });

  it("carries the header's entered values as data, and the inspection row's in computed", () => {
    const header = moduleOf(doc, "header");
    expect(Object.keys(header.data).sort()).toEqual(
      ["expiryDate", "factoryAddress", "factoryGloveCode", "inspectionDate", "mfgDate", "poNo", "productCode", "productName"].sort(),
    );
    expect(header.computed).toMatchObject({ manufacturer: "Manufacturer A · Factory A1", client: null, inspector: "Inspector A" });
  });

  it("keeps the order per size, and the inner unit's name in packing's config", () => {
    expect(moduleOf(doc, "order_lots").data).toEqual({
      sizes: { M: { qtyCases: 2900, lotNumbers: ["LOT-A01"], packingSite: null } },
    });
    expect(moduleOf(doc, "order_lots").computed).toMatchObject({ totalCartons: 2900, totalGloves: 5_800_000 });
    expect(moduleOf(doc, "packing_config").config).toMatchObject({ innerUnit: "inner_box" });
    expect(moduleOf(doc, "packing_config").computed).toMatchObject({ innerUnit: "inner box", glovesPerCaseCheck: 2000 });
  });

  it("keeps force at break's readings per size, its lab report, and the median against the spec", () => {
    const forceAtBreak = moduleOf(doc, "force_at_break");
    expect(Object.keys(forceAtBreak.data).sort()).toEqual(["labReports", "sizes"]);
    expect(forceAtBreak.data.sizes).toEqual({ M: { values: expect.any(Array) } });
    expect(forceAtBreak.computed).toMatchObject({
      specMin: 6,
      labReportAttached: true,
      sizes: { M: { n: 13, entered: 13, median: 6.537, result: "pass" } },
    });
    expect(forceAtBreak.config).toMatchObject({ specMin: 6 });
  });

  it("carries each module's settings: specs, statistics, thresholds and AQLs", () => {
    expect(doc.modules.every((module) => module.config !== undefined)).toBe(true);
    expect(moduleOf(doc, "dimensions").config).toMatchObject({ statistic: "median" });
    expect(moduleOf(doc, "weight").config).toMatchObject({ warnThresholdPct: 10 });
    expect(moduleOf(doc, "watertight").config).toMatchObject({ aql: 1.5 });
  });
});
