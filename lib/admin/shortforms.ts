import { GlossaryEntrySchema, GlossarySchema, sameShortform, type GlossaryEntry, type GlossaryKind } from "@/lib/schemas/ai-settings";
import {
  DEFECT_CODE_PATTERN,
  LIMITS,
  MESSAGES,
  failed,
  fieldErrors,
  matchesSearch,
  oneLine,
  readForm,
  searchText,
  suggestCodes,
  suggestNewCode,
  type ActionResult,
} from "./defects";

/**
 * Shortforms for /admin/defects/shortforms (docs/AI.md, "The paper form and
 * shortforms"): what inspectors write on their paper forms, a reading aid for
 * Steri-AI, each defect linked to the library codes it counts under. The
 * list is one JSON value (ai_settings.glossary, read and saved whole by
 * lib/ai/settings.ts); the panel changes one entry at a time, against the
 * entry as it opened it, so a save never quietly undoes someone else's.
 *
 * Client-safe like ./defects, which the code list's grouping lives in
 * (shortformsByCode, so ./defects never imports this file): the tab and its
 * panel use the items, the search and the suggestions; the Server Actions
 * use the form reader and applyShortformChange.
 */

export { shortformsByCode } from "./defects";

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

/** A defect code as the shortforms read the library. */
export type LibraryCode = { code: string; name: string; active: boolean };

/** A linked code as the list shows it: its library name, and whether it is active, inactive or not a defect code at all. */
export type ShortformCode = { code: string; name: string | null; state: "ok" | "inactive" | "unknown" };

/** One shortform as the Shortforms tab shows it. Display data only: this reaches the browser. */
export type ShortformItem = {
  short: string;
  meaning: string;
  confirmed: boolean;
  kind: GlossaryKind;
  codes: ShortformCode[];
  /** What the search matches: the shortform, its meaning, each code and its name. */
  search: string;
};

const byShort = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** The shortforms by shortform ("CF", "DT", "TG32"), each code with its library name and state. */
export function buildShortformItems(entries: readonly GlossaryEntry[], codes: readonly LibraryCode[]): ShortformItem[] {
  const library = new Map(codes.map((row) => [row.code, row]));
  return [...entries]
    .sort((a, b) => byShort.compare(a.short, b.short))
    .map((entry) => {
      const linked = entry.codes.map((code): ShortformCode => {
        const row = library.get(code);
        return { code, name: row?.name ?? null, state: !row ? "unknown" : row.active ? "ok" : "inactive" };
      });
      return {
        short: entry.short,
        meaning: entry.meaning,
        confirmed: entry.confirmed,
        kind: entry.kind,
        codes: linked,
        search: searchText(entry.short, entry.meaning, ...linked.flatMap((code) => [code.code, code.name])),
      };
    });
}

/** The entry an item shows, as saved: what the panel sends back as the version it opened. */
export function entryOf(item: ShortformItem): GlossaryEntry {
  return { short: item.short, meaning: item.meaning, confirmed: item.confirmed, kind: item.kind, codes: item.codes.map((code) => code.code) };
}

/* ------------------------------------------------------------------ *
 * The code picker
 * ------------------------------------------------------------------ */

/** How many codes the picker suggests from the shortform's words. */
export const SUGGESTED_CODES = 3;

/**
 * What the code picker offers, without the codes already chosen: up to three
 * active codes suggested from the shortform's words (`words`: the shortform
 * and its meaning, so "Between fingers" finds hole_crotch), then every other
 * active code. Both narrowed by the search (code or name). Suggested by code
 * and name only: every visual code's description says "Visual", which would
 * suggest any of them for "Skin Visual".
 */
export function pickerOptions(
  library: readonly LibraryCode[],
  chosen: readonly string[],
  words: string,
  query: string,
): { suggested: LibraryCode[]; others: LibraryCode[] } {
  const open = library.filter((code) => code.active && !chosen.includes(code.code));
  const shown = open.filter((code) => matchesSearch(searchText(code.code, code.name), query));
  const picks = suggestCodes(
    words,
    open.map(({ code, name }) => ({ code, name, description: null })),
    { limit: SUGGESTED_CODES },
  );
  return {
    suggested: picks.flatMap((value) => shown.filter((code) => code.code === value)),
    others: shown.filter((code) => !picks.includes(code.code)),
  };
}

/** Words that end a name without saying anything ("Thin Spot on the" is "Thin Spot"). */
const TRAILING = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "when", "with"]);

/**
 * A code to add for a shortform that has none, and its name: the meaning's
 * first words ("Skin Visual" from "Skin Visual: a visual defect of the glove
 * skin"), else the shortform. Null when there is nothing to name it by.
 */
export function newCodeFor(short: string, meaning: string, taken: ReadonlySet<string>): { code: string; name: string } | null {
  const head = oneLine(meaning).split(/[:;,(.]/)[0] ?? "";
  const words = head.split(" ").filter(Boolean).slice(0, 4);
  while (words.length > 1 && TRAILING.has(words[words.length - 1].toLowerCase())) words.pop();
  const name = (words.join(" ") || oneLine(short)).slice(0, LIMITS.name);
  if (!name) return null;
  return { code: suggestNewCode(name, "visual", taken), name };
}

/* ------------------------------------------------------------------ *
 * Saving one entry
 * ------------------------------------------------------------------ */

export type ShortformField = "short" | "kind" | "codes" | "meaning" | "confirmed";
/** The fields in the order they appear, so the first one with an error takes the focus. */
export const SHORTFORM_FIELDS: readonly ShortformField[] = ["short", "kind", "codes", "meaning", "confirmed"];
export type ShortformResult = ActionResult<ShortformField>;

export const SHORTFORM_MESSAGES = {
  conflict: "The shortforms changed since you opened this one. Close it and open it again.",
  noSecretKey: "The server needs SUPABASE_SECRET_KEY before shortforms can be saved.",
  unavailable: "The shortforms could not be read, so nothing was saved. Try again.",
} as const;

/** “hole_x” is not an active defect code. */
export function notActiveCode(code: string): string {
  return `“${code}” is not an active defect code.`;
}

/**
 * The entry as the panel opened it, from the form's `original`: JSON, or ""
 * when adding (null). Undefined when it is missing or unreadable: the page is
 * out of date.
 */
export function readOriginal(formData: FormData): GlossaryEntry | null | undefined {
  const raw = formData.get("original");
  if (raw === "") return null;
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = GlossaryEntrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the shortform panel sends: `original` (the entry as it opened, "" to
 * add), `short`, `kind`, `codes` (one field per code, none for a term),
 * `meaning` and `confirmed` ("true" or "false"). A code that is no defect
 * code's shape gets the same answer as an unknown one.
 */
export function readShortformForm(
  formData: FormData,
): { ok: true; original: GlossaryEntry | null; next: GlossaryEntry } | { ok: false; result: ShortformResult } {
  const original = readOriginal(formData);
  const fields = readForm(formData, ["short", "kind", "meaning", "confirmed"]);
  if (original === undefined || (fields.kind !== "defect" && fields.kind !== "term")) {
    return { ok: false, result: failed(MESSAGES.stale) };
  }
  const codes =
    fields.kind === "term" ? [] : formData.getAll("codes").filter((value): value is string => typeof value === "string");
  const parsed = GlossaryEntrySchema.safeParse({
    short: fields.short,
    meaning: fields.meaning,
    confirmed: fields.confirmed === "true",
    kind: fields.kind,
    codes,
  });
  const errors: Partial<Record<ShortformField, string>> = parsed.success ? {} : fieldErrors(parsed.error);
  const malformed = codes.find((code) => code.length > LIMITS.code || !DEFECT_CODE_PATTERN.test(code));
  if (malformed !== undefined) errors.codes = notActiveCode(malformed);
  if (Object.keys(errors).length > 0) return { ok: false, result: failed(MESSAGES.checkFields, errors) };
  if (!parsed.success) return { ok: false, result: failed(MESSAGES.stale) };
  return { ok: true, original, next: parsed.data };
}

function sameEntry(a: GlossaryEntry, b: GlossaryEntry): boolean {
  return (
    a.short === b.short &&
    a.meaning === b.meaning &&
    a.confirmed === b.confirmed &&
    a.kind === b.kind &&
    a.codes.length === b.codes.length &&
    a.codes.every((code, index) => code === b.codes[index])
  );
}

export type ShortformChange = {
  /** The entry as the panel opened it; null when adding. */
  original: GlossaryEntry | null;
  /** The entry to save; null to delete `original`. */
  next: GlossaryEntry | null;
};

/**
 * The whole list with one entry added, changed (in its place, renamed too)
 * or deleted. Refused when the shortform is already in the list (ignoring
 * case), when the list would break its own rules (at most 200: a list that
 * cannot be read back would leave Steri-AI and this tab with the starting
 * list), or when the saved entry is no longer the one the panel opened:
 * someone else changed or deleted it meanwhile. A delete of an entry that is
 * already gone changes nothing (`changed` false).
 */
export function applyShortformChange(
  entries: readonly GlossaryEntry[],
  { original, next }: ShortformChange,
): { ok: true; entries: GlossaryEntry[]; changed: boolean } | { ok: false; result: ShortformResult } {
  const index = original ? entries.findIndex((entry) => sameShortform(entry.short, original.short)) : -1;
  if (original) {
    if (index === -1) {
      return next ? { ok: false, result: failed(SHORTFORM_MESSAGES.conflict) } : { ok: true, entries: [...entries], changed: false };
    }
    if (!sameEntry(entries[index], original)) return { ok: false, result: failed(SHORTFORM_MESSAGES.conflict) };
  }
  if (!next) {
    if (!original) return { ok: false, result: failed(MESSAGES.stale) };
    return { ok: true, entries: entries.filter((_, position) => position !== index), changed: true };
  }
  if (entries.some((entry, position) => position !== index && sameShortform(entry.short, next.short))) {
    return { ok: false, result: failed(MESSAGES.checkFields, { short: `“${next.short}” is already in the list.` }) };
  }
  const list = original ? entries.map((entry, position) => (position === index ? next : entry)) : [...entries, next];
  const whole = GlossarySchema.safeParse(list);
  if (!whole.success) return { ok: false, result: failed(whole.error.issues[0]?.message ?? MESSAGES.stale) };
  return { ok: true, entries: list, changed: true };
}
