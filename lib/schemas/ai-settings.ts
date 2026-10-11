// AI settings (docs/AI.md, "AI Settings"): what an admin chooses in Admin >
// AI Settings. Client-safe: the shapes and the model list, never a key.
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

/** An Anthropic API key as pasted from console.anthropic.com: sk-ant-… */
export const AnthropicApiKeySchema = z
  .string()
  .trim()
  .max(300, { error: "That is longer than an Anthropic API key." })
  .regex(/^sk-ant-[A-Za-z0-9_-]{16,}$/, { error: "Paste an Anthropic API key: it starts with sk-ant-." });

/** What Admin > AI Settings posts. A blank key keeps the saved one. */
export const AiSettingsInputSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(AnthropicApiKeySchema.nullable()),
  documentModel: ClaudeModelIdSchema,
  reviewModel: ClaudeModelIdSchema,
});
export type AiSettingsInput = z.output<typeof AiSettingsInputSchema>;
export type AiSettingsField = keyof AiSettingsInput;

/** One shortform inspectors write on paper ("BF"), what it means, and whether an inspector has confirmed it. */
export const GlossaryEntrySchema = z.object({
  short: z.string().trim().min(1, { error: "Enter the shortform." }).max(40, { error: "Keep a shortform to 40 characters." }),
  meaning: z.string().trim().min(1, { error: "Enter what it means." }).max(300, { error: "Keep a meaning to 300 characters." }),
  confirmed: z.boolean(),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
export const GlossarySchema = z.array(GlossaryEntrySchema).max(200, { error: "Keep the list to 200 shortforms." });

/**
 * The starting list: one inspector's shortforms (confirmed by him, 11
 * October 2026), then what else the paper forms showed. Examples for the
 * AI, not a standard: other inspectors write other words, and the AI still
 * records every defect in the template's list (lib/ai/reading-guide.ts). Meanings name the
 * template's wording where one fits; on the form, the Major or Minor part a
 * defect is written in decides its class. Admins keep it in Admin > AI
 * Settings.
 */
export const DEFAULT_GLOSSARY: readonly GlossaryEntry[] = [
  { short: "BF", meaning: "Between Finger: watertight hole between the fingers (template: Between Fingers (Crotch))", confirmed: true },
  { short: "FT", meaning: "Finger Tip: watertight hole at a fingertip (template: Finger)", confirmed: true },
  { short: "SF", meaning: "Side Finger: watertight hole on the side of a finger (template: Finger)", confirmed: true },
  { short: "P", meaning: "Palm: watertight hole in the palm (template: Palm)", confirmed: true },
  { short: "CF", meaning: "Cuff Area: watertight hole at the cuff (template: Cuff)", confirmed: true },
  { short: "MH", meaning: "Multiple Holes: a glove with several holes in the watertight test (template: Other, written as Multiple Holes)", confirmed: true },
  { short: "GB", meaning: "Glove Burst: the glove burst in the watertight test", confirmed: true },
  { short: "IB", meaning: "Improper Beading (template: Defective Bead when major, Poor Beading when minor)", confirmed: true },
  { short: "DT", meaning: "Dirt (template: Non-Removable Dirt when major, Small Dirt / Stain when minor)", confirmed: true },
  { short: "TA", meaning: "Thin Area (template: Thin Area on Glove Body; Thin Area Between Fingers (Crotch) when the form says crotch)", confirmed: true },
  { short: "TS", meaning: "Thin Spot (template: Thin Spot on Glove Body)", confirmed: true },
  { short: "SKV", meaning: "Skin Visual: a visual defect of the glove skin (written as Skin Visual when the template has no such defect)", confirmed: true },
  { short: "L", meaning: "Lump (template: Big Lumps (>2mm) when major, Lumps (<2mm) when minor)", confirmed: true },
  { short: "FM", meaning: "Flow Mark (written as Flow Mark when the template has no such defect)", confirmed: true },
  { short: "FS", meaning: "Seen on a watertight row: probably SF (Side Finger) written the other way round", confirmed: false },
  { short: "Stain", meaning: "Written in full in the visual part (template: Oil Stain when major, Small Dirt / Stain when minor)", confirmed: false },
  { short: "TG32", meaning: "Manufacturer shortform: probably Top Glove factory 32 (Terang Nusa Sdn. Bhd.)", confirmed: false },
  { short: "BK", meaning: "The inspector's initials (Ngan Boon Keat); the app records the inspector itself", confirmed: false },
  { short: "WTT", meaning: "Watertight test", confirmed: true },
  { short: "FAB", meaning: "Force at break", confirmed: true },
  { short: "PF", meaning: "Powder free", confirmed: true },
  { short: "EG", meaning: "Examination gloves", confirmed: true },
];

/** Where the API key comes from, as the settings screen shows it. Never the key itself. */
export type AiKeyState =
  /** Saved here; `hint` is its last four characters. */
  | { source: "saved"; hint: string }
  /** Saved, but the server's secret changed since, so it cannot be decrypted: enter it again. */
  | { source: "unreadable"; hint: string }
  /** None saved: the server's ANTHROPIC_API_KEY variable is used. */
  | { source: "environment" }
  | { source: "none" };

export type AiSettingsView = {
  key: AiKeyState;
  documentModel: string;
  reviewModel: string;
  /** Last saved, and by whom; null before the first save. */
  updatedAt: string | null;
  updatedBy: string | null;
  /** The shortforms the AI is told about. */
  glossary: GlossaryEntry[];
  /** "ready", or why nothing can be saved here yet. */
  storage: "ready" | "no_secret_key" | "unavailable";
};

/** "sk-ant-…AbCd": how a saved key is named on screen. */
export function keyLabel(hint: string): string {
  return `sk-ant-…${hint}`;
}
