import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn(() => false) }));
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import { after } from "next/server";
import { mockReview } from "@/lib/ai/providers/mock";
import { createFakeSupabase, type FakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS, makeInspectionRow, makeObjects, makeTables, UPDATED_AT } from "@/lib/export/__fixtures__/inspection";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { ALREADY_PENDING, NOT_REVIEWABLE } from "./panel-model";
import { completeAiReview, scheduleAiReviewOnSubmit, startAiReview } from "./review-runner";
import { STALE_REVIEW_MS, STOPPED_MESSAGE } from "./stored";

const ADMIN = { id: IDS.admin, role: "admin" } as const;
const NOW = Date.parse("2026-10-06T02:00:00Z");

/** Callbacks handed to after(), run by the test as Next.js would once the response is sent. */
let scheduled: (() => unknown)[] = [];

function fake(tables = makeTables()): FakeSupabase {
  return createFakeSupabase({ tables, objects: makeObjects(), now: () => new Date(NOW).toISOString() });
}

async function runScheduled() {
  const callbacks = scheduled;
  scheduled = [];
  for (const callback of callbacks) await callback();
}

function reviews(db: FakeSupabase) {
  return db.tables.ai_reviews ?? [];
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AI_REVIEW_PROVIDER", "mock");
  vi.stubEnv("AI_REVIEW_WEBHOOK_URL", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.mocked(after).mockImplementation((task) => {
    scheduled.push(typeof task === "function" ? task : () => task);
  });
  vi.mocked(isAdminClientConfigured).mockReturnValue(false);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  scheduled = [];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("startAiReview", () => {
  it("stores a pending review of the current version, logs the request and writes the opinion in the background", async () => {
    const db = fake();
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(started).toEqual({ ok: true, reviewId: expect.any(String), inspectionUpdatedAt: UPDATED_AT });
    if (!started.ok) return;

    expect(reviews(db)).toEqual([
      expect.objectContaining({
        id: started.reviewId,
        inspection_id: IDS.inspection,
        inspection_updated_at: UPDATED_AT,
        status: "pending",
        model: "mock",
      }),
    ]);
    expect(db.rpcCalls[0]).toEqual({
      name: "log_inspection_event",
      args: {
        inspection_id: IDS.inspection,
        action: "ai_review.requested",
        changes: { reviewId: started.reviewId, trigger: "admin", provider: "mock", inspectionUpdatedAt: UPDATED_AT },
      },
    });
    expect(scheduled).toHaveLength(1);

    await runScheduled();
    const [stored] = reviews(db);
    expect(stored).toMatchObject({ status: "done", model: "mock", suggested_result: "fail" });
    expect(Array.isArray(stored.findings) && stored.findings.length).toBeGreaterThan(0);
    expect(db.rpcCalls.at(-1)).toMatchObject({ args: { action: "ai_review.done", changes: { reviewId: started.reviewId, provider: "mock" } } });
    // The AI never changes the inspection.
    expect(db.queries.filter((query) => query.table === "inspections" && query.operation !== "select")).toEqual([]);
  });

  it("says when no reviewer is connected, before reading anything", async () => {
    vi.stubEnv("AI_REVIEW_PROVIDER", "off");
    const db = fake();
    expect(await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN })).toEqual({
      ok: false,
      reason: "not_connected",
      message: "AI second opinion not connected.",
    });
    expect(db.queries).toEqual([]);
  });

  it("reviews submitted and approved inspections only", async () => {
    const db = fake({ ...makeTables(), inspections: [makeInspectionRow({ status: "draft" })] });
    expect(await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN })).toEqual({
      ok: false,
      reason: "not_reviewable",
      message: NOT_REVIEWABLE,
    });
    const approved = fake({ ...makeTables(), inspections: [makeInspectionRow({ status: "approved" })] });
    expect((await startAiReview({ client: approved.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN })).ok).toBe(true);
  });

  it("does not start a second review of the same version while one is being written", async () => {
    const db = fake();
    await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    const again = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(again).toEqual({ ok: false, reason: "pending", message: `${ALREADY_PENDING} It appears here when it is ready.` });
    expect(reviews(db)).toHaveLength(1);
  });

  it("records a review that never got an answer as stopped, then starts a new one", async () => {
    const db = fake({
      ...makeTables(),
      ai_reviews: [
        {
          id: "99999999-9999-4999-8999-0000000000aa",
          inspection_id: IDS.inspection,
          inspection_updated_at: UPDATED_AT,
          status: "pending",
          model: "mock",
          suggested_result: null,
          confidence: null,
          summary: null,
          findings: [],
          questions: [],
          created_at: new Date(NOW - STALE_REVIEW_MS - 1).toISOString(),
          updated_at: new Date(NOW - STALE_REVIEW_MS - 1).toISOString(),
        },
      ],
    });
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(started.ok).toBe(true);
    expect(reviews(db).map((review) => [review.status, review.summary])).toEqual([
      ["failed", STOPPED_MESSAGE],
      ["pending", undefined],
    ]);
  });

  it("answers not found to someone who may not export the inspection", async () => {
    const db = fake();
    const result = await startAiReview({
      client: db.client,
      inspectionId: IDS.inspection,
      trigger: "admin",
      viewer: { id: IDS.otherInspector, role: "inspector" },
    });
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(reviews(db)).toEqual([]);
  });

  it("stores the opinion with the service role when the server has the secret key", async () => {
    const db = fake();
    const writer = fake({ ai_reviews: [] });
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue(writer.client as ReturnType<typeof createAdminClient>);
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    if (!started.ok) throw new Error(started.message);
    await runScheduled();
    expect(writer.queries).toEqual([
      expect.objectContaining({
        table: "ai_reviews",
        operation: "update",
        filters: [
          { column: "id", op: "eq", value: started.reviewId },
          { column: "status", op: "eq", value: "pending" },
        ],
      }),
    ]);
  });
});

describe("completeAiReview", () => {
  async function pendingReview() {
    const db = fake();
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    if (!started.ok) throw new Error(started.message);
    scheduled = [];
    return { db, reviewId: started.reviewId };
  }

  function exportDoc(): InspectionExport {
    return ExportSchema.parse(JSON.parse(JSON.stringify({ ...minimalExport() })));
  }

  it("stores a failure with its reason, so the panel can say why", async () => {
    const { db, reviewId } = await pendingReview();
    const outcome = await completeAiReview({
      reviewId,
      inspectionId: IDS.inspection,
      exportDoc: exportDoc(),
      writer: db.client,
      review: async () => ({ ok: false, reason: "timeout", message: "The webhook did not answer in time.", provider: "webhook" }),
    });
    expect(outcome).toBe("failed");
    expect(reviews(db)[0]).toMatchObject({ status: "failed", summary: "The webhook did not answer in time.", model: "webhook" });
    expect(db.rpcCalls.at(-1)).toMatchObject({ args: { action: "ai_review.failed", changes: { reason: "timeout" } } });
  });

  it("treats a reviewer that throws as a failure, never as a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, reviewId } = await pendingReview();
    const outcome = await completeAiReview({
      reviewId,
      inspectionId: IDS.inspection,
      exportDoc: exportDoc(),
      writer: db.client,
      review: async () => {
        throw new Error("boom");
      },
    });
    expect(outcome).toBe("failed");
    expect(reviews(db)[0]).toMatchObject({ status: "failed", summary: "Unexpected error while requesting the AI review." });
  });

  it("never overwrites a review that is no longer pending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, reviewId } = await pendingReview();
    reviews(db)[0].status = "failed";
    const doc = exportDoc();
    const outcome = await completeAiReview({
      reviewId,
      inspectionId: IDS.inspection,
      exportDoc: doc,
      writer: db.client,
      review: async (sent) => ({ ok: true, review: mockReview(sent), provider: "mock", model: null }),
    });
    expect(outcome).toBe("not_stored");
    expect(reviews(db)[0].status).toBe("failed");
  });
});

describe("scheduleAiReviewOnSubmit", () => {
  it("does nothing when no reviewer is connected", async () => {
    vi.stubEnv("AI_REVIEW_PROVIDER", "off");
    expect(await scheduleAiReviewOnSubmit(IDS.inspection)).toMatchObject({ ok: false, reason: "not_connected" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("needs the secret key, since inspectors cannot write reviews", async () => {
    expect(await scheduleAiReviewOnSubmit(IDS.inspection)).toMatchObject({
      ok: false,
      reason: "database_error",
      message: expect.stringContaining("SUPABASE_SECRET_KEY"),
    });
  });

  it("starts the review as the service role", async () => {
    const db = fake();
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue(db.client as ReturnType<typeof createAdminClient>);
    const started = await scheduleAiReviewOnSubmit(IDS.inspection);
    expect(started.ok).toBe(true);
    expect(db.rpcCalls[0]).toMatchObject({ args: { action: "ai_review.requested", changes: { trigger: "submit" } } });
    await runScheduled();
    expect(reviews(db)[0].status).toBe("done");
  });
});

/** The smallest valid export: what completeAiReview hands on is not its concern. */
function minimalExport(): InspectionExport {
  return {
    schemaVersion: "1",
    refNo: "INS-2026-0042",
    status: "submitted",
    timestamps: {
      createdAt: "2026-10-05T01:00:00+00:00",
      updatedAt: UPDATED_AT,
      submittedAt: UPDATED_AT,
      approvedAt: null,
      exportedAt: "2026-10-06T02:00:00.000Z",
    },
    inspector: { id: IDS.inspector, name: "Inspector A" },
    template: {
      code: "TEST_EG",
      version: 3,
      standard: "EN455",
      productType: "examination",
      client: null,
      manufacturer: null,
      reportTitle: "Report",
      clientLogoUrl: null,
      sourceFile: null,
    },
    modules: [],
    excludedModules: [],
    custom: [],
    photos: [],
    files: [],
    conclusion: { suggestedResult: "hold", finalResult: null, remark: null, inspector: null, date: null },
  };
}
