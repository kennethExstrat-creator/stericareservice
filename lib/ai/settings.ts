import "server-only";
import { isDeepStrictEqual } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { personLabel } from "@/lib/inspections/format";
import { AiPriceListSchema, DEFAULT_AI_PRICES, withDefaultModels, type AiPriceList } from "@/lib/schemas/ai-prices";
import {
  DEFAULT_DOCUMENT_MODEL,
  DEFAULT_GLOSSARY,
  StoredGlossarySchema,
  upgradeGlossary,
  type AiKeyState,
  type AiSettingsView,
  type GlossaryEntry,
  type GlossaryStorage,
  type ReviewProvider,
} from "@/lib/schemas/ai-settings";
import {
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_STYLE,
  summaryMenuOf,
  SummaryStyleSchema,
  type SummaryMenu,
  type SummarySettingsInput,
  type SummaryStyle,
} from "@/lib/schemas/summary-style";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  AI_REVIEW_EFFORTS,
  DEFAULT_REVIEW_EFFORT,
  DEFAULT_REVIEW_MAX_PHOTOS,
  DEFAULT_REVIEW_MODEL,
  REVIEW_MAX_PHOTOS_LIMIT,
  readAiConfig,
  type AiEnv,
  type AiReviewEffort,
} from "./config";
import { boxSecret, openSecret, sealSecret } from "./secret-box";

/*
 * The settings saved in Admin > Steri-AI Settings (public.ai_settings, one
 * row): the Anthropic API key, encrypted (secret-box.ts); the Claude models
 * for reading documents and for the second opinion, and the second
 * opinion's effort and photos (Inspection Settings); the price list
 * (Steri-AI Cost); the shortforms (Admin > Defects > Shortforms). Only the
 * service role reads the row, so every caller checks the user first. They
 * lie over the environment (loadAiEnv): a saved value wins over its variable.
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
 * model, document model, review effort and photos per review win over
 * ANTHROPIC_API_KEY, AI_REVIEW_MODEL, AI_DOCUMENT_MODEL, AI_REVIEW_EFFORT and
 * AI_REVIEW_MAX_PHOTOS. Never throws: without a readable row the variables
 * alone apply.
 */
export async function loadAiEnv(env: AiEnv = process.env): Promise<AiEnv> {
  const read = await readRow();
  if (!read.ok || !read.row) return env;
  return settingsEnv(read.row, env);
}

function settingsEnv(row: SettingsRow, env: AiEnv): AiEnv {
  const merged: Record<string, string | undefined> = { ...env };
  const key = savedKey(row, env);
  if (key) merged.ANTHROPIC_API_KEY = key;
  if (row.review_model) merged.AI_REVIEW_MODEL = row.review_model;
  if (row.document_model) merged.AI_DOCUMENT_MODEL = row.document_model;
  // A project without migration 20261013120000 has neither column: the variables apply.
  if (row.review_effort) merged.AI_REVIEW_EFFORT = row.review_effort;
  if (row.review_max_photos != null) merged.AI_REVIEW_MAX_PHOTOS = String(row.review_max_photos);
  return merged;
}

/**
 * The price list each call's cost is worked out with (lib/ai/usage.ts): the
 * saved one, with any model of the app's own it lacks (withDefaultModels),
 * else DEFAULT_AI_PRICES. Never throws: a list that cannot be read is logged
 * and the app's list stands in.
 */
export async function loadAiPrices(): Promise<AiPriceList> {
  const read = await readRow();
  return pricesOf(read.ok ? read.row : null);
}

function pricesOf(row: SettingsRow | null): AiPriceList {
  if (row?.prices == null) return DEFAULT_AI_PRICES;
  const saved = AiPriceListSchema.safeParse(row.prices);
  if (!saved.success) {
    console.error("[ai settings] the saved prices could not be read; the app's list stands in", saved.error.issues[0]?.message);
    return DEFAULT_AI_PRICES;
  }
  return withDefaultModels(saved.data);
}

type GlossaryRead = { entries: GlossaryEntry[]; legacy: boolean };

/**
 * The saved shortforms in today's shape (a list saved before 13 October 2026
 * takes its kinds and codes from the starting list: upgradeGlossary), else
 * the starting list.
 */
function glossaryOf(row: SettingsRow | null): GlossaryRead {
  if (row?.glossary == null) return { entries: [...DEFAULT_GLOSSARY], legacy: false };
  const saved = StoredGlossarySchema.safeParse(row.glossary);
  if (!saved.success) {
    console.error("[ai settings] the saved shortforms could not be read; the starting list stands in", saved.error.issues[0]);
    return { entries: [...DEFAULT_GLOSSARY], legacy: false };
  }
  return upgradeGlossary(saved.data);
}

/** The shortforms the AI is told about with every document. Never throws: the starting list stands in. */
export async function loadGlossary(): Promise<GlossaryEntry[]> {
  const read = await readRow();
  return glossaryOf(read.ok ? read.row : null).entries;
}

/** The shortforms as Admin > Defects shows them, and whether they can be saved (`storage`). */
export type GlossaryState = GlossaryRead & { storage: GlossaryStorage };

/**
 * What Admin > Defects reads after its admin check: the shortforms (the tab
 * count, the Codes column, the Shortforms tab), and whether they can be
 * saved: without SUPABASE_SECRET_KEY, or when the row cannot be read, the
 * starting list stands in and nothing is saved. Never throws.
 */
export async function loadGlossaryState(): Promise<GlossaryState> {
  if (!isAdminClientConfigured()) return { entries: [...DEFAULT_GLOSSARY], legacy: false, storage: "no_secret_key" };
  const read = await readRow();
  if (!read.ok) return { entries: [...DEFAULT_GLOSSARY], legacy: false, storage: "unavailable" };
  return { ...glossaryOf(read.row), storage: "ready" };
}

/** The second opinion as it runs now (Inspection Settings): the saved value, else the variable, else the default. */
export type ReviewSettingsView = {
  reviewEffort: AiReviewEffort;
  reviewMaxPhotos: number;
  /** Who writes second opinions, from AI_REVIEW_PROVIDER and what is set up (lib/ai/config.ts). */
  reviewProvider: ReviewProvider;
};

function effortOf(raw: string | undefined): AiReviewEffort {
  const value = raw?.trim().toLowerCase();
  return AI_REVIEW_EFFORTS.find((effort) => effort === value) ?? DEFAULT_REVIEW_EFFORT;
}

function maxPhotosOf(raw: string | undefined): number {
  const value = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value >= 0 && value <= REVIEW_MAX_PHOTOS_LIMIT ? value : DEFAULT_REVIEW_MAX_PHOTOS;
}

/**
 * The second opinion's settings as they apply in this environment: pass
 * loadAiEnv()'s, which holds the saved values. For Inspection Settings.
 */
export function reviewSettingsOf(env: AiEnv): ReviewSettingsView {
  const { review } = readAiConfig(env);
  return {
    reviewEffort: effortOf(env.AI_REVIEW_EFFORT),
    reviewMaxPhotos: maxPhotosOf(env.AI_REVIEW_MAX_PHOTOS),
    // "off" is AI_REVIEW_PROVIDER=off; without it, nothing is set up yet (no key, no webhook).
    reviewProvider: review.provider === "off" && !review.switchedOff ? "none" : review.provider,
  };
}

/** What Admin > Steri-AI Settings shows: where the key comes from, never the key. */
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
    // The saved effort and photos lie over their variables, as every call reads them (loadAiEnv).
    ...reviewSettingsOf(row ? settingsEnv(row, env) : env),
    updatedAt: row?.updated_at ?? null,
    updatedBy,
    storage: !canStore ? "no_secret_key" : read.ok ? "ready" : "unavailable",
  };
}

export type SaveResult = { ok: true } | { ok: false; message: string };

const NO_STORAGE = "The server needs SUPABASE_SECRET_KEY to save Steri-AI settings.";
const SAVE_FAILED = "The settings could not be saved. Try again.";

async function writeRow(values: SettingsInsert): Promise<SaveResult> {
  const { error } = await createAdminClient().from("ai_settings").upsert(values, { onConflict: "id" });
  if (error) {
    console.error("[ai settings] saving the settings failed", error.code, error.message);
    return { ok: false, message: SAVE_FAILED };
  }
  return { ok: true };
}

/** Saves a new API key (General), encrypted, with its last four characters for the screen. The caller has validated it. */
export async function saveApiKey(apiKey: string, userId: string): Promise<SaveResult> {
  const secret = boxSecret();
  if (!isAdminClientConfigured() || !secret) return { ok: false, message: NO_STORAGE };
  const key = apiKey.trim();
  if (!key) return { ok: false, message: "Paste an API key first." };
  return writeRow({
    id: true,
    anthropic_api_key_encrypted: sealSecret(key, secret),
    anthropic_api_key_hint: key.slice(-4),
    updated_by: userId,
  });
}

/**
 * Inspection Settings as saved: the two models, and the second opinion's
 * effort (low to high; null keeps AI_REVIEW_EFFORT, whose xhigh and max stay
 * server settings) and photos.
 */
export type InspectionSettings = {
  documentModel: string;
  reviewModel: string;
  reviewEffort: "low" | "medium" | "high" | null;
  reviewMaxPhotos: number;
};

/** Saves Inspection Settings (validated by the caller); they lie over the variables from the next call (loadAiEnv). */
export async function saveInspectionSettings(input: InspectionSettings, userId: string): Promise<SaveResult> {
  if (!isAdminClientConfigured()) return { ok: false, message: NO_STORAGE };
  return writeRow({
    id: true,
    document_model: input.documentModel,
    review_model: input.reviewModel,
    review_effort: input.reviewEffort,
    review_max_photos: input.reviewMaxPhotos,
    updated_by: userId,
  });
}

/**
 * Saves the price list (Steri-AI Cost). The app's own list is stored as null,
 * so a later change to DEFAULT_AI_PRICES reaches a project that never edited
 * it. New calls are priced with it; recorded calls keep their cost.
 */
export async function saveAiPrices(list: AiPriceList, userId: string): Promise<SaveResult> {
  if (!isAdminClientConfigured()) return { ok: false, message: NO_STORAGE };
  const parsed = AiPriceListSchema.safeParse(list);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the prices." };
  const prices: Json | null = isDeepStrictEqual(parsed.data, DEFAULT_AI_PRICES) ? null : parsed.data;
  return writeRow({ id: true, prices, updated_by: userId });
}

/** Saves the whole shortforms list (Admin > Defects > Shortforms changes one entry and saves them all). */
export async function saveGlossary(glossary: GlossaryEntry[], userId: string): Promise<SaveResult> {
  if (!isAdminClientConfigured()) return { ok: false, message: NO_STORAGE };
  return writeRow({ id: true, glossary, updated_by: userId });
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

/* ------------------------------------------------------------------ *
 * The Steri-AI Summary (docs/AI.md, "Steri-AI Summary"; 12 October 2026):
 * its own model (ai_settings.summary_model over AI_SUMMARY_MODEL, else
 * DEFAULT_SUMMARY_MODEL) and the house style (summary_style, null for
 * DEFAULT_SUMMARY_STYLE), migration 20261013130000. Its card on Inspection
 * Settings saves only these two.
 * ------------------------------------------------------------------ */

/**
 * The house style as saved, else the app's. A style this build cannot read
 * is logged and the app's stands in, as for the prices. Never throws.
 */
function summaryStyleOf(row: SettingsRow | null): SummaryStyle {
  if (row?.summary_style == null) return DEFAULT_SUMMARY_STYLE;
  const saved = SummaryStyleSchema.safeParse(row.summary_style);
  if (!saved.success) {
    console.error("[ai settings] the saved summary style could not be read; the app's stands in", saved.error.issues[0]?.message);
    return DEFAULT_SUMMARY_STYLE;
  }
  return saved.data;
}

/** loadAiEnv's environment, with the summary's saved model over AI_SUMMARY_MODEL. */
function summaryEnv(row: SettingsRow | null, env: AiEnv): AiEnv {
  const merged = row ? settingsEnv(row, env) : env;
  return row?.summary_model ? { ...merged, AI_SUMMARY_MODEL: row.summary_model } : merged;
}

/** What the summary writer reads: the environment (key and model) and the house style. */
export type SummarySetup = { env: AiEnv; style: SummaryStyle };

/**
 * The summary writer's settings from one read of the row: the saved key and
 * summary model laid over the variables, and the house style. Never throws:
 * without a readable row the variables and the app's style apply.
 */
export async function loadSummarySetup(env: AiEnv = process.env): Promise<SummarySetup> {
  const read = await readRow();
  const row = read.ok ? read.row : null;
  return { env: summaryEnv(row, env), style: summaryStyleOf(row) };
}

/** The menu beside the Steri-AI Summary button, from the house style: for the capture page while the inspection is editable. */
export async function loadSummaryMenu(): Promise<SummaryMenu> {
  const read = await readRow();
  return summaryMenuOf(summaryStyleOf(read.ok ? read.row : null));
}

/** What the Inspection Summary card shows. */
export type SummarySettingsView = {
  /** The model in use: saved, else AI_SUMMARY_MODEL, else DEFAULT_SUMMARY_MODEL. */
  model: string;
  style: SummaryStyle;
  /** "ready", or why nothing can be saved: no SUPABASE_SECRET_KEY, or the row could not be read. */
  storage: "ready" | "no_secret_key" | "unavailable";
  /** Last saved and by whom, shared by every Steri-AI setting; null before the first save. */
  updatedAt: string | null;
  updatedBy: string | null;
};

/** The Inspection Summary card's settings in force, after the page's admin check. Never throws. */
export async function readSummarySettingsView(env: AiEnv = process.env): Promise<SummarySettingsView> {
  const fallbackModel = env.AI_SUMMARY_MODEL?.trim() || DEFAULT_SUMMARY_MODEL;
  if (!isAdminClientConfigured()) {
    return { model: fallbackModel, style: DEFAULT_SUMMARY_STYLE, storage: "no_secret_key", updatedAt: null, updatedBy: null };
  }
  const read = await readRow();
  const row = read.ok ? read.row : null;
  return {
    model: row?.summary_model || fallbackModel,
    style: summaryStyleOf(row),
    storage: read.ok ? "ready" : "unavailable",
    updatedAt: row?.updated_at ?? null,
    updatedBy: await savedByName(row),
  };
}

/** Who last saved the row, by name, else email. */
async function savedByName(row: SettingsRow | null): Promise<string | null> {
  if (!row?.updated_by) return null;
  try {
    const { data } = await createAdminClient().from("profiles").select("full_name, email").eq("id", row.updated_by).maybeSingle();
    return data ? personLabel(data) : null;
  } catch (error) {
    console.error("[ai settings] reading who saved the settings failed", error);
    return null;
  }
}

/**
 * Saves the Inspection Summary card (validated by the caller): the model as
 * chosen, as document_model is, and the house style, stored as null when it
 * is the app's own, so a later change to DEFAULT_SUMMARY_STYLE reaches a
 * project that never edited it, as the prices are. Only the last save is
 * kept (Kenneth, 12 October 2026), with who saved it and when.
 */
export async function saveSummarySettings(input: SummarySettingsInput, userId: string): Promise<SaveResult> {
  if (!isAdminClientConfigured()) return { ok: false, message: NO_STORAGE };
  const style: Json | null = isDeepStrictEqual(input.style, DEFAULT_SUMMARY_STYLE) ? null : input.style;
  return writeRow({ id: true, summary_model: input.model, summary_style: style, updated_by: userId });
}
