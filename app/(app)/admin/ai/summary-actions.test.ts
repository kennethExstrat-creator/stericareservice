// The Inspection Summary card's Server Actions (12 October 2026), public
// endpoints: an active admin only, checked before anything is read, saved
// or sent to Claude; the save through the real settings code, with the
// service-role client faked; Try It with Claude (writeSummary) mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({ upserts: [] as Record<string, unknown>[], rpc: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminClientConfigured: () => true,
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: async (values: Record<string, unknown>) => {
        admin.upserts.push(values);
        return { error: null };
      },
    }),
    rpc: admin.rpc,
  }),
}));
vi.mock("@/lib/ai/summary-writer", () => ({ writeSummary: vi.fn() }));
vi.mock("@/lib/ai/usage", () => ({ recordAiUsageLater: vi.fn() }));

import { revalidatePath } from "next/cache";
import { writeSummary } from "@/lib/ai/summary-writer";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction } from "@/lib/auth/session";
import { createFakeSupabase, type FakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { STD_EG_IDS, stdEgRecord, stdEgTables } from "@/lib/export/__fixtures__/std-eg";
import { DEFAULT_SUMMARY_STYLE } from "@/lib/schemas/summary-style";
import { createClient } from "@/lib/supabase/server";
import { previewSummaryAction, saveSummarySettingsAction } from "./summary-actions";

const ADMIN = { id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };
const NO_PERMISSION = { ok: false as const, error: "You do not have permission to do that." };
const DOC = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "The lot PASSED." }] }] };

let fake: FakeSupabase;

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-supabase-secret-key-0123456789");
  admin.upserts = [];
  admin.rpc.mockResolvedValue({ data: 1, error: null });
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN });
  fake = createFakeSupabase({ tables: stdEgTables(stdEgRecord()) });
  vi.mocked(createClient).mockResolvedValue(fake.client as never);
  vi.mocked(writeSummary).mockResolvedValue({
    ok: true,
    doc: DOC,
    text: "The lot PASSED.",
    notes: [],
    figures: ["3,100"],
    words: 3,
    model: "claude-opus-5-5",
    attempts: 1,
  });
  vi.mocked(recordAiUsageLater).mockImplementation(() => vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("the admin check", () => {
  it("refuses anyone but an active admin before saving or calling Claude", async () => {
    vi.mocked(authorizeAction).mockResolvedValue(NO_PERMISSION);
    expect(await saveSummarySettingsAction({ model: "claude-opus-5-5", style: {} })).toEqual({ ok: false, message: NO_PERMISSION.error });
    expect(await previewSummaryAction({ inspectionId: STD_EG_IDS.inspection, model: "claude-opus-5-5", style: {} })).toEqual({
      ok: false,
      reason: "forbidden",
      message: NO_PERMISSION.error,
    });
    expect(admin.upserts).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
    expect(writeSummary).not.toHaveBeenCalled();
    expect(recordAiUsageLater).not.toHaveBeenCalled();
    expect(vi.mocked(authorizeAction).mock.calls.every(([need]) => JSON.stringify(need) === JSON.stringify({ permission: "ai_settings" }))).toBe(true);
  });
});

describe("saveSummarySettingsAction", () => {
  it("stores the app's own style as null and the model as chosen, then refreshes the page", async () => {
    expect(await saveSummarySettingsAction({ model: "claude-sonnet-5-5", style: {} })).toEqual({
      ok: true,
      message: "Summary settings saved. The next summary uses them.",
    });
    expect(admin.upserts).toEqual([{ id: true, summary_model: "claude-sonnet-5-5", summary_style: null, updated_by: ADMIN.id }]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/admin/ai"]]);
  });

  it("stores a changed style whole, normalised", async () => {
    await saveSummarySettingsAction({
      model: "claude-opus-5-5",
      style: { length: "brief", language: "ms", languagesOffered: ["en-GB"], closingSentence: " As sampled. " },
    });
    expect(admin.upserts).toEqual([
      {
        id: true,
        summary_model: "claude-opus-5-5",
        summary_style: { ...DEFAULT_SUMMARY_STYLE, length: "brief", language: "ms", languagesOffered: ["en-GB", "ms"], closingSentence: "As sampled." },
        updated_by: ADMIN.id,
      },
    ]);
  });

  it("answers each refused field under its path, saving nothing", async () => {
    const answer = await saveSummarySettingsAction({
      model: "gpt-5",
      style: { tone: "loud", closingSentence: "x".repeat(301), examples: ["a", "b", "c"] },
    });
    expect(answer).toEqual({
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: {
        model: "Enter a Claude model id, for example claude-opus-5-5.",
        "style.tone": "Choose a tone.",
        "style.closingSentence": "Keep a sentence to 300 characters.",
        "style.examples": "Add up to 2 examples.",
      },
    });
    expect(admin.upserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("previewSummaryAction", () => {
  const input = { inspectionId: STD_EG_IDS.inspection, model: "claude-opus-5-5", style: { length: "brief", tone: "formal" } };

  it("writes one sample with the card's unsaved model and style, on a submitted inspection too", async () => {
    expect(await previewSummaryAction(input)).toEqual({
      ok: true,
      doc: DOC,
      text: "The lot PASSED.",
      notes: [],
      figures: ["3,100"],
      words: 3,
      model: "claude-opus-5-5",
    });
    const [written, env] = vi.mocked(writeSummary).mock.calls[0];
    expect(env.AI_SUMMARY_MODEL).toBe("claude-opus-5-5");
    expect(written).toMatchObject({ mode: "write", note: "", finalResult: "pass", style: { length: "brief", tone: "formal" } });
    expect(written.view.status).toBe("submitted");
  });

  it("records the call as inspection_summary in the admin's name, and writes no audit row", async () => {
    await previewSummaryAction(input);
    expect(vi.mocked(recordAiUsageLater).mock.calls).toEqual([
      [{ feature: "inspection_summary", inspectionId: STD_EG_IDS.inspection, actorId: ADMIN.id, itemCount: 1 }],
      [{ feature: "inspection_summary", inspectionId: STD_EG_IDS.inspection, actorId: ADMIN.id, itemCount: 0 }],
    ]);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.queries.filter((query) => query.operation !== "select")).toEqual([]);
    expect(admin.upserts).toEqual([]);
  });

  it("refuses settings that do not read, and an inspection the admin cannot read", async () => {
    expect(await previewSummaryAction({ ...input, model: "gpt-5" })).toEqual({
      ok: false,
      reason: "error",
      message: "Check the settings above: Try It uses them as they are on the card.",
    });
    fake.tables.inspections = [];
    expect(await previewSummaryAction(input)).toEqual({ ok: false, reason: "forbidden", message: "This inspection is not available." });
    expect(writeSummary).not.toHaveBeenCalled();
  });

  it("needs a conclusion, as the inspector's button does", async () => {
    const record = stdEgRecord({ result: null });
    const data = structuredClone(record.data) as { modules: Record<string, Record<string, unknown>> };
    data.modules.conclusion = { ...data.modules.conclusion, finalResult: null };
    fake = createFakeSupabase({ tables: stdEgTables({ ...record, data }) });
    vi.mocked(createClient).mockResolvedValue(fake.client as never);
    expect(await previewSummaryAction(input)).toEqual({
      ok: false,
      reason: "needs_result",
      message: "Choose PASSED, FAILED or HOLD first: the summary starts with the conclusion.",
    });
    expect(writeSummary).not.toHaveBeenCalled();
  });
});
