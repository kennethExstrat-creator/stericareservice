"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_REVIEW_MODEL } from "@/lib/ai/config";
import { loadAiEnv, removeSavedApiKey, saveAiPrices, saveApiKey, saveInspectionSettings, testClaudeConnection } from "@/lib/ai/settings";
import { authorizeAction } from "@/lib/auth/session";
import { AiPriceListSchema, type AiPriceList } from "@/lib/schemas/ai-prices";
import {
  AnthropicApiKeySchema,
  ApiKeyInputSchema,
  ClaudeModelIdSchema,
  DEFAULT_DOCUMENT_MODEL,
  InspectionSettingsInputSchema,
  type InspectionSettingsField,
} from "@/lib/schemas/ai-settings";
import { priceListMessage } from "./_components/price-form";

/*
 * Admin > Steri-AI Settings (docs/AI.md, "AI Settings"). Server Actions are
 * public endpoints: each checks for an active admin first and validates with
 * zod. Each view saves only its own settings: General the key, Inspection
 * Settings the models, effort and photos, Steri-AI Cost the price list. The
 * key is encrypted before it is stored and never sent back to the browser.
 */

/** How a save went; a refused field's reason under its name. */
export type SaveState<F extends string = never> =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<F, string>> };

export type ApiKeyState = SaveState<"apiKey">;
export type InspectionSettingsState = SaveState<InspectionSettingsField>;

export type ConnectionTest = { ok: boolean; message: string };

const PATHS = ["/admin/ai", "/admin"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** General's Save Key: the key alone, so the models in use are never written with it. */
export async function saveApiKeyAction(_previous: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { status: "error", message: auth.error };
  const parsed = ApiKeyInputSchema.safeParse({ apiKey: text(formData, "apiKey") });
  if (!parsed.success) {
    const reason = parsed.error.issues[0]?.message ?? "Paste an Anthropic API key.";
    return { status: "error", message: "Check the highlighted field.", fieldErrors: { apiKey: reason } };
  }
  const result = await saveApiKey(parsed.data.apiKey, auth.user.id);
  if (!result.ok) return { status: "error", message: result.message };
  for (const path of PATHS) revalidatePath(path);
  return { status: "saved", message: "Saved. The new API key is in use." };
}

export async function removeAiKeyAction(): Promise<ApiKeyState> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { status: "error", message: auth.error };
  const result = await removeSavedApiKey(auth.user.id);
  if (!result.ok) return { status: "error", message: result.message };
  for (const path of PATHS) revalidatePath(path);
  return { status: "saved", message: "The saved key is removed." };
}

/** Inspection Settings' Save: the two models and the second opinion's effort and photos; the key stays as it is. */
export async function saveInspectionSettingsAction(
  _previous: InspectionSettingsState,
  formData: FormData,
): Promise<InspectionSettingsState> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { status: "error", message: auth.error };
  const parsed = InspectionSettingsInputSchema.safeParse({
    documentModel: text(formData, "documentModel"),
    reviewModel: text(formData, "reviewModel"),
    reviewEffort: text(formData, "reviewEffort"),
    reviewMaxPhotos: text(formData, "reviewMaxPhotos"),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<InspectionSettingsField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as InspectionSettingsField;
      fieldErrors[field] ??= issue.message;
    }
    return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  }
  const result = await saveInspectionSettings(parsed.data, auth.user.id);
  if (!result.ok) return { status: "error", message: result.message };
  for (const path of PATHS) revalidatePath(path);
  return { status: "saved", message: "Saved." };
}

/**
 * Tests the key typed on General, else the key in use, against the models
 * in use (Inspection Settings, saved or from the server). Nothing is saved
 * and nothing is billed.
 */
export async function testAiConnectionAction(formData: FormData): Promise<ConnectionTest> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { ok: false, message: auth.error };
  const typed = text(formData, "apiKey");
  let typedKey: string | undefined;
  if (typed.trim() !== "") {
    const key = AnthropicApiKeySchema.safeParse(typed);
    if (!key.success) return { ok: false, message: key.error.issues[0]?.message ?? "Paste an Anthropic API key." };
    typedKey = key.data;
  }
  const env = await loadAiEnv();
  const models: string[] = [];
  for (const raw of [env.AI_DOCUMENT_MODEL?.trim() || DEFAULT_DOCUMENT_MODEL, env.AI_REVIEW_MODEL?.trim() || DEFAULT_REVIEW_MODEL]) {
    const model = ClaudeModelIdSchema.safeParse(raw);
    if (!model.success) return { ok: false, message: "A model in Inspection Settings is not a Claude model id. Choose another there." };
    models.push(model.data);
  }
  const apiKey = typedKey ?? (env.ANTHROPIC_API_KEY?.trim() || undefined);
  if (!apiKey) return { ok: false, message: "Paste an API key first." };
  return testClaudeConnection(apiKey, models);
}

export type PriceListSave = { ok: boolean; message: string };

/**
 * Saves Steri-AI Cost's price list (docs/AI.md, "Steri-AI Cost"). The list
 * comes from the browser, so it is read with the schema again. New calls are
 * priced with it; recorded calls keep the cost they were recorded with. Who
 * changed it is kept on the settings row (ai_settings.updated_by), as for
 * every Steri-AI setting: audit_log holds inspection events only.
 */
export async function saveAiPricesAction(list: AiPriceList): Promise<PriceListSave> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { ok: false, message: auth.error };
  const parsed = AiPriceListSchema.safeParse(list);
  if (!parsed.success) return { ok: false, message: priceListMessage(parsed.error.issues) };
  const result = await saveAiPrices(parsed.data, auth.user.id);
  if (!result.ok) return { ok: false, message: result.message };
  for (const path of PATHS) revalidatePath(path);
  return { ok: true, message: "Prices saved. New calls use them." };
}
