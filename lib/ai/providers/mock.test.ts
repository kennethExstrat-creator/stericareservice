import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { AiReviewSchema, type InspectionExport, type ModuleResult } from "@/lib/schemas";
import { STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { mockReview } from "./mock";

function withResult(doc: InspectionExport, key: string, result: ModuleResult): InspectionExport {
  const target = doc.modules.find((candidate) => candidate.key === key);
  if (!target) throw new Error(`Fixture has no ${key} module`);
  target.result = result;
  return doc;
}

describe("mockReview", () => {
  it("turns the fixture's weight warning into a hold with one finding and a remark question", () => {
    const doc = makeStdEgExport();
    const weight = doc.modules.find((module) => module.key === "weight");
    if (!weight) throw new Error("Fixture has no weight module");
    const review = mockReview(doc);

    expect(review.suggestedResult).toBe("hold");
    expect(review.confidence).toBe(0.6);
    expect(review.findings).toEqual([
      {
        id: "F1",
        module: "weight",
        size: "M",
        severity: "minor",
        message: `${weight.title} has a warning. ${weight.result.summary}`,
        evidence: {
          values: [
            { label: "Module result", value: "warn", unit: null },
            { label: "Size M", value: "warn", unit: null },
            {
              label: "Warning weight_deviation, size M",
              // The real weight module's words for expected results B.
              value: STD_EG_EXPECTED.warnings[0].message,
              unit: null,
            },
          ],
          boxes: [],
          photos: [FIXTURE_IDS.photoScale],
        },
      },
    ]);
    expect(review.questions).toEqual([
      {
        id: "Q1",
        module: "conclusion",
        question: "The conclusion has no remark. What should the client know about this result?",
      },
    ]);
    expect(review.summary).toContain("1 of 14 modules need attention");
  });

  it("is deterministic and leaves the export untouched", () => {
    const doc = makeStdEgExport();
    const before = structuredClone(doc);
    expect(JSON.stringify(mockReview(doc))).toBe(JSON.stringify(mockReview(makeStdEgExport())));
    expect(doc).toEqual(before);
  });

  it("suggests pass with no findings or questions when everything passed and there is a remark", () => {
    const doc = withResult(makeStdEgExport(), "weight", { status: "pass", summary: "Within 10%." });
    doc.conclusion.remark = "Shipment released.";
    const review = mockReview(doc);
    expect(review).toMatchObject({ suggestedResult: "pass", confidence: 0.9, findings: [], questions: [] });
    expect(review.summary).toContain("All 14 modules passed or are informational");
  });

  it("suggests fail when any module failed, with findings in module order", () => {
    let doc = withResult(makeStdEgExport(), "visual", {
      status: "fail",
      summary: "1 critical defect (embedded insect).",
      perSize: { M: { status: "fail" } },
    });
    doc = withResult(doc, "labeling", { status: "not_done", summary: "" });
    const review = mockReview(doc);

    expect(review.suggestedResult).toBe("fail");
    expect(review.confidence).toBe(0.85);
    expect(review.findings.map(({ id, module, severity }) => ({ id, module, severity }))).toEqual([
      { id: "F1", module: "weight", severity: "minor" },
      { id: "F2", module: "visual", severity: "critical" },
      { id: "F3", module: "labeling", severity: "major" },
    ]);
    expect(review.findings[1].evidence.photos).toEqual([FIXTURE_IDS.photoThinSpot]);
    expect(review.findings[2].message).toBe("Packaging Labeling Inspection is not done.");
  });

  it("leaves size empty when several sizes need attention", () => {
    const doc = withResult(makeStdEgExport(), "watertight", {
      status: "fail",
      summary: "",
      perSize: { S: { status: "fail" }, M: { status: "warn" }, L: { status: "pass" } },
    });
    const finding = mockReview(doc).findings.find((candidate) => candidate.module === "watertight");
    expect(finding?.size).toBeNull();
    expect(finding?.evidence.values.map((value) => value.label)).toEqual(["Module result", "Size S", "Size M"]);
  });

  it("cites only photos tagged with the finding's module", () => {
    const doc = makeStdEgExport();
    const scale = doc.photos.find((photo) => photo.id === FIXTURE_IDS.photoScale);
    if (!scale) throw new Error("Fixture has no scale photo");
    scale.moduleKey = null;
    expect(mockReview(doc).findings[0]).toMatchObject({ module: "weight", evidence: { photos: [] } });
  });

  it("always produces a valid AiReview", () => {
    expect(AiReviewSchema.safeParse(mockReview(makeStdEgExport())).success).toBe(true);
  });
});
