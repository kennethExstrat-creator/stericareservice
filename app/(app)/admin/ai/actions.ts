"use server";

import { revalidatePath } from "next/cache";
import { loadAiEnv, removeSavedApiKey, saveAiSettings, saveGlossary, testClaudeConnection } from "@/lib/ai/settings";
import { authorizeAction } from "@/lib/auth/session";
import {
  AiSettingsInputSchema,
  AnthropicApiKeySchema,
  ClaudeModelIdSchema,
  GlossarySchema,
  type AiSettingsField,
  type GlossaryEntry,
} from "@/lib/schemas/ai-settings";

/*
 * Admin > AI Settings (docs/AI.md, "AI Settings"). Server Actions are public
 * endpoints: each checks for an active admin and validates with zod. The key
 * is encrypted before it is stored and never sent back to the browser.
 */

export type AiSettingsState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<AiSettingsField, string>> };

export type ConnectionTest = { ok: boolean; message: string };

const PATHS = ["/admin/ai", "/admin"] as const;

function readForm(formData: FormData): Record<AiSettingsField, string> {
  const text = (name: AiSettingsField) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return { apiKey: text("apiKey"), documentModel: text("documentModel"), reviewModel: text("reviewModel") };
}

export async function saveAiSettingsAction(_previous: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { status: "error", message: auth.error };
  const parsed = AiSettingsInputSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const fieldErrors: Partial<Record<AiSettingsField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as AiSettingsField;
      fieldErrors[field] ??= issue.message;
    }
    return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  }
  const result = await saveAiSettings(parsed.data, auth.user.id);
  if (!result.ok) return { status: "error", message: result.message };
  for (const path of PATHS) revalidatePath(path);
  return { status: "saved", message: parsed.data.apiKey ? "Saved. The new API key is in use." : "Saved." };
}

export async function removeAiKeyAction(): Promise<AiSettingsState> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { status: "error", message: auth.error };
  const result = await removeSavedApiKey(auth.user.id);
  if (!result.ok) return { status: "error", message: result.message };
  for (const path of PATHS) revalidatePath(path);
  return { status: "saved", message: "The saved key is removed." };
}

/** Tests the key typed in the form, else the key in use, against both models. Nothing is saved. */
export async function testAiConnectionAction(formData: FormData): Promise<ConnectionTest> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { ok: false, message: auth.error };
  const form = readForm(formData);
  const models: string[] = [];
  for (const raw of [form.documentModel, form.reviewModel]) {
    const model = ClaudeModelIdSchema.safeParse(raw);
    if (!model.success) return { ok: false, message: model.error.issues[0]?.message ?? "Enter a Claude model id." };
    models.push(model.data);
  }
  let apiKey: string | undefined;
  if (form.apiKey.trim() !== "") {
    const key = AnthropicApiKeySchema.safeParse(form.apiKey);
    if (!key.success) return { ok: false, message: key.error.issues[0]?.message ?? "Paste an Anthropic API key." };
    apiKey = key.data;
  } else {
    apiKey = (await loadAiEnv()).ANTHROPIC_API_KEY?.trim() || undefined;
  }
  if (!apiKey) return { ok: false, message: "Paste an API key first." };
  return testClaudeConnection(apiKey, models);
}

/** Saves the shortforms list (Admin > AI Settings, Shortforms) as it is on screen. */
export async function saveGlossaryAction(entries: GlossaryEntry[]): Promise<ConnectionTest> {
  const auth = await authorizeAction("admin");
  if (!auth.ok) return { ok: false, message: auth.error };
  const parsed = GlossarySchema.safeParse(entries);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = typeof issue?.path[0] === "number" ? ` (row ${issue.path[0] + 1})` : "";
    return { ok: false, message: `${issue?.message ?? "Check the shortforms."}${row}` };
  }
  const shorts = parsed.data.map((entry) => entry.short.toLowerCase());
  const twice = shorts.find((short, index) => shorts.indexOf(short) !== index);
  if (twice) return { ok: false, message: `"${twice.toUpperCase()}" is in the list twice.` };
  const result = await saveGlossary(parsed.data, auth.user.id);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/admin/ai");
  return { ok: true, message: "Shortforms saved. Steri-AI uses them from the next document it reads." };
}
