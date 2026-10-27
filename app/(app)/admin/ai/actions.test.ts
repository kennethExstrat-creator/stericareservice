// Steri-AI Settings' Server Actions, public endpoints: an active admin only,
// checked before anything is read or saved; each view saves only its own
// settings, read with zod (they come from the browser); then the pages are
// refreshed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PRICES, type AiPriceList } from "@/lib/schemas/ai-prices";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({
  loadAiEnv: vi.fn(),
  removeSavedApiKey: vi.fn(),
  saveAiPrices: vi.fn(),
  saveApiKey: vi.fn(),
  saveInspectionSettings: vi.fn(),
  testClaudeConnection: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { loadAiEnv, removeSavedApiKey, saveAiPrices, saveApiKey, saveInspectionSettings, testClaudeConnection } from "@/lib/ai/settings";
import { authorizeAction } from "@/lib/auth/session";
import { removeAiKeyAction, saveAiPricesAction, saveApiKeyAction, saveInspectionSettingsAction, testAiConnectionAction } from "./actions";

const ADMIN = { id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };
const NO_PERMISSION = { ok: false as const, error: "You do not have permission to do that." };

const LIST: AiPriceList = { ...DEFAULT_AI_PRICES, myrPerUsd: 4.72, myrRateOn: "2026-10-01" };
const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";
const IDLE = { status: "idle" } as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const SETTINGS = { documentModel: "claude-sonnet-5-5", reviewModel: "claude-opus-5-5", reviewEffort: "medium", reviewMaxPhotos: "4" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN });
  for (const save of [saveAiPrices, saveApiKey, saveInspectionSettings, removeSavedApiKey]) vi.mocked(save).mockResolvedValue({ ok: true });
  vi.mocked(loadAiEnv).mockResolvedValue({ ANTHROPIC_API_KEY: "sk-ant-in-use-0123456789abcdef", AI_DOCUMENT_MODEL: "claude-haiku-5-5" });
  vi.mocked(testClaudeConnection).mockResolvedValue({ ok: true, message: "Connected. The key can use Claude Haiku 5.5 and Claude Opus 5.5." });
});

describe("the admin check", () => {
  it("refuses anyone but an active admin before reading, saving or calling Anthropic", async () => {
    vi.mocked(authorizeAction).mockResolvedValue(NO_PERMISSION);
    const refused = { status: "error", message: NO_PERMISSION.error };
    expect(await saveApiKeyAction(IDLE, form({ apiKey: KEY }))).toEqual(refused);
    expect(await removeAiKeyAction()).toEqual(refused);
    expect(await saveInspectionSettingsAction(IDLE, form(SETTINGS))).toEqual(refused);
    expect(await testAiConnectionAction(form({ apiKey: KEY }))).toEqual({ ok: false, message: NO_PERMISSION.error });
    expect(await saveAiPricesAction(LIST)).toEqual({ ok: false, message: NO_PERMISSION.error });
    for (const call of [saveApiKey, removeSavedApiKey, saveInspectionSettings, saveAiPrices, loadAiEnv, testClaudeConnection]) {
      expect(call).not.toHaveBeenCalled();
    }
    expect(vi.mocked(authorizeAction).mock.calls.every(([need]) => JSON.stringify(need) === JSON.stringify({ permission: "ai_settings" }))).toBe(true);
  });
});

describe("saveApiKeyAction", () => {
  it("saves the key alone, never the models, and refreshes the pages", async () => {
    // A form that still carried models (an old tab) changes none of them.
    const answer = await saveApiKeyAction(IDLE, form({ apiKey: ` ${KEY} `, documentModel: "claude-x", reviewModel: "claude-y" }));
    expect(answer).toEqual({ status: "saved", message: "Saved. The new API key is in use." });
    expect(saveApiKey).toHaveBeenCalledWith(KEY, ADMIN.id);
    expect(saveInspectionSettings).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/admin/ai"]]);
  });

  it("refuses an Admin API key, a blank field and anything else, under the field", async () => {
    for (const [apiKey, reason] of [
      ["sk-ant-admin01-abcdefghijklmnopqrstuvwxyz", "That is an Admin API key. Paste a key from API Keys instead."],
      ["", "Paste an Anthropic API key: it starts with sk-ant-."],
      ["not-a-key", "Paste an Anthropic API key: it starts with sk-ant-."],
    ]) {
      expect(await saveApiKeyAction(IDLE, form({ apiKey }))).toEqual({
        status: "error",
        message: "Check the highlighted field.",
        fieldErrors: { apiKey: reason },
      });
    }
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes on why the key could not be saved", async () => {
    vi.mocked(saveApiKey).mockResolvedValue({ ok: false, message: "The server needs SUPABASE_SECRET_KEY to save Steri-AI settings." });
    expect(await saveApiKeyAction(IDLE, form({ apiKey: KEY }))).toEqual({
      status: "error",
      message: "The server needs SUPABASE_SECRET_KEY to save Steri-AI settings.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("removeAiKeyAction", () => {
  it("removes the saved key as the admin", async () => {
    expect(await removeAiKeyAction()).toEqual({ status: "saved", message: "The saved key is removed." });
    expect(removeSavedApiKey).toHaveBeenCalledWith(ADMIN.id);
  });
});

describe("saveInspectionSettingsAction", () => {
  it("saves the models, the effort and the photos, never a key", async () => {
    expect(await saveInspectionSettingsAction(IDLE, form({ ...SETTINGS, apiKey: KEY }))).toEqual({ status: "saved", message: "Saved." });
    expect(saveInspectionSettings).toHaveBeenCalledWith(
      { documentModel: "claude-sonnet-5-5", reviewModel: "claude-opus-5-5", reviewEffort: "medium", reviewMaxPhotos: 4 },
      ADMIN.id,
    );
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/admin/ai"]]);
  });

  it("keeps the server's effort when the picker shows it (xhigh or max are server settings)", async () => {
    await saveInspectionSettingsAction(IDLE, form({ ...SETTINGS, reviewEffort: "server" }));
    expect(vi.mocked(saveInspectionSettings).mock.calls[0]?.[0]).toMatchObject({ reviewEffort: null });
  });

  it("highlights each refused field and saves nothing", async () => {
    const answer = await saveInspectionSettingsAction(
      IDLE,
      form({ documentModel: "gpt-5", reviewModel: "claude-opus-5-5", reviewEffort: "max", reviewMaxPhotos: "" }),
    );
    expect(answer).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        documentModel: "Enter a Claude model id, for example claude-opus-5-5.",
        reviewEffort: "Choose Low, Medium or High.",
        reviewMaxPhotos: "Enter a whole number from 0 to 20.",
      },
    });
    for (const photos of ["21", "-1", "2.5", "six"]) {
      const refused = await saveInspectionSettingsAction(IDLE, form({ ...SETTINGS, reviewMaxPhotos: photos }));
      expect(refused).toMatchObject({ status: "error", fieldErrors: { reviewMaxPhotos: "Enter a whole number from 0 to 20." } });
    }
    expect(saveInspectionSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("testAiConnectionAction", () => {
  it("tries the key in use with the models in use", async () => {
    expect(await testAiConnectionAction(form({ apiKey: "" }))).toEqual({
      ok: true,
      message: "Connected. The key can use Claude Haiku 5.5 and Claude Opus 5.5.",
    });
    // The document model is saved (or set on the server); the review model is the default.
    expect(testClaudeConnection).toHaveBeenCalledWith("sk-ant-in-use-0123456789abcdef", ["claude-haiku-5-5", "claude-opus-5-5"]);
  });

  it("tries a typed key instead, and refuses an Admin API key without calling Anthropic", async () => {
    await testAiConnectionAction(form({ apiKey: KEY }));
    expect(vi.mocked(testClaudeConnection).mock.calls[0]?.[0]).toBe(KEY);
    vi.mocked(testClaudeConnection).mockClear();
    expect(await testAiConnectionAction(form({ apiKey: "sk-ant-admin01-abcdefghijklmnopqrstuvwxyz" }))).toEqual({
      ok: false,
      message: "That is an Admin API key. Paste a key from API Keys instead.",
    });
    expect(testClaudeConnection).not.toHaveBeenCalled();
  });

  it("asks for a key when there is none", async () => {
    vi.mocked(loadAiEnv).mockResolvedValue({});
    expect(await testAiConnectionAction(form({}))).toEqual({ ok: false, message: "Paste an API key first." });
    expect(testClaudeConnection).not.toHaveBeenCalled();
  });
});

describe("saveAiPricesAction", () => {
  it("saves the list as the admin and refreshes the pages", async () => {
    expect(await saveAiPricesAction(LIST)).toEqual({ ok: true, message: "Prices saved. New calls use them." });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "ai_settings" });
    expect(saveAiPrices).toHaveBeenCalledWith(LIST, ADMIN.id);
    expect(vi.mocked(authorizeAction).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(saveAiPrices).mock.invocationCallOrder[0]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/admin/ai"]]);
  });

  it("reads the list again: a refused price or a model listed twice saves nothing", async () => {
    const negative = { ...LIST, models: [{ ...LIST.models[0], input: -1 }, ...LIST.models.slice(1)] };
    expect(await saveAiPricesAction(negative)).toEqual({ ok: false, message: "Check the highlighted prices." });
    const twice = { ...LIST, models: [...LIST.models, { ...LIST.models[0], model: "claude-x" }, { ...LIST.models[1], model: "claude-x" }] };
    expect(await saveAiPricesAction(twice)).toEqual({ ok: false, message: '"claude-x" is in the list twice.' });
    expect(await saveAiPricesAction({ nonsense: true } as unknown as AiPriceList)).toEqual({ ok: false, message: "Check the highlighted prices." });
    expect(saveAiPrices).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes on why the list could not be saved", async () => {
    vi.mocked(saveAiPrices).mockResolvedValue({ ok: false, message: "The server needs SUPABASE_SECRET_KEY to save Steri-AI settings." });
    expect(await saveAiPricesAction(LIST)).toEqual({ ok: false, message: "The server needs SUPABASE_SECRET_KEY to save Steri-AI settings." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
