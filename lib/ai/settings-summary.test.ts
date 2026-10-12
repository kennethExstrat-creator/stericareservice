// The Steri-AI Summary's settings (migration 20261013130000, 12 October
// 2026): its own model over AI_SUMMARY_MODEL, the house style (null for the
// app's own), what the card shows, and its save. The row is a fake admin client.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SUMMARY_STYLE, SummaryStyleSchema } from "@/lib/schemas/summary-style";
import type { Database } from "@/lib/supabase/database.types";

type Row = Database["public"]["Tables"]["ai_settings"]["Row"];

const db = vi.hoisted(() => ({
  configured: true,
  row: null as Record<string, unknown> | null,
  upserts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminClientConfigured: () => db.configured,
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "ai_settings" ? db.row : { full_name: "Kenneth", email: "admin@test.local" },
            error: null,
          }),
        }),
      }),
      upsert: async (values: Record<string, unknown>) => {
        db.upserts.push(values);
        return { error: null };
      },
    }),
  }),
}));

import { sealSecret } from "./secret-box";
import { loadSummaryMenu, loadSummarySetup, readSummarySettingsView, saveSummarySettings } from "./settings";

const SECRET = "test-supabase-secret-key-0123456789";
const SAVED_KEY = "sk-ant-api03-saved-0123456789abcdef";

function row(values: Partial<Row>): Row {
  return {
    id: true,
    anthropic_api_key_encrypted: null,
    anthropic_api_key_hint: null,
    document_model: null,
    review_model: null,
    review_effort: null,
    review_max_photos: null,
    prices: null,
    glossary: null,
    summary_model: null,
    summary_style: null,
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T06:05:00Z",
    updated_by: null,
    ...values,
  };
}

const BRIEF = SummaryStyleSchema.parse({ length: "brief", tone: "formal", languagesOffered: ["en-GB", "ms"] });

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
  db.configured = true;
  db.row = null;
  db.upserts = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("loadSummarySetup", () => {
  it("uses the variables and the app's style while nothing is saved", async () => {
    const setup = await loadSummarySetup({ ANTHROPIC_API_KEY: "sk-ant-env-0123456789abcdef", AI_SUMMARY_MODEL: "claude-haiku-5-5" });
    expect(setup.env).toMatchObject({ ANTHROPIC_API_KEY: "sk-ant-env-0123456789abcdef", AI_SUMMARY_MODEL: "claude-haiku-5-5" });
    expect(setup.style).toEqual(DEFAULT_SUMMARY_STYLE);
  });

  it("lays the saved key and summary model over the variables, and reads the house style", async () => {
    db.row = row({
      anthropic_api_key_encrypted: sealSecret(SAVED_KEY, SECRET),
      anthropic_api_key_hint: "cdef",
      summary_model: "claude-opus-5-5",
      summary_style: { length: "brief", tone: "formal", languagesOffered: ["ms"] },
    });
    const setup = await loadSummarySetup({ SUPABASE_SECRET_KEY: SECRET, AI_SUMMARY_MODEL: "claude-haiku-5-5" });
    expect(setup.env).toMatchObject({ ANTHROPIC_API_KEY: SAVED_KEY, AI_SUMMARY_MODEL: "claude-opus-5-5" });
    expect(setup.style).toEqual(BRIEF);
  });

  it("falls back to the app's style, and says so, when the saved one cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.row = row({ summary_style: { length: "endless" } });
    expect((await loadSummarySetup({})).style).toEqual(DEFAULT_SUMMARY_STYLE);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("summary style could not be read"), expect.any(String));
  });
});

describe("loadSummaryMenu", () => {
  it("offers the house style's choices", async () => {
    db.row = row({ summary_style: { length: "brief", tone: "formal", languagesOffered: ["en-GB", "ms"] } });
    expect(await loadSummaryMenu()).toEqual({
      length: "brief",
      paragraphs: "auto",
      format: "paragraphs",
      language: "en-GB",
      languagesOffered: ["en-GB", "ms"],
      inspectorsCanAdjust: true,
    });
  });
});

describe("readSummarySettingsView", () => {
  it("shows the saved model and style, and who saved them when", async () => {
    db.row = row({ summary_model: "claude-opus-5-5", summary_style: BRIEF, updated_by: "admin-id" });
    expect(await readSummarySettingsView({ AI_SUMMARY_MODEL: "claude-haiku-5-5" })).toEqual({
      model: "claude-opus-5-5",
      style: BRIEF,
      storage: "ready",
      updatedAt: "2026-10-12T06:05:00Z",
      updatedBy: "Kenneth",
    });
  });

  it("falls back to AI_SUMMARY_MODEL, then to Claude Sonnet 5.5", async () => {
    expect(await readSummarySettingsView({ AI_SUMMARY_MODEL: " claude-haiku-5-5 " })).toMatchObject({
      model: "claude-haiku-5-5",
      style: DEFAULT_SUMMARY_STYLE,
      updatedAt: null,
      updatedBy: null,
    });
    expect((await readSummarySettingsView({})).model).toBe("claude-sonnet-5-5");
  });

  it("says nothing can be saved without the secret key", async () => {
    db.configured = false;
    expect(await readSummarySettingsView({})).toMatchObject({ storage: "no_secret_key", model: "claude-sonnet-5-5" });
  });
});

describe("saveSummarySettings", () => {
  it("stores the app's own style as null and the model as chosen, with who saved it", async () => {
    expect(await saveSummarySettings({ model: "claude-sonnet-5-5", style: SummaryStyleSchema.parse({}) }, "admin-id")).toEqual({ ok: true });
    expect(db.upserts).toEqual([{ id: true, summary_model: "claude-sonnet-5-5", summary_style: null, updated_by: "admin-id" }]);
  });

  it("stores a changed style whole, and touches no other setting", async () => {
    await saveSummarySettings({ model: "claude-opus-5-5", style: BRIEF }, "admin-id");
    expect(db.upserts).toEqual([{ id: true, summary_model: "claude-opus-5-5", summary_style: BRIEF, updated_by: "admin-id" }]);
  });

  it("needs the secret key", async () => {
    db.configured = false;
    expect(await saveSummarySettings({ model: "claude-opus-5-5", style: BRIEF }, "admin-id")).toEqual({
      ok: false,
      message: "The server needs SUPABASE_SECRET_KEY to save Steri-AI settings.",
    });
    expect(db.upserts).toEqual([]);
  });
});
