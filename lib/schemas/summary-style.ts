// The Steri-AI Summary (docs/AI.md, "Steri-AI Summary"; Kenneth, 12 October
// 2026): how Steri-AI drafts the Inspection Summary on the Conclusion when an
// inspector taps Steri-AI Summary. It writes text only and never changes a
// result. An admin sets the house style once, in Steri-AI Settings >
// Inspection Settings (ai_settings.summary_style, null for
// DEFAULT_SUMMARY_STYLE; ai_settings.summary_model, null for AI_SUMMARY_MODEL
// or DEFAULT_SUMMARY_MODEL). An inspector may change the length, paragraphs,
// format and, when two or more are offered, the language of one summary from
// the menu beside the button, unless the admin locks them
// (inspectorsCanAdjust). Everything else always follows the house style.
//
// Client-safe leaf: zod and the sibling schemas only, so the settings card,
// the button and the server share one source. Imported by its path, not
// through the lib/schemas index.
import { z } from "zod";
import { ClaudeModelIdSchema } from "./ai-settings";
import type { RichTextDoc } from "./rich-text";

/* ------------------------------------------------------------------ *
 * The choices: what is stored, its name on screen (Title Case,
 * docs/DESIGN.md) and a line under it (null for none)
 * ------------------------------------------------------------------ */

type Choice = { readonly value: string | number; readonly label: string; readonly hint: string | null };

function valuesOf<T extends readonly { readonly value: string }[]>(choices: T) {
  return choices.map((choice) => choice.value) as unknown as [T[number]["value"], ...T[number]["value"][]];
}

/** Word targets are a guide: Steri-AI aims within a quarter either side. `shortLabel` is the inspector's menu's. */
export const SUMMARY_LENGTHS = [
  { value: "brief", label: "Brief (About 80 Words)", shortLabel: "Brief", hint: null, words: 80, autoParagraphs: 1 },
  { value: "standard", label: "Standard (About 150 Words)", shortLabel: "Standard", hint: null, words: 150, autoParagraphs: 2 },
  { value: "detailed", label: "Detailed (About 300 Words)", shortLabel: "Detailed", hint: null, words: 300, autoParagraphs: 4 },
] as const satisfies readonly (Choice & { shortLabel: string; words: number; autoParagraphs: number })[];

/** "auto" follows the length (Brief 1, Standard 2, Detailed 4). Not used for bullet points. */
export const SUMMARY_PARAGRAPHS = [
  { value: "auto", label: "Auto (Follows Length)", hint: "Brief 1, Standard 2, Detailed 4." },
  { value: 1, label: "1", hint: null },
  { value: 2, label: "2", hint: null },
  { value: 3, label: "3", hint: null },
  { value: 4, label: "4", hint: null },
  { value: 5, label: "5", hint: null },
] as const satisfies readonly Choice[];

/** Headed Sections are bold run-in labels ("Conclusion:"), not headings: the Inspection Summary has no heading. */
export const SUMMARY_FORMATS = [
  { value: "paragraphs", label: "Paragraphs", hint: "Prose only." },
  { value: "bullets", label: "Bullet Points", hint: "One point per line, the conclusion first." },
  {
    value: "paragraph_list",
    label: "Paragraph and Findings List",
    hint: "The conclusion and the order in prose, then one bullet per finding.",
  },
  {
    value: "headed",
    label: "Headed Sections",
    hint: "A short bold label such as Conclusion: or Watertight Test: before each paragraph.",
  },
] as const satisfies readonly Choice[];

export const SUMMARY_NUMBERS = [
  { value: "exact", label: "Every Number", hint: "Every count with its limit and every figure against its specification." },
  { value: "key", label: "Key Numbers", hint: "Exact figures for failures, warnings and gaps; one figure, or words, for what passed." },
  { value: "words", label: "Words Only", hint: "No figures besides what a sentence needs." },
] as const satisfies readonly Choice[];

/**
 * The summary's parts in the default order. The order is also the priority:
 * when the length is tight, Steri-AI shortens the parts lower down first,
 * then leaves them out. Result is always first and always on (`fixed`).
 */
export const SUMMARY_SECTIONS = [
  { key: "result", label: "Result", on: true, fixed: true, hint: "The conclusion in the template's word: PASSED, FAILED or HOLD." },
  {
    key: "remark",
    label: "Remark",
    on: true,
    fixed: false,
    hint: "The inspector's remark, in short, as the reason for the conclusion. Nothing when there is no remark.",
  },
  {
    key: "issues",
    label: "Issues First",
    on: true,
    fixed: false,
    hint: "Every section that failed, passed with a warning or was not done, with its figures.",
  },
  { key: "overview", label: "Order Overview", on: true, fixed: false, hint: "What was inspected: the details ticked below." },
  {
    key: "sampling",
    label: "Sampling Plan",
    on: true,
    fixed: false,
    hint: "Standard, inspection level, code letters, AQLs and sample sizes, in one sentence.",
  },
  {
    key: "tests",
    label: "Test Results",
    on: true,
    fixed: false,
    hint: "Each section's key result against its limit or specification, in report order.",
  },
  {
    key: "defects",
    label: "Defects Found",
    on: true,
    fixed: false,
    hint: "Holes by location, and visual defects by class against accept and reject.",
  },
  { key: "comments", label: "Inspector Comments", on: true, fixed: false, hint: "The inspector's comments on the sections, in short." },
  { key: "excluded", label: "Sections Switched Off", on: false, fixed: false, hint: "Sections left out of this inspection, with the reason." },
  {
    key: "next_step",
    label: "Next Step",
    on: true,
    fixed: false,
    hint: "One closing sentence on what the conclusion means for the lot. It never promises shipment, and it is left out while any section is not done.",
  },
] as const;
export type SummarySectionKey = (typeof SUMMARY_SECTIONS)[number]["key"];
export const SUMMARY_SECTION_KEYS: readonly SummarySectionKey[] = SUMMARY_SECTIONS.map((section) => section.key);

/** What Order Overview names. The report's header already prints them all, so the last four are off. */
export const SUMMARY_OVERVIEW_DETAILS = [
  { key: "product", label: "Product", on: true },
  { key: "po", label: "PO Number", on: true },
  { key: "sizes", label: "Sizes", on: true },
  { key: "quantities", label: "Quantities (Cartons and Gloves)", on: true },
  { key: "client", label: "Client", on: false },
  { key: "manufacturer", label: "Manufacturer and Factory", on: false },
  { key: "lots", label: "Lot Numbers", on: false },
  { key: "date", label: "Inspection Date", on: false },
] as const;
export type SummaryOverviewKey = (typeof SUMMARY_OVERVIEW_DETAILS)[number]["key"];
export const SUMMARY_OVERVIEW_KEYS: readonly SummaryOverviewKey[] = SUMMARY_OVERVIEW_DETAILS.map((detail) => detail.key);

export const SUMMARY_GROUPING = [
  { value: "test", label: "By Test", hint: null },
  { value: "size", label: "By Size", hint: null },
] as const satisfies readonly Choice[];

export const SUMMARY_SIZES = [
  { value: "differences", label: "Only Where Results Differ", hint: null },
  { value: "every", label: "Every Size", hint: null },
] as const satisfies readonly Choice[];

/** Each with its example sentence, shown under the select. */
export const SUMMARY_POINTS_OF_VIEW = [
  { value: "third_person", label: "Third Person", hint: "The watertight test found 1 hole in 500 gloves." },
  { value: "passive", label: "Passive", hint: "1 hole was found in 500 gloves." },
  { value: "we", label: "We (SteriCare)", hint: "We found 1 hole in 500 gloves." },
  { value: "i", label: "I (The Inspector)", hint: "I found 1 hole in 500 gloves." },
] as const satisfies readonly Choice[];

export const SUMMARY_TONES = [
  { value: "formal", label: "Formal", hint: null },
  { value: "professional", label: "Professional", hint: null },
  {
    value: "plain",
    label: "Plain English",
    hint: "Short sentences and everyday words, for readers whose first language is not English.",
  },
] as const satisfies readonly Choice[];

export const SUMMARY_TERMINOLOGY = [
  { value: "template", label: "Template's Wording", hint: "Section and defect names as the report prints them." },
  { value: "standard", label: "Standard Terms", hint: "ISO 2859-1, EN 455 and ASTM D6319 names." },
  { value: "everyday", label: "Everyday Words", hint: "Watertight test, visual check." },
] as const satisfies readonly Choice[];

/** What is bold. Problem sections: failed, passed with a warning, or not done. */
export const SUMMARY_EMPHASIS = [
  { value: "result_and_issues", label: "Conclusion and Problem Sections", hint: null },
  { value: "result", label: "Conclusion Only", hint: null },
  { value: "none", label: "No Bold", hint: null },
] as const satisfies readonly Choice[];

/** 13 October 2026 reads the same to UK, US and Malaysian readers. */
export const SUMMARY_DATE_FORMATS = [
  { value: "d_month_yyyy", label: "13 October 2026", hint: null },
  { value: "dd_mm_yyyy", label: "13/10/2026", hint: null },
  { value: "iso", label: "2026-10-13", hint: null },
  { value: "month_d_yyyy", label: "October 13, 2026", hint: null },
] as const satisfies readonly Choice[];

/** Section titles, defect names and the conclusion words stay as the report prints them, whatever the language. */
export const SUMMARY_LANGUAGES = [
  { value: "en-GB", label: "English (UK Spelling)", hint: null },
  { value: "en-US", label: "English (US Spelling)", hint: null },
  { value: "ms", label: "Bahasa Melayu", hint: null },
  { value: "zh-Hans", label: "Chinese (Simplified)", hint: null },
] as const satisfies readonly Choice[];

/** The longest texts: the inspector's note, each house sentence, the instruction, each example, and the examples kept. */
export const SUMMARY_LIMITS = { note: 300, sentence: 300, instruction: 500, example: 1500, examples: 2 } as const;

/** The settings card's labels and hints, by style key (the model's too). */
export const SUMMARY_FIELDS = {
  model: { label: "Model", hint: "For the Steri-AI Summary button on the Conclusion." },
  length: {
    label: "Length",
    hint: "A guide: Steri-AI aims within a quarter either side, and an order with several sizes may run longer.",
  },
  paragraphs: { label: "Paragraphs", hint: "Not used for Bullet Points." },
  format: { label: "Format", hint: null },
  numbers: { label: "Numbers", hint: null },
  sections: {
    label: "Sections and Order",
    hint: "The order is also the priority: when the length is tight, Steri-AI shortens the parts lower down first, then leaves them out. Result and Issues First are never left out.",
  },
  overview: { label: "Order Overview Names", hint: "The report's header already prints them." },
  inspectorsCanAdjust: {
    label: "Inspectors Can Adjust Length, Paragraphs and Format",
    hint: "From the menu beside the button, for one summary. Everything else on this card always applies.",
  },
  grouping: { label: "Group Results", hint: null },
  sizes: { label: "Sizes", hint: null },
  mentionSuggestion: {
    label: "Mention the Suggested Result When It Differs",
    hint: "The report prints the Conclusion and the Remark, not the suggested result. On: one sentence such as 'The suggested result was HOLD, as nine sections were not done.'",
  },
  pointOfView: { label: "Point of View", hint: null },
  tone: { label: "Tone", hint: null },
  terminology: { label: "Terminology", hint: null },
  emphasis: { label: "Bold", hint: null },
  colourResult: {
    label: "Colour the Conclusion Word",
    // The text colours have green and red but no amber (lib/rich-text), so HOLD keeps the text colour.
    hint: "PASSED green and FAILED red; HOLD stays black. Black-and-white prints and the plain-text copy lose colour.",
  },
  dateFormat: { label: "Dates", hint: null },
  language: { label: "Language", hint: null },
  languagesOffered: { label: "Languages Inspectors Can Choose", hint: "The menu beside the button shows Language once two or more are ticked." },
  verdictSentences: {
    label: "Verdict Sentences",
    hint: "Added word for word as the summary's last paragraph, for the conclusion chosen. Steri-AI then writes no Next Step of its own.",
  },
  closingSentence: { label: "Closing Sentence", hint: "Added word for word at the very end." },
  customInstruction: { label: "Instruction for Steri-AI", hint: null },
  examples: {
    label: "Example Summaries",
    hint: "Steri-AI copies their layout and tone, never their facts. They go with every summary for every client, so replace client, manufacturer, PO, lot and carton details with placeholders such as [PO].",
  },
} as const;

/** One field per conclusion: no placeholders. */
export const SUMMARY_VERDICT_FIELDS = [
  { key: "pass", label: "Verdict Sentence for PASSED" },
  { key: "fail", label: "Verdict Sentence for FAILED" },
  { key: "hold", label: "Verdict Sentence for HOLD" },
] as const;

export const SUMMARY_PLACEHOLDERS = {
  closingSentence: "This summary reflects the goods sampled at the time and place of inspection.",
  customInstruction: "Call the manufacturer the supplier.",
} as const;

/** The menu beside the button: what is not a style choice. */
export const SUMMARY_MENU_TEXT = {
  note: {
    label: "Note for Steri-AI (Optional)",
    hint: "Facts the inspection does not hold, such as 'The factory agreed to re-sort size M.' Steri-AI uses it as your statement.",
  },
  polish: {
    label: "Polish My Text",
    hint: "Keeps your facts and figures, fixes the wording and adds nothing. Formatting other than bold and lists is reset.",
  },
  locked: "Length, paragraphs and format follow SteriCare's house style.",
} as const;

/* ------------------------------------------------------------------ *
 * Field schemas
 * ------------------------------------------------------------------ */

export const SummaryLengthSchema = z.enum(valuesOf(SUMMARY_LENGTHS), { error: "Choose a length." });
export type SummaryLength = z.infer<typeof SummaryLengthSchema>;

export const SummaryParagraphsSchema = z.literal(["auto", 1, 2, 3, 4, 5], { error: "Choose Auto or 1 to 5 paragraphs." });
export type SummaryParagraphs = z.infer<typeof SummaryParagraphsSchema>;

export const SummaryFormatSchema = z.enum(valuesOf(SUMMARY_FORMATS), { error: "Choose a format." });
export type SummaryFormat = z.infer<typeof SummaryFormatSchema>;

export const SummaryLanguageSchema = z.enum(valuesOf(SUMMARY_LANGUAGES), { error: "Choose a language." });
export type SummaryLanguage = z.infer<typeof SummaryLanguageSchema>;

export type SummaryEmphasis = (typeof SUMMARY_EMPHASIS)[number]["value"];

/**
 * No NUL and no lone surrogate (half an emoji): Postgres refuses both in
 * jsonb. With the u flag a whole emoji is one code point, so the range
 * matches only a surrogate standing alone.
 */
function isStorable(text: string): boolean {
  return !/\u0000|[\ud800-\udfff]/u.test(text);
}

function textSchema(max: number, error: string) {
  return z
    .string({ error: "Enter text." })
    .trim()
    .max(max, { error })
    .refine(isStorable, { error: "This text holds a character that cannot be saved." });
}

const SentenceSchema = textSchema(SUMMARY_LIMITS.sentence, "Keep a sentence to 300 characters.");
const InstructionSchema = textSchema(SUMMARY_LIMITS.instruction, "Keep the instruction to 500 characters.");
const ExampleSchema = textSchema(SUMMARY_LIMITS.example, "Keep an example to 1,500 characters.");
const NoteSchema = textSchema(SUMMARY_LIMITS.note, "Keep the note to 300 characters.");

/** Used word for word, with no placeholder. Blank: Steri-AI writes the Next Step itself. */
const VerdictSentencesSchema = z.object({
  pass: SentenceSchema.default(""),
  fail: SentenceSchema.default(""),
  hold: SentenceSchema.default(""),
});

export type SummarySection = { key: SummarySectionKey; on: boolean };

const isSectionKey = (key: string): key is SummarySectionKey => (SUMMARY_SECTION_KEYS as readonly string[]).includes(key);

/**
 * Every known part once, in the order given: a key this build does not know
 * (a style saved by another build) is dropped, a part added later is
 * appended switched off, and Result is put first and on.
 */
function normaliseSections(list: readonly { key: string; on: boolean }[]): SummarySection[] {
  const known = list.filter((entry) => isSectionKey(entry.key)) as SummarySection[];
  const missing = SUMMARY_SECTION_KEYS.filter((key) => !known.some((entry) => entry.key === key)).map((key) => ({ key, on: false }));
  return [{ key: "result", on: true }, ...[...known, ...missing].filter((entry) => entry.key !== "result")];
}

const SummarySectionsSchema = z
  .array(z.object({ key: z.string().max(40), on: z.boolean({ error: "Switch the part on or off." }) }))
  .max(30)
  .superRefine((list, context) => {
    const seen = new Set<string>();
    list.forEach((entry, index) => {
      if (seen.has(entry.key)) context.addIssue({ code: "custom", path: [index, "key"], message: "List each part once." });
      seen.add(entry.key);
    });
  })
  .transform(normaliseSections);

/** The details ticked, in their own order; a key this build does not know is dropped. */
const SummaryOverviewSchema = z
  .array(z.string().max(40))
  .max(20)
  .transform((keys) => SUMMARY_OVERVIEW_KEYS.filter((key) => keys.includes(key)));

const defaultSections = (): SummarySection[] => SUMMARY_SECTIONS.map(({ key, on }) => ({ key, on }));
const defaultOverview = (): SummaryOverviewKey[] => SUMMARY_OVERVIEW_DETAILS.filter((detail) => detail.on).map((detail) => detail.key);

/** The house language is always offered; the list follows SUMMARY_LANGUAGES' order. */
function withHouseLanguage<T extends { language: SummaryLanguage; languagesOffered: SummaryLanguage[] }>(style: T): T {
  const offered = valuesOf(SUMMARY_LANGUAGES).filter((value) => value === style.language || style.languagesOffered.includes(value));
  return { ...style, languagesOffered: offered };
}

/* ------------------------------------------------------------------ *
 * The house style
 * ------------------------------------------------------------------ */

/**
 * The house style as stored in ai_settings.summary_style. A plain object, so
 * a style saved by an older build with a key this build dropped still reads,
 * and a key added later takes its default.
 */
export const SummaryStyleSchema = z
  .object({
    length: SummaryLengthSchema.default("standard"),
    paragraphs: SummaryParagraphsSchema.default("auto"),
    format: SummaryFormatSchema.default("paragraphs"),
    numbers: z.enum(valuesOf(SUMMARY_NUMBERS), { error: "Choose how many figures." }).default("key"),
    sections: SummarySectionsSchema.default(defaultSections),
    overview: SummaryOverviewSchema.default(defaultOverview),
    /** Inspectors may change length, paragraphs, format and (when offered) language for one summary. */
    inspectorsCanAdjust: z.boolean().default(true),
    grouping: z.enum(valuesOf(SUMMARY_GROUPING), { error: "Choose how results are grouped." }).default("test"),
    sizes: z.enum(valuesOf(SUMMARY_SIZES), { error: "Choose which sizes are named." }).default("differences"),
    /** Off (Kenneth, 12 October 2026): the report prints the Conclusion and the Remark, not the suggested result. */
    mentionSuggestion: z.boolean().default(false),
    pointOfView: z.enum(valuesOf(SUMMARY_POINTS_OF_VIEW), { error: "Choose a point of view." }).default("third_person"),
    tone: z.enum(valuesOf(SUMMARY_TONES), { error: "Choose a tone." }).default("professional"),
    terminology: z.enum(valuesOf(SUMMARY_TERMINOLOGY), { error: "Choose the terminology." }).default("template"),
    emphasis: z.enum(valuesOf(SUMMARY_EMPHASIS), { error: "Choose what is bold." }).default("result_and_issues"),
    /** PASSED green, FAILED red; HOLD keeps the text colour while the palette has no amber. */
    colourResult: z.boolean().default(false),
    dateFormat: z.enum(valuesOf(SUMMARY_DATE_FORMATS), { error: "Choose a date format." }).default("d_month_yyyy"),
    language: SummaryLanguageSchema.default("en-GB"),
    /** The languages the inspector's menu offers; it shows Language only with two or more. The house language is always in. */
    languagesOffered: z
      .array(SummaryLanguageSchema)
      .max(SUMMARY_LANGUAGES.length)
      .default((): SummaryLanguage[] => ["en-GB"]),
    verdictSentences: VerdictSentencesSchema.default(() => ({ pass: "", fail: "", hold: "" })),
    closingSentence: SentenceSchema.default(""),
    customInstruction: InstructionSchema.default(""),
    /** Layout and tone only. Sent with every summary for every client, so details are placeholders. Blank ones are dropped. */
    examples: z
      .array(ExampleSchema)
      .max(SUMMARY_LIMITS.examples, { error: "Add up to 2 examples." })
      .transform((examples) => examples.filter((example) => example !== ""))
      .default(() => []),
  })
  .overwrite(withHouseLanguage);
export type SummaryStyle = z.output<typeof SummaryStyleSchema>;
export type SummaryStyleInput = z.input<typeof SummaryStyleSchema>;

export const DEFAULT_SUMMARY_STYLE: SummaryStyle = SummaryStyleSchema.parse({});

/**
 * The Inspection Summary's own model (Kenneth, 12 October 2026: Claude
 * Sonnet 5.5). In the prompt lab Sonnet 5.5 wrote accurate drafts at about
 * half Opus 5.5's cost; Opus followed the rules more closely.
 */
export const DEFAULT_SUMMARY_MODEL = "claude-sonnet-5-5";

/** What the settings card's Save posts. */
export const SummarySettingsInputSchema = z.object({ model: ClaudeModelIdSchema, style: SummaryStyleSchema });
export type SummarySettingsInput = z.output<typeof SummarySettingsInputSchema>;

/** Try It: one real call on an inspection, with the card's unsaved model and style. */
export const SummaryPreviewInputSchema = z.strictObject({
  inspectionId: z.uuid(),
  model: ClaudeModelIdSchema,
  style: SummaryStyleSchema,
});
export type SummaryPreviewInput = z.input<typeof SummaryPreviewInputSchema>;

/* ------------------------------------------------------------------ *
 * One summary
 * ------------------------------------------------------------------ */

/** write: from the inspection. polish: the inspector's own text, keeping its facts and adding none. */
export const SUMMARY_MODES = ["write", "polish"] as const;
export type SummaryMode = (typeof SUMMARY_MODES)[number];

/**
 * What the button sends for one summary: the inspector's menu choices, which
 * apply only as resolveSummaryStyle allows, and a note (facts the inspection
 * does not hold, passed to Steri-AI as the inspector's statement).
 */
export const SummaryOptionsSchema = z.strictObject({
  mode: z.enum(SUMMARY_MODES),
  length: SummaryLengthSchema.optional(),
  paragraphs: SummaryParagraphsSchema.optional(),
  format: SummaryFormatSchema.optional(),
  language: SummaryLanguageSchema.optional(),
  note: NoteSchema.default(""),
});
/** What the button passes (the note may be left out). */
export type SummaryOptions = z.input<typeof SummaryOptionsSchema>;
/** As the server reads it. */
export type ParsedSummaryOptions = z.output<typeof SummaryOptionsSchema>;

/**
 * The style one summary is written with: the house style, with the
 * inspector's length, paragraphs and format while inspectorsCanAdjust is on,
 * and their language only when it is offered. With inspectorsCanAdjust off
 * nothing from the menu applies, the language included. The server applies
 * this again: the menu's choices are never trusted.
 */
export function resolveSummaryStyle(
  style: SummaryStyle,
  options: Pick<ParsedSummaryOptions, "length" | "paragraphs" | "format" | "language">,
): SummaryStyle {
  if (!style.inspectorsCanAdjust) return style;
  const language =
    options.language !== undefined && style.languagesOffered.includes(options.language) ? options.language : style.language;
  return {
    ...style,
    length: options.length ?? style.length,
    paragraphs: options.paragraphs ?? style.paragraphs,
    format: options.format ?? style.format,
    language,
  };
}

/** Paragraphs to ask for: the setting, or the length's own number on Auto. */
export function paragraphTarget(style: Pick<SummaryStyle, "length" | "paragraphs">): number {
  if (style.paragraphs !== "auto") return style.paragraphs;
  return SUMMARY_LENGTHS.find((length) => length.value === style.length)?.autoParagraphs ?? 2;
}

/** Shorter (-1) and Longer (+1): the next length, or the same one at either end. */
export function stepLength(length: SummaryLength, step: 1 | -1): SummaryLength {
  const order = valuesOf(SUMMARY_LENGTHS);
  const index = Math.min(order.length - 1, Math.max(0, order.indexOf(length) + step));
  return order[index];
}

/**
 * The range Steri-AI is asked to write within: a quarter either side of the
 * target (Brief 60 to 100 words, Standard 113 to 188, Detailed 225 to 375),
 * in Chinese characters at twice the numbers.
 */
export function summaryLengthRange(length: SummaryLength, language: SummaryLanguage): { lo: number; hi: number; unit: "words" | "characters" } {
  const words = SUMMARY_LENGTHS.find((entry) => entry.value === length)?.words ?? 150;
  const scale = language === "zh-Hans" ? 2 : 1;
  return {
    lo: Math.round(words * 0.75) * scale,
    hi: Math.round(words * 1.25) * scale,
    unit: language === "zh-Hans" ? "characters" : "words",
  };
}

/** Words in a summary's plain text, or characters (spaces aside) for Chinese. */
export function countSummaryWords(text: string, language: SummaryLanguage): number {
  if (language === "zh-Hans") return [...text.replace(/\s+/gu, "")].length;
  return text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** What the menu beside the button offers, from the house style (loadSummaryMenu on the server). */
export type SummaryMenu = {
  length: SummaryLength;
  paragraphs: SummaryParagraphs;
  format: SummaryFormat;
  language: SummaryLanguage;
  /** The house language first among them; the menu shows Language only with two or more. */
  languagesOffered: SummaryLanguage[];
  inspectorsCanAdjust: boolean;
};

export function summaryMenuOf(style: SummaryStyle): SummaryMenu {
  return {
    length: style.length,
    paragraphs: style.paragraphs,
    format: style.format,
    language: style.language,
    languagesOffered: [...style.languagesOffered],
    inspectorsCanAdjust: style.inspectorsCanAdjust,
  };
}

/* ------------------------------------------------------------------ *
 * What a draft answers (draftInspectionSummary, previewSummaryAction)
 * ------------------------------------------------------------------ */

export type SummaryFailureReason = "not_connected" | "misconfigured" | "needs_result" | "changed" | "forbidden" | "error";

/** A draft for the field. Nothing is written to the inspection: the screen inserts `doc` through the editor and autosave. */
export type SummaryDraftSuccess = {
  ok: true;
  mode: SummaryMode;
  /** The Inspection Summary's own document (lib/schemas/rich-text.ts), validated, house wording included. */
  doc: RichTextDoc;
  /** The same as plain text (richTextPlain), for the draft mark's hash and the word count. */
  text: string;
  /** Steri-AI's notes to the inspector, at most 3, never part of the summary. */
  notes: string[];
  /** Figures in the draft that the inspection, the note or the house wording do not hold, at most 5. */
  figures: string[];
  /** Words, or characters for Chinese (countSummaryWords). */
  words: number;
  /** The model that answered (a fallback model when one took over). */
  model: string;
  /** summaryBasisHash of the saved data the draft was written from, for "The inspection changed…". */
  basis: string;
};
export type SummaryDraftFailure = { ok: false; reason: SummaryFailureReason; message: string };
export type SummaryDraftResult = SummaryDraftSuccess | SummaryDraftFailure;
/** What the screen's draft() answers: the action's result, or the screen's own failure (not saved, unreachable). */
export type SummaryAssistResult = SummaryDraftResult;

/** Try It's sample: the same draft, nothing written and no basis. */
export type SummaryPreviewResult = Omit<SummaryDraftSuccess, "mode" | "basis"> | SummaryDraftFailure;

/** The messages, in Steri-AI wording, that the server and the button share. */
export const SUMMARY_MESSAGES = {
  notConnected:
    "Steri-AI Summary needs Steri-AI, which is not connected yet. Ask an admin to add the Anthropic API key under Admin > Steri-AI Settings.",
  modelNotClaude: "The model for Inspection Summary is not a Claude model. Ask an admin to check Admin > Steri-AI Settings.",
  notUnderstood: "The request was not understood. Reload the page and try again.",
  notAvailable: "This inspection is not available.",
  readOnly: "This inspection can no longer be changed here.",
  changed: "This inspection changed on another device since this one last saved. Reload the page, then try again.",
  unreadable: "This inspection's template or data cannot be read.",
  nothingToPolish: "There is no text to polish yet.",
  failed: "Steri-AI could not write the summary. Try again.",
  declined: "Steri-AI declined to write this summary. Write it yourself, or try again with a note.",
  cutOff: "Steri-AI's summary was cut off. Choose a shorter length and try again.",
  checksFailed: "Steri-AI's summary did not pass its checks. Try again, or write it yourself.",
  offline: "Steri-AI Summary needs a connection. Write the summary yourself, or try again once you are back online.",
  /** Followed by autosave's own message. */
  notSavedPrefix: "Not everything is saved yet. ",
  unreachable: "Could not reach the server. Check the connection, then try again.",
} as const;

/** "Choose PASSED, FAILED or HOLD first: …", in the template's words. Write only; Polish My Text works any time. */
export function needsResultMessage(words: { pass: string; fail: string; hold: string }): string {
  return `Choose ${words.pass}, ${words.fail} or ${words.hold} first: the summary starts with the conclusion.`;
}
