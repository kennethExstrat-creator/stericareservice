// The review's "Needs Your Attention" list (layout A, Kenneth, 27 October
// 2026: the page had "too much wording"). Each listed error and warning is
// one module's problem in one size, written as a whole sentence; the list
// shows one short line per problem instead, its sizes beside it: the
// issue's first sentence, without the size it starts with or the count in
// brackets, which move to the sizes ("M 2, L 2, XL 1").
import type { ValidationIssue } from "@/lib/validation";
import { isListedIssue } from "./evaluate";

export type AttentionSize = { size: string; count: number | null };

export type AttentionItem = {
  /** Stable within the list: module, level, code and text. */
  key: string;
  level: ValidationIssue["level"];
  moduleKey: string;
  code: string;
  /** 'Major Defects: "Ring mark" is not in the template's defect list'. */
  text: string;
  /** The sizes it is in, in the given order, each with the count its sentence named; none for a module-wide problem. */
  sizes: AttentionSize[];
};

/** "Size M, " or "Size XL, right hand, " (or with a colon) before the rest of a size's sentence. */
const SIZE_PREFIX = /^Size [^,:]+(?:, (?:right|left) hand)?[,:]\s*/i;
/** The first count in brackets: '"Ring mark" (2) is not…'. */
const COUNT = /\s*\((\d+)\)/;

/** The sentence up to its first full stop that ends a sentence (not a decimal point). */
export function firstSentence(message: string): string {
  const text = message.trim();
  const end = text.search(/[.!?](?=\s+["“A-Z]|$)/);
  return (end === -1 ? text : text.slice(0, end)).trim();
}

/** An issue as one short line: its first sentence without the size it starts with, and the count it names. */
export function shortIssue(issue: Pick<ValidationIssue, "message" | "size">): { text: string; count: number | null } {
  let text = firstSentence(issue.message);
  if (issue.size !== undefined) text = text.replace(SIZE_PREFIX, "");
  const found = COUNT.exec(text);
  const count = found ? Number(found[1]) : null;
  if (found) text = text.replace(COUNT, "");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), count };
}

/**
 * The listed issues (not the framework's "not done" warnings, which the
 * modules' own results say) as one item per problem, errors first, then in
 * the order the modules raised them. Sizes follow `sizeOrder` (the
 * template's); a size named twice (both hands) adds its counts.
 */
export function attentionItems(issues: readonly ValidationIssue[], sizeOrder: readonly string[]): AttentionItem[] {
  const items = new Map<string, AttentionItem>();
  for (const issue of issues) {
    if (!isListedIssue(issue)) continue;
    const { text, count } = shortIssue(issue);
    const key = [issue.moduleKey, issue.level, issue.code, text].join("|");
    let item = items.get(key);
    if (!item) {
      item = { key, level: issue.level, moduleKey: issue.moduleKey, code: issue.code, text, sizes: [] };
      items.set(key, item);
    }
    if (issue.size === undefined) continue;
    const known = item.sizes.find((entry) => entry.size === issue.size);
    if (known) known.count = known.count === null || count === null ? (known.count ?? count) : known.count + count;
    else item.sizes.push({ size: issue.size, count });
  }
  const rank = (size: string) => {
    const index = sizeOrder.indexOf(size);
    return index === -1 ? sizeOrder.length : index;
  };
  const list = [...items.values()];
  for (const item of list) item.sizes.sort((a, b) => rank(a.size) - rank(b.size));
  return [...list.filter((item) => item.level === "error"), ...list.filter((item) => item.level !== "error")];
}
