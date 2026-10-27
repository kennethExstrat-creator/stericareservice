import { beforeAll, describe, expect, it } from "vitest";
import type { EvaluatedInspection } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import {
  decisions,
  findings,
  IDS,
  loadFixture,
  MOCK_STATUS,
  NOW,
  OFF_STATUS,
  PHOTO_LINKS,
  REVIEW_IDS,
  reviewHistory,
  storedReview,
  UNKNOWN_PHOTO,
} from "./__fixtures__/panel";
import { inspectionFingerprint } from "./fingerprint";
import { ALREADY_PENDING, buildAiPanelModel, NOT_REVIEWABLE, type PanelModelInput } from "./panel-model";
import { STALE_REVIEW_MS, STOPPED_MESSAGE } from "./stored";

let record: InspectionRecord;
let evaluated: EvaluatedInspection;

beforeAll(async () => {
  ({ record, evaluated } = await loadFixture());
});

function model(overrides: Partial<PanelModelInput> = {}) {
  const isAdmin = overrides.isAdmin ?? true;
  return buildAiPanelModel({
    record,
    evaluated,
    reviews: reviewHistory(),
    decisions: decisions(),
    photoLinks: PHOTO_LINKS,
    aiStatus: MOCK_STATUS,
    viewerId: IDS.admin,
    isAdmin,
    // The built-in roles as made: admins ask and decide.
    allows: { secondOpinion: isAdmin },
    now: NOW,
    ...overrides,
  });
}

describe("buildAiPanelModel: reviews", () => {
  it("shows the newest finished review, the newer failed attempt above it, and keeps the rest as history", () => {
    const panel = model();
    expect(panel.current?.id).toBe(REVIEW_IDS.current);
    expect(panel.attempt).toMatchObject({ id: REVIEW_IDS.failed, state: "failed", problem: "The webhook did not answer in time." });
    expect(panel.history.map((review) => [review.id, review.state])).toEqual([
      [REVIEW_IDS.stale, "stopped"],
      [REVIEW_IDS.older, "done"],
    ]);
    expect(panel.history[0].problem).toBe(STOPPED_MESSAGE);
    // A stopped review is not waited for.
    expect(panel.pendingIds).toEqual([]);
  });

  it("describes the current review: who wrote it, when, about which version, with what confidence", () => {
    const current = model().current;
    expect(current).toMatchObject({
      state: "done",
      source: "Mock reviewer (test data only)",
      requestedAt: "6 Oct 2026, 09:00",
      version: "5 Oct 2026, 17:30",
      isCurrentVersion: true,
      suggestedResult: "fail",
      confidencePct: 85,
      readable: true,
    });
    const older = model().history.find((review) => review.id === REVIEW_IDS.older);
    expect(older?.isCurrentVersion).toBe(false);
  });

  it("attaches the latest decision on each finding, and keeps the earlier ones", () => {
    const f1 = model().current?.findings.find((finding) => finding.id === "F1");
    expect(f1?.decision).toEqual({
      action: "disagree",
      note: "The indicative weight on the sheet is for size L.",
      actor: "Admin B",
      at: "6 Oct 2026, 09:20",
    });
    expect(f1?.history).toEqual([{ action: "agree", note: null, actor: "Admin A", at: "6 Oct 2026, 09:10" }]);
    // Decisions belong to their own review.
    const older = model().history.find((review) => review.id === REVIEW_IDS.older);
    expect(older?.findings[0].decision?.action).toBe("fixed");
    expect(model().current?.findings.find((finding) => finding.id === "F2")?.decision).toBeNull();
  });

  it("points photo evidence at signed thumbnails, and says when a photo is gone or cannot be shown", () => {
    const photos = model().current?.findings.find((finding) => finding.id === "F1")?.evidence.photos;
    expect(photos).toEqual([
      {
        id: IDS.photoWeight,
        caption: "Scale reading",
        tags: "Weight (g) · Size M",
        thumbUrl: "https://storage.test/thumb-weight.jpg",
        url: "https://storage.test/weight.jpg",
        state: "ok",
      },
      { id: UNKNOWN_PHOTO, caption: null, tags: null, thumbUrl: null, url: null, state: "missing" },
      {
        id: IDS.photoHeic,
        caption: null,
        tags: null,
        thumbUrl: null,
        url: "https://storage.test/original.heic",
        state: "flagged",
      },
    ]);
  });

  it("words cited photos as the review and the gallery do: the defect in the template's words, levels and entries named", () => {
    const cite = (photos: string[]) =>
      storedReview({
        findings: [{ ...findings()[0], id: "F1", module: "visual", evidence: { values: [], boxes: [], photos } }],
      });
    const labelled = model({ reviews: [cite([IDS.photoVisual])] }).current?.findings[0].evidence.photos[0];
    // Tagged size:M/defect:thin_spot; visual words thin_spot "Thin spot on glove body".
    expect(labelled?.tags).toBe("Visual Inspection · Size M · Thin spot on glove body");

    // A defect the module has no word for is named from the master list (defect_codes), as on the review.
    const photos = record.photos.map((photo) =>
      photo.id === IDS.photoVisual ? { ...photo, moduleKey: "labeling", target: "size:M/box:1324/defect:hole_cuff/level:carton" } : photo,
    );
    const named = model({
      record: { ...record, photos },
      reviews: [cite([IDS.photoVisual])],
      defectNames: new Map([["hole_cuff", "Hole in cuff"]]),
    }).current?.findings[0].evidence.photos[0];
    // Labelling is not in this template: the module's own name, and the level in plain words, as the gallery has them.
    expect(named?.tags).toBe("Packaging Labeling Inspection · Size M · Hole in cuff · Box/Carton #1324 · Carton");
    // Without the name, the code as tagged.
    const unnamed = model({ record: { ...record, photos }, reviews: [cite([IDS.photoVisual])] }).current?.findings[0];
    expect(unnamed?.evidence.photos[0].tags).toContain("· hole_cuff ·");
  });

  it("knows who is looking: a half-made decision is kept under the admin's id", () => {
    expect(model().viewer).toEqual({ id: IDS.admin, isAdmin: true, canDecide: true });
  });

  it("waits for a review still being written and lets no second one start for the same version", () => {
    const running = storedReview({
      id: REVIEW_IDS.running,
      status: "pending",
      findings: [],
      questions: [],
      createdAt: new Date(NOW - 60_000).toISOString(),
    });
    const panel = model({ reviews: [running, ...reviewHistory()] });
    expect(panel.attempt).toMatchObject({ id: REVIEW_IDS.running, state: "pending" });
    expect(panel.pendingIds).toEqual([REVIEW_IDS.running]);
    expect(panel.review).toMatchObject({ canRequest: false, blockedReason: ALREADY_PENDING });

    const stale = model({ reviews: [running], now: NOW + STALE_REVIEW_MS });
    expect(stale.attempt?.state).toBe("stopped");
    expect(stale.review.canRequest).toBe(true);
  });

  it("keeps a review of the same content current after the inspection was saved again", () => {
    const content = inspectionFingerprint(record);
    // Approved since the review: a save, the same content.
    const saved = { ...record, status: "approved" as const, updatedAt: "2026-10-06T03:00:00.000001+00:00" };
    const panel = model({ record: saved, reviews: [storedReview({ inspectionFingerprint: content })] });
    expect(panel.current).toMatchObject({ isCurrentVersion: true, comparedBy: "content" });

    // The same review once the content changed: an earlier version, whatever the save.
    const edited = { ...record, remarks: "Spec sheet received." };
    const stale = model({ record: edited, reviews: [storedReview({ inspectionFingerprint: content })] });
    expect(stale.current).toMatchObject({ isCurrentVersion: false, comparedBy: "content" });
  });

  it("compares a review stored without a fingerprint by its save", () => {
    expect(model().current).toMatchObject({ isCurrentVersion: true, comparedBy: "save" });
    const saved = { ...record, updatedAt: "2026-10-06T03:00:00.000001+00:00" };
    expect(model({ record: saved }).current).toMatchObject({ isCurrentVersion: false, comparedBy: "save" });
  });

  it("waits for a review of the same content, and lets one start for new content", () => {
    const content = inspectionFingerprint(record);
    const running = storedReview({
      id: REVIEW_IDS.running,
      inspectionFingerprint: content,
      status: "pending",
      findings: [],
      questions: [],
      createdAt: new Date(NOW - 60_000).toISOString(),
    });
    const approved = { ...record, status: "approved" as const, updatedAt: "2026-10-06T03:00:00.000001+00:00" };
    expect(model({ record: approved, reviews: [running] }).review).toMatchObject({ canRequest: false, blockedReason: ALREADY_PENDING });
    const edited = { ...record, data: { modules: {}, custom: {} } };
    expect(model({ record: edited, reviews: [running] }).review).toMatchObject({ canRequest: true, blockedReason: null });
  });

  it("has no current review and no attempt before the first request", () => {
    const panel = model({ reviews: [], decisions: [] });
    expect(panel).toMatchObject({ current: null, attempt: null, history: [], pendingIds: [] });
    expect(panel.overall.ai).toEqual({ findings: [], questions: [] });
  });
});

describe("buildAiPanelModel: the three columns", () => {
  it("puts the overall results side by side: suggested, the inspector's final result and remark, the AI's view", () => {
    const { overall } = model();
    // Why, in the sections' own titles; the pill beside it names the result.
    expect(overall.system).toEqual({
      result: "fail",
      summary: "Failed: Finished Goods Sampling Information (carton number). Warnings: Packing configuration, Weight (g).",
    });
    expect(overall.inspector).toEqual({
      name: "Inspector A",
      finalResult: "hold",
      remark: "Weight below the indicative value; waiting for the spec sheet.",
      comment: null,
    });
    expect(overall.ai.findings.map((finding) => finding.id)).toEqual(["F4"]);
    expect(overall.ai.questions.map((question) => question.id)).toEqual(["Q1", "Q2"]);
  });

  it("lists the sections with something to compare in template order, the rest as quiet", () => {
    const panel = model();
    expect(panel.sections.map((section) => [section.key, section.kind])).toEqual([
      ["glove_type", "custom"],
      ["glove_info", "module"],
      ["packing_config", "module"],
      ["carton_sampling", "module"],
      ["dimensions", "excluded"],
      ["weight", "module"],
      ["tensile", "other"],
    ]);
    expect(panel.quiet).toEqual([
      { key: "header", title: "Manufacturer Information", status: "info" },
      { key: "order_lots", title: "Order", status: "info" },
      { key: "sampling_plan", title: "Sampling Plan", status: "info" },
      { key: "visual", title: "Visual Inspection", status: "pass" },
    ]);
  });

  it("shows each section's computed result, issues, the inspector's comment and the AI's findings and questions", () => {
    const sections = new Map(model().sections.map((section) => [section.key, section]));
    expect(sections.get("weight")).toMatchObject({
      title: "Weight (g)",
      system: { status: "warn", warnings: expect.arrayContaining([expect.stringContaining("indicative")]) },
      inspector: { comment: "Weighed on the factory scale." },
    });
    expect(sections.get("weight")?.ai.findings.map((finding) => finding.id)).toEqual(["F1"]);
    expect(sections.get("weight")?.ai.questions.map((question) => question.id)).toEqual(["Q3"]);
    expect(sections.get("carton_sampling")?.system).toMatchObject({
      status: "fail",
      errors: [expect.stringContaining("578")],
    });
    expect(sections.get("dimensions")?.system).toMatchObject({
      status: null,
      excludedReason: "Calipers out for calibration.",
    });
    expect(sections.get("glove_info")?.inspector.comment).toBe("Indicative weight from the glove spec sheet.");
    expect(sections.get("glove_type")?.ai.findings.map((finding) => finding.id)).toEqual(["F3"]);
  });

  it("leaves the AI column empty when there is no finished review", () => {
    const panel = model({ reviews: [] });
    expect(panel.sections.every((section) => section.ai.findings.length === 0 && section.ai.questions.length === 0)).toBe(true);
    expect(panel.sections.some((section) => section.kind === "other")).toBe(false);
  });
});

describe("buildAiPanelModel: who may do what", () => {
  it("lets an admin request a second opinion of a submitted inspection when a reviewer is connected", () => {
    expect(model().review).toMatchObject({ connected: true, canRequest: true, blockedReason: null, mock: true });
    expect(model({ aiStatus: OFF_STATUS }).review).toMatchObject({
      connected: false,
      canRequest: false,
      label: "Steri-AI Second Opinion Not Connected",
    });
  });

  it("gives inspectors the opinions to read and nothing to do", () => {
    const panel = model({ isAdmin: false, decisions: [] });
    expect(panel.viewer.isAdmin).toBe(false);
    expect(panel.review.canRequest).toBe(false);
    expect(panel.current?.findings.length).toBeGreaterThan(0);
  });

  // Roles and permissions (migration 20261027150000): an admin-level role does only what its switches allow.
  it("follows the role's switches: Steri-AI Second Opinion asks and decides", () => {
    const none = model({ allows: { secondOpinion: false } });
    expect(none.viewer).toMatchObject({ isAdmin: true, canDecide: false });
    expect(none.review.canRequest).toBe(false);
    // The decisions others made are still read.
    expect(none.current?.findings.some((finding) => finding.decision !== null)).toBe(true);

    const both = model({ allows: { secondOpinion: true } });
    expect(both.viewer.canDecide).toBe(true);
    expect(both.review.canRequest).toBe(true);
  });

  it("keeps drafts out of the second opinion, and says why", () => {
    const draft = { ...record, status: "draft" as const };
    expect(model({ record: draft }).review).toMatchObject({ canRequest: false, blockedReason: NOT_REVIEWABLE });
  });

  it("names the variable to fix to admins only", () => {
    const misconfigured = {
      ...OFF_STATUS,
      review: {
        connected: false,
        provider: "misconfigured" as const,
        label: "Steri-AI Second Opinion Not Connected: Configuration Error",
        detail: "AI_REVIEW_PROVIDER is claude but ANTHROPIC_API_KEY is not set.",
      },
    };
    expect(model({ aiStatus: misconfigured }).review.detail).toContain("ANTHROPIC_API_KEY");
    expect(model({ aiStatus: misconfigured, isAdmin: false }).review.detail).toBeNull();
  });

  // No Steri-AI Report (Kenneth, 27 October 2026: "we already have Client Report"): no link to send or open.
  it("names the inspection and its save, with no report hand-off", () => {
    const panel = model();
    expect(panel.inspection).toEqual({
      id: IDS.inspection,
      refNo: record.refNo,
      status: record.status,
      updatedAt: record.updatedAt,
      savedAt: "5 Oct 2026, 17:30",
    });
    expect(panel).not.toHaveProperty("report");
  });
});
