import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn(() => false) }));
// The settings saved in Admin > AI Settings are not under test here: the variables apply.
vi.mock("@/lib/ai/settings", () => ({ loadAiEnv: async (env = process.env) => env }));
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import { after } from "next/server";
import { mockReview } from "@/lib/ai/providers/mock";
import { createFakeSupabase, type FakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS, makeInspectionRow, makeObjects, makeTables, UPDATED_AT } from "@/lib/export/__fixtures__/inspection";
import { loadInspectionRecord } from "@/lib/export/record";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { inspectionFingerprint } from "./fingerprint";
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

const LATER = "2026-10-06T01:30:00.000001+00:00";

function inspectionRow(db: FakeSupabase) {
  const row = db.tables.inspections?.[0];
  if (!row) throw new Error("no inspection row");
  return row;
}

/** The content fingerprint of the inspection as the fake database holds it now. */
async function currentFingerprint(db: FakeSupabase): Promise<string> {
  const loaded = await loadInspectionRecord(db.client, IDS.inspection);
  if (!loaded.ok) throw new Error(loaded.message);
  return inspectionFingerprint(loaded.record);
}

/** A pending review older than any reviewer may take: its server stopped before it answered. */
function staleReviewRow() {
  return {
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
  };
}

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
        inspection_fingerprint: await currentFingerprint(db),
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
      message: "Steri-AI second opinion not connected.",
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

  it("keeps to one review of the same content when the inspection was saved again (approved, a report link)", async () => {
    const db = fake();
    await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    Object.assign(inspectionRow(db), { status: "approved", updated_at: LATER, report_url: "https://reports.example.com/r.pdf" });
    const again = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(again).toEqual({ ok: false, reason: "pending", message: `${ALREADY_PENDING} It appears here when it is ready.` });
    expect(reviews(db)).toHaveLength(1);
  });

  it("starts a review of new content while one of the earlier content is still being written", async () => {
    const db = fake();
    await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    const before = await currentFingerprint(db);
    Object.assign(inspectionRow(db), { remarks: "Spec sheet received: weight confirmed.", updated_at: LATER });
    const again = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(again).toMatchObject({ ok: true, inspectionUpdatedAt: LATER });
    expect(reviews(db).map((review) => review.inspection_fingerprint)).toEqual([before, await currentFingerprint(db)]);
  });

  it("compares a pending review stored without a fingerprint by its save", async () => {
    const pending = { ...staleReviewRow(), created_at: new Date(NOW - 60_000).toISOString() };
    const same = fake({ ...makeTables(), ai_reviews: [pending] });
    expect(
      await startAiReview({ client: same.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW }),
    ).toMatchObject({ ok: false, reason: "pending" });
    const earlier = fake({ ...makeTables(), ai_reviews: [{ ...pending, inspection_updated_at: "2026-10-05T08:00:00+00:00" }] });
    expect(
      (await startAiReview({ client: earlier.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW })).ok,
    ).toBe(true);
  });

  it("stores the review without its fingerprint on a database that does not have the column yet", async () => {
    // PostgREST's answer to a column it does not know (migration 20261007113245 not applied).
    const db = createFakeSupabase({
      tables: makeTables(),
      objects: makeObjects(),
      now: () => new Date(NOW).toISOString(),
      failQuery: (query) =>
        query.table === "ai_reviews" && query.operation === "insert" && "inspection_fingerprint" in (query.payload as object)
          ? { code: "PGRST204", message: "Could not find the 'inspection_fingerprint' column of 'ai_reviews' in the schema cache" }
          : null,
    });
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(started.ok).toBe(true);
    expect(reviews(db)).toEqual([expect.objectContaining({ inspection_updated_at: UPDATED_AT, status: "pending" })]);
    expect(reviews(db)[0]).not.toHaveProperty("inspection_fingerprint");
    expect(scheduled).toHaveLength(1);
  });

  it("answers that one is being written when the database refuses a second pending review (two requests at once)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The other request inserted its pending row between this one's check and its insert;
    // the unique index ai_reviews_one_pending_per_version refuses this one.
    const db = createFakeSupabase({
      tables: makeTables(),
      objects: makeObjects(),
      now: () => new Date(NOW).toISOString(),
      failQuery: (query) =>
        query.table === "ai_reviews" && query.operation === "insert"
          ? { code: "23505", message: 'duplicate key value violates unique constraint "ai_reviews_one_pending_per_version"' }
          : null,
    });
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(started).toEqual({ ok: false, reason: "pending", message: `${ALREADY_PENDING} It appears here when it is ready.` });
    // Nothing is sent to the reviewer, and no request is logged.
    expect(scheduled).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("records a review that never got an answer as stopped, then starts a new one", async () => {
    const db = fake({ ...makeTables(), ai_reviews: [staleReviewRow()] });
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(started.ok).toBe(true);
    expect(reviews(db).map((review) => [review.status, review.summary])).toEqual([
      ["failed", STOPPED_MESSAGE],
      ["pending", undefined],
    ]);
  });

  it("starts no review when a review that got no answer cannot be closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createFakeSupabase({
      tables: { ...makeTables(), ai_reviews: [staleReviewRow()] },
      objects: makeObjects(),
      now: () => new Date(NOW).toISOString(),
      failQuery: (query) =>
        query.table === "ai_reviews" && query.operation === "update" ? { code: "57014", message: "canceling statement" } : null,
    });
    const started = await startAiReview({ client: db.client, inspectionId: IDS.inspection, trigger: "admin", viewer: ADMIN, now: () => NOW });
    expect(started).toEqual({
      ok: false,
      reason: "database_error",
      message: "Could not close a review that stopped. Try again.",
    });
    expect(reviews(db).map((review) => review.status)).toEqual(["pending"]);
    expect(scheduled).toEqual([]);
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
    expect(reviews(db)[0]).toMatchObject({ status: "failed", summary: "Unexpected error while requesting Steri-AI's review." });
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
