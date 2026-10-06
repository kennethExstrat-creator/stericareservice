// The export of the STD_EG example through the real modules, the whole way
// the route builds it (BUILD_SPEC 9.1): read through a Supabase client,
// evaluated with the app's registry, links signed for 24 hours, validated by
// ExportSchema. build.test.ts covers the pipeline's rules on the framework's
// test modules; this one checks what the real modules put in.
import { afterEach, describe, expect, it, vi } from "vitest";

// The framework as it is, with a spy on the context builder: what the export passes it.
vi.mock("@/modules/_framework", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/_framework")>();
  return { ...actual, buildInspectionContext: vi.fn(actual.buildInspectionContext) };
});

import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { buildInspectionContext } from "@/modules/_framework";
import { createFakeSupabase } from "./__fixtures__/fake-supabase";
import {
  STD_EG_IDS,
  STD_EG_REF_NO,
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
    const labReport = moduleOf(doc, "force_at_break").data.labReport;
    expect(labReport).toBe(STD_EG_IDS.fileLabReport);
    const file = doc.files.find((entry) => entry.id === labReport);
    expect(file).toMatchObject({ moduleKey: "force_at_break", kind: "lab_report", url: expect.stringContaining("inspection-files") });
    const signing = fake.signed.find((request) => request.bucket === "inspection-files");
    expect(signing).toMatchObject({ expiresIn: EXPORT_URL_TTL_SECONDS });
  });

  it("exports every module's config as the STD_EG version resolves it", async () => {
    const { doc } = await exportOf();
    expect(moduleOf(doc, "force_at_break").config).toEqual({ n: 13, specMin: 6, standardLabel: null, decimals: 3 });
    expect(moduleOf(doc, "sampling_plan").config).toMatchObject({ inspectionLevel: "I" });
    expect(moduleOf(doc, "visual").config).toMatchObject({
      classes: { critical: { aql: 0 }, major: { aql: 2.5 }, minor: { aql: 4 } },
    });
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
    vi.mocked(buildInspectionContext).mockClear();
    const record = stdEgRecord();
    expect(evaluateRecord(record).ok).toBe(true);
    expect(buildInspectionContext).toHaveBeenCalledWith(
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
