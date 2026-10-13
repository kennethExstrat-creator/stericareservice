// The checks every Steri-AI Summary draft passes before an inspector sees it
// (docs/AI.md, "Steri-AI Summary"; 12 October 2026). Hard checks: a draft
// that fails one is asked for once more, with the problem after the cache
// breakpoint, and a second failure is an error; nothing that fails reaches
// the field. The lab's third call shows why: valid JSON and a normal stop,
// but the paragraph broke off at "… 2,900 cartons, concluded", just where
// the conclusion word should have been. The reviewers' real calls added
// two (Kenneth, 12 October 2026): a polish that leaves out a sentence or a
// figure of the inspector's text (it took out "Checked on site.", "as it is
// not a recorded fact"), a hard check; and a draft far over its length
// (249 words against Standard's 188), asked for once more but kept with a
// note the second time. Notes in the first person, about "the data" or
// about the inspection being a draft are dropped. Soft checks (figures the
// inspection does not hold) are only shown under the field. Pure.
import { richTextPlain } from "@/lib/rich-text";
import type { InspectionResult } from "@/lib/schemas/common";
import { RICH_TEXT_MAX_CHARACTERS, richTextLength, richTextParagraphs, type RichTextDoc } from "@/lib/schemas/rich-text";
import {
  countSummaryWords,
  SUMMARY_LENGTHS,
  summaryLengthRange,
  type SummaryLanguage,
  type SummaryMode,
  type SummaryStyle,
} from "@/lib/schemas/summary-style";
import { wholeWordPattern, type SummaryAnswer } from "./summary-doc";
import { lengthUnitText, listOf } from "./summary-style-text";
import type { ResultWords } from "./summary-view";

/** What a summary never says: the app, the AI, field names and codes, placeholders, links, email addresses. */
export const FORBIDDEN_TERMS = /\bSteri-?AI\b|\bAI\b|\bJSON\b|not_done|\bmodules?\b|\{[a-zA-Z]+\}|https?:\/\/|\S+@\S+\.\w+/u;

/** A complete paragraph or point: it ends with . ! ? 。 ！ or ？, a closing bracket or quote after it at most. */
const COMPLETE = /[.!?。！？][)"”’]*$/u;

export type HardCheckInput = {
  answer: SummaryAnswer;
  /** Steri-AI's text as the field's document, before the house wording. */
  doc: RichTextDoc;
  /** What the field would hold: the text and the house wording. */
  full: RichTextDoc;
  mode: SummaryMode;
  finalResult: InspectionResult | null;
  words: ResultWords;
  language: SummaryLanguage;
  mentionSuggestion: boolean;
  /** Polish: the inspector's text as sent (docToInlineText), whose sentences and figures the answer keeps. */
  draft?: string | null;
};

function paragraphText(paragraph: ReturnType<typeof richTextParagraphs>[number]): string {
  return (paragraph.content ?? []).map((inline) => (inline.type === "text" ? inline.text : " ")).join("").trim();
}

/** The word on its own (no letter or digit of a longer word either side; Chinese may touch it), as written. */
function wordPattern(word: string): RegExp {
  return wholeWordPattern([word]);
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?。！？])\s+|\n+/u);

/** The last few words of a paragraph that broke off, for the retry's problem line. */
function tail(text: string): string {
  const words = text.split(/\s+/u);
  return words.length > 6 ? `… ${words.slice(-6).join(" ")}` : text;
}

/**
 * Every hard check the draft fails, as problems for the retry ("Your
 * previous answer …"); empty when it passes. Write only, the conclusion
 * word must be there; in English, no other conclusion word may be, except,
 * with mentionSuggestion on, in a sentence about the suggested result.
 * Polish keeps the inspector's words, so it skips both, and keeps every
 * sentence and figure of the inspector's draft instead (droppedFromDraft).
 */
export function hardCheckProblems(input: HardCheckInput): string[] {
  if (input.answer.blocks.some((block) => block.items.some((item) => item.replaceAll("**", "").trim() === ""))) {
    return ["had an empty paragraph or list point"];
  }
  const paragraphs = richTextParagraphs(input.doc).map(paragraphText).filter((text) => text !== "");
  if (paragraphs.length === 0) return ["had no summary"];

  const problems: string[] = [];
  const open = paragraphs.find((text) => !COMPLETE.test(text));
  if (open) problems.push(`stopped mid-sentence ("${tail(open)}")`);

  const text = richTextPlain(input.doc);
  if (input.mode === "write" && input.finalResult !== null) {
    const word = input.words[input.finalResult];
    if (!wordPattern(word).test(text)) problems.push(`did not state the conclusion, ${word}`);
    if (input.language === "en-GB" || input.language === "en-US") {
      const others = (["pass", "fail", "hold"] as const).filter((result) => result !== input.finalResult).map((result) => input.words[result]);
      const allowed = (sentence: string) => input.mentionSuggestion && /suggest/iu.test(sentence);
      const stray = others.find((other) => sentencesOf(text).some((sentence) => wordPattern(other).test(sentence) && !allowed(sentence)));
      if (stray) {
        problems.push(
          input.mentionSuggestion
            ? `used ${stray} outside the sentence about the suggested result, though the conclusion is ${word}`
            : `used ${stray}, though the conclusion is ${word} and the suggested result is not to be mentioned`,
        );
      }
    }
  }

  if (input.mode === "polish" && input.draft) {
    const dropped = droppedFromDraft(input.draft, text, input.language);
    if (dropped.sentences.length > 0 || dropped.figures.length > 0) problems.push(droppedProblem(dropped));
  }

  const forbidden = FORBIDDEN_TERMS.exec(text);
  if (forbidden) problems.push(`mentioned "${forbidden[0]}", which a summary never mentions`);
  if (richTextLength(input.full) > RICH_TEXT_MAX_CHARACTERS) problems.push("was longer than the summary's 5,000 characters");
  return problems;
}

/* ------------------------------------------------------------------ *
 * Figures (soft): shown under the field, never retried
 * ------------------------------------------------------------------ */

/** A figure as written: thousands separators and a percent sign included. */
const FIGURE = /\d+(?:,\d{3})*(?:\.\d+)?%?/gu;
/** Standards named with their numbers: "ISO 2859-1", "EN 455", "ASTM D6319". */
const STANDARD_NAMES = /\b(?:ISO\s?2859-1|EN\s?455|ASTM\s?D\d{4})\b/gu;

const valueOf = (figure: string) => Number(figure.replace(/[,%]/gu, ""));

/**
 * The figures in `text` whose value none of `sources` holds (2,900 matches
 * 2900; 17% does not match 17.1%), as written, each once, at most `max`.
 * The sources are the inspection Steri-AI read, the note, the inspector's
 * draft and the house wording: never the example summaries.
 */
export function unknownFigures(text: string, sources: readonly string[], max = 5): string[] {
  const known = new Set<number>();
  for (const source of sources) for (const match of source.matchAll(FIGURE)) known.add(valueOf(match[0]));
  const unknown: string[] = [];
  for (const match of text.replace(STANDARD_NAMES, " ").matchAll(FIGURE)) {
    const figure = match[0];
    if (known.has(valueOf(figure)) || unknown.includes(figure)) continue;
    unknown.push(figure);
    if (unknown.length === max) break;
  }
  return unknown;
}

/* ------------------------------------------------------------------ *
 * Polish My Text keeps the inspector's sentences and figures (hard)
 * ------------------------------------------------------------------ */

/** A list mark docToInlineText writes ("- ", "1. ") or an inspector typed ("• ", "2) "). */
const LIST_MARK = /^(?:[-*•]|\d+[.)])\s+/u;
/** A date in figures (09/10/2026, 2026-10-09), which the style's Dates may write in words. */
const NUMERIC_DATE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/gu;
/** A word, or a figure with its thousands separators and decimals. */
const TOKEN = /\d+(?:,\d{3})*(?:\.\d+)?|[\p{L}\p{M}]+/gu;
/** Words that tell little on their own: a sentence is recognised by its other words. */
const COMMON_WORDS = new Set(
  (
    "the and but for nor not yet with without from into onto upon over under than then that this these those there here " +
    "was were are has had have having been being its all any each per via also only very such some more most less " +
    "which who whom whose what when where while their them they our your his her she him one two three " +
    // Units and fillers a polish may drop: "3 pcs", "OK lah".
    "pcs okay lah leh lor meh mah hor liao"
  ).split(" "),
);
/** A sentence is kept while a sentence of the answer holds half its telling words, two at least (keptIn). */
const KEPT_SHARE = 0.5;
/** An answer with under 30% of the draft's running words was translated or rewritten whole: sentences are not compared. */
const SAME_TEXT_SHARE = 0.3;
/** What a summary never says (FORBIDDEN_TERMS, a link whole): a polish cannot keep it, so it is no word of the draft's. */
const NEVER_KEPT = new RegExp(`https?:\\/\\/\\S+|${FORBIDDEN_TERMS.source}`, "gu");

const withoutMarks = (line: string) => line.replace(LIST_MARK, "").replaceAll("**", "").trim();

/** A text's sentences: by line (list points), then by full stop, question or exclamation mark; list marks and bold aside. */
function sentencesIn(text: string): string[] {
  return text
    .split(/\n+/u)
    .map(withoutMarks)
    .flatMap((line) => line.split(/(?<=[.!?。！？])\s+/u))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/** A shortform in capitals (WTT, FAB, SKV), which a polish writes in full: never one of the draft's telling words. */
const SHORTFORM = /^[A-Z]{2,6}$/u;

/** A figure by its value, "#2.9" for 2.90; a telling word lower-cased; null for a short or common word. */
function keyOf(token: string): string | null {
  if (/^\d/u.test(token)) return `#${Number(token.replaceAll(",", ""))}`;
  const word = token.toLowerCase();
  return word.length < 3 || COMMON_WORDS.has(word) ? null : word;
}

/** The telling words and figures of `text`, each once; the draft's (`draft`) without its shortforms in capitals. */
function keysOf(text: string, { draft = false }: { draft?: boolean } = {}): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(TOKEN)) {
    if (draft && SHORTFORM.test(match[0])) continue;
    const key = keyOf(match[0]);
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

/**
 * The draft's running words, for telling a translation (SAME_TEXT_SHARE):
 * no figure, shortform or word in capitals inside a sentence (a title, a
 * name), which a translation keeps as the report prints it.
 */
function runningWords(sentences: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const sentence of sentences) {
    [...sentence.matchAll(TOKEN)].forEach(([token], index) => {
      if (/^\d/u.test(token) || SHORTFORM.test(token) || (index > 0 && !/^\p{Ll}/u.test(token))) return;
      const key = keyOf(token);
      if (key !== null) keys.add(key);
    });
  }
  return [...keys];
}

/** One word with another ending: "checked" and "checks", "glove" and "gloves", "inspected" and "inspection". */
function sameWord(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length);
  let common = 0;
  while (common < shorter && a[common] === b[common]) common += 1;
  return common >= 3 && a.length - common <= 3 && b.length - common <= 3;
}

/** The draft's word written short: its first letters (insp, approx), or its letters with one vowel at most (qty, fty, chked). */
function shortFor(short: string, word: string): boolean {
  if (short.length < 3 || short.length >= word.length || short[0] !== word[0]) return false;
  if (word.startsWith(short)) return true;
  if ((short.match(/[aeiou]/gu)?.length ?? 0) > 1) return false;
  let next = 0;
  for (const letter of word) if (letter === short[next]) next += 1;
  return next === short.length;
}

/** One slip of the keys between words of five letters or more: a letter wrong, missing, added or swapped with the next (corect, lables). */
function oneSlip(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at += 1;
  if (a.length === b.length) {
    return a.slice(at + 1) === b.slice(at + 1) || (a[at] === b[at + 1] && a[at + 1] === b[at] && a.slice(at + 2) === b.slice(at + 2));
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.slice(at) === longer.slice(at + 1);
}

/**
 * The draft's word as a polish writes it: with another ending, in full
 * (insp, qty, chked), with a slip mended (corect), or as the last part of a
 * word written apart or in the report's term (onsite, pinhole).
 */
function alike(draftWord: string, answerWord: string): boolean {
  return (
    sameWord(draftWord, answerWord) ||
    shortFor(draftWord, answerWord) ||
    oneSlip(draftWord, answerWord) ||
    (answerWord.length >= 4 && draftWord.endsWith(answerWord))
  );
}

/** Whether the answer has the draft's key: a figure by its value, a word as written or alike. */
function holds(answerKeys: ReadonlySet<string>, key: string): boolean {
  if (answerKeys.has(key)) return true;
  if (key.startsWith("#")) return false;
  for (const other of answerKeys) if (!other.startsWith("#") && alike(key, other)) return true;
  return false;
}

/** The figures of `text` as written, standards' own numbers aside, and dates in figures too with `dates` false. */
function figuresOf(text: string, { dates }: { dates: boolean }): string[] {
  const kept = text.replace(STANDARD_NAMES, " ");
  return [...(dates ? kept : kept.replace(NUMERIC_DATE, " ")).matchAll(FIGURE)].map((match) => match[0]);
}

export type DroppedFromDraft = { sentences: string[]; figures: string[] };

/**
 * Whether one sentence of the answer holds half the keys, two at least; for
 * a sentence of four keys or more, two neighbouring sentences (one split in
 * two). A short sentence's words must stand together: "check" in Glove
 * Packing Check and "site" in the packing site never keep "Checked on site."
 */
function keptIn(answerSentences: readonly ReadonlySet<string>[], keys: readonly string[]): boolean {
  const needed = Math.max(2, Math.ceil(keys.length * KEPT_SHARE));
  return answerSentences.some((sentence, index) => {
    const next = keys.length >= 4 ? (answerSentences[index + 1] ?? []) : [];
    const window = new Set([...sentence, ...next]);
    return keys.filter((key) => holds(window, key)).length >= needed;
  });
}

/**
 * What a polish left out of the inspector's draft: each sentence of two or
 * more telling words that no sentence of the answer holds half of (keptIn:
 * a sentence reworded, merged, split or moved keeps most of its words; one
 * taken out keeps none), and each figure whose value the answer no longer
 * holds. A word counts as kept in another ending, in full, with a slip
 * mended or apart (alike: insp, qty, chked, corect, onsite); what a summary
 * never says (module, AI, a link) is no word of the draft's. Sentences are
 * compared only in English and where the answer is in the draft's words:
 * never in Bahasa Melayu or Chinese, nor when it shares under 30% of the
 * draft's running words (a draft in another language, translated; the
 * report's titles, kept as printed, do not count). Figures are compared
 * always, but for the draft's dates in figures, which the style's Dates may
 * write in words (09/10/2026 as 9 October 2026).
 */
export function droppedFromDraft(draft: string, answer: string, language: SummaryLanguage): DroppedFromDraft {
  // List numbers are no figures: both texts are read without their list marks.
  const draftSentences = sentencesIn(draft.replace(NEVER_KEPT, " ").replace(/[ \t]{2,}/gu, " "));
  const answerSentences = sentencesIn(answer);
  const answerFigures = new Set(figuresOf(answerSentences.join("\n"), { dates: true }).map(valueOf));
  const figures = [...new Set(figuresOf(draftSentences.join("\n"), { dates: false }))].filter(
    (figure) => !answerFigures.has(valueOf(figure)),
  );

  const answerKeys = new Set(keysOf(answerSentences.join("\n")));
  const running = runningWords(draftSentences);
  const shared = running.filter((key) => holds(answerKeys, key)).length;
  const english = language === "en-GB" || language === "en-US";
  if (!english || running.length === 0 || shared < running.length * SAME_TEXT_SHARE) return { sentences: [], figures };

  const answerKeySets = answerSentences.map((sentence) => new Set(keysOf(sentence)));
  const sentences = draftSentences.filter((sentence) => {
    const keys = keysOf(sentence, { draft: true });
    return keys.length >= 2 && !keptIn(answerKeySets, keys);
  });
  return { sentences, figures };
}

/** "Checked on site", within 80 characters: a sentence quoted in the problem line, without its full stop. */
function quoted(sentence: string): string {
  const bare = sentence.replace(/[.!?。！？]+$/u, "");
  const characters = Array.from(bare);
  return `"${characters.length > 80 ? `${characters.slice(0, 79).join("")}…` : bare}"`;
}

/** The retry's problem: what the polish left out, and the rule it broke. */
function droppedProblem({ sentences, figures }: DroppedFromDraft): string {
  const parts: string[] = [];
  if (sentences.length === 1) parts.push(`the inspector's sentence ${quoted(sentences[0])}`);
  if (sentences.length > 1) parts.push(`${sentences.length} of the inspector's sentences, such as ${quoted(sentences[0])}`);
  if (figures.length > 0) parts.push(`the inspector's ${figures.length === 1 ? "figure" : "figures"} ${listOf(figures.slice(0, 5))}`);
  return `left out ${parts.join(" and ")}: a polish keeps every sentence and figure of the draft, in or close to the inspector's words`;
}

/* ------------------------------------------------------------------ *
 * Length: binding, with room for a miscount (Kenneth, 12 October 2026)
 * ------------------------------------------------------------------ */

/** How far past the length's maximum, in %, a draft may run before it is asked for once more. */
export const LENGTH_TOLERANCE_PERCENT = 15;

/** The most a draft may run to: the maximum plus 15%, in whole words (Standard: 188 → 216). */
export function lengthLimit(max: number): number {
  return Math.floor((max * (100 + LENGTH_TOLERANCE_PERCENT)) / 100);
}

export type LengthCheck = {
  /** Steri-AI's own text, counted as the length is (countSummaryWords). */
  words: number;
  /** The length's maximum, as the request states it. */
  max: number;
  unit: "words" | "characters";
};

/**
 * Steri-AI's own text (never the house wording) against the length's
 * maximum: null within the maximum plus 15% (Standard: 216 words), else
 * the count. Write only: a polish keeps the inspector's length.
 */
export function overLength(text: string, style: Pick<SummaryStyle, "length" | "language">): LengthCheck | null {
  const { hi, unit } = summaryLengthRange(style.length, style.language);
  const words = countSummaryWords(text, style.language);
  return words > lengthLimit(hi) ? { words, max: hi, unit } : null;
}

/** The retry's problem: "was too long by 61 words (249; 188 at most) …". */
export function tooLongProblem({ words, max, unit }: LengthCheck): string {
  return `was too long by ${words - max} ${lengthUnitText(unit)} (${words}; ${max} at most): shorten the later parts first, then leave them out`;
}

/** The note a draft still too long after the retry is kept with: what to do, in the length's own words. */
export function lengthNote(style: Pick<SummaryStyle, "length" | "language">): string {
  const { hi, unit } = summaryLengthRange(style.length, style.language);
  const label = SUMMARY_LENGTHS.find((length) => length.value === style.length)?.shortLabel ?? "Standard";
  return `Shorten the summary to ${hi} ${lengthUnitText(unit)} at most (${label}).`;
}

/* ------------------------------------------------------------------ *
 * Notes: short, impersonal and practical (Kenneth, 12 October 2026)
 * ------------------------------------------------------------------ */

/** I, me, my, we, our, us (never US), with their contractions; never the Roman I of "inspection level I" or "Class I". */
const FIRST_PERSON =
  /(?<!\b(?:[Ll]evel|LEVEL|[Cc]lass|[Tt]ype|[Pp]art|[Pp]hase|[Gg]rade|[Cc]ategory|[Aa]nnex|[Tt]able)\s+)(?<![\p{L}\p{N}'’])(?:I(?:['’](?:m|ve|d|ll))?|[Mm](?:e|y|ine|yself)|[Ww]e(?:['’](?:re|ve|d|ll))?|[Oo]urs?|[Oo]urselves|[Uu]s)(?![\p{L}\p{N}'’])/u;
/** "the data", "the inspection data". */
const ABOUT_DATA = /\bdata\b/iu;
/**
 * The inspection's status: a summary is only written while it is a draft or
 * reopened. The inspector's own text called the draft ("The draft says …")
 * is no status, and neither is a document not submitted ("The lab report was
 * not submitted"): only the inspection is.
 */
const ABOUT_STATUS =
  /\b(?:(?:is|was|remains|still)\s+(?:still\s+)?(?:a\s+|in\s+)?draft\b|draft\s+(?:status|stage|state|inspection|report|mode)\b|reopened\b|inspection\s+(?:is|was|has|remains)\s+(?:still\s+)?not\s+(?:yet\s+)?(?:been\s+)?submitted\b|still\s+being\s+recorded\b)/iu;

/** A note Steri-AI should not have written: in the first person, about "the data", or about the inspection being a draft. */
export function isUnwantedNote(note: string): boolean {
  return FIRST_PERSON.test(note) || ABOUT_DATA.test(note) || ABOUT_STATUS.test(note);
}

/** The notes worth showing under the field: the unwanted ones dropped (isUnwantedNote). */
export function practicalNotes(notes: readonly string[]): string[] {
  return notes.filter((note) => !isUnwantedNote(note));
}
