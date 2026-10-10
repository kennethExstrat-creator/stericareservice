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
  /** "ready", or why nothing can be saved here yet. */
  storage: "ready" | "no_secret_key" | "unavailable";
};

/** "sk-ant-…AbCd": how a saved key is named on screen. */
export function keyLabel(hint: string): string {
  return `sk-ant-…${hint}`;
}
