// The Steri-AI Summary button's logic, without React (docs/AI.md, "Steri-AI
// Summary"; Kenneth, 12 October 2026), so every rule is unit-tested in Node:
// the menu's choices remembered on the device, the "Drafted by Steri-AI"
// mark, where a draft goes (straight in, or Replace Your Summary? first),
// the screen's state through a call, and what the status line under the
// field shows. steri-ai-summary.tsx renders it.
//
// - Device only (localStorage, every read and write in try/catch, and a copy
//   in memory, so a browser that refuses storage still shows the mark until
//   the page goes): the menu's choices per user, and the last draft's mark
//   per inspection and user. Neither is ever in the inspection data, the
//   export, the review or the report: once inserted, the summary is the
//   inspector's text, and the mark goes as soon as its plain text changes.
// - A draft goes straight in when the field is empty, when it holds
//   Steri-AI's own last draft unedited, and for Polish My Text; otherwise
//   the inspector chooses Replace, Add Below or Cancel once it is ready
//   (never before, so a failed call asks nothing). Every insert goes through
//   the editor's handle, so it is one undo step.
// - One call at a time. Cancel stops waiting: the late answer is dropped,
//   though it is billed and counted all the same.
import { z } from "zod";
import type { RichTextEditorHandle, RichTextInsertMode, RichTextInsertResult } from "@/components/qc/rich-text-editor";
import { formatCount } from "@/lib/format";
import { summaryTextHash } from "@/lib/inspections/capture/summary-basis";
import { richTextPlain } from "@/lib/rich-text";
import { RICH_TEXT_MAX_CHARACTERS, richTextLength, type RichTextBlock, type RichTextDoc } from "@/lib/schemas/rich-text";
import {
  stepLength,
  SUMMARY_MESSAGES,
  SUMMARY_MODES,
  SummaryFormatSchema,
  SummaryLanguageSchema,
  SummaryLengthSchema,
  SummaryParagraphsSchema,
  type SummaryAssistResult,
  type SummaryDraftSuccess,
  type SummaryFormat,
  type SummaryLanguage,
  type SummaryLength,
  type SummaryMenu,
  type SummaryMode,
  type SummaryOptions,
  type SummaryParagraphs,
} from "@/lib/schemas/summary-style";

/* ------------------------------------------------------------------ *
 * Wording (docs/DESIGN.md: labels in Title Case, lines in sentence case)
 * ------------------------------------------------------------------ */

export const SUMMARY_TEXT = {
  button: "Steri-AI Summary",
  writingButton: "Writing…",
  options: "Summary Options",
  write: "Write Summary",
  reset: "Reset to House Style",
  writing: "Steri-AI is writing the summary…",
  slow: "Still writing. This can take up to a minute on a slow connection.",
  cancel: "Cancel",
  cancelled: "Stopped waiting for Steri-AI.",
  wrote: "Steri-AI wrote the summary. Check it before you sign.",
  polished: "Steri-AI polished your text. Check it before you sign.",
  undone: "Steri-AI's draft was taken back.",
  stale: "The inspection changed after Steri-AI wrote this summary.",
  beforeYouSign: "Before you sign:",
  notPutIn: "Steri-AI's draft could not be put in the field. Try again.",
  cut: "The end of the draft did not fit in the summary's 5,000 characters and was left out.",
  dialogTitle: "Replace Your Summary?",
  dialogBody: "Steri-AI's draft is ready. Replace your text with it, or add it below. Undo in the editor takes either back.",
  draftRegion: "Steri-AI's draft",
  tooLong: "Too long to add below: the summary holds up to 5,000 characters.",
  replace: "Replace",
  addBelow: "Add Below",
  tryAgain: "Try Again",
  writeAgain: "Write Again",
  shorter: "Shorter",
  longer: "Longer",
  undo: "Undo",
  dismiss: "Dismiss",
} as const;

/** How long a call runs before the line says it is still writing and offers Cancel. */
export const SLOW_AFTER_MS = 15_000;

/* ------------------------------------------------------------------ *
 * On the device: localStorage behind try/catch, with a copy in memory
 * ------------------------------------------------------------------ */

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This browser's localStorage, or null where there is none or it refuses (a private window, blocked site data). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type DeviceStore = {
  /** The value kept under `key`: this page's own last write, else storage's; null for none or a refusal. */
  read(key: string | null): string | null;
  /** Keeps a value (null removes it) and tells this page's readers. A refusal or a full storage is ignored. */
  write(key: string, value: string | null): void;
  subscribe(listener: () => void): () => void;
};

/**
 * What the button keeps on the device. Storage may be missing, refuse or
 * throw at any point: the page then works the same, only nothing outlives
 * it (the copy in memory still shows what this page wrote).
 */
export function createDeviceStore(storage: () => StorageLike | null = browserStorage): DeviceStore {
  const written = new Map<string, string | null>();
  const listeners = new Set<() => void>();
  return {
    read(key) {
      if (key === null) return null;
      if (written.has(key)) return written.get(key) ?? null;
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      written.set(key, value);
      try {
        const target = storage();
        if (value === null) target?.removeItem(key);
        else target?.setItem(key, value);
      } catch {
        // Blocked or full: the copy in memory serves this page.
      }
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The menu's choices, per user on this device (docs/AI.md: the choices last used on that device). */
export function summaryOptionsKey(userId: string): string {
  return `stericare:summary-options:v1:${userId}`;
}

/** The last draft's mark, per inspection and user on this device. */
export function summaryDraftKey(inspectionId: string, userId: string): string {
  return `stericare:summary-draft:v1:${inspectionId}:${userId}`;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The menu's choices
 * ------------------------------------------------------------------ */

/** What the inspector may change for one summary; a choice left out follows the house style. */
export type SummaryChoices = {
  length?: SummaryLength;
  paragraphs?: SummaryParagraphs;
  format?: SummaryFormat;
  language?: SummaryLanguage;
};
export type SummaryChoiceKey = keyof SummaryChoices;

/** The menu shows Language only when inspectors may adjust and two or more languages are offered. */
export function languageOffered(menu: SummaryMenu): boolean {
  return menu.inspectorsCanAdjust && menu.languagesOffered.length >= 2;
}

/**
 * Kept choices as the house style allows them now. None while inspectors
 * cannot adjust. A value the schemas refuse, a language no longer offered,
 * or one equal to the house style's is dropped, so that choice follows the
 * house style again when an admin changes it.
 */
export function allowedChoices(raw: unknown, menu: SummaryMenu): SummaryChoices {
  if (!menu.inspectorsCanAdjust || typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const choices: SummaryChoices = {};
  const length = SummaryLengthSchema.safeParse(record.length);
  if (length.success && length.data !== menu.length) choices.length = length.data;
  const paragraphs = SummaryParagraphsSchema.safeParse(record.paragraphs);
  if (paragraphs.success && paragraphs.data !== menu.paragraphs) choices.paragraphs = paragraphs.data;
  const format = SummaryFormatSchema.safeParse(record.format);
  if (format.success && format.data !== menu.format) choices.format = format.data;
  const language = SummaryLanguageSchema.safeParse(record.language);
  if (language.success && language.data !== menu.language && languageOffered(menu) && menu.languagesOffered.includes(language.data)) {
    choices.language = language.data;
  }
  return choices;
}

/** The kept choices, read from the device's raw value. */
export function storedChoices(raw: string | null, menu: SummaryMenu): SummaryChoices {
  return allowedChoices(parseJson(raw), menu);
}

/** The kept choices after one change in the menu. */
export function withChoice<K extends SummaryChoiceKey>(
  choices: SummaryChoices,
  key: K,
  value: NonNullable<SummaryChoices[K]>,
  menu: SummaryMenu,
): SummaryChoices {
  return allowedChoices({ ...choices, [key]: value }, menu);
}

/** What the menu shows: the inspector's choice where one is kept, else the house style's. */
export function shownChoices(menu: SummaryMenu, choices: SummaryChoices): Required<SummaryChoices> {
  return {
    length: choices.length ?? menu.length,
    paragraphs: choices.paragraphs ?? menu.paragraphs,
    format: choices.format ?? menu.format,
    language: choices.language ?? menu.language,
  };
}

/** The options one summary is asked with: the choices (the server applies them only as the house style allows) and the note. */
export function requestOptions(mode: SummaryMode, choices: SummaryChoices, note: string): SummaryOptions {
  const trimmed = note.trim();
  return { mode, ...choices, ...(trimmed === "" ? {} : { note: trimmed }) };
}

/** The choices an options object carries. */
export function choicesOf(options: SummaryOptions): SummaryChoices {
  const choices: SummaryChoices = {};
  if (options.length !== undefined) choices.length = options.length;
  if (options.paragraphs !== undefined) choices.paragraphs = options.paragraphs;
  if (options.format !== undefined) choices.format = options.format;
  if (options.language !== undefined) choices.language = options.language;
  return choices;
}

/** The language a summary is written in, as the server resolves it (resolveSummaryStyle). */
export function languageOf(menu: SummaryMenu, choices: SummaryChoices): SummaryLanguage {
  const { language } = choices;
  return menu.inspectorsCanAdjust && language !== undefined && menu.languagesOffered.includes(language) ? language : menu.language;
}

/* ------------------------------------------------------------------ *
 * The "Drafted by Steri-AI" mark
 * ------------------------------------------------------------------ */

/** What the device keeps about the last draft put in, never its text. */
export type SummaryMark = {
  /** summaryTextHash of the field's plain text just after the draft went in: the mark shows while it matches. */
  textHash: string;
  /** summaryBasisHash of the data the draft was written from. */
  basis: string;
  /** The model that answered. */
  model: string;
  notes: string[];
  figures: string[];
  /** When it went in, in ms since the epoch. */
  at: number;
  mode: SummaryMode;
  /** Words, or characters for Chinese, as the server counted them. */
  words: number;
  unit: "words" | "characters";
  /** The draft is the whole field (an empty field, Replace, Polish My Text); false after Add Below. */
  whole: boolean;
  /** The choices it was written with: Write Again, Shorter and Longer start from them. */
  options: SummaryChoices;
};

const MarkSchema = z.object({
  textHash: z.string().regex(/^[0-9a-f]{16}$/),
  basis: z.string().max(64),
  model: z.string().max(100),
  notes: z.array(z.string().max(300)).max(3),
  figures: z.array(z.string().max(100)).max(5),
  at: z.number(),
  mode: z.enum(SUMMARY_MODES),
  words: z.number().int().min(0),
  unit: z.enum(["words", "characters"]),
  whole: z.boolean(),
  options: z
    .object({
      length: SummaryLengthSchema.optional(),
      paragraphs: SummaryParagraphsSchema.optional(),
      format: SummaryFormatSchema.optional(),
      language: SummaryLanguageSchema.optional(),
    })
    .catch({}),
});

/** The mark the device keeps; null for none, or for one this build cannot read. */
export function parseMark(raw: string | null): SummaryMark | null {
  const parsed = MarkSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

/** summaryTextHash of the field's plain text; null while it is empty. */
export function textHashOf(value: RichTextDoc | null): string | null {
  if (value === null) return null;
  const text = richTextPlain(value);
  return text === "" ? null : summaryTextHash(text);
}

/** The field still holds the text the mark's draft put there: not one letter changed (formatting may have). */
export function markHolds(mark: SummaryMark | null, textHash: string | null): mark is SummaryMark {
  return mark !== null && textHash !== null && mark.textHash === textHash;
}

/** "Drafted by Steri-AI · 152 words. Check it before you sign." */
export function markLine(mark: Pick<SummaryMark, "mode" | "whole" | "words" | "unit">): string {
  const unit = mark.unit === "characters" ? (mark.words === 1 ? "character" : "characters") : mark.words === 1 ? "word" : "words";
  const by = mark.mode === "polish" ? "Polished by Steri-AI" : mark.whole ? "Drafted by Steri-AI" : "Drafted by Steri-AI and added below";
  return `${by} · ${formatCount(mark.words)} ${unit}. Check it before you sign.`;
}

/** The figures the server could not find in the inspection, the note or the house wording. */
export function figuresLine(figures: readonly string[]): string {
  return `Check these figures before you sign: ${figures.join(", ")}. Steri-AI did not find them in the inspection.`;
}

/* ------------------------------------------------------------------ *
 * Where a draft goes
 * ------------------------------------------------------------------ */

const isBlankLine = (block: RichTextBlock) => block.type === "paragraph" && block.content === undefined;

/**
 * The draft's blocks with an empty paragraph between each two, as an
 * inspector types them: the field's paragraphs and lists have no margins of
 * their own (components/qc/rich-text-classes.ts), so the draft's paragraphs
 * would otherwise run together, in the editor, its read-only box and the
 * review. Blocks already apart stay as they are, so a spaced draft comes out
 * the same. The plain text, and so the mark and the word count, is unchanged.
 */
export function spacedDraft(doc: RichTextDoc): RichTextDoc {
  const content: RichTextBlock[] = [];
  for (const block of doc.content) {
    const previous = content[content.length - 1];
    if (previous && !isBlankLine(previous) && !isBlankLine(block)) content.push({ type: "paragraph" });
    content.push(block);
  }
  return content.length === doc.content.length ? doc : { ...doc, content };
}

/**
 * Straight in (replace) for Polish My Text, into an empty field, and over
 * Steri-AI's own last draft while it is unedited and the whole field; else
 * ask: the field holds the inspector's own words. A polished text is theirs
 * too (their facts, Steri-AI's wording), so a new draft asks before it goes
 * over it (12 October 2026), as Write Again is not offered under it.
 */
export function placementFor(mode: SummaryMode, value: RichTextDoc | null, mark: SummaryMark | null): "replace" | "ask" {
  if (mode === "polish") return "replace";
  const textHash = textHashOf(value);
  if (textHash === null) return "replace";
  return markHolds(mark, textHash) && mark.whole && mark.mode === "write" ? "replace" : "ask";
}

/** Add Below fits: the two texts together within the field's 5,000 characters (the blank line between counts none). */
export function fitsBelow(value: RichTextDoc | null, doc: RichTextDoc): boolean {
  return (value === null ? 0 : richTextLength(value)) + richTextLength(doc) <= RICH_TEXT_MAX_CHARACTERS;
}

/** Write Again (the same choices), Shorter and Longer (one length down or up, paragraphs back on Auto). */
export function regenerateOptions(
  mark: SummaryMark,
  kind: "again" | "shorter" | "longer",
  menu: SummaryMenu,
  note: string,
): SummaryOptions {
  const choices: SummaryChoices = { ...mark.options };
  if (kind !== "again") {
    choices.length = stepLength(choices.length ?? menu.length, kind === "shorter" ? -1 : 1);
    choices.paragraphs = "auto";
  }
  return requestOptions("write", choices, note);
}

/* ------------------------------------------------------------------ *
 * The screen's state through a call
 * ------------------------------------------------------------------ */

export type SummaryNotice = "offline" | "needs_result";

/** Steri-AI's notes and the figures to check, shown under the field and never stored in the inspection. */
export type SummaryNotes = { notes: string[]; figures: string[]; cut: boolean };

export type SummaryState = {
  /** The call in flight; `slow` once it has run SLOW_AFTER_MS. */
  run: { id: number; options: SummaryOptions; slow: boolean } | null;
  /** A draft waiting for Replace, Add Below or Cancel. */
  asking: { id: number; options: SummaryOptions; draft: SummaryDraftSuccess } | null;
  /** The last failure, and what Try Again asks again. */
  error: { message: string; retry: SummaryOptions } | null;
  /** Why a press did nothing: no connection, or no conclusion yet. Shown while that still holds. */
  notice: { kind: SummaryNotice; message: string } | null;
  /** The last draft's notes and figures: shown until dismissed, Undo or the next call, edited or not. */
  notes: SummaryNotes | null;
  /** The field just before the last draft, and the text the draft left: Undo, while that text is unchanged. */
  undo: { before: RichTextDoc | null; textHash: string } | null;
  /** What the live region says. */
  announcement: string;
};

export const INITIAL_SUMMARY_STATE: SummaryState = {
  run: null,
  asking: null,
  error: null,
  notice: null,
  notes: null,
  undo: null,
  announcement: "",
};

export type SummaryAction =
  | { type: "blocked"; notice: SummaryNotice; message: string }
  | { type: "started"; id: number; options: SummaryOptions }
  | { type: "slow"; id: number }
  /** Cancel: stop waiting for the call. */
  | { type: "cancelled" }
  /** The answer came after Cancel, or once the screen could no longer change the inspection: dropped. */
  | { type: "dropped"; id: number }
  | { type: "failed"; id: number; message: string }
  | { type: "asked"; id: number; draft: SummaryDraftSuccess }
  | { type: "inserted"; id: number; notes: SummaryNotes | null; undo: SummaryState["undo"]; announcement: string }
  /** Cancel in Replace Your Summary?: the draft is dropped and the field kept as it is. */
  | { type: "kept" }
  | { type: "undone" }
  | { type: "dismissed" };

function noted(notes: SummaryNotes | null): SummaryNotes | null {
  return notes && (notes.notes.length > 0 || notes.figures.length > 0 || notes.cut) ? notes : null;
}

export function summaryReducer(state: SummaryState, action: SummaryAction): SummaryState {
  switch (action.type) {
    case "blocked":
      return { ...state, notice: { kind: action.notice, message: action.message }, error: null, announcement: action.message };
    case "started":
      return {
        ...state,
        run: { id: action.id, options: action.options, slow: false },
        asking: null,
        error: null,
        notice: null,
        notes: null,
        announcement: SUMMARY_TEXT.writing,
      };
    case "slow":
      if (state.run?.id !== action.id || state.run.slow) return state;
      return { ...state, run: { ...state.run, slow: true }, announcement: SUMMARY_TEXT.slow };
    case "cancelled":
      return state.run ? { ...state, run: null, announcement: SUMMARY_TEXT.cancelled } : state;
    case "dropped":
      return state.run?.id === action.id ? { ...state, run: null, announcement: "" } : state;
    case "failed": {
      const retry = state.run?.id === action.id ? state.run.options : state.asking?.id === action.id ? state.asking.options : null;
      if (retry === null) return state;
      return { ...state, run: null, asking: null, error: { message: action.message, retry }, announcement: action.message };
    }
    case "asked":
      if (state.run?.id !== action.id) return state;
      return { ...state, run: null, asking: { id: action.id, options: state.run.options, draft: action.draft }, announcement: "" };
    case "inserted":
      if (state.run?.id !== action.id && state.asking?.id !== action.id) return state;
      return {
        ...state,
        run: null,
        asking: null,
        error: null,
        notes: noted(action.notes),
        undo: action.undo,
        announcement: action.announcement,
      };
    case "kept":
      return state.asking ? { ...state, asking: null, announcement: "" } : state;
    case "undone":
      return { ...state, undo: null, notes: null, announcement: SUMMARY_TEXT.undone };
    case "dismissed":
      return { ...state, notes: null };
  }
}

/** What a call needs from the screen: the hook gives the real ones, tests give fakes. */
export type SummaryRunIO = {
  menu: SummaryMenu;
  draft(options: SummaryOptions): Promise<SummaryAssistResult>;
  /** The call is still the one on screen: not cancelled, and the inspection can still be changed here. */
  isCurrent(id: number): boolean;
  /** The field and the mark as they are now. */
  field(): { value: RichTextDoc | null; mark: SummaryMark | null };
  /** The editor's handle (RichTextEditorHandle): one undo step, onChange as for typing, no focus. */
  insert: RichTextEditorHandle["insertDocument"];
  keepMark(mark: SummaryMark): void;
  dispatch(action: SummaryAction): void;
  now(): number;
};

/**
 * One call: asks for the draft, then puts it straight in or asks the
 * inspector where it goes. An answer that comes after Cancel, or once the
 * screen has turned read-only, is dropped.
 */
export async function performSummaryRun(io: SummaryRunIO, id: number, options: SummaryOptions): Promise<void> {
  io.dispatch({ type: "started", id, options });
  let result: SummaryAssistResult;
  try {
    result = await io.draft(options);
  } catch {
    // The screen's draft() never throws; this is only a safety net.
    result = { ok: false, reason: "error", message: SUMMARY_MESSAGES.unreachable };
  }
  if (!io.isCurrent(id)) {
    io.dispatch({ type: "dropped", id });
    return;
  }
  if (!result.ok) {
    io.dispatch({ type: "failed", id, message: result.message });
    return;
  }
  // Spaced once, so Replace Your Summary? shows what goes in.
  const draft = { ...result, doc: spacedDraft(result.doc) };
  const { value, mark } = io.field();
  if (placementFor(draft.mode, value, mark) === "ask") {
    io.dispatch({ type: "asked", id, draft });
    return;
  }
  applyDraft(io, { id, options, draft }, "replace");
}

/**
 * Puts a draft in through the editor (replace, or below the inspector's
 * text), keeps its mark on the device and says so.
 */
export function applyDraft(
  io: Pick<SummaryRunIO, "menu" | "insert" | "keepMark" | "dispatch" | "now">,
  { id, options, draft }: { id: number; options: SummaryOptions; draft: SummaryDraftSuccess },
  mode: RichTextInsertMode,
): RichTextInsertResult {
  const outcome = io.insert(draft.doc, mode);
  if (!outcome.applied) {
    io.dispatch({ type: "failed", id, message: SUMMARY_TEXT.notPutIn });
    return outcome;
  }
  const textHash = textHashOf(outcome.after);
  if (textHash !== null) {
    const choices = choicesOf(options);
    io.keepMark({
      textHash,
      basis: draft.basis,
      model: draft.model,
      notes: draft.notes.slice(0, 3),
      figures: draft.figures.slice(0, 5),
      at: io.now(),
      mode: draft.mode,
      words: draft.words,
      unit: languageOf(io.menu, choices) === "zh-Hans" ? "characters" : "words",
      whole: mode === "replace",
      options: choices,
    });
  }
  io.dispatch({
    type: "inserted",
    id,
    notes: { notes: draft.notes.slice(0, 3), figures: draft.figures.slice(0, 5), cut: outcome.cut },
    undo: textHash === null ? null : { before: outcome.before, textHash },
    announcement: draft.mode === "polish" ? SUMMARY_TEXT.polished : SUMMARY_TEXT.wrote,
  });
  return outcome;
}

/* ------------------------------------------------------------------ *
 * The status line under the field
 * ------------------------------------------------------------------ */

/** A regenerate button: offered and pressable, offered but at its end (greyed, focusable), or not offered. */
export type SummaryStep = "on" | "off" | null;

export type SummaryStatusView = {
  /** The call's progress, the last failure, or why a press did nothing. */
  activity:
    | { kind: "writing"; slow: boolean }
    | { kind: "error"; message: string }
    | { kind: "notice"; message: string }
    | null;
  /** Steri-AI's draft is in the field, unedited. */
  mark: {
    line: string;
    /** Anything else in the inspection changed since the draft was written. */
    stale: boolean;
    shorter: SummaryStep;
    longer: SummaryStep;
    writeAgain: boolean;
    undo: boolean;
  } | null;
  notes: SummaryNotes | null;
};

export type SummaryStatusInput = {
  state: SummaryState;
  menu: SummaryMenu;
  online: boolean;
  /** No conclusion is chosen yet. */
  needsResult: boolean;
  mark: SummaryMark | null;
  /** textHashOf the field now. */
  textHash: string | null;
  /** summaryBasisHash of the data now: asked only while Steri-AI's written draft is in the field unedited. */
  basisNow: () => string;
};

export function summaryStatus({ state, menu, online, needsResult, mark, textHash, basisNow }: SummaryStatusInput): SummaryStatusView {
  if (state.run) return { activity: { kind: "writing", slow: state.run.slow }, mark: null, notes: null };
  const notice =
    state.notice && ((state.notice.kind === "offline" && !online) || (state.notice.kind === "needs_result" && needsResult))
      ? state.notice
      : null;
  const activity = state.error
    ? ({ kind: "error", message: state.error.message } as const)
    : notice
      ? ({ kind: "notice", message: notice.message } as const)
      : null;

  let markView: SummaryStatusView["mark"] = null;
  if (markHolds(mark, textHash)) {
    const written = mark.mode === "write" && mark.whole;
    const stale = mark.mode === "write" && basisNow() !== mark.basis;
    const length = mark.options.length ?? menu.length;
    const steps = written && !stale && menu.inspectorsCanAdjust;
    markView = {
      line: stale ? SUMMARY_TEXT.stale : markLine(mark),
      stale,
      shorter: steps ? (length === "brief" ? "off" : "on") : null,
      longer: steps ? (length === "detailed" ? "off" : "on") : null,
      writeAgain: written,
      undo: state.undo !== null && state.undo.textHash === textHash,
    };
  }

  const kept = markHolds(mark, textHash) ? noted({ notes: mark.notes, figures: mark.figures, cut: false }) : null;
  return { activity, mark: markView, notes: state.notes ?? kept };
}

/** The status line says something: the button is described by it only then (aria-describedby). */
export function hasStatus(view: SummaryStatusView): boolean {
  return view.activity !== null || view.mark !== null || view.notes !== null;
}
