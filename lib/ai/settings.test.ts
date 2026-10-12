// The settings row (ai_settings) over the server's variables, and the saves
// each Steri-AI Settings view makes: the key alone, Inspection Settings'
// models, effort and photos. The row is a fake admin client.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

type Row = Database["public"]["Tables"]["ai_settings"]["Row"];

const db = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, upserts: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminClientConfigured: () => true,
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "ai_settings" ? db.row : { full_name: "Test Admin", email: "admin@test.local" },
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
import { loadAiEnv, readAiSettingsView, saveApiKey, saveInspectionSettings } from "./settings";

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

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
  db.row = null;
  db.upserts = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadAiEnv", () => {
  it("lays the saved effort and photos over AI_REVIEW_EFFORT and AI_REVIEW_MAX_PHOTOS", async () => {
    db.row = row({ review_effort: "low", review_max_photos: 0 });
    const env = await loadAiEnv({ AI_REVIEW_EFFORT: "high", AI_REVIEW_MAX_PHOTOS: "6" });
    expect(env).toMatchObject({ AI_REVIEW_EFFORT: "low", AI_REVIEW_MAX_PHOTOS: "0" });
  });

  it("keeps the variables where nothing is saved", async () => {
    db.row = row({ document_model: "claude-haiku-5-5" });
    const env = await loadAiEnv({ AI_REVIEW_EFFORT: "xhigh", AI_REVIEW_MAX_PHOTOS: "3" });
    expect(env).toMatchObject({ AI_REVIEW_EFFORT: "xhigh", AI_REVIEW_MAX_PHOTOS: "3", AI_DOCUMENT_MODEL: "claude-haiku-5-5" });
  });
});

describe("readAiSettingsView", () => {
  it("shows the second opinion's settings in force and who writes it", async () => {
    db.row = row({ review_max_photos: 2, anthropic_api_key_encrypted: sealSecret(SAVED_KEY, SECRET), anthropic_api_key_hint: "cdef" });
    const view = await readAiSettingsView({ SUPABASE_SECRET_KEY: SECRET, AI_REVIEW_EFFORT: "max" });
    expect(view).toMatchObject({ key: { source: "saved", hint: "cdef" }, reviewEffort: "max", reviewMaxPhotos: 2, reviewProvider: "claude" });
  });

  it("falls back to high and 6 photos, and tells nothing set up from switched off", async () => {
    expect(await readAiSettingsView({ SUPABASE_SECRET_KEY: SECRET })).toMatchObject({
      key: { source: "none" },
      reviewEffort: "high",
      reviewMaxPhotos: 6,
      reviewProvider: "none",
    });
    expect(await readAiSettingsView({ SUPABASE_SECRET_KEY: SECRET, AI_REVIEW_PROVIDER: "off", ANTHROPIC_API_KEY: SAVED_KEY })).toMatchObject({
      reviewProvider: "off",
    });
  });
});

describe("the saves", () => {
  it("saveApiKey writes the key, sealed, and its last four characters: never a model", async () => {
    expect(await saveApiKey(` ${SAVED_KEY} `, "admin-id")).toEqual({ ok: true });
    expect(db.upserts).toHaveLength(1);
    const [values] = db.upserts;
    expect(Object.keys(values).sort()).toEqual(["anthropic_api_key_encrypted", "anthropic_api_key_hint", "id", "updated_by"]);
    expect(values).toMatchObject({ id: true, anthropic_api_key_hint: "cdef", updated_by: "admin-id" });
    expect(values.anthropic_api_key_encrypted).not.toContain(SAVED_KEY);
  });

  it("saveInspectionSettings writes the models, the effort (null keeps the server's) and the photos: never the key", async () => {
    await saveInspectionSettings({ documentModel: "claude-sonnet-5-5", reviewModel: "claude-opus-5-5", reviewEffort: null, reviewMaxPhotos: 4 }, "admin-id");
    expect(db.upserts).toEqual([
      {
        id: true,
        document_model: "claude-sonnet-5-5",
        review_model: "claude-opus-5-5",
        review_effort: null,
        review_max_photos: 4,
        updated_by: "admin-id",
      },
    ]);
  });
});
