// How the review shows a module's result (BUILD_SPEC 4.2 rule 7): the
// status its pill shows, and what its summary says beyond the per-size lines
// listed under it. Pure: the module results component renders what these
// return, and the tests run them over the example reports.
import { inspectorDecision } from "@/lib/export/conclusion";
import type { Status } from "@/lib/design/status";
import { formatSize } from "@/lib/format";
import type { ModuleStatus } from "@/lib/schemas/module-result";
import type { InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { inTemplateOrder } from "./format";

/**
 * The status a module's pill shows. A module status has no hold, so the
 * conclusion records the inspector's HOLD as a warning (modules/conclusion/
 * calc.ts); the review shows it as the final result reads it, "On Hold" with
 * the pause icon, in the same amber (docs/DESIGN.md: warn and hold differ in
 * label, icon and tint). Every other result is shown as it is.
 */
export function shownStatus(entry: Pick<ModuleEvaluation, "key" | "result" | "data">): Status {
  const { status } = entry.result;
  if (entry.key !== "conclusion" || status !== "warn") return status;
  return inspectorDecision({ result: null, remarks: null }, entry.data).result === "hold" ? "hold" : status;
}

/** One size's line under a module's result: the size, the template's name for it ("Medium") and its summary. */
export type SizeLine = { size: string; label: string; summary: string };

/** A module's per-size results in the template's order of sizes, each named as the template names it. */
export function sizeResults(
  entry: Pick<ModuleEvaluation, "result">,
  context: Pick<InspectionContext, "sizes" | "templateSizes">,
): (SizeLine & { status: ModuleStatus })[] {
  const perSize = entry.result.perSize ?? {};
  return inTemplateOrder(context, Object.keys(perSize)).flatMap((size) => {
    const own = perSize[size];
    return own
      ? [{ size, label: formatSize(size, { sizes: context.templateSizes }), status: own.status, summary: own.summary ?? "" }]
      : [];
  });
}

/** The module's summary as the review shows it, above its per-size lines: summaryBeyondSizes. */
export function moduleSummary(
  entry: Pick<ModuleEvaluation, "result">,
  context: Pick<InspectionContext, "sizes" | "templateSizes">,
): string | null {
  return summaryBeyondSizes(entry.result.summary, sizeResults(entry, context));
}

/**
 * What a module's summary says beyond its per-size lines, which the review
 * lists under it, size by size:
 * - a headline of its own ("Median within spec for size M.", "No defects in
 *   size M.") stays whole;
 * - a summary that only strings the sizes' lines together ("Size M: 1 / 500
 *   (Finger 1), Defect Limit 14 / 15: Passed.") is left out (null), or the
 *   same sentence would read twice;
 * - a note after the sizes' lines stays on its own: "Size M: Median 6.537 N.
 *   Spec. ≥ 6 N." gives "Spec. ≥ 6 N.".
 * A size's line counts as repeated only behind its size ("Size M: …", "size
 * S: …", "Size XS, L: …"), or as the whole summary, so its words used inside
 * a headline never go. Whatever the number of sizes.
 */
export function summaryBeyondSizes(summary: string, sizes: readonly SizeLine[]): string | null {
  const text = summary.trim();
  if (text === "") return null;
  const lines = [...new Set(sizes.map((entry) => withoutFullStop(entry.summary)).filter((line) => line !== ""))];
  if (lines.length === 0) return text;
  if (lines.length === 1 && withoutFullStop(text) === lines[0]) return null;

  const name = alternation(sizes.flatMap((entry) => [entry.size, entry.label]));
  const behindSize = `\\bsizes?\\s+(?:${name})(?:\\s*(?:,|&|\\band\\b)\\s*(?:${name}))*\\s*:\\s*`;
  let rest = text;
  // Longest first: a line that ends another one's words never takes them apart.
  for (const line of [...lines].sort((a, b) => b.length - a.length)) {
    const repeated = new RegExp(behindSize + escapeRegExp(line), "giu");
    const left = rest.replace(repeated, " ");
    // A size's line the summary does not repeat: the summary is a headline of its own.
    if (left === rest) return text;
    rest = left;
  }
  const note = rest
    .replace(/\s+/g, " ")
    // The marks the lines left behind, as one: a full stop where one of them was.
    .replace(/\s*[.;,:](?:\s*[.;,:])+/g, (marks) => (marks.includes(".") ? "." : marks.trim()[0]))
    .replace(/^[\s.;,:]+/, "")
    .replace(/[\s.;,:]+$/, "");
  return /[\p{L}\p{N}]/u.test(note) ? `${note}.` : null;
}

/** "Passed." as "Passed": a line repeated inside a sentence loses its full stop. */
function withoutFullStop(text: string): string {
  return text.trim().replace(/\.$/, "").trim();
}

/** Size names for a pattern, longest first, so "XL" is never read as "L". */
function alternation(names: readonly string[]): string {
  return [...new Set(names.map((entry) => entry.trim()).filter((entry) => entry !== ""))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
