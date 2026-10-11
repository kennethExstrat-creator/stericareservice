// One Submit, one Approve and one Reopen for every PO part of an inspection
// (lib/inspections/parts.ts; Kenneth, 11 October 2026: "PO parts in one
// inspection"). Each part keeps its own checks, version and audit trail; the
// decision covers them all, and when one part cannot move none does. Here:
// what a review decision does with each part, the words the screens and the
// actions share, and the versions an approve form carries. Client-safe; the
// part states are read on the server (part-moves-server.ts).
import { z } from "zod";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";

/** A part as a review decision weighs it. */
export type PartState = {
  id: string;
  /** "PO 2680276", or "PO 2" while it has no PO number yet (partLabel). */
  label: string;
  refNo: string;
  status: InspectionStatus;
  /** `updated_at` exactly as Postgres returned it: approving applies to this version only. */
  version: string;
  /** The first part: it stands for the inspection (its reference number is the inspection's). */
  primary: boolean;
  /** The inspector's final result and the app's suggestion, as the row repeats them. */
  result: InspectionResult | null;
  suggestedResult: InspectionResult | null;
};

/** Most parts one request may name; an inspection has a handful. */
export const MAX_PARTS = 50;

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** "PO 1", "PO 1 and PO 2", "PO 1, PO 2 and PO 3". */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** What one decision covers when there are several parts: "All 3 POs", in a label's Title Case. */
export function allPartsLabel(count: number): string {
  return `All ${count} POs`;
}

/** "is" or "are", for a list of parts. */
export function isOrAre(count: number): string {
  return count === 1 ? "is" : "are";
}

/** "PO 2 is a draft": the status as a sentence says it. */
export function statusWord(status: InspectionStatus): string {
  if (status === "draft") return "a draft";
  return status;
}

/** "PO 2 is a draft and PO 3 is reopened". */
export function describeParts(parts: readonly Pick<PartState, "label" | "status">[]): string {
  return joinWords(parts.map((part) => `${part.label} is ${statusWord(part.status)}`));
}

/**
 * What should make the admin stop before approving a part, from the results
 * its row repeats: no final result chosen, or one that differs from the
 * suggestion. The checks themselves (approvalCautions) run on the part's
 * own review.
 */
export function partCautions(part: Pick<PartState, "label" | "result" | "suggestedResult">): string[] {
  if (part.result === null) return [`The inspector has not chosen a final result for ${part.label}.`];
  if (part.suggestedResult !== null && part.result !== part.suggestedResult) {
    return [`The final result of ${part.label} differs from its suggested result.`];
  }
  return [];
}

/**
 * The cautions of an approve that covers several parts, each naming its PO,
 * the gravest first within a part as approvalCautions orders them. The part
 * on the page is weighed with its checks (`facts`: its final result, the
 * suggestion and the errors found, null when nothing could be checked); the
 * others by the results their rows repeat (partCautions).
 */
export function partsApprovalCautions(
  parts: readonly PartState[],
  currentId: string,
  facts: { finalResult: InspectionResult | null; suggestedResult: InspectionResult | null; errors: number | null },
): string[] {
  return parts.flatMap((part) => {
    if (part.id !== currentId) return partCautions(part);
    const { finalResult, suggestedResult, errors } = facts;
    return [
      ...(errors === null
        ? [`The results of ${part.label} could not be worked out, so nothing was checked. Ask a developer before you approve it.`]
        : []),
      ...partCautions({ label: part.label, result: finalResult, suggestedResult }),
      ...(errors !== null && errors > 0
        ? [
            `The checks found ${errors === 1 ? "1 error" : `${errors} errors`} in ${part.label}. Reopen it instead if the inspector should fix ${errors === 1 ? "it" : "them"} first.`,
          ]
        : []),
    ];
  });
}

/* ------------------------------------------------------------------ *
 * Submit
 * ------------------------------------------------------------------ */

/** A part that keeps the inspection from being submitted, and why: the screen links to it. */
export type SubmitPartProblem = { id: string; label: string; message: string };

/**
 * The parts the submit confirmation named, by id: the server submits them
 * only while they are the parts there are, so a PO added or gone on another
 * device is seen before it goes.
 */
export const SubmitPartIdsSchema = z.array(z.uuid()).min(1).max(MAX_PARTS);

/** "3 items are needed in PO 2 before you can submit." (blockedSubmitMessage, for another part). */
export function partNeedsMessage(needed: number, label: string): string {
  return `${needed === 1 ? "1 item is" : `${needed} items are`} needed in ${label} before you can submit.`;
}

/* ------------------------------------------------------------------ *
 * Review decisions
 * ------------------------------------------------------------------ */

export type ReviewVerb = "approve" | "reopen";

/**
 * What a review decision does with each part. Every submitted part moves.
 * A part already where the decision puts it is left as it is: approved for
 * an approve; reopened or a draft for a reopen, since both are with the
 * inspector already. Any other part cannot move (a draft or reopened part
 * is not approved before it is submitted; an approved part is final), and
 * then no part moves.
 */
export type ReviewPlan<P> = { move: P[]; done: P[]; blocked: P[] };

export function planReview<P extends Pick<PartState, "status">>(parts: readonly P[], verb: ReviewVerb): ReviewPlan<P> {
  const plan: ReviewPlan<P> = { move: [], done: [], blocked: [] };
  for (const part of parts) {
    if (part.status === "submitted") plan.move.push(part);
    else if (verb === "approve" ? part.status === "approved" : part.status !== "approved") plan.done.push(part);
    else plan.blocked.push(part);
  }
  return plan;
}

/** Why the dialog cannot approve or reopen: "PO 2 is a draft: every PO must be submitted before …". */
export function blockedNote(verb: ReviewVerb, blocked: readonly Pick<PartState, "label" | "status">[]): string {
  return verb === "approve"
    ? `${describeParts(blocked)}: every PO must be submitted before the inspection can be approved.`
    : `${describeParts(blocked)}, so the inspection can no longer be reopened.`;
}

/* ------------------------------------------------------------------ *
 * The approve form: each part with the version the page showed
 * ------------------------------------------------------------------ */

/** The form field an approve repeats for every part: `<id>@<version>`. */
export const PART_VERSION_FIELD = "partVersion";

export function partVersionValue(part: Pick<PartState, "id" | "version">): string {
  return `${part.id}@${part.version}`;
}

const PartVersionSchema = z
  .string()
  .transform((value) => {
    const at = value.indexOf("@");
    return { id: at < 0 ? value : value.slice(0, at), version: at < 0 ? "" : value.slice(at + 1) };
  })
  .pipe(z.object({ id: z.uuid(), version: z.iso.datetime({ offset: true }) }));

/** Every part an approve form names, with the version it showed; none for an inspection of one part. */
export const PartVersionsSchema = z.array(PartVersionSchema).max(MAX_PARTS);
export type PartVersion = z.infer<typeof PartVersionSchema>;

/** The parts a page showed, or a confirmation named, are the parts there are now: each once, in any order. */
export function sameParts(parts: readonly Pick<PartState, "id">[], seen: readonly Pick<PartVersion, "id">[]): boolean {
  const ids = new Set(parts.map((part) => part.id));
  return ids.size === seen.length && new Set(seen.map((part) => part.id)).size === ids.size && seen.every((part) => ids.has(part.id));
}
