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

  it("accepts open results on a draft", () => {
    const doc = makeStdEgExport();
    doc.status = "draft";
    doc.timestamps.submittedAt = null;
    doc.conclusion = { suggestedResult: null, finalResult: null, remark: null, inspector: null, date: null };
    moduleOf(doc, "visual").result = { status: "not_done", summary: "Minor defects not entered." };
    expect(parse(doc).success).toBe(true);
  });

  it("references the fixture's lab report from force at break", () => {
    const doc = makeStdEgExport();
    expect(moduleOf(doc, "force_at_break").data).toMatchObject({
      sizes: { M: { labReportFileId: FIXTURE_IDS.fileLabReport } },
    });
  });
});
