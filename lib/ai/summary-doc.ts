// Steri-AI's answer for the Inspection Summary, and the field's own document
// made from it (docs/AI.md, "Steri-AI Summary"; 12 October 2026). The
// answer is flat: blocks of plain strings with **bold**, because structured
// outputs take no recursive schema, and because the prompt lab's runs of
// text with marks cost more tokens per word and once closed the array
// mid-sentence. The server turns it into the canonical document of
// lib/schemas/rich-text.ts (the form the editor stores), colours the
// conclusion word itself when the house style asks, adds the house wording
// word for word, and validates the result before it leaves the server.
// Pure, so every rule is unit-tested.
import { z } from "zod";
import { richTextPlain } from "@/lib/rich-text";
import type { InspectionResult } from "@/lib/schemas/common";
import {
  RICH_TEXT_COLOURS,
  type RichTextBlock,
  type RichTextColour,
  type RichTextDoc,
  type RichTextMark,
  type RichTextParagraph,
  type RichTextText,
} from "@/lib/schemas/rich-text";
import type { SummaryEmphasis } from "@/lib/schemas/summary-style";
import type { HouseWording } from "./summary-style-text";
import type { ResultWords } from "./summary-view";

/**
 * The answer's JSON schema, fixed for every request, so its compiled grammar
 * stays cached for 24 hours. Flat: structured outputs take no recursive
 * schema and no length or array-size constraints, so the server enforces
 * those (SummaryAnswerSchema).
 */
export const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      description: "The summary, in order.",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["paragraph", "bullet_list", "numbered_list"] },
          items: {
            type: "array",
            description: "A paragraph: exactly one string. A list: one string per point. Bold as **double asterisks**; no other markup.",
            items: { type: "string" },
          },
        },
        required: ["type", "items"],
        additionalProperties: false,
      },
    },
    notes: {
      type: "array",
      description: "Up to three short sentences in English to the inspector.",
      items: { type: "string" },
    },
  },
  required: ["blocks", "notes"],
  additionalProperties: false,
} as const;

export const SUMMARY_ANSWER_LIMITS = { blocks: 12, items: 20, itemCharacters: 1500, notes: 3, noteCharacters: 300 } as const;

/** At most `max` characters, never half an emoji. */
function cut(value: string, max: number): string {
  const characters = Array.from(value);
  return characters.length <= max ? value : characters.slice(0, max).join("");
}

/** The answer as the server takes it: 1 to 12 blocks of 1 to 20 strings; the notes trimmed, at most 3 of 300 characters. */
export const SummaryAnswerSchema = z.object({
  blocks: z
    .array(
      z.object({
        type: z.enum(["paragraph", "bullet_list", "numbered_list"]),
        items: z.array(z.string().max(SUMMARY_ANSWER_LIMITS.itemCharacters)).min(1).max(SUMMARY_ANSWER_LIMITS.items),
      }),
    )
    .min(1)
    .max(SUMMARY_ANSWER_LIMITS.blocks),
  notes: z.array(z.string()).transform((notes) =>
    notes
      .map((note) => note.trim())
      .filter((note) => note !== "")
      .slice(0, SUMMARY_ANSWER_LIMITS.notes)
      .map((note) => cut(note, SUMMARY_ANSWER_LIMITS.noteCharacters)),
  ),
});
export type SummaryAnswer = z.output<typeof SummaryAnswerSchema>;

export type AnswerRead = { ok: true; answer: SummaryAnswer } | { ok: false; problem: string };

/** The last text block of an answer, read and checked; the problem in words for the retry ("Your previous answer …"). */
export function parseSummaryAnswer(text: string): AnswerRead {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: "could not be read as the required JSON" };
  }
  const parsed = SummaryAnswerSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problem: "did not keep to the required JSON (1 to 12 blocks, each of 1 to 20 strings of at most 1,500 characters)",
    };
  }
  return { ok: true, answer: parsed.data };
}

/* ------------------------------------------------------------------ *
 * The answer as the field's document
 * ------------------------------------------------------------------ */

/** The text colour each conclusion word takes when the house style colours it; null keeps the text colour. */
export type ResultColours = Readonly<Record<InspectionResult, RichTextColour | null>>;

/**
 * Green for the pass word, red for the fail word (docs/DESIGN.md's status
 * colours, which the editor's palette has), amber for hold only once the
 * palette has an amber: until then HOLD keeps the text colour.
 */
export const RESULT_COLOURS: ResultColours = {
  pass: "green",
  fail: "red",
  hold: (RICH_TEXT_COLOURS as readonly string[]).includes("amber") ? ("amber" as RichTextColour) : null,
};

export type SummaryDocOptions = {
  /** The template's conclusion words. */
  words: ResultWords;
  emphasis: SummaryEmphasis;
  colourResult: boolean;
  colours?: ResultColours;
};

type Run = { text: string; bold: boolean; colour: RichTextColour | null };

/** A bullet, a number or a heading mark the answer should not have written: "- ", "* ", "• ", "1. ", "1) ", "# ". */
const LEADING_MARK = /^(?:[-*•]|\d+[.)]|#{1,6})\s+/u;

/** Control characters out (a tab becomes a space), and any surrogate standing alone. */
function cleanText(text: string): string {
  return text
    .replace(/\t/gu, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
    .replace(/[\ud800-\udfff]/gu, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * A letter or digit that would make a conclusion word part of a longer word.
 * Chinese, Japanese and Korean characters are left out: they sit right
 * against a Latin word ("结论为PASSED。"), which is still the word on its own.
 */
const WORD_CHARACTER = "(?![\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}])[\\p{L}\\p{N}]";

/** Any of `words` on its own, as written, captured: no letter or digit of a longer word either side. */
export function wholeWordPattern(words: readonly string[]): RegExp {
  const alternatives = words.map(escapeRegExp).sort((a, b) => b.length - a.length);
  return new RegExp(`(?<!${WORD_CHARACTER})(${alternatives.join("|")})(?!${WORD_CHARACTER})`, "u");
}

/** The pieces of a run, the conclusion words (as whole words) apart with their colour. */
function coloured(run: Omit<Run, "colour">, options: SummaryDocOptions): Run[] {
  const colours = options.colours ?? RESULT_COLOURS;
  const entries = (["pass", "fail", "hold"] as const)
    .map((result) => ({ word: options.words[result].trim(), colour: colours[result] }))
    .filter((entry) => entry.word !== "" && entry.colour !== null);
  if (!options.colourResult || entries.length === 0) return [{ ...run, colour: null }];
  const pattern = wholeWordPattern(entries.map((entry) => entry.word));
  return run.text.split(pattern).map((piece, index) => ({
    text: piece,
    bold: run.bold,
    colour: index % 2 === 1 ? (entries.find((entry) => entry.word === piece)?.colour ?? null) : null,
  }));
}

/** One answer string as runs: no stray list or heading mark, line breaks joined, **bold** read (all dropped when unbalanced). */
function runsOf(source: string, options: SummaryDocOptions, repairs: string[]): Run[] {
  let text = source.trim();
  if (LEADING_MARK.test(text)) {
    repairs.push("stripped a bullet, number or heading mark");
    text = text.replace(LEADING_MARK, "");
  }
  if (/[\r\n]/u.test(text)) {
    repairs.push("joined line breaks");
    text = text.replace(/\s*[\r\n]+\s*/gu, " ");
  }
  text = cleanText(text).replace(/ {2,}/gu, " ");
  const parts = text.split("**");
  let runs: Omit<Run, "colour">[];
  if (parts.length % 2 === 0) {
    repairs.push("unbalanced **: bold dropped");
    runs = [{ text: parts.join(""), bold: false }];
  } else {
    runs = parts.map((part, index) => ({ text: part, bold: index % 2 === 1 && options.emphasis !== "none" }));
  }
  return runs.flatMap((run) => coloured(run, options));
}

function marksOf(run: Run): RichTextMark[] {
  // The editor's own order (RICH_TEXT_MARK_ORDER): the text style, then bold.
  return [
    ...(run.colour ? [{ type: "textStyle" as const, attrs: { fontSize: null, color: run.colour } }] : []),
    ...(run.bold ? [{ type: "bold" as const }] : []),
  ];
}

function textNode(text: string, marks: RichTextMark[]): RichTextText {
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

/** Text nodes: neighbours with the same marks joined, empty ones dropped, the paragraph's ends trimmed. */
function textNodes(runs: readonly Run[]): RichTextText[] {
  const nodes: RichTextText[] = [];
  for (const run of runs) {
    const last = nodes.at(-1);
    // Never two spaces where two runs meet.
    const text = last?.text.endsWith(" ") ? run.text.replace(/^ +/u, "") : run.text;
    if (text === "") continue;
    const marks = marksOf(run);
    if (last && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) nodes[nodes.length - 1] = textNode(last.text + text, marks);
    else nodes.push(textNode(text, marks));
  }
  while (nodes.length > 0 && nodes[0].text.trimStart() === "") nodes.shift();
  while (nodes.length > 0 && nodes[nodes.length - 1].text.trimEnd() === "") nodes.pop();
  if (nodes.length > 0) {
    nodes[0] = textNode(nodes[0].text.trimStart(), nodes[0].marks ?? []);
    const end = nodes.length - 1;
    nodes[end] = textNode(nodes[end].text.trimEnd(), nodes[end].marks ?? []);
  }
  return nodes;
}

function paragraphOf(item: string, options: SummaryDocOptions, repairs: string[]): RichTextParagraph | null {
  const content = textNodes(runsOf(item, options, repairs));
  return content.length > 0 ? { type: "paragraph", content } : null;
}

/**
 * The answer as the Inspection Summary's document, in its canonical form
 * (as lib/rich-text toRichTextDoc stores it). A paragraph block gives a
 * paragraph per string (more than one is a repair); a bullet_list a bullet
 * list, a numbered_list a numbered list from 1; lists never nest. Empty
 * strings and lists are dropped. `repairs` says what was mended, so a
 * prompt problem shows in the server log. The caller validates the result.
 */
export function answerToDoc(answer: SummaryAnswer, options: SummaryDocOptions): { doc: RichTextDoc; repairs: string[] } {
  const repairs: string[] = [];
  const content: RichTextBlock[] = [];
  for (const block of answer.blocks) {
    if (block.type === "paragraph") {
      if (block.items.length !== 1) repairs.push(`a paragraph block held ${block.items.length} strings`);
      for (const item of block.items) {
        const paragraph = paragraphOf(item, options, repairs);
        if (paragraph) content.push(paragraph);
        else repairs.push("dropped an empty paragraph");
      }
      continue;
    }
    const items = block.items.flatMap((item) => {
      const paragraph = paragraphOf(item, options, repairs);
      return paragraph ? [{ type: "listItem" as const, content: [paragraph] as [RichTextParagraph] }] : [];
    });
    if (items.length === 0) {
      repairs.push("dropped an empty list");
      continue;
    }
    content.push(block.type === "bullet_list" ? { type: "bulletList", content: items } : { type: "orderedList", content: items });
  }
  return { doc: { type: "doc", content }, repairs };
}

/* ------------------------------------------------------------------ *
 * House wording, word for word
 * ------------------------------------------------------------------ */

/** The verdict sentence, then the closing sentence, each its own paragraph, as written. */
export function houseWordingParagraphs(wording: HouseWording): RichTextParagraph[] {
  return [wording.verdict, wording.closing].flatMap((sentence) => {
    const text = sentence ? cleanText(sentence).trim() : "";
    return text ? [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] : [];
  });
}

/** The document with the house wording after Steri-AI's text. */
export function appendHouseWording(doc: RichTextDoc, wording: HouseWording): RichTextDoc {
  return { type: "doc", content: [...doc.content, ...houseWordingParagraphs(wording)] };
}

function paragraphText(paragraph: RichTextParagraph): string {
  return (paragraph.content ?? []).map((inline) => (inline.type === "text" ? inline.text : "\n")).join("");
}

/**
 * Polish: the inspector's document without the house wording it ends with
 * (the closing sentence, then the verdict sentence before it, each a
 * paragraph that says exactly that), and which of them it ended with, so
 * they go back after the polished text, word for word, and never through
 * Steri-AI.
 */
export function stripHouseWording(doc: RichTextDoc, candidate: HouseWording): { doc: RichTextDoc; wording: HouseWording } {
  const content = [...doc.content];
  const endsWith = (sentence: string | null) => {
    const last = content.at(-1);
    return sentence !== null && sentence.trim() !== "" && last?.type === "paragraph" && paragraphText(last).trim() === sentence.trim();
  };
  const closing = endsWith(candidate.closing) ? candidate.closing : null;
  if (closing) content.pop();
  const verdict = endsWith(candidate.verdict) ? candidate.verdict : null;
  if (verdict) content.pop();
  return { doc: { type: "doc", content }, wording: { verdict, closing } };
}

/* ------------------------------------------------------------------ *
 * Text out
 * ------------------------------------------------------------------ */

/** "**text**" with any spaces at its ends kept outside the marks. */
function bold(text: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/u.exec(text);
  return match && match[2] !== "" ? `${match[1]}**${match[2]}**${match[3]}` : text;
}

function inlineText(paragraph: RichTextParagraph): string {
  const segments: { text: string; bold: boolean }[] = [];
  for (const inline of paragraph.content ?? []) {
    const isBold = inline.type === "text" && (inline.marks ?? []).some((mark) => mark.type === "bold");
    const text = inline.type === "text" ? inline.text : "\n";
    const last = segments.at(-1);
    if (last && last.bold === isBold) last.text += text;
    else segments.push({ text, bold: isBold });
  }
  return segments.map((segment) => (segment.bold ? bold(segment.text) : segment.text)).join("").trim();
}

/**
 * The inspector's document as Polish My Text sends it: paragraphs apart,
 * bold as **…**, list points as "- " or "1. " lines; other formatting
 * dropped (Polish resets it).
 */
export function docToInlineText(doc: RichTextDoc): string {
  return doc.content
    .flatMap((block) => {
      if (block.type === "paragraph") {
        const text = inlineText(block);
        return text ? [text] : [];
      }
      const start = block.type === "orderedList" ? (block.attrs?.start ?? 1) : 1;
      const items = block.content.flatMap((item, index) => {
        const text = inlineText(item.content[0]);
        return text ? [`${block.type === "orderedList" ? `${start + index}.` : "-"} ${text}`] : [];
      });
      return items.length > 0 ? [items.join("\n")] : [];
    })
    .join("\n\n");
}

/** The field's plain-text copy (lib/rich-text): what the mark hashes and the words are counted in. */
export function summaryPlainText(doc: RichTextDoc): string {
  return richTextPlain(doc);
}
