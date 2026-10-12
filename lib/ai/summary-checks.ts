// The checks every Steri-AI Summary draft passes before an inspector sees it
// (docs/AI.md, "Steri-AI Summary"; 12 October 2026). Hard checks: a draft
// that fails one is asked for once more, with the problem after the cache
// breakpoint, and a second failure is an error; nothing that fails reaches
// the field. The lab's third call shows why: valid JSON and a normal stop,
// but the paragraph broke off at "… 2,900 cartons, concluded", just where
// the conclusion word should have been. Soft checks (figures the inspection
// does not hold) are only shown under the field. Pure.
import { richTextPlain } from "@/lib/rich-text";
import type { InspectionResult } from "@/lib/schemas/common";
import { RICH_TEXT_MAX_CHARACTERS, richTextLength, richTextParagraphs, type RichTextDoc } from "@/lib/schemas/rich-text";
import type { SummaryLanguage, SummaryMode } from "@/lib/schemas/summary-style";
import { wholeWordPattern, type SummaryAnswer } from "./summary-doc";
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
 * Polish keeps the inspector's words, so it skips both.
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
