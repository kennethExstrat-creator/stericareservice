import { createFakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS, makeObjects, makeTables, UPDATED_AT } from "@/lib/export/__fixtures__/inspection";
import { evaluateRecord, type EvaluatedInspection } from "@/lib/export/evaluate";
import { loadInspectionRecord, type InspectionRecord } from "@/lib/export/record";
import type { AiStatus } from "@/lib/ai/status";
import type { AiFinding, AiQuestion } from "@/lib/schemas/ai-review";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import type { StoredDecision } from "../panel-model";
import type { StoredAiReview } from "../stored";

/* ------------------------------------------------------------------ *
 * The export fixture's inspection with stored reviews and decisions,
 * for the panel model and the panel's markup tests.
 * ------------------------------------------------------------------ */

export const REVIEW_IDS = {
  current: "99999999-9999-4999-8999-000000000001",
  older: "99999999-9999-4999-8999-000000000002",
  failed: "99999999-9999-4999-8999-000000000003",
  stale: "99999999-9999-4999-8999-000000000004",
  running: "99999999-9999-4999-8999-000000000005",
} as const;

export const UNKNOWN_PHOTO = "66666666-6666-4666-8666-0000000000ff";

/** 6 Oct 2026, 10:00 Malaysia time. */
export const NOW = Date.parse("2026-10-06T02:00:00Z");

export async function loadFixture(): Promise<{ record: InspectionRecord; evaluated: EvaluatedInspection }> {
  const fake = createFakeSupabase({ tables: makeTables(), objects: makeObjects() });
  const loaded = await loadInspectionRecord(fake.client, IDS.inspection);
  if (!loaded.ok) throw new Error(loaded.message);
  const evaluation = evaluateRecord(loaded.record, TEST_REGISTRY);
  if (!evaluation.ok) throw new Error(evaluation.message);
  return { record: loaded.record, evaluated: evaluation.evaluated };
}

export function findings(): AiFinding[] {
  return [
    {
      id: "F1",
      module: "weight",
      size: "M",
      severity: "major",
      message: "Average weight is 17% below the indicative weight. Check the spec sheet and the scale.",
      evidence: {
        values: [
          { label: "Average weight, size M", value: "2.9", unit: "g" },
          { label: "Indicative weight", value: "3.5", unit: "g" },
        ],
        boxes: [],
        photos: [IDS.photoWeight, UNKNOWN_PHOTO, IDS.photoHeic],
      },
    },
    {
      id: "F2",
      module: "carton_sampling",
      size: "M",
      severity: "critical",
      message: "Carton 578 is listed twice.",
      evidence: { values: [], boxes: ["578"], photos: [] },
    },
    {
      id: "F3",
      module: "glove_type",
      size: null,
      severity: "info",
      message: "Glove type is recorded as free text.",
      evidence: { values: [{ label: "Glove Type", value: "Nitrile, powder free", unit: null }], boxes: [], photos: [] },
    },
    {
      id: "F4",
      module: "conclusion",
      size: null,
      severity: "minor",
      message: "The final result is hold while a carton check failed.",
      evidence: { values: [], boxes: [], photos: [] },
    },
    {
      id: "F5",
      module: "tensile",
      size: "M",
      severity: "minor",
      message: "Tensile was in an earlier version of this inspection.",
      evidence: { values: [], boxes: [], photos: [] },
    },
  ];
}

export function questions(): AiQuestion[] {
  return [
    { id: "Q1", module: "conclusion", question: "Is the spec sheet on its way?" },
    { id: "Q2", module: null, question: "Was the whole lot on site?" },
    { id: "Q3", module: "weight", question: "Which scale was used?" },
  ];
}

export function storedReview(overrides: Partial<StoredAiReview> = {}): StoredAiReview {
  return {
    id: REVIEW_IDS.current,
    inspectionId: IDS.inspection,
    // The same instant as the inspection's updated_at, spelt the JavaScript way.
    inspectionUpdatedAt: "2026-10-05T09:30:00.654321Z",
    // Stored without a fingerprint, so compared by save; pass one to compare by content.
    inspectionFingerprint: null,
    status: "done",
    model: "mock",
    suggestedResult: "fail",
    confidence: 0.85,
    summary: "Mock second opinion (test data, no AI model). 4 of 9 modules need attention.",
    findings: findings(),
    questions: questions(),
    readable: true,
    createdAt: "2026-10-06T01:00:00Z",
    updatedAt: "2026-10-06T01:00:03Z",
    ...overrides,
  };
}

/** Newest first: a failed retry, the current review, a stale pending one and an older version's review. */
export function reviewHistory(): StoredAiReview[] {
  return [
    storedReview({
      id: REVIEW_IDS.failed,
      status: "failed",
      summary: "The webhook did not answer in time.",
      suggestedResult: null,
      confidence: null,
      findings: [],
      questions: [],
      model: "webhook",
      createdAt: "2026-10-06T01:30:00Z",
    }),
    storedReview(),
    storedReview({
      id: REVIEW_IDS.stale,
      status: "pending",
      summary: null,
      suggestedResult: null,
      confidence: null,
      findings: [],
      questions: [],
      createdAt: "2026-10-05T23:00:00Z",
    }),
    storedReview({
      id: REVIEW_IDS.older,
      inspectionUpdatedAt: "2026-10-05T08:00:00+00:00",
      suggestedResult: "hold",
      confidence: 0.6,
      findings: findings().slice(1, 2),
      questions: [],
      createdAt: "2026-10-05T08:05:00Z",
    }),
  ];
}

export function decisions(): StoredDecision[] {
  return [
    {
      reviewId: REVIEW_IDS.current,
      findingId: "F1",
      action: "agree",
      note: null,
      at: "2026-10-06T01:10:00Z",
      actor: "Admin A",
    },
    {
      reviewId: REVIEW_IDS.current,
      findingId: "F1",
      action: "disagree",
      note: "The indicative weight on the sheet is for size L.",
      at: "2026-10-06T01:20:00Z",
      actor: "Admin B",
    },
    {
      reviewId: REVIEW_IDS.older,
      findingId: "F2",
      action: "fixed",
      note: "Inspector corrected carton 578.",
      at: "2026-10-05T08:30:00Z",
      actor: "Admin A",
    },
  ];
}

export const MOCK_STATUS: AiStatus = {
  review: { connected: true, provider: "mock", label: "AI second opinion: mock reviewer (test data only)" },
  report: { connected: false, provider: "off", label: "AI not connected" },
};

export const OFF_STATUS: AiStatus = {
  review: { connected: false, provider: "off", label: "AI second opinion not connected" },
  report: { connected: false, provider: "off", label: "AI not connected" },
};

export const PHOTO_LINKS = {
  thumbs: new Map([[IDS.photoWeight, "https://storage.test/thumb-weight.jpg"]]),
  full: new Map([
    [IDS.photoWeight, "https://storage.test/weight.jpg"],
    [IDS.photoHeic, "https://storage.test/original.heic"],
  ]),
};

export { IDS, UPDATED_AT };
