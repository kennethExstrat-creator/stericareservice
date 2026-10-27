// The Report page's rules (Kenneth, 27 October 2026): its options read and
// written in the data (the morning's first shape read into the design's),
// what the save refuses, and which sections an inspection can show.
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_OPTIONS, ReportOptionsSchema, type ReportOptions } from "@/lib/schemas/report-options";
import { emptyData, filledData } from "./__fixtures__/capture";
import {
  NOT_IN_INSPECTION,
  readReportOptions,
  reportFooterNote,
  reportOptionsProblem,
  reportSectionsAvailable,
  reportTitle,
  withFirstShape,
  writeReportOptions,
} from "./report";

const options = (patch: Partial<ReportOptions> = {}): ReportOptions => ({ ...DEFAULT_REPORT_OPTIONS, ...patch });

describe("readReportOptions and writeReportOptions: the options in the data", () => {
  it("reads data from before the Report page, with nothing saved, as the defaults", () => {
    expect(readReportOptions(emptyData())).toEqual(DEFAULT_REPORT_OPTIONS);
    expect(readReportOptions({ report: null })).toEqual(DEFAULT_REPORT_OPTIONS);
    expect(readReportOptions({ report: "corrupt" })).toEqual(DEFAULT_REPORT_OPTIONS);
  });

  it("reads what is saved, an option saved before another existed taking that one's default", () => {
    const read = readReportOptions({ report: { pageSize: "letter", photos: { perGroup: 12 } } });
    expect(read).toEqual({ ...DEFAULT_REPORT_OPTIONS, pageSize: "letter", photos: { ...DEFAULT_REPORT_OPTIONS.photos, perGroup: 12 } });
  });

  it("keeps the options it can read when one cannot be read: that one, or that switch, takes its default", () => {
    const read = readReportOptions({
      report: {
        pageSize: "a3",
        showClient: false,
        sections: { packing: { include: "maybe", blocks: { agedGloves: false, perBoxResults: 3 } } },
        photos: { perGroup: 5, groups: { samplingPackaging: false } },
      },
    });
    expect(read.pageSize).toBe("a4");
    expect(read.showClient).toBe(false);
    expect(read.sections.packing).toEqual({
      include: true,
      blocks: { averageLayeringDispensing: true, perBoxResults: true, agedGloves: false, stickinessGrades: true },
    });
    expect(read.photos).toEqual({ groups: { samplingPackaging: false, packingVisualAgeing: true, watertightLaboratory: true }, perGroup: 8 });
  });

  it("writes the options whole beside the modules, leaving the modules as they are", () => {
    const data = filledData();
    const next = options({ showClient: false });
    const written = writeReportOptions(data, next);
    expect(written.report).toEqual(next);
    expect(written.modules).toBe(data.modules);
    expect(written.custom).toBe(data.custom);
    expect(readReportOptions(written)).toEqual(next);
    expect(data.report).toBeUndefined();
  });
});

describe("options saved in the first shape (the morning's switch per capture step)", () => {
  it("map onto the design's options: client, summary, signature, photos", () => {
    const read = readReportOptions({
      report: { showClientName: false, includeSummary: false, includeSignature: false, includePhotos: false, photosPerStep: 6, photoSize: "large" },
    });
    expect(read.showClient).toBe(false);
    expect(read.summary).toEqual({ orderMix: true, inspectionSummary: false, resultsByCheck: true });
    expect(read.sections.labellingConclusion.blocks.inspectorSignature).toBe(false);
    expect(read.photos).toEqual({ groups: { samplingPackaging: false, packingVisualAgeing: false, watertightLaboratory: false }, perGroup: 12 });
    // Photos per Step doubles into Photos per Group: the old default is the new default.
    expect(readReportOptions({ report: { photosPerStep: 4 } }).photos.perGroup).toBe(8);
    expect(readReportOptions({ report: { photosPerStep: 2 } }).photos.perGroup).toBe(4);
  });

  it("switch off the blocks a step's page held, and a section once none of its blocks is left", () => {
    const weight = readReportOptions({ report: { omittedSteps: ["weight"] } });
    expect(weight.sections.dimensions).toEqual({
      include: true,
      blocks: { gloveLength: true, palmWidth: true, medianResults: true, weightPerGlove: false },
    });
    const dimension = readReportOptions({ report: { omittedSteps: ["dimensions"] } });
    expect(dimension.sections.measurements.include).toBe(false);
    expect(dimension.sections.dimensions.blocks).toMatchObject({ gloveLength: false, palmWidth: false, medianResults: false, weightPerGlove: true });
    expect(readReportOptions({ report: { omittedSteps: ["dimensions", "weight"] } }).sections.dimensions.include).toBe(false);
    // Either test of a kind leaves its section out: an inspection has one of them.
    expect(readReportOptions({ report: { omittedSteps: ["tensile"] } }).sections.forceAtBreak.include).toBe(false);
    expect(readReportOptions({ report: { omittedSteps: ["dispensing_safedon"] } }).sections.packing.include).toBe(false);
    // The defects chart shows both tests: it goes only with both.
    const watertight = readReportOptions({ report: { omittedSteps: ["watertight"] } }).sections.holesVisual;
    expect(watertight).toMatchObject({ include: true, blocks: { defectsAgainstLimit: true, pinholesByLocation: false } });
    expect(readReportOptions({ report: { omittedSteps: ["watertight", "visual"] } }).sections.holesVisual.include).toBe(false);
    // Source Documents and the Conclusion held no section of their own.
    expect(readReportOptions({ report: { omittedSteps: ["source_documents", "conclusion"] } }).sections).toEqual(DEFAULT_REPORT_OPTIONS.sections);
  });

  it("leaves options in the design's shape as they are, and lets what that shape saves win", () => {
    const current = { ...DEFAULT_REPORT_OPTIONS, showClient: false };
    expect(withFirstShape(current)).toBe(current);
    expect(readReportOptions({ report: { showClient: true, showClientName: false } }).showClient).toBe(true);
    expect(withFirstShape({ omittedSteps: ["weight"], pageSize: "letter" })).not.toHaveProperty("omittedSteps");
  });
});

describe("reportOptionsProblem: what the save refuses", () => {
  const before = filledData();

  it("lets a save through with no options, with options as stored, or with options that parse", () => {
    expect(reportOptionsProblem(before, filledData())).toBeNull();
    expect(reportOptionsProblem(before, writeReportOptions(before, options({ pageSize: "letter" })))).toBeNull();
    const saved = writeReportOptions(before, options({ footerNote: "Confidential." }));
    expect(reportOptionsProblem(saved, saved)).toBeNull();
  });

  it("names the Report page and the first problem, as the autosave pill words a step's", () => {
    expect(reportOptionsProblem(before, { ...before, report: { ...options(), footerNote: "x".repeat(301) } })).toBe(
      "Report: Keep the footer note to 300 characters.",
    );
    expect(reportOptionsProblem(before, { ...before, report: { ...options(), photos: { ...options().photos, perGroup: 5 } } })).toBe(
      "Report: Choose 4, 8 or 12 photos per group.",
    );
    expect(reportOptionsProblem(before, { ...before, report: "corrupt" })).toMatch(/^Report: /);
  });

  it("never stops a save over options left as they were saved, readable or not", () => {
    const unreadable = { ...before, report: { pageSize: "a3" } };
    expect(ReportOptionsSchema.safeParse(unreadable.report).success).toBe(false);
    expect(reportOptionsProblem(unreadable, { ...unreadable, modules: { ...unreadable.modules, weight: { sizes: {} } } })).toBeNull();
  });
});

describe("reportTitle and reportFooterNote", () => {
  it("trim what is typed; a blank title is the default one and a blank note none", () => {
    expect(reportTitle(options({ title: "  Lot Release Report " }))).toBe("Lot Release Report");
    expect(reportTitle(options({ title: "   " }))).toBe("Pre-Shipment Inspection Report");
    expect(reportFooterNote(options({ footerNote: " Confidential. " }))).toBe("Confidential.");
    expect(reportFooterNote(options())).toBeNull();
  });
});

describe("reportSectionsAvailable: the sections an inspection can show", () => {
  it("offers a section when the inspection includes one of its modules, and says why it does not", () => {
    const stdSg = reportSectionsAvailable(["header", "order_lots", "sampling_plan", "watertight", "visual", "dimensions", "dye_leak", "conclusion"]);
    expect(stdSg).toEqual({
      orderSampling: true,
      dimensions: true,
      measurements: true,
      forceAtBreak: false,
      holesVisual: true,
      packing: false,
      labellingConclusion: true,
    });
    // Physical properties stand in for force at break, Safedon dispensing for the packing check.
    expect(reportSectionsAvailable(["tensile", "dispensing_safedon"])).toMatchObject({ forceAtBreak: true, packing: true });
    expect(NOT_IN_INSPECTION).toBe("Not in this inspection");
  });
});
