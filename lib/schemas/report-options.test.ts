// The Report page's options (Kenneth, 27 October 2026), shaped as the
// report's design is ("make the setting of report match the the report
// design"): their defaults, the parts they name, the schema the save checks
// them with, and how data saved before an option existed reads.
import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import {
  blockOn,
  DEFAULT_REPORT_OPTIONS,
  DEFAULT_REPORT_TITLE,
  REPORT_FIELDS,
  REPORT_LIMITS,
  REPORT_PAGE_SIZES,
  REPORT_PHOTO_GROUPS,
  REPORT_PHOTOS_PER_GROUP,
  REPORT_SECTION_KEYS,
  REPORT_SECTIONS,
  REPORT_SUMMARY,
  REPORT_TEMPLATES,
  ReportOptionsSchema,
  reportSection,
} from "./report-options";

const issuesOf = (input: unknown) => {
  const parsed = ReportOptionsSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
};

describe("the report's parts", () => {
  it("follow the design: the Summary's three blocks, sections 02 to 08 and three photo records", () => {
    expect(REPORT_SUMMARY.blocks.map((block) => block.key)).toEqual(["orderMix", "inspectionSummary", "resultsByCheck"]);
    expect(REPORT_SECTION_KEYS).toEqual(["orderSampling", "dimensions", "measurements", "forceAtBreak", "holesVisual", "packing", "labellingConclusion"]);
    expect(REPORT_SECTIONS.map((section) => [section.key, section.blocks.map((block) => block.key)])).toEqual([
      ["orderSampling", ["gloveInformation", "packingConfiguration", "orderLotsSampling", "finishedGoodsSampling"]],
      ["dimensions", ["gloveLength", "palmWidth", "medianResults", "weightPerGlove"]],
      ["measurements", []],
      ["forceAtBreak", ["laboratoryDetails", "maximumLoad", "specimenReadings", "laboratorySummary"]],
      ["holesVisual", ["defectsAgainstLimit", "pinholesByLocation", "visualCritical", "defectPhotos", "visualMajorMinor"]],
      ["packing", ["averageLayeringDispensing", "perBoxResults", "agedGloves", "stickinessGrades"]],
      ["labellingConclusion", ["dispenserCartonBox", "resultsMatrix", "inspectorSignature", "remark"]],
    ]);
    expect(REPORT_PHOTO_GROUPS.map((group) => [group.key, group.title])).toEqual([
      ["samplingPackaging", "Sampling & Packaging"],
      ["packingVisualAgeing", "Packing, Visual & Ageing"],
      ["watertightLaboratory", "Watertight & Laboratory Testing"],
    ]);
    expect(reportSection("packing").modules).toEqual(["dispensing_packing", "dispensing_safedon"]);
  });

  it("name every part in Title Case (docs/DESIGN.md, Capitalisation)", () => {
    const labels = [
      ...Object.values(REPORT_FIELDS).map((field) => field.label),
      ...REPORT_TEMPLATES.map((template) => template.label),
      REPORT_SUMMARY.title,
      ...REPORT_SUMMARY.blocks.map((block) => block.label),
      ...REPORT_SECTIONS.flatMap((section) => [section.title, ...section.blocks.map((block) => block.label)]),
      ...REPORT_PHOTO_GROUPS.map((group) => group.title),
    ];
    expect(labels.filter((label) => lowerCaseWords(label).length > 0)).toEqual([]);
  });

  it("give each photo record modules no other record takes", () => {
    const modules = REPORT_PHOTO_GROUPS.flatMap((group) => [...group.modules]);
    expect(new Set(modules).size).toBe(modules.length);
  });
});

describe("the report options' defaults", () => {
  it("are the standard template on A4, the default title, the client shown, and every block, section and photo record on", () => {
    expect(DEFAULT_REPORT_OPTIONS).toMatchObject({
      template: "standard_preshipment",
      pageSize: "a4",
      title: "Pre-Shipment Inspection Report",
      showClient: true,
      footerNote: "",
      summary: { orderMix: true, inspectionSummary: true, resultsByCheck: true },
      photos: { groups: { samplingPackaging: true, packingVisualAgeing: true, watertightLaboratory: true }, perGroup: 8 },
    });
    expect(DEFAULT_REPORT_OPTIONS.title).toBe(DEFAULT_REPORT_TITLE);
    for (const section of REPORT_SECTIONS) {
      const saved = DEFAULT_REPORT_OPTIONS.sections[section.key];
      expect(saved.include).toBe(true);
      expect(Object.keys(saved.blocks)).toEqual(section.blocks.map((block) => block.key));
      expect(Object.values(saved.blocks).every(Boolean)).toBe(true);
    }
    expect(blockOn(DEFAULT_REPORT_OPTIONS, "dimensions", "weightPerGlove")).toBe(true);
  });

  it("fill in what was saved before an option existed, block by block, and drop an option this build does not know", () => {
    expect(ReportOptionsSchema.parse({})).toEqual(DEFAULT_REPORT_OPTIONS);
    const saved = ReportOptionsSchema.parse({ pageSize: "letter", sections: { dimensions: { blocks: { weightPerGlove: false } } } });
    expect(saved.pageSize).toBe("letter");
    expect(saved.sections.dimensions).toEqual({ include: true, blocks: { gloveLength: true, palmWidth: true, medianResults: true, weightPerGlove: false } });
    expect(saved.sections.packing).toEqual(DEFAULT_REPORT_OPTIONS.sections.packing);
    expect(blockOn(saved, "dimensions", "weightPerGlove")).toBe(false);
    expect(ReportOptionsSchema.parse({ watermark: true, footerNote: "Confidential." })).toEqual({ ...DEFAULT_REPORT_OPTIONS, footerNote: "Confidential." });
  });

  it("offer one template, A4 or Letter at their sizes, and 4, 8 or 12 photos per group", () => {
    expect(REPORT_TEMPLATES.map((template) => template.label)).toEqual(["Standard Preshipment Report"]);
    expect(REPORT_PAGE_SIZES.map(({ value, width, height }) => [value, width, height])).toEqual([
      ["a4", 210, 297],
      ["letter", 215.9, 279.4],
    ]);
    expect(REPORT_PHOTOS_PER_GROUP).toEqual([4, 8, 12]);
    for (const perGroup of [4, 8, 12]) expect(issuesOf({ photos: { perGroup } })).toEqual([]);
  });
});

describe("ReportOptionsSchema: what the save refuses", () => {
  it("refuses a choice it does not offer, with the choices in the message", () => {
    expect(issuesOf({ pageSize: "a3" })).toEqual([{ path: "pageSize", message: "Choose A4 or Letter." }]);
    expect(issuesOf({ photos: { perGroup: 6 } })).toEqual([{ path: "photos.perGroup", message: "Choose 4, 8 or 12 photos per group." }]);
    expect(issuesOf({ template: "custom" })).toEqual([{ path: "template", message: "Choose a report template." }]);
    expect(issuesOf({ sections: { packing: { include: "yes" } } })).toEqual([{ path: "sections.packing.include", message: "Switch it on or off." }]);
    expect(issuesOf({ summary: { orderMix: 1 } })).toHaveLength(1);
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
});
