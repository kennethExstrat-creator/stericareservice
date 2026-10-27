// The Report page's export, from the capture screen's own copy: the same
// document the server exports for what is saved, so the preview's pages are
// the printed ones; the photos the screen knows, with the links it holds.
import { describe, expect, it } from "vitest";
import { makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { evaluateRecord } from "@/lib/export/evaluate";
import { STD_EG_IDS, stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { liveReportExport, type LiveExportInput, type LivePhoto } from "./live-export";
import { buildReportModel } from "./model";

function liveInput(patch: Partial<LiveExportInput> = {}): LiveExportInput {
  const record = stdEgRecord();
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok || !record.template) throw new Error("The STD_EG fixture does not evaluate.");
  const { template, context, report, data, inspector, client, manufacturer } = evaluation.evaluated;
  return {
    inspectionId: record.id,
    refNo: record.refNo,
    status: record.status,
    inspectionDate: record.inspectionDate,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    result: record.result,
    template: { code: "STD_EG", version: 1, standard: "EN455", productType: "examination", resolved: record.template.resolved as ResolvedTemplate },
    evaluation: { template, context, report },
    data,
    meta: { refNo: record.refNo, inspectionDate: record.inspectionDate, inspector, client, manufacturer: { id: STD_EG_IDS.manufacturer, name: "Manufacturer A" } },
    manufacturerLabel: manufacturer?.name ?? null,
    ...patch,
  };
}

const photo = (id: string, patch: Partial<LivePhoto> = {}): LivePhoto => ({
  id,
  moduleKey: "visual",
  target: "size:M/defect:thin_spot",
  caption: "Thin spot",
  takenAt: "2025-04-11T03:10:00.000Z",
  includeInReport: false,
  flagged: false,
  storagePath: `${STD_EG_IDS.inspection}/${id}.jpg`,
  createdAt: "2025-04-11T03:10:00.000000+00:00",
  url: `https://storage.example.com/inspection-photos/${id}.jpg?token=placeholder`,
  ...patch,
});

describe("liveReportExport", () => {
  it("is the export of what the screen holds: the modules, the conclusion and the options as the server exports them", () => {
    const live = liveReportExport(liveInput());
    const saved = makeStdEgExport();
    expect(live).not.toBeNull();
    expect(live?.modules).toEqual(saved.modules);
    expect(live?.conclusion).toEqual(saved.conclusion);
    expect(live?.report).toEqual(saved.report);
    expect(live?.template).toMatchObject({ code: "STD_EG", standard: "EN455", productType: "examination", manufacturer: saved.template.manufacturer });
  });

  it("makes the same Summary as the printed report", () => {
    const live = liveReportExport(liveInput());
    const saved = makeStdEgExport();
    // The saved export's photos are the fixture's; the screen's are its own.
    expect(buildReportModel({ ...live!, photos: saved.photos }).summary).toEqual(buildReportModel(saved).summary);
    expect(buildReportModel(live!).chrome).toEqual(buildReportModel(saved).chrome);
  });

  it("follows the options saved in the screen's copy at once", () => {
    const input = liveInput();
    const live = liveReportExport({ ...input, data: { ...input.data, report: { title: "Lot Release Report", showClient: false } } });
    expect(live?.report).toMatchObject({ title: "Lot Release Report", showClient: false });
  });

  it("takes the photos the screen can show, with their links, and none it holds no link for", () => {
    const [a, b, c] = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000c1"];
    const live = liveReportExport(
      liveInput({ photos: [photo(a), photo(b, { url: null }), photo(c, { moduleKey: "watertight" }), photo("not-a-uuid")] }),
    );
    // In the template's order of their modules, as the export sorts them: the watertight test before the visual.
    expect(live?.photos.map((entry) => [entry.id, entry.moduleKey, entry.url])).toEqual([
      [c, "watertight", `https://storage.example.com/inspection-photos/${c}.jpg?token=placeholder`],
      [a, "visual", `https://storage.example.com/inspection-photos/${a}.jpg?token=placeholder`],
    ]);
  });

  it("is none without an inspector, or when the copy does not make a valid export", () => {
    const input = liveInput();
    expect(liveReportExport({ ...input, meta: { ...input.meta, inspector: null } })).toBeNull();
    expect(liveReportExport({ ...input, updatedAt: "yesterday" })).toBeNull();
  });
});
