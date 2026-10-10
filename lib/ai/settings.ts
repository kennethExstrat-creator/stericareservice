import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { personLabel } from "@/lib/inspections/format";
import { DEFAULT_DOCUMENT_MODEL, type AiKeyState, type AiSettingsInput, type AiSettingsView } from "@/lib/schemas/ai-settings";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { DEFAULT_REVIEW_MODEL, type AiEnv } from "./config";
import { boxSecret, openSecret, sealSecret } from "./secret-box";

/*
 * The settings saved in Admin > AI Settings (public.ai_settings, one row):
 * the Anthropic API key, encrypted (secret-box.ts), and the Claude models for
 * reading documents and for the second opinion. Only the service role reads
 * the row, so every caller checks the user first. They lie over the
 * environment (loadAiEnv): a saved key or model wins over its variable.
 */

type SettingsRow = Database["public"]["Tables"]["ai_settings"]["Row"];
type SettingsInsert = Database["public"]["Tables"]["ai_settings"]["Insert"];

type RowRead = { ok: true; row: SettingsRow | null } | { ok: false };

async function readRow(): Promise<RowRead> {
  if (!isAdminClientConfigured()) return { ok: true, row: null };
  try {
    const { data, error } = await createAdminClient().from("ai_settings").select("*").eq("id", true).maybeSingle();
    if (error) {
      console.error("[ai settings] reading the settings failed", error.code, error.message);
      return { ok: false };
    }
    return { ok: true, row: data };
  } catch (error) {
    console.error("[ai settings] reading the settings failed", error);
    return { ok: false };
  }
}

function savedKey(row: SettingsRow | null, env: AiEnv): string | null {
  const secret = boxSecret(env);
  if (!row?.anthropic_api_key_encrypted || !secret) return null;
  return openSecret(row.anthropic_api_key_encrypted, secret);
}

/**
 * The environment the AI hand-offs read (lib/ai/config.ts and the document
 * reader), with the saved settings laid over it: the saved API key, review
 * model and document model win over ANTHROPIC_API_KEY, AI_REVIEW_MODEL and
 * AI_DOCUMENT_MODEL. Never throws: without a readable row the variables
 * alone apply.
 */
export async function loadAiEnv(env: AiEnv = process.env): Promise<AiEnv> {
  const read = await readRow();
  if (!read.ok || !read.row) return env;
  const merged: Record<string, string | undefined> = { ...env };
  const key = savedKey(read.row, env);
  if (key) merged.ANTHROPIC_API_KEY = key;
  if (read.row.review_model) merged.AI_REVIEW_MODEL = read.row.review_model;
  if (read.row.document_model) merged.AI_DOCUMENT_MODEL = read.row.document_model;
  return merged;
}

/** What Admin > AI Settings shows: where the key comes from, never the key. */
export async function readAiSettingsView(env: AiEnv = process.env): Promise<AiSettingsView> {
  const canStore = isAdminClientConfigured() && boxSecret(env) !== null;
  const read: RowRead = canStore ? await readRow() : { ok: true, row: null };
  const row = read.ok ? read.row : null;

  let key: AiKeyState;
  if (row?.anthropic_api_key_encrypted && row.anthropic_api_key_hint) {
    key = savedKey(row, env)
      ? { source: "saved", hint: row.anthropic_api_key_hint }
      : { source: "unreadable", hint: row.anthropic_api_key_hint };
  } else {
    key = env.ANTHROPIC_API_KEY?.trim() ? { source: "environment" } : { source: "none" };
  }

  let updatedBy: string | null = null;
  if (row?.updated_by) {
    const { data } = await createAdminClient().from("profiles").select("full_name, email").eq("id", row.updated_by).maybeSingle();
    updatedBy = data ? personLabel(data) : null;
  }

  return {
    key,
    documentModel: row?.document_model || env.AI_DOCUMENT_MODEL?.trim() || DEFAULT_DOCUMENT_MODEL,
    reviewModel: row?.review_model || env.AI_REVIEW_MODEL?.trim() || DEFAULT_REVIEW_MODEL,
    updatedAt: row?.updated_at ?? null,
    updatedBy,
    storage: !canStore ? "no_secret_key" : read.ok ? "ready" : "unavailable",
  };
}

export type SaveResult = { ok: true } | { ok: false; message: string };

const NO_STORAGE = "The server needs SUPABASE_SECRET_KEY to save AI settings.";
const SAVE_FAILED = "The settings could not be saved. Try again.";

async function writeRow(values: SettingsInsert): Promise<SaveResult> {
  const { error } = await createAdminClient().from("ai_settings").upsert(values, { onConflict: "id" });
  if (error) {
    console.error("[ai settings] saving the settings failed", error.code, error.message);
    return { ok: false, message: SAVE_FAILED };
  }
  return { ok: true };
}

/** Saves the models, and the key when one is given (a blank key keeps the saved one). */
export async function saveAiSettings(input: AiSettingsInput, userId: string): Promise<SaveResult> {
  const secret = boxSecret();
  if (!isAdminClientConfigured() || !secret) return { ok: false, message: NO_STORAGE };
  const values: SettingsInsert = {
    id: true,
    document_model: input.documentModel,
    review_model: input.reviewModel,
    updated_by: userId,
  };
  if (input.apiKey) {
    values.anthropic_api_key_encrypted = sealSecret(input.apiKey, secret);
    values.anthropic_api_key_hint = input.apiKey.slice(-4);
  }
  return writeRow(values);
}

/** Forgets the saved key: ANTHROPIC_API_KEY applies again, if set. */
export async function removeSavedApiKey(userId: string): Promise<SaveResult> {
  if (!isAdminClientConfigured() || !boxSecret()) return { ok: false, message: NO_STORAGE };
  return writeRow({ id: true, anthropic_api_key_encrypted: null, anthropic_api_key_hint: null, updated_by: userId });
}

/**
 * Asks Anthropic whether the key works and may use each model (GET
 * /v1/models/{id}: no tokens are billed). The message is safe to show.
 */
export async function testClaudeConnection(apiKey: string, models: readonly string[]): Promise<{ ok: boolean; message: string }> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 });
  const found: string[] = [];
  const missing: string[] = [];
  for (const model of [...new Set(models)]) {
    try {
      const info = await client.models.retrieve(model);
      found.push(info.display_name || model);
    } catch (error) {
      if (error instanceof Anthropic.NotFoundError) {
        missing.push(model);
        continue;
      }
      if (error instanceof Anthropic.AuthenticationError) return { ok: false, message: "Anthropic did not accept this API key." };
      if (error instanceof Anthropic.PermissionDeniedError) {
        return { ok: false, message: "This API key is not allowed to use the Claude API." };
      }
      if (error instanceof Anthropic.APIConnectionError) {
        return { ok: false, message: "Could not reach Anthropic. Check the server's internet connection and try again." };
      }
      console.error("[ai settings] testing the connection failed", error);
      return { ok: false, message: "Anthropic answered with an error. Try again in a minute." };
    }
  }
  if (missing.length > 0) {
    return { ok: false, message: `The key works, but it cannot use ${missing.join(" or ")}. Choose another model.` };
  }
  return { ok: true, message: `Connected. The key can use ${found.join(" and ")}.` };
}
