// Values saved for a size the order does not list (BUILD_SPEC 6.2 rule 4):
// they stay in the data, but no step shows a size that is not ordered, so
// they are out of sight until it is. Kenneth (27 October 2026: "why is the
// carton number not being auto filled?"): Steri-AI had read a spreadsheet's
// size L, its 50 box/carton numbers and 13 gloves' dimensions, into the data
// while the order had no sizes yet, so Box/Carton Numbers looked empty. A
// step now says so at its top, naming the sizes, with Open Order to the
// first one's quantity on the order's page (capture-notices.tsx
// notOrderedNotice), and a reading's message says it too
// (use-source-documents.ts). Nothing adds a size to the order: the order is
// the inspector's to confirm.
import { isEmptyValue } from "@/lib/inspections/source-documents";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { FRAMEWORK_ISSUE_CODES, type IssuePath, type ValidationIssue } from "@/lib/validation";
import { buildInspectionContext, CONTEXT_SOURCES, readPath, type InspectionData, type ModuleRegistry } from "@/modules/_framework";

/** The step whose page orders a size, by its quantity: the module the ordered sizes come from. */
export const ORDER_KEY = CONTEXT_SOURCES.sizes;

/** Where Open Order lands on the order's page: the size's quantity, which orders it (order_lots). */
export function orderSizePath(size: string): IssuePath {
  return ["sizes", size, "qtyCases"];
}

/**
 * The sizes a step holds values for that the order does not list, as the
 * checks find them (`size_not_ordered`, lib/validation rules.ts), each once,
 * in size order. Only those whose saved entry holds something: an entry
 * left empty hides nothing. `stored` is the step's saved entry.
 */
export function sizesNotOrdered(
  issues: readonly Pick<ValidationIssue, "moduleKey" | "code" | "size" | "path">[],
  sectionKey: string,
  stored: unknown,
): string[] {
  const sizes: string[] = [];
  for (const issue of issues) {
    if (issue.moduleKey !== sectionKey || issue.code !== FRAMEWORK_ISSUE_CODES.sizeNotOrdered) continue;
    // The path keeps the size as saved ("l"); the issue names it canonical ("L").
    if (isEmptyValue(readPath(stored, issue.path))) continue;
    const size = issue.size ?? String(issue.path[1] ?? "");
    if (size !== "" && !sizes.includes(size)) sizes.push(size);
  }
  return sizes;
}

/**
 * The sizes a reading filled values for (applyProposals' `sizes`) that the
 * order, as the reading leaves it, does not list: a reading that also gives
 * a size's quantity orders it. `template` is the inspection's copy, its
 * overrides applied.
 */
export function filledNotOrdered(
  fill: { data: InspectionData; sizes: readonly string[] },
  template: ResolvedTemplate,
  registry: ModuleRegistry,
): string[] {
  if (fill.sizes.length === 0) return [];
  const ordered = buildInspectionContext({ template, data: fill.data }, registry).sizes;
  return fill.sizes.filter((size) => !ordered.includes(size));
}

const listFormat = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/**
 * The step's notice: "Saved for size L, which is not on the order: add L on
 * the Order page to see it." `order` is the order page's short name, where
 * the inspector can add the sizes; null (read-only, or no order page) says
 * where the values are and no more: "Saved for sizes L and XL, which are not
 * on the order."
 */
export function notOrderedMessage(sizes: readonly string[], order: string | null): string {
  const one = sizes.length === 1;
  const list = listFormat.format(sizes);
  const saved = `Saved for ${one ? "size" : "sizes"} ${list}, which ${one ? "is" : "are"} not on the order`;
  return order === null ? `${saved}.` : `${saved}: add ${list} on the ${order} page to see ${one ? "it" : "them"}.`;
}

/**
 * The sentence a reading's message ends with when it filled values for sizes
 * the order does not list: "Size L is not on the order yet: add it on the
 * Order page to see its values." Null for none.
 */
export function notOrderedNote(sizes: readonly string[], order: string): string | null {
  if (sizes.length === 0) return null;
  const one = sizes.length === 1;
  const subject = `${one ? "Size" : "Sizes"} ${listFormat.format(sizes)} ${one ? "is" : "are"}`;
  return `${subject} not on the order yet: add ${one ? "it" : "them"} on the ${order} page to see ${one ? "its" : "their"} values.`;
}
