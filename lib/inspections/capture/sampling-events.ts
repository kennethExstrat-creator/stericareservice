// The audit row a capture save writes for a size's code letter on the
// Sampling Plan (Kenneth, 27 October 2026). Auto Calculate fills each size's
// Code Letter with its lot's ISO 2859-1 letter; the inspector may reduce it
// (N to M, a smaller # of Gloves Sample, for a factory of consistent high
// quality) with a reason, and raise it back up to the calculated letter.
// Asked whether reducing should be audit logged: "yes, reducing code letter
// go to Audit Log". As with Dimension's rows (./dimension-events.ts), the
// server works the row out from the data it read and the data it saves, never
// from what the browser says, and saveCaptureData writes it in the save's own
// transaction (public.save_inspection_with_events, code_letter_changed since
// migration 20261027120000).
//
// The data is read loosely, with a schema of its own for just what the row
// records (each size's letter, its reason and its # of Gloves Sample): a
// shape it does not know is skipped, never thrown on.
import { z } from "zod";
import { CODE_LETTERS, CodeLetterSchema, type CodeLetter } from "@/lib/aql";
import type { ModuleEvaluation } from "@/modules/_framework";
import { readModuleEntry, type InspectionData } from "@/modules/_framework/data";
import type { AuditEvent } from "./dimension-events";

export const CODE_LETTER_CHANGED = "code_letter_changed";

/**
 * What code_letter_changed records for one size. `from` is the letter
 * stored before and `to` the letter saved, null when it was cleared; the
 * gloves are the size's # of Gloves Sample before and after.
 */
export type CodeLetterChange = {
  module: "sampling_plan";
  size: string;
  /**
   * The stored letter. For a letter filled and reduced in the same save, the
   * lot's letter, or null where the server does not know it.
   */
  from: CodeLetter | null;
  to: CodeLetter | null;
  /** Down or up the ISO 2859-1 letters (A to R, without I and O); null when the letter was cleared. */
  direction: "reduced" | "raised" | null;
  /** The inspector's reason for a letter reduced; null when it was raised or cleared. */
  reason: string | null;
  glovesFrom: number | null;
  glovesTo: number | null;
};

/** The module's evaluation of the data saved: calc's lot letters. */
type SamplingEvaluation = Pick<ModuleEvaluation, "computed">;

/** What the row reads of a size: its letter, the reason for it and its # of Gloves Sample. */
type SizeLetter = { codeLetter: CodeLetter | null; reason: string | null; gloves: number | null };

const NO_LETTER: SizeLetter = { codeLetter: null, reason: null, gloves: null };

/**
 * A size's entry, for those three alone. A letter that is not an ISO 2859-1
 * code letter makes the size unreadable; a reason (1 to 500 characters, as
 * the screen asks for it) or a count that cannot be read is taken as none.
 */
const SizeLetterSchema = z.object({
  codeLetter: CodeLetterSchema.nullish(),
  codeLetterReason: z.string().trim().min(1).max(500).nullish().catch(null),
  gloves: z.int().min(0).nullish().catch(null),
});

const SamplingSizesSchema = z.object({ sizes: z.record(z.string(), z.unknown()).default({}) });

/** calc's computed values, for each ordered size's lot letter (SizePlan.codeLetter): the letter Auto Calculate fills. */
const LotLettersSchema = z.object({
  sizes: z.record(z.string(), z.object({ codeLetter: CodeLetterSchema.nullable() }).nullable().catch(null)),
});

/**
 * Each saved size of the sampling plan, read for its letter: null for a size
 * that cannot be read. None when nothing is saved; null when the entry
 * itself cannot be read.
 */
function lettersOf(data: InspectionData): Map<string, SizeLetter | null> | null {
  const entry = readModuleEntry(data, "modules", "sampling_plan");
  if (!entry.hasData) return new Map();
  const plan = SamplingSizesSchema.safeParse(entry.value);
  if (!plan.success) return null;
  return new Map(
    Object.entries(plan.data.sizes).map(([size, value]) => {
      const parsed = SizeLetterSchema.safeParse(value);
      if (!parsed.success) return [size, null];
      const { codeLetter, codeLetterReason, gloves } = parsed.data;
      return [size, { codeLetter: codeLetter ?? null, reason: codeLetterReason ?? null, gloves: gloves ?? null }];
    }),
  );
}

function lotLettersOf(sampling: SamplingEvaluation | undefined): Readonly<Record<string, { codeLetter: CodeLetter | null } | null>> {
  const parsed = LotLettersSchema.safeParse(sampling?.computed);
  return parsed.success ? parsed.data.sizes : {};
}

/** `letter` comes before `than` in ISO 2859-1's order: a smaller sample. */
function isBelow(letter: CodeLetter, than: CodeLetter): boolean {
  return CODE_LETTERS.indexOf(letter) < CODE_LETTERS.indexOf(than);
}

/**
 * The code_letter_changed rows a save from `before` (what the server read)
 * to `after` (what it writes) records, in size order: one per size whose
 * stored letter was changed, reduced or raised, or cleared. The first fill
 * is the calculation, not an inspector's decision: no row, unless it comes
 * with a reason, which the screen asks for only with a letter reduced below
 * the lot's: filled and reduced in one save (on a device that was offline
 * meanwhile), it is recorded as reduced from the lot's letter. A size, or a
 * sampling plan, that cannot be read on either side is skipped. `sampling`
 * is the module's evaluation of `after`.
 */
export function samplingEvents(
  before: InspectionData,
  after: InspectionData,
  sampling: SamplingEvaluation | undefined,
): AuditEvent[] {
  const stored = lettersOf(before);
  const saved = lettersOf(after);
  if (stored === null || saved === null) return [];
  const lotLetters = lotLettersOf(sampling);
  const sizes = [...new Set([...stored.keys(), ...saved.keys()])].sort();
  const events: AuditEvent[] = [];
  for (const size of sizes) {
    const from = stored.has(size) ? stored.get(size) : NO_LETTER;
    const to = saved.has(size) ? saved.get(size) : NO_LETTER;
    if (!from || !to) continue;
    const change = letterChange(size, from, to, lotLetters[size]?.codeLetter ?? null);
    if (change) events.push({ action: CODE_LETTER_CHANGED, changes: change });
  }
  return events;
}

function letterChange(size: string, from: SizeLetter, to: SizeLetter, lotLetter: CodeLetter | null): CodeLetterChange | null {
  if (from.codeLetter === to.codeLetter) return null;
  const change = { module: "sampling_plan", size, glovesFrom: from.gloves, glovesTo: to.gloves } as const;
  if (to.codeLetter === null) return { ...change, from: from.codeLetter, to: null, direction: null, reason: null };
  if (from.codeLetter === null) {
    if (to.reason === null) return null;
    const lot = lotLetter !== null && isBelow(to.codeLetter, lotLetter) ? lotLetter : null;
    return { ...change, from: lot, to: to.codeLetter, direction: "reduced", reason: to.reason };
  }
  const reduced = isBelow(to.codeLetter, from.codeLetter);
  return {
    ...change,
    from: from.codeLetter,
    to: to.codeLetter,
    direction: reduced ? "reduced" : "raised",
    reason: reduced ? to.reason : null,
  };
}
