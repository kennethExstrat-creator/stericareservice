// The Code Letter row (Kenneth, 27 October 2026: "give a button to reduce the
// code letter to the previous letter, for example, the auto calculate gives
// N. The inspector can manually reduce it to M ... some inspection are done
// for high quality factory where their performance is consistent"): a size's
// ISO 2859-1 sample size code letter a step down or up in the standard's
// order, which skips I and O (lib/aql CODE_LETTERS: J down is H, P down is
// N), and the gloves a letter takes. A letter goes back up only as far as its
// lot's own letter at the inspection level, never above the plan; one below
// it says so ("Reduced from N"), so a reviewer can tell the sample was
// lowered on purpose.
import { CODE_LETTERS, SAMPLE_SIZES, type CodeLetter } from "@/lib/aql";

/** The letter before `letter` in ISO 2859-1 order (N → M, J → H); null at A. */
export function previousCodeLetter(letter: CodeLetter): CodeLetter | null {
  const index = CODE_LETTERS.indexOf(letter);
  return index > 0 ? CODE_LETTERS[index - 1] : null;
}

/** The letter after `letter` (M → N, H → J); null at R. */
export function nextCodeLetter(letter: CodeLetter): CodeLetter | null {
  const index = CODE_LETTERS.indexOf(letter);
  return index >= 0 && index < CODE_LETTERS.length - 1 ? CODE_LETTERS[index + 1] : null;
}

/** `letter` comes before `other` in ISO 2859-1 order: it takes a smaller sample. */
export function isBelow(letter: CodeLetter, other: CodeLetter): boolean {
  return CODE_LETTERS.indexOf(letter) < CODE_LETTERS.indexOf(other);
}

/**
 * The gloves a letter takes from a lot: its Table 2-A sample size (M is 315),
 * every glove of a lot no larger (docs/AQL.md rule 8), the sample size alone
 * while the lot is not known.
 */
export function letterSample(letter: CodeLetter, lot: number | null): number {
  const n = SAMPLE_SIZES[letter];
  return lot === null ? n : Math.min(n, lot);
}

/** What a size's Code Letter cell offers, from its letter and its lot's. */
export type LetterSteps = {
  /** The letter Reduce sets: the one before; null while the size has no letter, and at A. */
  reduceTo: CodeLetter | null;
  /** The letter Raise sets: the one after, only while the size's letter is below its lot's; null otherwise. */
  raiseTo: CodeLetter | null;
  /** The lot's letter while the size's is below it ("Reduced from N"); null otherwise. */
  reducedFrom: CodeLetter | null;
};

/** A size's steps: `letter` its own (data), `lotLetter` its lot's at the inspection level, null while the lot is not known. */
export function letterSteps(letter: CodeLetter | null, lotLetter: CodeLetter | null): LetterSteps {
  const below = letter !== null && lotLetter !== null && isBelow(letter, lotLetter);
  return {
    reduceTo: letter === null ? null : previousCodeLetter(letter),
    raiseTo: below ? nextCodeLetter(letter) : null,
    reducedFrom: below ? lotLetter : null,
  };
}
