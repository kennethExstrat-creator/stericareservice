// What Steri-AI reads to write the Inspection Summary (12 October 2026), on
// the STD_EG example inspection run through the real modules, and a variant
// with two sizes ordered.
import { describe, expect, it } from "vitest";
import { evaluateRecord, type EvaluatedInspection } from "@/lib/export/evaluate";
import { STD_EG_COMMENTS, STD_EG_IDS, stdEgInspectionData, stdEgRecord, stdEgTemplate } from "@/lib/export/__fixtures__/std-eg";
import type { InspectionRecord, PhotoRecord } from "@/lib/export/record";
import type { InspectionData } from "@/modules/_framework";
import {
  capSummaryView,
  finalResultOf,
  resultWordsOf,
  SUMMARY_VIEW_MAX_CHARACTERS,
  summaryViewOf,
  type SummaryView,
} from "./summary-view";

const SUMMARY_TEXT = "The goods were inspected and PASSED; nothing else to add.";

function evaluate(record: InspectionRecord): EvaluatedInspection {
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(evaluation.message);
  return evaluation.evaluated;
}

function viewOf(record: InspectionRecord): SummaryView {
  return summaryViewOf({ record, evaluated: evaluate(record) });
}

/** The record with its data changed by `change` (a deep copy first). */
function withData(change: (data: InspectionData) => void, base: InspectionRecord = stdEgRecord()): InspectionRecord {
  const data = structuredClone(base.data) as InspectionData;
  change(data);
  return { ...base, data };
}

type Entry = Record<string, unknown>;
const moduleOf = (data: InspectionData, key: string) => data.modules[key] as Entry;
const sizesOf = (data: InspectionData, key: string) => moduleOf(data, key).sizes as Record<string, unknown>;

/** Size L ordered too: its sections are not done for it. */
function twoSizes(): InspectionRecord {
  return withData((data) => {
    const order = sizesOf(data, "order_lots");
    order.L = { ...(order.M as Entry), lotNumbers: ["LOT-B01"] };
  });
}

describe("summaryViewOf", () => {
  const record = stdEgRecord();
  const view = viewOf(record);
  const json = JSON.stringify(view);

  it("holds the inspection's own facts in the template's wording", () => {
    expect(view).toMatchObject({
      refNo: "INS-2025-0001",
      status: "submitted",
      standard: "EN 455",
      productType: "examination",
      unit: "pcs",
      sizesOrdered: ["M"],
      order: { "PO / SO Number": "PO-0001 (SO-0001)", "Product Code": "PC-A01", "Inspection Date": "2025-04-11" },
    });
    expect(view.sections.map((section) => section.title)).not.toContain("Manufacturer Information");
    expect(view.sections.map((section) => section.title)).not.toContain("Conclusion");
    const watertight = view.sections.find((section) => section.title === "Freedom From Holes by Watertight Test");
    expect(watertight).toMatchObject({
      status: "pass",
      summary: "Size M: 1 / 500 (Finger 1), Defect Limit 14 / 15: Passed.",
      details: ["Freedom From Holes by Watertight Test (Single Sampling Code Letter N, AQL 1.5)"],
    });
    expect(view.sections.find((section) => section.title.startsWith("Weight"))).toMatchObject({
      status: "warn",
      warnings: ["Average weight 2.9 g is 17.1% below the indicative 3.5 g (threshold 10%)."],
      comment: "Weighed on the factory scale; the indicative weight is from the glove spec sheet.",
    });
  });

  it("carries no link, id, email, timestamp or signature", () => {
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(json).not.toMatch(/\S+@\S+\.\w+/);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(json).not.toMatch(/strokes|signature|storagePath|\.jpg|\.pdf|\.heic/i);
    expect(json).not.toContain("inspector@test.local");
    // An inspector with no full name is not named by their email (the report's own fallback).
    const unnamed = viewOf({ ...record, inspector: record.inspector && { ...record.inspector, fullName: null } });
    expect(unnamed.conclusion.inspectedBy).toBeNull();
    expect(JSON.stringify(unnamed)).not.toMatch(/\S+@\S+\.\w+/);
    // The files' names stay out too: only what kind of document is where.
    expect(view.evidence.documents).toEqual([
      { kind: "lab report", attachedTo: "Force at Break in Newton (Refer to Attached Where Applicable)" },
    ]);
  });

  it("never carries the Inspection Summary itself", () => {
    const written = withData((data) => {
      moduleOf(data, "conclusion").inspectionSummary = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: SUMMARY_TEXT }] }],
      };
    });
    const withSummary = JSON.stringify(viewOf(written));
    expect(withSummary).not.toContain(SUMMARY_TEXT);
    expect(withSummary).not.toContain("inspectionSummary");
    expect(withSummary).toBe(json);
  });

  it("names the conclusion and the suggestion's reasons in the template's words and titles", () => {
    expect(view.conclusion).toEqual({
      words: { pass: "PASSED", fail: "FAILED", hold: "HOLD" },
      finalResult: "PASSED",
      suggestedResult: "PASSED",
      suggestionReasons: { failed: [], notDone: [], warnings: ["Weight (g)"] },
      remark: null,
      date: "2025-04-12",
      inspectedBy: "Inspector A",
    });
  });

  it("honours a template with other conclusion words, and the remark", () => {
    const template = stdEgTemplate();
    const resolved = {
      ...template,
      modules: template.modules.map((module) =>
        module.key === "conclusion" ? { ...module, labels: { ...module.labels, pass: "ACCEPTED", fail: "REJECTED", hold: "ON HOLD" } } : module,
      ),
    };
    const base = stdEgRecord();
    const other = withData(
      (data) => {
        moduleOf(data, "conclusion").remark = "  The weight is within the client's own tolerance.  ";
      },
      { ...base, template: base.template && { ...base.template, resolved } },
    );
    const evaluated = evaluate(other);
    expect(resultWordsOf(evaluated)).toEqual({ pass: "ACCEPTED", fail: "REJECTED", hold: "ON HOLD" });
    expect(finalResultOf(other, evaluated)).toBe("pass");
    expect(summaryViewOf({ record: other, evaluated }).conclusion).toMatchObject({
      finalResult: "ACCEPTED",
      suggestedResult: "ACCEPTED",
      remark: "The weight is within the client's own tolerance.",
    });
  });

  it("takes the row's final result where the conclusion holds none, and none while neither does", () => {
    const unchosen = withData((data) => {
      moduleOf(data, "conclusion").finalResult = null;
    });
    expect(finalResultOf(unchosen, evaluate(unchosen))).toBe("pass");
    const neither = { ...unchosen, result: null };
    expect(finalResultOf(neither, evaluate(neither))).toBeNull();
    expect(viewOf(neither).conclusion.finalResult).toBeNull();
  });

  it("names photos and documents by place, with captions", () => {
    expect(view.evidence.photos.total).toBe(5);
    expect(view.evidence.photos.byPlace["Freedom From Holes by Watertight Test"]).toBe(1);
    expect(view.evidence.photos.captions[0]).toEqual({
      place: "Freedom From Holes by Watertight Test",
      caption: "Pin hole on a finger after the watertight test",
    });
    expect(view.evidence.videos).toBe(0);
  });
});

describe("the two-size variant", () => {
  const record = twoSizes();
  const evaluated = evaluate(record);
  const view = summaryViewOf({ record, evaluated });

  it("lists both sizes, and per size only the sizes ordered", () => {
    expect(view.sizesOrdered).toEqual(["M", "L"]);
    for (const section of view.sections) {
      for (const size of Object.keys(section.perSize ?? {})) expect(view.sizesOrdered, section.title).toContain(size);
    }
    expect(view.sections.find((section) => section.title === "Order")?.perSize).toMatchObject({ L: expect.stringContaining("LOT-B01") });
  });

  it("drops the warnings about the record, keeping those about the goods", () => {
    const housekeeping = new Set(["module_not_done", "defect_unmapped", "final_result_differs", "mapped_value_ignored"]);
    const recordOnly = evaluated.report.issues.filter((issue) => housekeeping.has(issue.code)).map((issue) => issue.message);
    expect(recordOnly.length).toBeGreaterThan(0);
    const warnings = view.sections.flatMap((section) => section.warnings ?? []);
    expect(warnings.filter((warning) => recordOnly.includes(warning))).toEqual([]);
    expect(warnings).toContain("Average weight 2.9 g is 17.1% below the indicative 3.5 g (threshold 10%).");
  });

  it("names the sections not done by title", () => {
    expect(view.conclusion.suggestedResult).toBe("HOLD");
    expect(view.conclusion.suggestionReasons.notDone).toContain("Freedom From Holes by Watertight Test");
  });

  it("lists the report's errors only while the inspection is a draft or reopened", () => {
    // The report's own mistakes (a duplicate carton, a stray dispensing box), not yet corrected.
    const uncorrected = {
      ...stdEgRecord(),
      data: stdEgInspectionData({ corrected: false, labReportFileId: STD_EG_IDS.fileLabReport, comments: STD_EG_COMMENTS }),
    };
    const errorsOf = (status: InspectionRecord["status"]) => viewOf({ ...uncorrected, status }).sections.flatMap((section) => section.errors ?? []);
    expect(errorsOf("draft").length).toBeGreaterThan(0);
    expect(errorsOf("reopened")).toEqual(errorsOf("draft"));
    expect(errorsOf("submitted")).toEqual([]);
  });

  it("never shows a size that was saved but not ordered", () => {
    const stray = withData((data) => {
      sizesOf(data, "weight").XL = { values: [3.1, 3.2] };
    }, record);
    const strayView = viewOf(stray);
    expect(JSON.stringify(strayView.sections)).not.toMatch(/"XL"/);
    expect(strayView.sizesOrdered).toEqual(["M", "L"]);
  });
});

describe("the size limits", () => {
  function photo(index: number, caption: string): PhotoRecord {
    return {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      moduleKey: index % 2 === 0 ? "media_warehouse" : null,
      target: null,
      storagePath: `x/${index}.jpg`,
      thumbPath: null,
      caption,
      takenAt: null,
      includeInReport: false,
      flagged: false,
      createdAt: `2025-04-11T06:${String(index).padStart(2, "0")}:00.000000+00:00`,
    };
  }

  it("keeps at most 30 captions, each cut to 200 characters, blank ones left out", () => {
    const photos = [photo(0, "   "), ...Array.from({ length: 35 }, (_, index) => photo(index + 1, `${index + 1} ${"carton ".repeat(60)}`))];
    const view = viewOf({ ...stdEgRecord(), photos });
    expect(view.evidence.photos.total).toBe(36);
    expect(view.evidence.photos.byPlace).toMatchObject({ Warehouse: 18, Untagged: 18 });
    expect(view.evidence.photos.captions).toHaveLength(30);
    expect(view.evidence.photos.captions[0].caption.startsWith("1 carton")).toBe(true);
    expect(Math.max(...view.evidence.photos.captions.map((entry) => Array.from(entry.caption).length))).toBe(200);
  });

  it("drops the captions first, then the details, past 60,000 characters", () => {
    const base = { ...viewOf(stdEgRecord()), reportTitle: "" };
    const captions = Array.from({ length: 30 }, (_, index) => ({ place: "Warehouse", caption: `${index} ${"x".repeat(190)}` }));
    const withCaptions: SummaryView = { ...base, evidence: { ...base.evidence, photos: { ...base.evidence.photos, captions } } };
    expect(capSummaryView(withCaptions)).toBe(withCaptions);

    const padding = "y".repeat(SUMMARY_VIEW_MAX_CHARACTERS - JSON.stringify(withCaptions).length + 10);
    const overByCaptions: SummaryView = { ...withCaptions, reportTitle: padding };
    const capped = capSummaryView(overByCaptions);
    expect(capped.evidence.photos.captions).toEqual([]);
    expect(capped.sections.some((section) => section.details)).toBe(true);

    const overByMore: SummaryView = { ...withCaptions, reportTitle: padding + "z".repeat(8_000) };
    const cut = capSummaryView(overByMore);
    expect(cut.evidence.photos.captions).toEqual([]);
    expect(cut.sections.some((section) => section.details)).toBe(false);
    expect(cut.sections.length).toBe(base.sections.length);
  });
});
