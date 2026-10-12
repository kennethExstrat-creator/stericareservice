// AI settings (docs/AI.md, "AI Settings"): what an admin chooses in Admin >
// Steri-AI Settings. Client-safe: the shapes and the model list, never a key.
import { z } from "zod";

/** The Claude models the pickers offer, most capable first. Any other Claude model id can be typed in. */
export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Most capable. Slower, highest cost." },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Fast and capable, lower cost." },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fastest, lowest cost." },
] as const;

/** Reading order documents on /inspections/new. */
export const DEFAULT_DOCUMENT_MODEL = "claude-opus-5-5";

/** A Claude API model id, as lib/ai/config.ts accepts it: the screen shows it, so a key must not pass as one. */
export const ClaudeModelIdSchema = z
  .string()
  .trim()
  .max(100, { error: "Keep the model id to 100 characters." })
  .regex(/^claude-[a-z0-9][a-z0-9.:@_-]*$/, { error: "Enter a Claude model id, for example claude-opus-5-5." });

/**
 * An Anthropic API key as pasted from console.anthropic.com: sk-ant-…, never
 * an Admin API key (sk-ant-admin…), which manages the organisation's members
 * and keys and cannot call Claude.
 */
export const AnthropicApiKeySchema = z
  .string()
  .trim()
  .max(300, { error: "That is longer than an Anthropic API key." })
  .regex(/^sk-ant-[A-Za-z0-9_-]{16,}$/, { error: "Paste an Anthropic API key: it starts with sk-ant-." })
  .refine((key) => !key.startsWith("sk-ant-admin"), { error: "That is an Admin API key. Paste a key from API Keys instead." });

/** What General's Save Key posts (Steri-AI Settings, General). */
export const ApiKeyInputSchema = z.object({ apiKey: AnthropicApiKeySchema });

/** The second opinion's effort an admin can save; xhigh and max stay server settings (AI_REVIEW_EFFORT). */
export const REVIEW_EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;
export type SavedReviewEffort = (typeof REVIEW_EFFORT_OPTIONS)[number]["value"];

/** What the effort picker posts to keep AI_REVIEW_EFFORT's xhigh or max: nothing is saved over it. */
export const SERVER_REVIEW_EFFORT = "server";

/** Photos a second opinion may attach (lib/ai/config.ts, REVIEW_MAX_PHOTOS_LIMIT). */
export const MAX_REVIEW_PHOTOS = 20;

const PHOTOS_ERROR = `Enter a whole number from 0 to ${MAX_REVIEW_PHOTOS}.`;

/** What Inspection Settings posts: the model for each job, and the second opinion's effort and photos. */
export const InspectionSettingsInputSchema = z.object({
  documentModel: ClaudeModelIdSchema,
  reviewModel: ClaudeModelIdSchema,
  // null: keep the server's effort (SERVER_REVIEW_EFFORT, while AI_REVIEW_EFFORT is xhigh or max).
  reviewEffort: z
    .enum(["low", "medium", "high", SERVER_REVIEW_EFFORT], { error: "Choose Low, Medium or High." })
    .transform((effort) => (effort === SERVER_REVIEW_EFFORT ? null : effort)),
  // A form posts text: blank is refused (never read as 0), then a whole number in range.
  reviewMaxPhotos: z
    .string({ error: PHOTOS_ERROR })
    .trim()
    .min(1, { error: PHOTOS_ERROR })
    .transform(Number)
    .pipe(z.number({ error: PHOTOS_ERROR }).int({ error: PHOTOS_ERROR }).min(0, { error: PHOTOS_ERROR }).max(MAX_REVIEW_PHOTOS, { error: PHOTOS_ERROR })),
});
export type InspectionSettingsInput = z.output<typeof InspectionSettingsInputSchema>;
export type InspectionSettingsField = keyof InspectionSettingsInput;

/*
 * Shortforms (docs/AI.md, "The paper form and shortforms"): what inspectors
 * write on their paper forms, kept in Admin > Defects > Shortforms
 * (ai_settings.glossary) and given to Steri-AI with every document it reads.
 * A defect shortform links the defect library codes it means
 * (defect_codes.code), so Steri-AI counts it under that code.
 */

/** defect: counted under defect codes. term: anything else (a test, a product word, a factory code, initials). */
export const GLOSSARY_KINDS = ["defect", "term"] as const;
export type GlossaryKind = (typeof GLOSSARY_KINDS)[number];

/** Whether the shortforms can be saved: "ready", or why not (no SUPABASE_SECRET_KEY, or the row could not be read). */
export type GlossaryStorage = "ready" | "no_secret_key" | "unavailable";

/** Most codes one shortform links: one per case its meaning names (major, minor, at the crotch). */
export const MAX_SHORTFORM_CODES = 3;

/** A defect code as defect_codes stores it (the same rule as its check constraint). */
const DefectCodeRefSchema = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

const GlossaryEntryShape = z.object({
  short: z.string().trim().min(1, { error: "Enter the shortform." }).max(40, { error: "Keep a shortform to 40 characters." }),
  meaning: z.string().trim().min(1, { error: "Enter what it means." }).max(300, { error: "Keep a meaning to 300 characters." }),
  confirmed: z.boolean(),
  /** defect: counted under codes. term: anything else (a test, a product word, a factory code, initials). */
  kind: z.enum(GLOSSARY_KINDS),
  /** The defect codes it means: one, or one per case its meaning names. Empty while the library has none, and always for a term. */
  codes: z.array(DefectCodeRefSchema).max(MAX_SHORTFORM_CODES, { error: `Choose up to ${MAX_SHORTFORM_CODES} codes.` }),
});

type EntryLike = { kind?: GlossaryKind; codes?: readonly string[] };
const termHasNoCode = (entry: EntryLike) => entry.kind !== "term" || (entry.codes ?? []).length === 0;
const codesOnce = (entry: EntryLike) => new Set(entry.codes ?? []).size === (entry.codes ?? []).length;

/** One shortform inspectors write on paper ("BF"), what it means, whether an inspector has confirmed it, and the codes it counts under. */
export const GlossaryEntrySchema = GlossaryEntryShape.refine(termHasNoCode, {
  error: "Other terms have no defect code.",
  path: ["codes"],
}).refine(codesOnce, { error: "Choose each code once.", path: ["codes"] });
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

/** The same shortform, ignoring case: "bf" is "BF". Shortforms are unique this way. */
export function sameShortform(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Flags the second and later entries of a shortform already in the list. */
function flagRepeats(entries: readonly { short: string }[], context: z.RefinementCtx): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const key = entry.short.trim().toLowerCase();
    if (seen.has(key)) context.addIssue({ code: "custom", path: [index, "short"], message: `“${entry.short}” is in the list twice.` });
    seen.add(key);
  });
}

const LIST_LIMIT = { error: "Keep the list to 200 shortforms." } as const;

export const GlossarySchema = z.array(GlossaryEntrySchema).max(200, LIST_LIMIT).superRefine(flagRepeats);

/** A list as saved: the same, but lists saved before 13 October 2026 have no kind or codes (upgradeGlossary). */
export const StoredGlossarySchema = z
  .array(
    GlossaryEntryShape.extend({ kind: GlossaryEntryShape.shape.kind.optional(), codes: GlossaryEntryShape.shape.codes.optional() })
      .refine(termHasNoCode, { error: "Other terms have no defect code.", path: ["codes"] })
      .refine(codesOnce, { error: "Choose each code once.", path: ["codes"] }),
  )
  .max(200, LIST_LIMIT)
  .superRefine(flagRepeats);
export type StoredGlossary = z.output<typeof StoredGlossarySchema>;

/**
 * The starting list: one inspector's shortforms (confirmed by him, 11
 * October 2026), then what else the paper forms showed. Examples for
 * Steri-AI, not a standard: other inspectors write other words, and it still
 * records every defect in the template's list (lib/ai/reading-guide.ts). A
 * defect links the library codes it means (supabase/seed.sql); on the form,
 * the Major or Minor part a defect is written in decides its class. Admins
 * keep it in Admin > Defects > Shortforms.
 */
export const DEFAULT_GLOSSARY: readonly GlossaryEntry[] = [
  { short: "BF", meaning: "Between Finger: watertight hole between the fingers", confirmed: true, kind: "defect", codes: ["hole_crotch"] },
  { short: "FT", meaning: "Finger Tip: watertight hole at a fingertip", confirmed: true, kind: "defect", codes: ["hole_finger"] },
  { short: "SF", meaning: "Side Finger: watertight hole on the side of a finger", confirmed: true, kind: "defect", codes: ["hole_finger"] },
  { short: "P", meaning: "Palm: watertight hole in the palm", confirmed: true, kind: "defect", codes: ["hole_palm"] },
  { short: "CF", meaning: "Cuff Area: watertight hole at the cuff", confirmed: true, kind: "defect", codes: ["hole_cuff"] },
  {
    short: "MH",
    meaning: "Multiple Holes: a glove with several holes in the watertight test, recorded as Other, Multiple Holes",
    confirmed: true,
    kind: "defect",
    codes: ["hole_other"],
  },
  { short: "GB", meaning: "Glove Burst: the glove burst in the watertight test", confirmed: true, kind: "defect", codes: ["glove_burst"] },
  {
    short: "IB",
    meaning: "Improper Beading: Defective Bead when major, Poor Beading when minor",
    confirmed: true,
    kind: "defect",
    codes: ["bead_defective", "bead_poor"],
  },
  {
    short: "DT",
    meaning: "Dirt: Non-Removable Dirt when major, Small Dirt / Stain when minor",
    confirmed: true,
    kind: "defect",
    codes: ["dirt_nonremovable", "dirt_small"],
  },
  {
    short: "TA",
    meaning: "Thin Area: on the glove body; between the fingers (crotch) when the form says crotch",
    confirmed: true,
    kind: "defect",
    codes: ["thin_body_area", "thin_crotch_area"],
  },
  { short: "TS", meaning: "Thin Spot on the glove body", confirmed: true, kind: "defect", codes: ["thin_spot"] },
  { short: "SKV", meaning: "Skin Visual: a visual defect of the glove skin", confirmed: true, kind: "defect", codes: ["skin_visual"] },
  {
    short: "L",
    meaning: "Lump: Big Lumps (>2mm) when major, Lumps (<2mm) when minor",
    confirmed: true,
    kind: "defect",
    codes: ["lump_big", "lump_small"],
  },
  { short: "FM", meaning: "Flow Mark", confirmed: true, kind: "defect", codes: ["flow_mark"] },
  {
    short: "FS",
    meaning: "Seen on a watertight row: probably SF (Side Finger) written the other way round",
    confirmed: false,
    kind: "defect",
    codes: ["hole_finger"],
  },
  {
    short: "Stain",
    meaning: "Written in full in the visual part: Oil Stain when major, Small Dirt / Stain when minor",
    confirmed: false,
    kind: "defect",
    codes: ["stain", "dirt_small"],
  },
  {
    short: "TG32",
    meaning: "A manufacturer's factory code as written (TG and a factory number, 32): match it only to a manufacturer whose factory number is 32",
    confirmed: false,
    kind: "term",
    codes: [],
  },
  {
    short: "BK",
    meaning: "The inspector's initials (Ngan Boon Keat); the app records the inspector itself",
    confirmed: false,
    kind: "term",
    codes: [],
  },
  { short: "WTT", meaning: "Watertight test", confirmed: true, kind: "term", codes: [] },
  { short: "FAB", meaning: "Force at break", confirmed: true, kind: "term", codes: [] },
  { short: "PF", meaning: "Powder free", confirmed: true, kind: "term", codes: [] },
  { short: "EG", meaning: "Examination gloves", confirmed: true, kind: "term", codes: [] },
];

/**
 * A saved list in today's shape, and whether it was saved before 13 October
 * 2026 (`legacy`). An entry with a kind is kept as it is. One without takes
 * its kind and codes from the starting list's entry with the same shortform,
 * ignoring case, keeping its own meaning and confirmation; one the starting
 * list does not have becomes a defect with no code yet. Read-time and
 * deterministic, so Steri-AI gets the links from the first read; the next
 * save writes the whole list in this shape.
 */
export function upgradeGlossary(stored: StoredGlossary): { entries: GlossaryEntry[]; legacy: boolean } {
  let legacy = false;
  const entries = stored.map(({ short, meaning, confirmed, kind, codes }): GlossaryEntry => {
    if (kind) return { short, meaning, confirmed, kind, codes: kind === "term" ? [] : [...(codes ?? [])] };
    legacy = true;
    const known = DEFAULT_GLOSSARY.find((entry) => sameShortform(entry.short, short));
    return { short, meaning, confirmed, kind: known?.kind ?? "defect", codes: [...(known?.codes ?? [])] };
  });
  return { entries, legacy };
}

/** Where the API key comes from, as the settings screen shows it. Never the key itself. */
export type AiKeyState =
  /** Saved here; `hint` is its last four characters. */
  | { source: "saved"; hint: string }
  /** Saved, but the server's secret changed since, so it cannot be decrypted: enter it again. */
  | { source: "unreadable"; hint: string }
  /** None saved: the server's ANTHROPIC_API_KEY variable is used. */
  | { source: "environment" }
  | { source: "none" };

/**
 * Who writes second opinions (AI_REVIEW_PROVIDER and what is set up, lib/ai/config.ts):
 * Claude, the review webhook, the mock reviewer, switched off on the server
 * (off), nothing set up yet (none: no key and no webhook), or server settings
 * that need fixing.
 */
export type ReviewProvider = "claude" | "webhook" | "mock" | "off" | "none" | "misconfigured";

export type AiSettingsView = {
  key: AiKeyState;
  documentModel: string;
  reviewModel: string;
  /** The second opinion's effort in force: saved, else AI_REVIEW_EFFORT (xhigh and max only from there), else high. */
  reviewEffort: SavedReviewEffort | "xhigh" | "max";
  /** Photos per second opinion in force: saved, else AI_REVIEW_MAX_PHOTOS, else 6. */
  reviewMaxPhotos: number;
  reviewProvider: ReviewProvider;
  /** Last saved, and by whom; null before the first save. */
  updatedAt: string | null;
  updatedBy: string | null;
  /** "ready", or why nothing can be saved here yet. */
  storage: "ready" | "no_secret_key" | "unavailable";
};

/** "sk-ant-…AbCd": how a saved key is named on screen. */
export function keyLabel(hint: string): string {
  return `sk-ant-…${hint}`;
}
