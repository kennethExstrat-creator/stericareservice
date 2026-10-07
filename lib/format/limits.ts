// Acceptance limits from an AQL plan as one line: "Ac 3 / Re 4". The
// template may word them its own way ("Accept 3 / Reject 4",
// "Acc. = 0 / Rej. = 1"): pass its words as `accept` and `reject`; "Ac" and
// "Re" are only the fallback.

/** Accept with at most `ac` defects; reject at `re` (ac + 1) or more. Same shape as lib/aql. */
export type AcceptanceLimits = { readonly ac: number; readonly re: number };

export type LimitsFormat = {
  /** "short" (default) is "Ac 3 / Re 4"; "long" is "Accept 3 / Reject 4". */
  style?: "short" | "long";
  /** Template wording for the accept word, e.g. "Acc. =". Wins over `style`; blank falls back to it. */
  accept?: string;
  /** Template wording for the reject word, e.g. "Rej. =". Wins over `style`; blank falls back to it. */
  reject?: string;
  /** Text without limits. Default "". */
  empty?: string;
};

const WORDS = {
  short: { accept: "Ac", reject: "Re" },
  long: { accept: "Accept", reject: "Reject" },
} as const;

export function formatLimits(limits: AcceptanceLimits | null | undefined, format: LimitsFormat = {}): string {
  const parts = formatLimitParts(limits, format);
  return parts ? parts.join(" ") : (format.empty ?? "");
}

/**
 * formatLimits' line in two halves, the slash with the first: "Accept 10 /"
 * and "Reject 11". A cell too narrow for the line breaks between them, never
 * before the slash. null without limits.
 */
export function formatLimitParts(
  limits: AcceptanceLimits | null | undefined,
  format: Omit<LimitsFormat, "empty"> = {},
): readonly [string, string] | null {
  if (!limits) return null;
  const { style = "short" } = format;
  const accept = format.accept?.trim() || WORDS[style].accept;
  const reject = format.reject?.trim() || WORDS[style].reject;
  return [`${accept} ${limits.ac} /`, `${reject} ${limits.re}`];
}
