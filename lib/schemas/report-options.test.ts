// The Report page's options (Kenneth, 27 October 2026): their defaults, the
// schema the save checks them with, and how data saved before them reads.
import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import {
  DEFAULT_REPORT_OPTIONS,
  DEFAULT_REPORT_TITLE,
  REPORT_FIELDS,
  REPORT_LIMITS,
  REPORT_PAGE_SIZES,
  REPORT_PHOTO_SIZES,
  REPORT_TEMPLATES,
  ReportOptionsSchema,
} from "./report-options";

const issuesOf = (input: unknown) => {
  const parsed = ReportOptionsSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
};

describe("the report options' defaults", () => {
  it("are the standard template on A4, every step, 4 medium photos per step, the default title and everything shown", () => {
    expect(DEFAULT_REPORT_OPTIONS).toEqual({
      template: "standard_preshipment",
      pageSize: "a4",
      omittedSteps: [],
      includePhotos: true,
      photosPerStep: 4,
      photoSize: "medium",
      title: "Pre-Shipment Inspection Report",
      showClientName: true,
      includeSummary: true,
      includeSignature: true,
      footerNote: "",
    });
    expect(DEFAULT_REPORT_OPTIONS.title).toBe(DEFAULT_REPORT_TITLE);
  });

  it("fill in what was saved before an option existed, and drop an option this build does not know", () => {
    expect(ReportOptionsSchema.parse({})).toEqual(DEFAULT_REPORT_OPTIONS);
    expect(ReportOptionsSchema.parse({ pageSize: "letter", omittedSteps: ["weight"] })).toEqual({
      ...DEFAULT_REPORT_OPTIONS,
      pageSize: "letter",
      omittedSteps: ["weight"],
    });
    expect(ReportOptionsSchema.parse({ watermark: true, footerNote: "Confidential." })).toEqual({ ...DEFAULT_REPORT_OPTIONS, footerNote: "Confidential." });
  });

  it("offer one template for now, A4 or Letter at their sizes, 2, 4 or 6 photos and three photo sizes", () => {
    expect(REPORT_TEMPLATES.map((template) => template.label)).toEqual(["Standard Preshipment Report"]);
    expect(REPORT_PAGE_SIZES.map(({ value, width, height }) => [value, width, height])).toEqual([
      ["a4", 210, 297],
      ["letter", 215.9, 279.4],
    ]);
    expect(REPORT_PHOTO_SIZES.map((size) => size.label)).toEqual(["Small", "Medium", "Large"]);
    for (const photosPerStep of [2, 4, 6]) expect(issuesOf({ photosPerStep })).toEqual([]);
  });

  it("label every option in Title Case (docs/DESIGN.md, Capitalisation), and the template's note is a sentence", () => {
    const labels = [
      ...Object.values(REPORT_FIELDS).map((field) => field.label),
      ...REPORT_TEMPLATES.map((template) => template.label),
      ...REPORT_PHOTO_SIZES.map((size) => size.label),
    ];
    expect(labels.filter((label) => lowerCaseWords(label).length > 0)).toEqual([]);
    expect(REPORT_FIELDS.template.hint).toBe("Template design coming soon.");
  });
});

describe("ReportOptionsSchema: what the save refuses", () => {
  it("refuses a choice it does not offer, with the choices in the message", () => {
    expect(issuesOf({ pageSize: "a3" })).toEqual([{ path: "pageSize", message: "Choose A4 or Letter." }]);
    expect(issuesOf({ photosPerStep: 3 })).toEqual([{ path: "photosPerStep", message: "Choose 2, 4 or 6 photos per step." }]);
    expect(issuesOf({ photoSize: "huge" })).toEqual([{ path: "photoSize", message: "Choose Small, Medium or Large." }]);
    expect(issuesOf({ template: "custom" })).toEqual([{ path: "template", message: "Choose a report template." }]);
    expect(issuesOf({ includePhotos: "yes" })).toHaveLength(1);
  });

  it("keeps the title to 120 characters and the footer note to 300, as typed: spaces stay while it is saved on every change", () => {
    expect(REPORT_LIMITS).toEqual({ title: 120, footerNote: 300 });
    expect(issuesOf({ title: "x".repeat(121) })).toEqual([{ path: "title", message: "Keep the title to 120 characters." }]);
    expect(issuesOf({ footerNote: "x".repeat(301) })).toEqual([{ path: "footerNote", message: "Keep the footer note to 300 characters." }]);
    expect(ReportOptionsSchema.parse({ title: "Lot Release ", footerNote: "x".repeat(300) })).toMatchObject({ title: "Lot Release " });
    // A blank title is allowed: the report then takes the default one.
    expect(issuesOf({ title: "" })).toEqual([]);
  });

  it("refuses text Postgres cannot store in jsonb", () => {
    expect(issuesOf({ footerNote: "Line\u0000break" })).toEqual([{ path: "footerNote", message: "This text holds a character that cannot be saved." }]);
    expect(issuesOf({ title: "Half \ud83d an emoji" })).toHaveLength(1);
    expect(issuesOf({ title: "Glove report \u{1F9E4}" })).toEqual([]);
  });

  it("names steps by their keys, at most 64 of them", () => {
    expect(issuesOf({ omittedSteps: ["order_lots", "source_documents", "dispensing_notes"] })).toEqual([]);
    expect(issuesOf({ omittedSteps: ["Weight"] })).toEqual([{ path: "omittedSteps.0", message: "Not a step of an inspection." }]);
    expect(issuesOf({ omittedSteps: Array.from({ length: 65 }, (_, index) => `step_${index}`) })).toEqual([{ path: "omittedSteps", message: "Too many steps." }]);
  });
});
