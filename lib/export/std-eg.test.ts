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
import { PASSING_AGED_SAMPLE } from "@/modules/dispensing_packing/__fixtures__/examples";
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

  it("exports both inspection levels in force with the sampling plan: the general one and the special one, S-2 by default (Kenneth, 27 October 2026)", async () => {
    // The STD_EG version sets I and no special level, as every version saved before 27 October 2026.
    const sampling = moduleOf((await exportOf()).doc, "sampling_plan");
    expect(sampling.computed).toMatchObject({ inspectionLevel: "I", specialInspectionLevel: "S-2" });
    expect(sampling.labels).toMatchObject({ inspectionLevel: "Inspection Level", specialInspectionLevel: "Special Inspection Level" });

    // Set for the inspection in Sampling Settings: the data keeps it, the computed values carry it.
    const data = stdEgInspectionData({ labReportFileId: STD_EG_IDS.fileLabReport });
    const plan = data.modules.sampling_plan as Record<string, unknown>;
    const record = stdEgRecord({
      data: { ...data, modules: { ...data.modules, sampling_plan: { ...plan, inspectionLevel: "II", specialInspectionLevel: "S-3" } } },
    });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    const own = moduleOf(doc, "sampling_plan");
    expect(own.data).toMatchObject({ inspectionLevel: "II", specialInspectionLevel: "S-3" });
    expect(own.computed).toMatchObject({ inspectionLevel: "II", specialInspectionLevel: "S-3" });
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

  it("exports a size's aged sample apart from its boxes, with a line of its own (Kenneth, 26 October 2026)", async () => {
    // The fixture's placeholder (the report printed none): passed, on its own line after the boxes'.
    const placeholder = moduleOf((await exportOf()).doc, "dispensing_packing");
    expect(placeholder.data.sizes).toEqual({ M: { boxes: expect.any(Array), agedSample: PASSING_AGED_SAMPLE } });
    expect(placeholder.computed).toMatchObject({ sizes: { M: { agedSample: { result: "pass" } } } });
    expect(placeholder.result.perSize?.M).toEqual({
      status: "pass",
      summary:
        "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed.\n" +
        "Aged Sample: Layering 85.0% (min. 70%), Dispensing 88.0% (min. 80%), Stickiness A: Passed.",
    });
    expect(placeholder.warnings.map((issue) => issue.code)).toEqual(["box_not_in_carton_list"]);

    const data = stdEgInspectionData({ labReportFileId: STD_EG_IDS.fileLabReport });
    const packing = data.modules.dispensing_packing as { sizes: { M: { boxes: unknown[] } } };
    const agedSample = { layeringPct: 88, dispensingPct: 76, stickiness: "B", note: "Aged sample" };
    const record = stdEgRecord({
      data: { ...data, modules: { ...data.modules, dispensing_packing: { sizes: { M: { boxes: packing.sizes.M.boxes, agedSample } } } } },
    });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    const dispensing = moduleOf(doc, "dispensing_packing");
    expect(dispensing.labels.agedSample).toBe("Aged Sample");
    expect(dispensing.data.sizes).toEqual({ M: { boxes: packing.sizes.M.boxes, agedSample } });
    // The 13 boxes' figures as without it; its checks on their own, its dispensing failing.
    expect(dispensing.computed).toMatchObject({
      sizes: {
        M: {
          boxesTested: 13,
          boxesComplete: 13,
          layeringResult: "pass",
          dispensingResult: "pass",
          stickinessResult: "pass",
          agedSample: { layeringResult: "pass", dispensingResult: "fail", stickinessResult: "pass", result: "fail" },
        },
      },
    });
    expect((dispensing.computed as { sizes: { M: { layeringAverage: number } } }).sizes.M.layeringAverage).toBeCloseTo(88.3, 1);
    expect(dispensing.result.perSize?.M).toEqual({
      status: "fail",
      summary:
        "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed.\n" +
        "Aged Sample: Layering 88.0% (min. 70%), Dispensing 76.0% (min. 80%), Stickiness B: Failed (Dispensing).",
    });
    expect(doc.conclusion.suggestedResult).toBe("fail");
  });

  it("exports a size whose aged sample was never entered as not done: its line says so, with a warning (Kenneth, 27 October 2026)", async () => {
    const data = stdEgInspectionData({ labReportFileId: STD_EG_IDS.fileLabReport });
    const packing = data.modules.dispensing_packing as { sizes: { M: { boxes: unknown[] } } };
    const record = stdEgRecord({
      data: { ...data, modules: { ...data.modules, dispensing_packing: { sizes: { M: { boxes: packing.sizes.M.boxes } } } } },
    });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    const dispensing = moduleOf(doc, "dispensing_packing");
    expect(dispensing.data.sizes).toEqual({ M: { boxes: packing.sizes.M.boxes } });
    // Nothing of its own computed; the 13 boxes' checks stand.
    expect(dispensing.computed).toMatchObject({ sizes: { M: { agedSample: null, layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass" } } });
    expect(dispensing.result).toMatchObject({
      status: "not_done",
      perSize: {
        M: {
          status: "not_done",
          summary: "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed.\nAged Sample is not entered yet.",
        },
      },
    });
    // "Aged Sample?" unanswered: the warning offers No too (Kenneth, 30 October 2026).
    expect(dispensing.warnings).toContainEqual({
      code: "aged_sample_missing",
      message: "Aged Sample for size M is not entered yet, or answer No to Aged Sample?",
      size: "M",
    });
    expect(dispensing.errors).toEqual([]);
    expect(doc.conclusion.suggestedResult).toBe("hold");
  });

  it('exports "Aged Sample?" answered No: the size passed on its boxes, the values saved kept and not counted (Kenneth, 30 October 2026)', async () => {
    const data = stdEgInspectionData({ labReportFileId: STD_EG_IDS.fileLabReport });
    const packing = data.modules.dispensing_packing as { sizes: { M: { boxes: unknown[] } } };
    const saved = { hasAgedSample: "no", sizes: { M: { boxes: packing.sizes.M.boxes, agedSample: { layeringPct: 60, dispensingPct: null, stickiness: null, note: null } } } };
    const record = stdEgRecord({ data: { ...data, modules: { ...data.modules, dispensing_packing: saved } } });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    const dispensing = moduleOf(doc, "dispensing_packing");
    expect(dispensing.data).toEqual(saved);
    expect(dispensing.computed).toMatchObject({ sizes: { M: { agedSample: null, layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass" } } });
    expect(dispensing.result).toMatchObject({
      status: "pass",
      perSize: { M: { status: "pass", summary: "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed.\nNo Aged Sample." } },
    });
    expect(dispensing.warnings.filter((warning) => warning.code.startsWith("aged_sample"))).toEqual([]);
    expect(dispensing.errors).toEqual([]);
  });

  it("exports the Sampling Quantity in Kenneth's words, with the inner boxes per case, the gloves per inner box and those put back (27 October 2026)", async () => {
    // A version saved with the form's words for the rows, as STD_EG version 6 holds them.
    const base = stdEgRecord();
    const resolved = base.template!.resolved as { modules: { key: string; labels: Record<string, string> }[] };
    const template = {
      ...resolved,
      modules: resolved.modules.map((entry) =>
        entry.key === "sampling_plan" ? { ...entry, labels: { ...entry.labels, cases: "Case", innerUnits: "Inner Box", gloves: "Gloves" } } : entry,
      ),
    };
    // Kenneth's example: 25 cases, one inner box from each, and code M's 315 gloves.
    const data = stdEgInspectionData({ labReportFileId: STD_EG_IDS.fileLabReport });
    const plan = data.modules.sampling_plan as { sizes: { M: Record<string, number | null> } };
    const record = stdEgRecord({
      template: { ...base.template!, resolved: template },
      data: {
        ...data,
        modules: {
          ...data.modules,
          // M's lot (5,800,000 gloves) is code N at level I, lowered to M with the reason (Kenneth, 27 October 2026).
          sampling_plan: {
            sizes: {
              M: {
                ...plan.sizes.M,
                cases: 25,
                innerUnitsPerCase: 1,
                innerUnits: 25,
                gloves: 315,
                codeLetter: "M",
                codeLetterReason: "Consistent high-quality factory",
              },
            },
          },
        },
      },
    });
    const { doc } = await exportOf(stdEgTables(record), stdEgObjects(record));
    expect(ExportSchema.safeParse(doc).success).toBe(true);
    const sampling = moduleOf(doc, "sampling_plan");
    expect(sampling.labels).toMatchObject({
      cases: "# of Case",
      innerUnitsPerCase: "Inner Box Taken per Case",
      innerUnits: "Total # of Inner Box",
      gloves: "# of Gloves Sample",
      glovesPerInnerBox: "Gloves Taken per Inner Box",
      putBack: "Put Back",
      codeLetter: "Code Letter",
    });
    expect(sampling.data.sizes).toMatchObject({
      M: { cases: 25, innerUnitsPerCase: 1, innerUnits: 25, gloves: 315, codeLetter: "M", codeLetterReason: "Consistent high-quality factory" },
    });
    // The letter is data; whether it was reduced, and from what, is computed beside the lot's own letter.
    expect(sampling.computed).toMatchObject({
      sizes: { M: { glovesPerInnerBox: 13, putBack: 10, codeLetter: "N", codeLetterReduced: true, reducedFrom: "N" } },
      totals: { innerUnits: 25, putBack: 10 },
    });
    // No gloves taken in all any more (Kenneth, 27 October 2026: "remove this row").
    expect((sampling.computed.sizes as Record<string, object>).M).not.toHaveProperty("totalGlovesTaken");
    expect(sampling.computed.totals).not.toHaveProperty("totalGlovesTaken");
    expect(sampling.computed.totals).not.toHaveProperty("innerUnitsPerCase");
    expect(sampling.result.perSize?.M.summary).toContain("Gloves Taken per Inner Box: 13; Put Back: 10; Code Letter: M (reduced from N).");
    expect(sampling.result.perSize?.M.summary).not.toContain("Total Gloves Taken");
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
