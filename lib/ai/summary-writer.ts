import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaTextBlockParam,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ClaudeModelIdSchema } from "@/lib/schemas/ai-settings";
import type { InspectionResult } from "@/lib/schemas/common";
import { RichTextDocSchema, type RichTextDoc } from "@/lib/schemas/rich-text";
import {
  countSummaryWords,
  DEFAULT_SUMMARY_MODEL,
  SUMMARY_MESSAGES,
  summaryLengthRange,
  type SummaryMode,
  type SummaryStyle,
} from "@/lib/schemas/summary-style";
import type { AiEnv } from "./config";
import { createMessage } from "./document-reader";
import { SUMMARY_SYSTEM_PROMPT } from "./prompts/summary-system";
import { SERVER_SIDE_FALLBACK_BETA } from "./providers/claude-request";
import { hardCheckProblems, lengthNote, overLength, practicalNotes, tooLongProblem, unknownFigures } from "./summary-checks";
import {
  answerToDoc,
  appendHouseWording,
  parseSummaryAnswer,
  SUMMARY_ANSWER_LIMITS,
  SUMMARY_OUTPUT_SCHEMA,
  summaryPlainText,
} from "./summary-doc";
import { escapeTags, lengthUnitText, renderWritingStyle, type HouseWording } from "./summary-style-text";
import type { SummaryView } from "./summary-view";
import type { OnAiCall } from "./usage";

/* ------------------------------------------------------------------ *
 * The Steri-AI Summary's request (docs/AI.md, "Steri-AI Summary"; 12
 * October 2026): one inspection, the writing style, the inspector's note
 * or draft, and the ask, to the Inspection Summary's own model at low
 * effort. The answer is flat blocks of strings with **bold**, made into
 * the field's document, checked and validated here; a draft that fails a
 * hard check is asked for once more. One far over its length is asked for
 * once more too, but kept with a note when the second answer still runs
 * long or fails (Kenneth, 12 October 2026). Never throws: a failure comes
 * back in words for the inspector. Text only: nothing here reads or writes
 * a result, and nothing is stored.
 *
 * Request layout, in cache order (the 5.5 models cache from 512 tokens):
 *   system  SUMMARY_SYSTEM_PROMPT               cache_control (the same for every summary)
 *   user    <inspection> JSON </inspection>     cache_control (the same per inspection state)
 *           <writing_style> … </writing_style>  per summary
 *           <inspector_draft> … (polish)        per summary
 *           <inspector_note> … (with a note)    per summary
 *           the ask, then a retry's problem     per summary
 * so Shorter, Longer, Write Again or another style within 5 minutes reads
 * the system prompt and the inspection from the cache.
 * ------------------------------------------------------------------ */

/** Thinking plus about 1,000 words; the lab's answers used 114 to 1,251 output tokens. */
export const SUMMARY_MAX_TOKENS = 8_000;
export const SUMMARY_TIMEOUT_MS = 60_000;

/**
 * Models with server-side refusal fallbacks (fallbacks: "default", as the
 * second opinion sends): Claude Opus 5 and 5.5, Sonnet 5.5, Fable 5.
 * Claude Haiku 5.5 has none, and an Other model id gets none.
 */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/u;

export function hasServerSideFallbacks(model: string): boolean {
  return FALLBACK_MODELS.test(model);
}

export type WriteSummaryInput = {
  view: SummaryView;
  /** The style this summary is written in (resolveSummaryStyle). */
  style: SummaryStyle;
  mode: SummaryMode;
  /** The inspector's note, trimmed; blank for none. */
  note: string;
  /** Polish: the inspector's text as docToInlineText gives it, without its house wording. */
  draft: string | null;
  finalResult: InspectionResult | null;
  /** What goes after Steri-AI's text, word for word (houseWordingOf; for a polish, what the text ended with). */
  houseWording: HouseWording;
};

export type SummaryCallbacks = {
  /** Hears of the first call, billed or failed, for its cost (lib/ai/usage.ts). */
  onCall?: OnAiCall;
  /** Hears of the check retry, if there is one. */
  onRetryCall?: OnAiCall;
};

export type SummaryOutcome =
  | {
      ok: true;
      doc: RichTextDoc;
      text: string;
      notes: string[];
      figures: string[];
      words: number;
      model: string;
      /** 1, or 2 when the check retry wrote it. */
      attempts: number;
    }
  | { ok: false; reason: "not_connected" | "misconfigured" | "error"; message: string };

type SummaryFailure = Extract<SummaryOutcome, { ok: false }>;

const fail = (reason: SummaryFailure["reason"], message: string): SummaryFailure => ({ ok: false, reason, message });

/** The inspection as JSON, "<" escaped as \u003c (still valid JSON), so text an inspector typed cannot close the tag. */
function inspectionBlock(view: SummaryView): string {
  return `<inspection>\n${JSON.stringify(view).replaceAll("<", "\\u003c")}\n</inspection>`;
}

/** The ask, last before a retry's problem: Write with the length's maximum, Polish keeping every sentence of the inspector's (12 October 2026). */
function ask(input: WriteSummaryInput): string {
  const { refNo } = input.view;
  if (input.mode === "polish") {
    return `Polish the inspector's draft above for inspection ${refNo} in the writing style above. Keep every sentence of the draft and every fact, figure and judgement it states, including what the inspection data does not record: those are the inspector's own statements. Keep the inspector's words where they are clear; you may reorder and complete sentences, correct the grammar and use the report's terms. Leave out nothing and add nothing, even when the inspection data has more. Where the draft disagrees with the inspection data, keep the inspector's words and say so in notes only.`;
  }
  const { hi, unit } = summaryLengthRange(input.style.length, input.style.language);
  return `Write the Inspection Summary for inspection ${refNo} in the writing style above, in ${hi} ${lengthUnitText(unit)} at most.`;
}

/** The request for one summary. No thinking, temperature, top_p or prefill: Opus 5.5 always thinks and refuses the rest. */
export function buildSummaryRequest(input: WriteSummaryInput, model: string): MessageCreateParamsNonStreaming {
  const content: BetaTextBlockParam[] = [
    { type: "text", text: inspectionBlock(input.view), cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: renderWritingStyle(input.style, { finalResult: input.finalResult, houseWording: input.houseWording, mode: input.mode }),
    },
  ];
  if (input.mode === "polish" && input.draft) {
    content.push({ type: "text", text: `<inspector_draft>\n${escapeTags(input.draft)}\n</inspector_draft>` });
  }
  if (input.note.trim()) content.push({ type: "text", text: `<inspector_note>\n${escapeTags(input.note.trim())}\n</inspector_note>` });
  content.push({ type: "text", text: ask(input) });
  return {
    model,
    max_tokens: SUMMARY_MAX_TOKENS,
    ...(hasServerSideFallbacks(model) ? { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: "default" as const } : {}),
    system: [{ type: "text", text: SUMMARY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    // Low effort: Opus 5.5 defaults to medium, and in the lab low used no thinking tokens.
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_OUTPUT_SCHEMA } },
  };
}

/** The same request with the problem line last, after the cache breakpoint. */
export function withRetryLine(params: MessageCreateParamsNonStreaming, problem: string): MessageCreateParamsNonStreaming {
  const [turn] = params.messages;
  const content = Array.isArray(turn.content) ? turn.content : [{ type: "text" as const, text: turn.content }];
  return {
    ...params,
    messages: [
      {
        ...turn,
        content: [...content, { type: "text", text: `Your previous answer ${problem}. Write the whole answer again, following every rule.` }],
      },
    ],
  };
}

type Written = Extract<SummaryOutcome, { ok: true }>;

type Reading =
  | { kind: "done"; outcome: Written }
  /** Passes every check but its length (overLength): asked for once more, kept with a note if that fails. */
  | { kind: "long"; outcome: Written; problem: string }
  | { kind: "stopped"; failure: SummaryFailure }
  | { kind: "retry"; problem: string };

/**
 * Steri-AI's notes as shown under the field: one in the first person, about
 * "the data" or about the inspection being a draft dropped (12 October 2026).
 */
function notesOf(notes: readonly string[]): string[] {
  const kept = practicalNotes(notes);
  if (kept.length < notes.length) console.warn(`[steri-ai summary] dropped ${notes.length - kept.length} unwanted note(s)`);
  return kept;
}

/** A draft kept although it runs long: the length note last, within the notes' limit. */
function withLengthNote(outcome: Written, style: SummaryStyle): Written {
  const notes = [...outcome.notes.slice(0, SUMMARY_ANSWER_LIMITS.notes - 1), lengthNote(style)];
  return { ...outcome, notes };
}

/** One answer: stopped (declined or cut off, never retried), a problem to retry, too long, or the checked draft. */
function readAnswer(message: BetaMessage, input: WriteSummaryInput, attempts: number): Reading {
  if (message.stop_reason === "refusal") return { kind: "stopped", failure: fail("error", SUMMARY_MESSAGES.declined) };
  if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
    return { kind: "stopped", failure: fail("error", SUMMARY_MESSAGES.cutOff) };
  }
  const text = message.content.filter((block) => block.type === "text").at(-1)?.text ?? "";
  const read = parseSummaryAnswer(text);
  if (!read.ok) return { kind: "retry", problem: read.problem };

  const { words } = input.view.conclusion;
  const { doc, repairs } = answerToDoc(read.answer, { words, emphasis: input.style.emphasis, colourResult: input.style.colourResult });
  if (repairs.length > 0) console.warn("[steri-ai summary] repaired the answer:", [...new Set(repairs)].join("; "));
  const full = appendHouseWording(doc, input.houseWording);
  // Steri-AI's own text, never the house wording, against the length (Write only: a polish keeps the inspector's length).
  const long = input.mode === "write" ? overLength(summaryPlainText(doc), input.style) : null;
  const problems = hardCheckProblems({
    answer: read.answer,
    doc,
    full,
    mode: input.mode,
    finalResult: input.finalResult,
    words,
    language: input.style.language,
    mentionSuggestion: input.style.mentionSuggestion,
    draft: input.draft,
  });
  if (problems.length > 0) return { kind: "retry", problem: [...problems, ...(long ? [tooLongProblem(long)] : [])].join("; ") };
  // Only a document the field itself accepts leaves the server.
  const valid = RichTextDocSchema.safeParse(full);
  if (!valid.success) return { kind: "retry", problem: "could not be made into the summary's format" };

  const plain = summaryPlainText(valid.data);
  const sources = [JSON.stringify(input.view), input.note, input.draft ?? "", input.houseWording.verdict ?? "", input.houseWording.closing ?? ""];
  const outcome: Written = {
    ok: true,
    doc: valid.data,
    text: plain,
    notes: notesOf(read.answer.notes),
    figures: unknownFigures(plain, sources),
    words: countSummaryWords(plain, input.style.language),
    model: message.model,
    attempts,
  };
  return long ? { kind: "long", outcome, problem: tooLongProblem(long) } : { kind: "done", outcome };
}

/**
 * Writes one summary. `env` holds the key and the model (loadSummarySetup:
 * AI_SUMMARY_MODEL, saved or from the server). `onCall` and `onRetryCall`
 * hear of each Claude call, for its cost. No key, or a model that is no
 * Claude model, makes no call.
 */
export async function writeSummary(input: WriteSummaryInput, env: AiEnv, callbacks: SummaryCallbacks = {}): Promise<SummaryOutcome> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fail("not_connected", SUMMARY_MESSAGES.notConnected);
  const model = ClaudeModelIdSchema.safeParse(env.AI_SUMMARY_MODEL?.trim() || DEFAULT_SUMMARY_MODEL);
  if (!model.success) return fail("misconfigured", SUMMARY_MESSAGES.modelNotClaude);

  const params = buildSummaryRequest(input, model.data);
  let client: Anthropic;
  let first: Reading;
  try {
    client = new Anthropic({ apiKey, maxRetries: 1, timeout: SUMMARY_TIMEOUT_MS });
    first = readAnswer(await createMessage(client, params, callbacks.onCall), input, 1);
  } catch (error) {
    return describeSummaryError(error);
  }
  if (first.kind === "done") return first.outcome;
  if (first.kind === "stopped") return first.failure;

  console.warn(`[steri-ai summary] asking once more: the answer ${first.problem}`);
  let second: Reading;
  try {
    second = readAnswer(await createMessage(client, withRetryLine(params, first.problem), callbacks.onRetryCall), input, 2);
  } catch (error) {
    // Only the first answer's length failed: it stands, with its note.
    return first.kind === "long" ? withLengthNote(first.outcome, input.style) : describeSummaryError(error);
  }
  if (second.kind === "done") return second.outcome;
  // Still long the second time: kept, with a note (Kenneth, 12 October 2026).
  if (second.kind === "long") return withLengthNote(second.outcome, input.style);
  if (first.kind === "long") {
    console.warn("[steri-ai summary] the second answer failed: keeping the first, which only ran long");
    return withLengthNote(first.outcome, input.style);
  }
  if (second.kind === "stopped") return second.failure;
  console.warn(`[steri-ai summary] the second answer failed its checks too: it ${second.problem}`);
  return fail("error", SUMMARY_MESSAGES.checksFailed);
}

/** A failed request in words an inspector can act on (as describeSortError, for the summary). */
export function describeSummaryError(error: unknown): SummaryFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return fail("error", "Steri-AI took too long to write the summary. Try again.");
  if (error instanceof Anthropic.APIConnectionError) return fail("error", "Could not reach Steri-AI. Check the connection and try again.");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return fail("misconfigured", "Steri-AI did not accept the API key. Ask an admin to check Admin > Steri-AI Settings.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return fail("misconfigured", "The model for Inspection Summary is not available to this key. Ask an admin to check Admin > Steri-AI Settings.");
  }
  if (error instanceof Anthropic.RateLimitError) return fail("error", "Steri-AI is busy. Wait a minute and try again.");
  if (error instanceof Anthropic.BadRequestError) {
    console.error("[steri-ai summary] request refused", error.message);
    return fail("error", "Steri-AI could not take this request. Ask an admin to check the Inspection Summary model under Admin > Steri-AI Settings.");
  }
  if (error instanceof Anthropic.InternalServerError) return fail("error", "Steri-AI is having trouble right now. Try again in a minute.");
  console.error("[steri-ai summary] failed", error);
  return fail("error", SUMMARY_MESSAGES.failed);
}
