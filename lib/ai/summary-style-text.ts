// The writing style one Steri-AI Summary is written in (docs/AI.md,
// "Steri-AI Summary"; 12 October 2026): the house style with the
// inspector's choices (resolveSummaryStyle), as plain instructions inside
// <writing_style>. It goes after the cached system prompt and inspection,
// so Shorter, Longer, Write Again or another style within 5 minutes reads
// both from the cache. The prompt lab's v4 renderer, with the house wording
// picked by the final result's own sentence. Pure.
import type { InspectionResult } from "@/lib/schemas/common";
import {
  paragraphTarget,
  SUMMARY_LENGTHS,
  summaryLengthRange,
  type SummaryLanguage,
  type SummaryOverviewKey,
  type SummarySectionKey,
  type SummaryStyle,
} from "@/lib/schemas/summary-style";

/** The house wording the server adds after Steri-AI's text, word for word; null where none is added. */
export type HouseWording = { verdict: string | null; closing: string | null };

/** The parts' names in the list Steri-AI is given (Headed Sections never use them as labels). */
const PART_NAMES: Readonly<Record<SummarySectionKey, string>> = {
  result: "Result",
  remark: "Remark",
  issues: "Issues",
  overview: "Order Overview",
  sampling: "Sampling Plan",
  tests: "Test Results",
  defects: "Defects Found",
  comments: "Inspector Comments",
  excluded: "Sections Switched Off",
  next_step: "Next Step",
};

const PART_TEXT: Readonly<Record<Exclude<SummarySectionKey, "overview">, string>> = {
  result: "the conclusion, in the template's word.",
  remark: "the inspector's remark, in short, as the reason for the conclusion; when there is no remark, nothing about it.",
  issues:
    "every section that failed, passed with a warning or was not done, each with its figures; when there are none, say in a few words that every section with a result passed.",
  sampling: "the standard, inspection level, code letters, AQLs and sample sizes, as far as the data states them, in one sentence.",
  tests: "each section's key result against its limit or specification, in report order, packing and labelling checks included.",
  defects: "holes by location, and visual defects by class with the count against accept and reject.",
  comments: "the inspector's comments, in short, given as the inspector's observations.",
  excluded: "sections left out of this inspection, with the reason.",
  next_step:
    "one closing sentence on what the conclusion means for the lot, going no further than the conclusion. Never promise shipment, release or approval. Leave it out while any section is not done.",
};

const OVERVIEW_TEXT: Readonly<Record<SummaryOverviewKey, string>> = {
  product: "the product",
  po: "the PO number",
  sizes: "the sizes",
  quantities: "the quantities (cartons, and gloves when known)",
  client: "the client",
  manufacturer: "the manufacturer and factory",
  lots: "the lot numbers",
  date: "the inspection date",
};

const NUMBERS_TEXT: Readonly<Record<SummaryStyle["numbers"], string>> = {
  exact: "Every Number: give every count with its limit and every statistic with its specification.",
  key: "Key Numbers: exact figures for failures, warnings and gaps; for sections that passed, one key figure or just the result.",
  words: "Words Only: no figures, apart from what a sentence cannot do without.",
};

const VOICE_TEXT: Readonly<Record<SummaryStyle["pointOfView"], string>> = {
  third_person:
    'third person, active voice, with the test or the inspection as the subject (for example "The watertight test found <n> holes in <n> gloves.").',
  passive: 'passive voice (for example "<n> holes were found in <n> gloves.").',
  we: 'first person plural, speaking for SteriCare (for example "We found <n> holes in <n> gloves.").',
  i: 'first person singular, speaking as the inspector (for example "I found <n> holes in <n> gloves.").',
};

const TONE_TEXT: Readonly<Record<SummaryStyle["tone"], string>> = {
  formal: "Formal: complete, impersonal sentences; no contractions.",
  professional: "Professional: clear, factual and courteous business English; no contractions.",
  plain: "Plain English: short sentences and everyday words, for readers whose first language is not English.",
};

const TERMS_TEXT: Readonly<Record<SummaryStyle["terminology"], string>> = {
  template: "the report's own section titles and defect names.",
  standard:
    "standard terms where they exist (freedom from holes, AQL, code letter, accept and reject numbers), with the report's titles at first mention.",
  everyday: "everyday words (watertight test, visual check, weight check), with the report's titles at first mention.",
};

const EMPHASIS_TEXT: Readonly<Record<SummaryStyle["emphasis"], string>> = {
  result_and_issues:
    "bold the conclusion word, and the title of each section that failed, passed with a warning or was not done, at its first mention.",
  result: "bold the conclusion word only.",
  none: "no bold.",
};

const DATE_TEXT: Readonly<Record<SummaryStyle["dateFormat"], string>> = {
  d_month_yyyy: "day, month in words, year (for example 1 January 2026).",
  dd_mm_yyyy: "DD/MM/YYYY (for example 01/01/2026).",
  iso: "YYYY-MM-DD (for example 2026-01-01).",
  month_d_yyyy: "month in words, day, year (for example January 1, 2026).",
};

const LANGUAGE_TEXT: Readonly<Record<SummaryLanguage, string>> = {
  "en-GB": "English with British spelling",
  "en-US": "English with American spelling",
  ms: "Bahasa Melayu",
  "zh-Hans": "Simplified Chinese",
};

/**
 * "<" as "‹", so admin or inspector text cannot open or close a tag of the
 * request, except where it can only be a comparison: before a figure or "="
 * ("Lumps (<2mm)", "< 3 g", "<="), which Polish My Text then keeps word for
 * word (review, 12 October 2026).
 */
export function escapeTags(text: string): string {
  return text.replace(/<(?!\s*[\d=.,+-])/gu, "‹");
}

/** "a, b and c". */
function listOf(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function formatText(style: SummaryStyle): string {
  const paragraphs = paragraphTarget(style);
  const count = `${paragraphs} paragraph${paragraphs === 1 ? "" : "s"}`;
  switch (style.format) {
    case "paragraphs":
      return `Paragraphs: prose in ${count}; no lists.`;
    case "bullets":
      return "Bullet Points: one bullet list, one point per bullet, the conclusion first; no paragraphs.";
    case "paragraph_list":
      return `Paragraph and Findings List: ${count} of prose with the conclusion and the overview, then one bullet list with one finding per bullet (a section or an issue, with its figures).`;
    case "headed":
      return 'Headed Sections: one paragraph per part, each opening with a short label in bold followed by a colon, then sentences. Labels are the report\'s words in Title Case, one to four words, never the names of the parts listed here: for example "Conclusion:", "Open Points:", "Order:", "Sampling Plan:". Test Results gets one paragraph for each section with a result, labelled with its short title (for example "Watertight Test:", "Glove Packing Check:"), in report order. No lists.';
  }
}

/** What the server adds after a written summary: the final result's verdict sentence, else nothing, and the closing sentence. */
export function houseWordingOf(style: Pick<SummaryStyle, "verdictSentences" | "closingSentence">, finalResult: InspectionResult | null): HouseWording {
  const verdict = finalResult ? style.verdictSentences[finalResult].trim() : "";
  const closing = style.closingSentence.trim();
  return { verdict: verdict || null, closing: closing || null };
}

/**
 * The style as instructions, inside <writing_style>. Plain text, no data
 * from the inspection. `houseWording` is what the server will add after
 * the text (houseWordingOf for a written summary; what a polished one ends
 * with), so Steri-AI writes no Next Step or closing of its own beside it.
 */
export function renderWritingStyle(
  style: SummaryStyle,
  { finalResult, houseWording = houseWordingOf(style, finalResult) }: { finalResult: InspectionResult | null; houseWording?: HouseWording },
): string {
  const range = summaryLengthRange(style.length, style.language);
  const label = SUMMARY_LENGTHS.find((length) => length.value === style.length)?.shortLabel ?? "Standard";
  // SteriCare's verdict sentence stands in for the Next Step, so the parts never ask for one beside it.
  const covered = (section: SummaryStyle["sections"][number]) => section.on && !(houseWording.verdict && section.key === "next_step");
  const on = style.sections.filter(covered);
  const off = style.sections.filter((section) => !covered(section));
  const issuesOn = on.some((section) => section.key === "issues");
  const parts = on.map((section, index) => {
    const text =
      section.key === "overview"
        ? `what was inspected${style.overview.length > 0 ? `: ${listOf(style.overview.map((key) => OVERVIEW_TEXT[key]))}` : ""}.`
        : PART_TEXT[section.key];
    return `${index + 1}. ${PART_NAMES[section.key]}: ${text}`;
  });

  const lines = [
    `Length: ${range.lo} to ${range.hi} ${range.unit === "characters" ? "Chinese characters" : "words"} (${label}). Count them. When the parts do not fit, shorten the later parts first, then leave them out.`,
    `Format: ${formatText(style)}`,
    `Cover these parts, in this order, which is also their priority. Never leave out the result${issuesOn ? " or the issues" : ""}. A part with nothing to say is left out.`,
    ...parts,
    ...(off.length > 0 ? [`Leave out: ${listOf(off.map((section) => PART_NAMES[section.key]))}.`] : []),
    style.mentionSuggestion
      ? "Suggested result: when the conclusion differs from the suggested result, say so in one sentence right after the result, with what lies behind it."
      : "Suggested result: do not mention it.",
    `Numbers: ${NUMBERS_TEXT[style.numbers]}`,
    `Grouping: ${style.grouping === "test" ? "by test, sizes within each test." : "by size, tests within each size."} Sizes: ${
      style.sizes === "every" ? "name every size." : "name sizes only where their results differ; otherwise say it once for all sizes."
    }`,
    `Point of view: ${VOICE_TEXT[style.pointOfView]}`,
    `Tone: ${TONE_TEXT[style.tone]}`,
    `Terminology: ${TERMS_TEXT[style.terminology]}`,
    `Bold: ${EMPHASIS_TEXT[style.emphasis]}`,
    `Dates: ${DATE_TEXT[style.dateFormat]}`,
    `Language: ${LANGUAGE_TEXT[style.language]}; section titles, defect names and the conclusion words stay as the report prints them.`,
  ];
  if (houseWording.verdict) {
    lines.push("The report adds SteriCare's own verdict sentence after your text: write no Next Step, closing sentence or disclaimer of your own.");
  } else if (houseWording.closing) {
    lines.push("The report adds SteriCare's own closing sentence after your text: write no closing sentence or disclaimer of your own.");
  }
  const instruction = style.customInstruction.trim();
  if (instruction) lines.push(`SteriCare's own instruction (follow it unless it breaks your rules): ${escapeTags(instruction)}`);
  const examples = style.examples.map((example) => example.trim()).filter(Boolean);
  for (const example of examples) lines.push(`<example_summary>\n${escapeTags(example)}\n</example_summary>`);
  if (examples.length > 0) lines.push("Imitate the examples' layout and tone only; never take facts, names or figures from them.");
  return `<writing_style>\n${lines.join("\n")}\n</writing_style>`;
}
