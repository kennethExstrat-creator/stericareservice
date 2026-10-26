// The export of the STD_EG example through the real modules, the whole way
// the route builds it (BUILD_SPEC 9.1): read through a Supabase client,
// evaluated with the app's registry, links signed for 24 hours, validated by
// ExportSchema. build.test.ts covers the pipeline's rules on the framework's
// test modules; this one checks what the real modules put in.
import { afterEach, describe, expect, it, vi } from "vitest";

// The framework as it is, with a spy on the context builder (with the titles shown): what the export passes it.
vi.mock("@/modules/_framework", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/_framework")>();
  return { ...actual, buildInspectionView: vi.fn(actual.buildInspectionView) };
});

import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { lookupFrom } from "@/lib/templates";
import { STD_EG_REPORT_SEED } from "@/lib/templates/definitions";
import { resolveTemplate } from "@/modules";
import { buildInspectionView } from "@/modules/_framework";
import { createFakeSupabase } from "./__fixtures__/fake-supabase";
import {
  STD_EG_IDS,
  STD_EG_REF_NO,
  stdEgInspectionData,
  stdEgObjects,
  stdEgRecord,
  stdEgTables,
} from "./__fixtures__/std-eg";
import { buildInspectionExport } from "./build";
import { evaluateRecord, inspectionMeta } from "./evaluate";
import { EXPORT_URL_TTL_SECONDS } from "./sign";

const ADMIN = { id: "00000000-0000-4000-8000-000000000102", role: "admin" } as const;

async function exportOf(tables = stdEgTables(), objects = stdEgObjects()) {
  const fake = createFakeSupabase({ tables, objects });
  const result = await buildInspectionExport(fake.client, STD_EG_IDS.inspection, {
    viewer: ADMIN,
    now: () => new Date("2025-04-12T09:15:00.000Z"),
  });
  if (!result.ok) throw new Error(`export failed: ${result.reason} ${result.message}`);
  return { doc: result.export, fake };
}

function moduleOf(doc: InspectionExport, key: string) {
  const found = doc.modules.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no module ${key}`);
  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the STD_EG example's export, through the real modules", () => {
  it("validates, with every STD_EG module in template order and its real data", async () => {
    const { doc } = await exportOf();
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    expect(doc.refNo).toBe(STD_EG_REF_NO);
    expect(doc.template).toMatchObject({ code: "STD_EG", version: 1, standard: "EN455", reportTitle: expect.any(String) });
    expect(doc.modules).toHaveLength(14);
    expect(moduleOf(doc, "dimensions").computed).toMatchObject({ statisticKind: "median" });
    expect(moduleOf(doc, "weight")).toMatchObject({
      result: { status: "warn" },
      warnings: [{ code: "weight_deviation", size: "M" }],
      comment: expect.stringContaining("factory scale"),
    });
    expect(doc.conclusion).toMatchObject({ suggestedResult: "pass", finalResult: "pass" });
  });

  it("exports the lab report a module keeps by id with a 24-hour signed link, so the report can match them", async () => {
    const { doc, fake } = await exportOf();
    expect(moduleOf(doc, "force_at_break").data.labReports).toEqual([{ fileId: STD_EG_IDS.fileLabReport, sizes: ["M"] }]);
    const file = doc.files.find((entry) => entry.id === STD_EG_IDS.fileLabReport);
    expect(file).toMatchObject({ moduleKey: "force_at_break", kind: "lab_report", url: expect.stringContaining("inspection-files") });
    const signing = fake.signed.find((request) => request.bucket === "inspection-files");
    expect(signing).toMatchObject({ expiresIn: EXPORT_URL_TTL_SECONDS });
  });

  it("names every lab report, one per size, each with its sizes and a signed link (Kenneth, 26 October 2026)", async () => {
    const ids = ["00000000-0000-4000-8000-000000000411", "00000000-0000-4000-8000-000000000412", "00000000-0000-4000-8000-000000000413"];
    const files = ids.map((id, index) => ({
      id,
      moduleKey: "source_documents",
      kind: "lab_report" as const,
      storagePath: `${STD_EG_IDS.inspection}/${id}.jpg`,
      name: `Lab report ${index + 1}.jpg`,
      createdAt: "2025-04-11T07:30:00.000000+00:00",
    }));
    const saved = stdEgInspectionData();
    const forceAtBreak = saved.modules.force_at_break as Record<string, unknown>;
    const labReports = [
      { fileId: ids[0], sizes: ["S"] },
      { fileId: ids[1], sizes: ["M"] },
      { fileId: ids[2], sizes: ["L"] },
    ];
    const data = { ...saved, modules: { ...saved.modules, force_at_break: { ...forceAtBreak, labReports } } };
    const record = stdEgRecord({ data, files });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    const exported = moduleOf(doc, "force_at_break");
    expect(exported.data.labReports).toEqual(labReports);
    expect(exported.computed).toMatchObject({ labReportAttached: true });
    expect(exported.warnings.map((warning) => warning.code)).not.toContain("lab_report_missing");
    expect(doc.files.map((file) => [file.id, file.name, file.kind])).toEqual(ids.map((id, index) => [id, `Lab report ${index + 1}.jpg`, "lab_report"]));
    for (const file of doc.files) expect(file.url).toMatch(/^https:\/\//);
  });

  it("exports a lab report saved alone before 26 October 2026 as a list of it, its sizes not known", async () => {
    const saved = stdEgInspectionData();
    const forceAtBreak: Record<string, unknown> = { ...(saved.modules.force_at_break as Record<string, unknown>) };
    delete forceAtBreak.labReports;
    const data = { ...saved, modules: { ...saved.modules, force_at_break: { ...forceAtBreak, labReport: STD_EG_IDS.fileLabReport } } };
    const record = stdEgRecord({ data });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(moduleOf(doc, "force_at_break").data).not.toHaveProperty("labReport");
    expect(moduleOf(doc, "force_at_break").data.labReports).toEqual([{ fileId: STD_EG_IDS.fileLabReport, sizes: [] }]);
    expect(moduleOf(doc, "force_at_break").computed).toMatchObject({ labReportAttached: true });
  });

  it("warns when a kept lab report's file was deleted, and exports no link for it", async () => {
    const record = stdEgRecord({ files: [] });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    const forceAtBreak = moduleOf(doc, "force_at_break");
    // The id stays in the data as the inspector left it; the module reads it against the inspection's files.
    expect(forceAtBreak.data.labReports).toEqual([{ fileId: STD_EG_IDS.fileLabReport, sizes: ["M"] }]);
    expect(forceAtBreak.computed).toMatchObject({ labReportAttached: false });
    expect(forceAtBreak.warnings).toContainEqual({
      code: "lab_report_missing",
      message: expect.stringContaining("not among this inspection's files"),
    });
    expect(doc.files).toEqual([]);
  });

  it("counts a lab report added in the gallery, which no module keeps by id", async () => {
    const record = stdEgRecord({ data: { ...stdEgInspectionData({ labReportFileId: null }), custom: {} } });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    const forceAtBreak = moduleOf(doc, "force_at_break");
    expect(forceAtBreak.data.labReports).toEqual([]);
    expect(forceAtBreak.computed).toMatchObject({ labReportAttached: true });
    expect(forceAtBreak.warnings.map((warning) => warning.code)).not.toContain("lab_report_missing");
    expect(doc.files).toEqual([expect.objectContaining({ id: STD_EG_IDS.fileLabReport, moduleKey: "force_at_break" })]);
  });

  it("exports a certificate the documents check keeps per item, so the report can match it by id", async () => {
    const certificate = "00000000-0000-4000-8000-000000000402";
    const definition = STD_EG_REPORT_SEED.definition();
    const conclusionAt = definition.modules.findIndex((entry) => entry.key === "conclusion");
    definition.modules.splice(conclusionAt, 0, { key: "documents", include: true });
    const resolution = resolveTemplate(definition, lookupFrom([]));
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    const base = stdEgRecord();
    const data = stdEgInspectionData({ labReportFileId: STD_EG_IDS.fileLabReport });
    const record = stdEgRecord({
      template: { ...base.template!, resolved: resolution.template },
      data: {
        ...data,
        modules: {
          ...data.modules,
          documents: { items: { certificateOfAnalysis: { status: "verified", referenceNo: "COA-0001", expiryDate: null, file: certificate } } },
        },
      },
      files: [
        ...base.files,
        {
          id: certificate,
          moduleKey: "documents",
          kind: "certificate",
          storagePath: `${STD_EG_IDS.inspection}/${certificate}.pdf`,
          name: "Certificate of analysis.pdf",
          createdAt: "2025-04-11T07:40:00.000000+00:00",
        },
      ],
    });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    const documents = moduleOf(doc, "documents");
    const items = documents.data.items as Record<string, { file: string | null }>;
    expect(items.certificateOfAnalysis.file).toBe(certificate);
    expect(documents.computed).toMatchObject({ fileState: { certificateOfAnalysis: "attached" } });
    expect(doc.files.find((file) => file.id === certificate)).toMatchObject({
      moduleKey: "documents",
      kind: "certificate",
      url: expect.stringContaining("inspection-files"),
    });
  });

  it("exports every module's config as the STD_EG version resolves it", async () => {
    const { doc } = await exportOf();
    expect(moduleOf(doc, "force_at_break").config).toEqual({ n: 13, specMin: 6, standardLabel: null, decimals: 3 });
    expect(moduleOf(doc, "sampling_plan").config).toMatchObject({ inspectionLevel: "I" });
    expect(moduleOf(doc, "visual").config).toMatchObject({
      classes: { critical: { aql: 0 }, major: { aql: 2.5 }, minor: { aql: 4 } },
    });
  });

  it("sends the report's drawn signature, and none once the report is to be signed by hand after export", async () => {
    const signed = await exportOf();
    expect(signed.doc.conclusion.signAfterExport).toBe(false);
    expect(moduleOf(signed.doc, "conclusion").data.signature).toMatchObject({ width: 600, height: 200 });

    // To Sign After Exported (Kenneth, 13 October 2026): the strokes stay saved, the export leaves them out.
    const data = stdEgInspectionData({ labReportFileId: STD_EG_IDS.fileLabReport, signAfterExport: true });
    expect((data.modules.conclusion as { signature: unknown }).signature).not.toBeNull();
    const record = stdEgRecord({ data });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    expect(doc.conclusion).toMatchObject({ finalResult: "pass", signAfterExport: true });
    expect(moduleOf(doc, "conclusion").data).toMatchObject({ signAfterExport: true, signature: null });
    expect(moduleOf(doc, "conclusion").result.summary).toMatch(/ To be signed after export\.$/);
  });

  it("lists a module switched off for the inspection, with the reason, instead of exporting it", async () => {
    const record = stdEgRecord({
      moduleOverrides: { dimensions: { reason: "Calipers out for calibration.", by: ADMIN.id, at: "2025-04-11T08:00:00+00:00" } },
    });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(doc.excludedModules).toEqual([{ key: "dimensions", title: "Dimension", reason: "Calipers out for calibration." }]);
    expect(doc.modules.map((module) => module.key)).not.toContain("dimensions");
  });
});

describe("inspectionMeta", () => {
  it("hands the context the inspection's files by id, module and kind", () => {
    const record = stdEgRecord();
    expect(inspectionMeta({ refNo: record.refNo }, record.files)).toEqual({
      refNo: STD_EG_REF_NO,
      files: [{ id: STD_EG_IDS.fileLabReport, moduleKey: "force_at_break", kind: "lab_report" }],
    });
  });

  it("keeps not knowing the files apart from having none", () => {
    expect(inspectionMeta({}, null)).toEqual({ files: null });
    expect(inspectionMeta({}, [])).toEqual({ files: [] });
  });

  it("is what the export builds the context with", () => {
    vi.mocked(buildInspectionView).mockClear();
    const record = stdEgRecord();
    expect(evaluateRecord(record).ok).toBe(true);
    expect(buildInspectionView).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          refNo: STD_EG_REF_NO,
          files: [{ id: STD_EG_IDS.fileLabReport, moduleKey: "force_at_break", kind: "lab_report" }],
        }),
      }),
      expect.anything(),
    );
  });
});
