import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn(() => false) }));
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import { refresh } from "next/cache";
import { after } from "next/server";
import { makeAiReview } from "@/lib/ai/__fixtures__/ai-review";
import { authorizeAction } from "@/lib/auth/session";
import { createFakeSupabase, type FakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS, makeObjects, makeTables } from "@/lib/export/__fixtures__/inspection";
import { createClient } from "@/lib/supabase/server";
import { getAiReviewProgress, recordAiFindingDecision, requestAiSecondOpinion, sendToAiReport } from "./actions";
import { AI_ACTION_IDLE } from "./types";

const ADMIN_USER = { id: IDS.admin, email: "admin@test.local", fullName: "Admin A", role: "admin" as const };
const REVIEW_ID = "99999999-9999-4999-8999-000000000001";

let db: FakeSupabase;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AI_REVIEW_PROVIDER", "mock");
  vi.stubEnv("AI_REPORT_WEBHOOK_URL", "");
  db = createFakeSupabase({ tables: makeTables(), objects: makeObjects() });
  vi.mocked(createClient).mockResolvedValue(db.client as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN_USER });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(refresh).mockReset();
  vi.mocked(after).mockReset();
  vi.mocked(authorizeAction).mockReset();
});

describe("requestAiSecondOpinion", () => {
  it("is admin work", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    const result = await requestAiSecondOpinion(AI_ACTION_IDLE, form({ inspectionId: IDS.inspection }));
    expect(result).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith("admin");
    expect(db.queries).toEqual([]);
  });

  it("checks the inspection id", async () => {
    const result = await requestAiSecondOpinion(AI_ACTION_IDLE, form({ inspectionId: "1 or 1=1" }));
    expect(result).toEqual({ status: "error", message: "That inspection could not be found. Reload the page." });
    expect(db.queries).toEqual([]);
  });

  it("starts the review, refreshes the page and says it may take a few minutes", async () => {
    const result = await requestAiSecondOpinion(AI_ACTION_IDLE, form({ inspectionId: IDS.inspection }));
    expect(result).toEqual({
      status: "success",
      message: "Second opinion requested. It can take a few minutes; this panel updates when it is ready.",
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(db.tables.ai_reviews).toEqual([expect.objectContaining({ status: "pending" })]);
  });

  it("turns an unexpected failure into a message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createClient).mockRejectedValue(new Error("cookies unavailable"));
    expect(await requestAiSecondOpinion(AI_ACTION_IDLE, form({ inspectionId: IDS.inspection }))).toEqual({
      status: "error",
      message: "Something went wrong. Try again.",
    });
  });
});

describe("recordAiFindingDecision", () => {
  beforeEach(() => {
    const review = makeAiReview();
    db.tables.ai_reviews = [
      {
        id: REVIEW_ID,
        inspection_id: IDS.inspection,
        inspection_updated_at: "2026-10-05T09:30:00.654321+00:00",
        status: "done",
        findings: review.findings,
        questions: review.questions,
        created_at: "2026-10-06T01:00:00Z",
        updated_at: "2026-10-06T01:00:00Z",
      },
    ];
  });

  it("records a decision and refreshes the panel", async () => {
    const result = await recordAiFindingDecision(
      AI_ACTION_IDLE,
      form({ reviewId: REVIEW_ID, findingId: "F1", action: "fixed", note: "" }),
    );
    expect(result).toEqual({ status: "success", message: "Recorded: finding F1 is fixed." });
    expect(refresh).toHaveBeenCalledOnce();
    expect(authorizeAction).toHaveBeenCalledWith("admin");
  });

  it("returns the note error next to the field", async () => {
    const result = await recordAiFindingDecision(
      AI_ACTION_IDLE,
      form({ reviewId: REVIEW_ID, findingId: "F1", action: "disagree", note: " " }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Add a note explaining why you disagree.",
      fieldErrors: { note: "Add a note explaining why you disagree." },
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("sendToAiReport", () => {
  it("offers the JSON download when no report service is connected", async () => {
    expect(await sendToAiReport(AI_ACTION_IDLE, form({ inspectionId: IDS.inspection }))).toEqual({
      status: "not_connected",
      message: "AI not connected.",
      downloadHref: `/api/inspections/${IDS.inspection}/export`,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is admin work", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await sendToAiReport(AI_ACTION_IDLE, form({ inspectionId: IDS.inspection }))).toEqual({
      status: "error",
      message: "Your session has ended. Sign in again.",
    });
  });
});

describe("getAiReviewProgress", () => {
  it("lists the reviews still being written", async () => {
    db.tables.ai_reviews = [
      {
        id: REVIEW_ID,
        inspection_id: IDS.inspection,
        inspection_updated_at: "2026-10-05T09:30:00.654321+00:00",
        status: "pending",
        findings: [],
        questions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    expect(await getAiReviewProgress(IDS.inspection)).toEqual({ ok: true, pending: [REVIEW_ID] });
    expect(authorizeAction).toHaveBeenCalledWith();
  });

  it("tells nothing to a caller who is not signed in, or about a bad id", async () => {
    expect(await getAiReviewProgress("not-an-id")).toEqual({ ok: false });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await getAiReviewProgress(IDS.inspection)).toEqual({ ok: false });
  });
});
