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
    // STD_EG has a custom module of its own (glove_type): the clash comes after it.
    expect(clash.custom.map((module) => module.key)).toEqual(["glove_type"]);
    clash.custom.push(customModule("weight"));
    expect(issuePaths(clash)).toEqual(["custom.1.key"]);

    // Reserved even when the template leaves that module out, so a later template version can add it.
    const reserved = makeStdEgExport();
    expect(reserved.modules.some((module) => module.key === "documents")).toBe(false);
    reserved.custom.push(customModule("documents"));
    expect(issuePaths(reserved)).toEqual(["custom.1.key"]);
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

  it("accepts open results on a draft", () => {
    const doc = makeStdEgExport();
    doc.status = "draft";
    doc.timestamps.submittedAt = null;
    doc.conclusion = { suggestedResult: null, finalResult: null, remark: null, inspector: null, date: null };
    moduleOf(doc, "visual").result = { status: "not_done", summary: "Minor defects not entered." };
    expect(parse(doc).success).toBe(true);
  });

  it("references the lab report by its file id in force at break's data, and lists that file with a signed URL", () => {
    const doc = makeStdEgExport();
    const forceAtBreak = moduleOf(doc, "force_at_break");
    expect(forceAtBreak.data.labReport).toBe(FIXTURE_IDS.fileLabReport);
    expect(forceAtBreak.computed.labReportAttached).toBe(true);
    // The report service matches the module's id to the file it may fetch.
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
});

/*
 * The fixture is built through the real modules (lib/ai/__fixtures__/std-eg-export.ts),
 * so these pin what the export carries for the STD_EG example: a module whose
 * shapes or results change has to change them knowingly.
 */
describe("the STD_EG export of the real modules", () => {
  const doc = makeStdEgExport();

  it("lists STD_EG's modules in template order, with its custom Glove Type", () => {
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
    expect(doc.custom).toEqual([
      expect.objectContaining({ key: "glove_type", after: "header", values: { gloveType: "Nitrile, powder free" } }),
    ]);
  });

  it("reproduces expected results B: every module passes or informs, weight warns", () => {
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
    expect(doc.modules.flatMap((module) => module.warnings.map((warning) => [module.key, warning.code, warning.size]))).toEqual([
      ["weight", "weight_deviation", "M"],
    ]);
    expect(doc.modules.flatMap((module) => module.errors ?? [])).toEqual([]);
    expect(doc.conclusion).toMatchObject({ suggestedResult: "pass", finalResult: "pass", remark: null, date: "2025-04-12" });
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
    expect(Object.keys(forceAtBreak.data).sort()).toEqual(["labReport", "sizes"]);
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
