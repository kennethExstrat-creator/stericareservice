// The Report page's rules (Kenneth, 27 October 2026): its options read and
// written in the data, what the save refuses, one switch per step the
// inspection includes, what a step switched off leaves out, and when
// Generate Report may run.
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_OPTIONS, ReportOptionsSchema, type ReportOptions } from "@/lib/schemas/report-options";
import type { ModuleOverrides } from "@/lib/schemas/template";
import { emptyData, filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import {
  evaluatedReportSteps,
  GENERATE_REASONS,
  generateAvailability,
  omittedSectionKeys,
  readReportOptions,
  reportFooterNote,
  reportOptionsProblem,
  reportSteps,
  reportTitle,
  stepInReport,
  withStepInReport,
  writeReportOptions,
} from "./report";
import { capturePages, captureSections, leadPagesFirst, withAuditLog, withReport, withSourceDocuments } from "./sections";

const OFF: ModuleOverrides = {
  packing_config: { reason: "Not in this order.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
};

function evaluated(data = filledData(), overrides: ModuleOverrides = {}) {
  const evaluation = evaluateCapture({ template: testTemplate(), overrides, data, meta: TEST_META }, TEST_REGISTRY);
  return { template: evaluation.template, report: evaluation.report, data };
}

/** The capture screen's pages, as it builds them: Source Documents first, the Report page and the Audit Log last. */
function screenPages(data = filledData(), overrides: ModuleOverrides = {}) {
  const evaluation = evaluated(data, overrides);
  const files = { key: "source_documents", title: "Source Documents", shortTitle: "Source Documents", status: "pass", progress: "done" } as const;
  return withAuditLog(
    withReport(withSourceDocuments(files, leadPagesFirst(capturePages(captureSections(evaluation.template, evaluation.report, data))))),
  );
}

const options = (patch: Partial<ReportOptions> = {}): ReportOptions => ({ ...DEFAULT_REPORT_OPTIONS, ...patch });

describe("readReportOptions and writeReportOptions: the options in the data", () => {
  it("reads data from before the Report page, with nothing saved, as the defaults", () => {
    expect(readReportOptions(emptyData())).toEqual(DEFAULT_REPORT_OPTIONS);
    expect(readReportOptions({ report: null })).toEqual(DEFAULT_REPORT_OPTIONS);
    expect(readReportOptions({ report: "corrupt" })).toEqual(DEFAULT_REPORT_OPTIONS);
  });

  it("reads what is saved, an option saved before another existed taking that one's default", () => {
    expect(readReportOptions({ report: { pageSize: "letter", photosPerStep: 6 } })).toEqual(options({ pageSize: "letter", photosPerStep: 6 }));
  });

  it("keeps the options it can read when one cannot be read: that one takes its default", () => {
    expect(readReportOptions({ report: { pageSize: "a3", photoSize: "large", omittedSteps: ["weight"] } })).toEqual(
      options({ photoSize: "large", omittedSteps: ["weight"] }),
    );
  });

  it("writes the options whole beside the modules, leaving the modules as they are", () => {
    const data = filledData();
    const written = writeReportOptions(data, options({ includePhotos: false }));
    expect(written.report).toEqual(options({ includePhotos: false }));
    expect(written.modules).toBe(data.modules);
    expect(written.custom).toBe(data.custom);
    expect(readReportOptions(written)).toEqual(options({ includePhotos: false }));
    expect(data.report).toBeUndefined();
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
    expect(reportOptionsProblem(before, { ...before, report: { ...options(), photosPerStep: 5 } })).toBe("Report: Choose 2, 4 or 6 photos per step.");
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

describe("reportSteps: one switch per step the inspection includes, in step order", () => {
  it("lists Source Documents and the included pages as the progress steps do, never the Report page, the Audit Log or a switched-off step", () => {
    const pages = screenPages(filledData(), OFF);
    const steps = reportSteps(pages);
    expect(steps.map((step) => step.key)).toEqual(["source_documents", "order_lots", "site_notes", "weight", "size_checks", "conclusion"]);
    expect(pages.map((page) => page.key)).toEqual(expect.arrayContaining(["packing_config", "report", "audit_log"]));
    expect(steps.map((step) => step.key)).not.toContain("packing_config");
  });

  it("names each step by its short name, with its full title for the hover, as the sidebar does", () => {
    const pages = screenPages();
    const steps = reportSteps(pages);
    for (const step of steps) {
      const page = pages.find((entry) => entry.key === step.key);
      expect(step).toMatchObject({ title: page?.title, shortTitle: page?.shortTitle });
    }
    expect(steps[0]).toMatchObject({ key: "source_documents", shortTitle: "Source Documents" });
  });

  it("gives each step the sections on its page: General Information on Source Documents', the modules shown on the order's", () => {
    const steps = reportSteps(screenPages());
    expect(steps.find((step) => step.key === "source_documents")?.sectionKeys).toEqual(["header", "source_documents"]);
    expect(steps.find((step) => step.key === "order_lots")?.sectionKeys).toEqual(["order_lots", "glove_info", "packing_config"]);
    expect(steps.find((step) => step.key === "weight")?.sectionKeys).toEqual(["weight"]);
    // Packing configuration switched off for the inspection: no longer on the order's page.
    expect(reportSteps(screenPages(filledData(), OFF)).find((step) => step.key === "order_lots")?.sectionKeys).toEqual(["order_lots", "glove_info"]);
  });

  it("are the same steps from an evaluation alone, as the export works them out", () => {
    for (const overrides of [{}, OFF]) {
      expect(evaluatedReportSteps(evaluated(filledData(), overrides))).toEqual(reportSteps(screenPages(filledData(), overrides)));
    }
  });
});

describe("switching a step off or on", () => {
  it("switches one step, every step on by default", () => {
    expect(stepInReport(options(), "weight")).toBe(true);
    const off = withStepInReport(options(), "weight", false);
    expect(off.omittedSteps).toEqual(["weight"]);
    expect(stepInReport(off, "weight")).toBe(false);
    expect(stepInReport(off, "order_lots")).toBe(true);
    // Twice off is once; back on, it goes.
    expect(withStepInReport(off, "weight", false).omittedSteps).toEqual(["weight"]);
    expect(withStepInReport(off, "weight", true).omittedSteps).toEqual([]);
  });

  it("leaves out every section on the page of a step switched off, in step order", () => {
    const steps = reportSteps(screenPages());
    expect(omittedSectionKeys(options(), steps)).toEqual([]);
    expect(omittedSectionKeys(options({ omittedSteps: ["weight", "order_lots"] }), steps)).toEqual([
      "order_lots",
      "glove_info",
      "packing_config",
      "weight",
    ]);
    // A step the inspection no longer has is no section.
    expect(omittedSectionKeys(options({ omittedSteps: ["dye_leak"] }), steps)).toEqual([]);
  });
});

describe("generateAvailability: the AI report's rules (BUILD_SPEC 9.1)", () => {
  it("runs for an admin on a submitted or approved inspection with a report service", () => {
    expect(generateAvailability({ isAdmin: true, reportable: true, connected: true })).toEqual({ allowed: true });
  });

  it("waits for an admin and a submitted inspection first, then for the report service", () => {
    const notYet = { allowed: false, reason: "Available to admins once the inspection is submitted." };
    expect(generateAvailability({ isAdmin: false, reportable: true, connected: true })).toEqual(notYet);
    expect(generateAvailability({ isAdmin: true, reportable: false, connected: true })).toEqual(notYet);
    expect(generateAvailability({ isAdmin: false, reportable: false, connected: false })).toEqual(notYet);
    expect(generateAvailability({ isAdmin: true, reportable: true, connected: false })).toEqual({
      allowed: false,
      reason: "The report service is not set up yet.",
    });
    expect(GENERATE_REASONS).toEqual({ notYet: notYet.reason, notSetUp: "The report service is not set up yet." });
  });
});
