import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// The framework's test modules, so the results do not move when the real modules land.
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import { makeAiReview } from "@/lib/ai/__fixtures__/ai-review";
import { createFakeSupabase, type FakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS, makeObjects, makeTables, PATHS, UPDATED_AT } from "@/lib/export/__fixtures__/inspection";
import { createClient } from "@/lib/supabase/server";
import { loadAiPanel, PANEL_LINK_TTL_SECONDS } from "./panel";

const ADMIN = { id: IDS.admin, role: "admin" } as const;
const INSPECTOR = { id: IDS.inspector, role: "inspector" } as const;
const REVIEW_ID = "99999999-9999-4999-8999-000000000001";
const NOW = Date.parse("2026-10-06T02:00:00Z");

/** A finished review of the current version whose finding cites the weight photo, with decisions embedded as PostgREST returns them. */
function reviewRow() {
  const review = makeAiReview();
  const findings = review.findings.map((finding) => ({
    ...finding,
    evidence: { ...finding.evidence, photos: [IDS.photoWeight] },
  }));
  return {
    id: REVIEW_ID,
    inspection_id: IDS.inspection,
    inspection_updated_at: UPDATED_AT,
    status: "done",
    model: "mock",
    suggested_result: review.suggestedResult,
    confidence: review.confidence,
    summary: review.summary,
    findings,
    questions: review.questions,
    created_at: "2026-10-06T01:00:00+00:00",
    updated_at: "2026-10-06T01:00:05+00:00",
    decisions: [
      {
        finding_id: findings[0].id,
        action: "disagree",
        note: "The sheet gives the weight for size L.",
        at: "2026-10-06T01:20:00+00:00",
        actor: { full_name: "Admin A", email: "admin@test.local" },
      },
      // A value the database would never hold is left out, not shown.
      { finding_id: findings[0].id, action: "ignore", note: null, at: "2026-10-06T01:25:00+00:00", actor: null },
    ],
  };
}

function fake(options: Parameters<typeof createFakeSupabase>[0] = {}): FakeSupabase {
  return createFakeSupabase({ tables: { ...makeTables(), ai_reviews: [reviewRow()] }, objects: makeObjects(), ...options });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AI_REVIEW_PROVIDER", "mock");
  vi.stubEnv("AI_REPORT_WEBHOOK_URL", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(createClient).mockReset();
});

describe("loadAiPanel", () => {
  it("gives an admin the reviews with the decisions on their findings, and an hour's links to the photos they cite", async () => {
    const db = fake();
    const loaded = await loadAiPanel(ADMIN, IDS.inspection, { client: db.client, now: NOW });
    if (!loaded.ok) throw new Error(loaded.message);
    const { model } = loaded;

    expect(model.viewer.isAdmin).toBe(true);
    expect(model.review).toMatchObject({ connected: true, mock: true, canRequest: true });
    expect(model.current).toMatchObject({ id: REVIEW_ID, state: "done", isCurrentVersion: true });
    const [finding] = model.current?.findings ?? [];
    expect(finding.decision).toMatchObject({ action: "disagree", actor: "Admin A", note: "The sheet gives the weight for size L." });
    expect(finding.history).toEqual([]);
    expect(finding.evidence.photos).toEqual([
      expect.objectContaining({
        id: IDS.photoWeight,
        state: "ok",
        url: expect.stringContaining(PATHS.photoWeight),
        thumbUrl: expect.stringContaining(PATHS.thumbWeight),
      }),
    ]);

    // Only the cited photo is signed, original and thumbnail, for an hour.
    expect(db.signed).toEqual([
      { bucket: "inspection-photos", paths: [PATHS.photoWeight, PATHS.thumbWeight], expiresIn: PANEL_LINK_TTL_SECONDS },
    ]);
    expect(PANEL_LINK_TTL_SECONDS).toBe(3600);
    // Reading the panel writes nothing.
    expect(db.queries.filter((query) => query.operation !== "select")).toEqual([]);
  });

  it("shows the inspector their own inspection's reviews without decisions", async () => {
    const loaded = await loadAiPanel(INSPECTOR, IDS.inspection, { client: fake().client, now: NOW });
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.model.viewer.isAdmin).toBe(false);
    expect(loaded.model.review.canRequest).toBe(false);
    expect(loaded.model.current?.findings[0].decision).toBeNull();
  });

  it("answers not found for someone else's inspection, an unknown id or one that is not a UUID", async () => {
    const other = { id: IDS.otherInspector, role: "inspector" } as const;
    expect(await loadAiPanel(other, IDS.inspection, { client: fake().client, now: NOW })).toEqual({
      ok: false,
      reason: "not_found",
      message: "Inspection not found.",
    });
    expect(await loadAiPanel(ADMIN, IDS.otherInspector, { client: fake().client, now: NOW })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    const db = fake();
    expect(await loadAiPanel(ADMIN, "1 or 1=1", { client: db.client, now: NOW })).toMatchObject({ ok: false, reason: "not_found" });
    expect(db.queries).toEqual([]);
  });

  it("says when the reviews cannot be read, without the database's details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fake({ failQuery: (query) => (query.table === "ai_reviews" ? { code: "XX000", message: "secret detail" } : null) });
    expect(await loadAiPanel(ADMIN, IDS.inspection, { client: db.client, now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
      message: "Could not read the AI reviews. Try again.",
    });
  });

  it("still shows the opinions when the photo links cannot be made", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const loaded = await loadAiPanel(ADMIN, IDS.inspection, { client: fake({ failSigning: () => true }).client, now: NOW });
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.model.current?.findings[0].evidence.photos).toEqual([
      expect.objectContaining({ id: IDS.photoWeight, state: "ok", thumbUrl: null, url: null }),
    ]);
  });

  it("reads as the signed-in user when no client is given", async () => {
    const db = fake();
    vi.mocked(createClient).mockResolvedValue(db.client as Awaited<ReturnType<typeof createClient>>);
    expect((await loadAiPanel(ADMIN, IDS.inspection, { now: NOW })).ok).toBe(true);
    expect(createClient).toHaveBeenCalledOnce();
  });
});
