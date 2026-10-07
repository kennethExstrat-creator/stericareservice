// Enter-to-next and paste-to-fill for NumberField groups, kept pure where it
// can be tested. Fields of one group are found in the DOM, in reading order:
// the inputs marked data-enter-field with the same data-enter-group name
// inside the nearest EnterGroup (data-enter-scope).

export const ENTER_SCOPE_ATTRIBUTE = "data-enter-scope";
export const ENTER_FIELD_ATTRIBUTE = "data-enter-field";
export const ENTER_GROUP_ATTRIBUTE = "data-enter-group";
/** Dispatched on a field's input when a paste fills it; the field answers in `stored`. */
export const FILL_EVENT = "qc-fill";

/** The detail of a FILL_EVENT: the raw text to store, and whether the field stored it. */
export type FillRequest = { readonly raw: string; stored?: boolean };

/**
 * Pasted text as rows of values, the way a spreadsheet copies a block: one
 * row per line, cells split at tabs, each trimmed. Blank and invalid entries
 * stay in place for the fields to judge.
 */
export function parsePastedRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return lines.split("\n").map((line) => line.split("\t").map((value) => value.trim()));
}

/** Every value in pasted text in reading order: row by row, left to right. */
export function splitPastedValues(text: string): string[] {
  return parsePastedRows(text).flat();
}

export type FieldPastePlan = {
  /** One raw value per field, from the field pasted into onwards. */
  values: string[];
  /** Values from other spreadsheet columns, not used because the run is one column. */
  leftOut: number;
};

/**
 * What a paste puts into a run of fields, or null for an ordinary paste of
 * one value. Fields that form one run in reading order take a block row by
 * row. A named group (`group="layering"`) is one column, so it takes the
 * block's first column only: a two-column block never mixes into it.
 */
export function planFieldPaste(text: string, { column }: { column: boolean }): FieldPastePlan | null {
  const rows = parsePastedRows(text);
  const values = column ? rows.map((row) => row[0]) : rows.flat();
  const leftOut = column ? rows.reduce((sum, row) => sum + row.slice(1).filter((value) => value !== "").length, 0) : 0;
  if (values.length < 2 && leftOut === 0) return null;
  return { values, leftOut };
}

export type PasteResult = {
  /** Fields that received a value. */
  filled: number;
  /** Of those, values the field could not store (text, out of range, a decimal in a whole-number field). */
  rejected: number;
  /** Values past the last field of the run. */
  skipped: number;
};

/**
 * Hands each planned value to the field `offset` places after `start`, in
 * order. `store` stores one value in one field, judged by that field's own
 * rules, and says whether it was stored. Wrap the call in batchDataChanges so
 * the module receives one onChange for the whole paste.
 */
export function fillRun<F>(
  planned: readonly string[],
  fields: readonly F[],
  start: number,
  store: (field: F, raw: string) => boolean,
): PasteResult {
  const result: PasteResult = { filled: 0, rejected: 0, skipped: 0 };
  planned.forEach((raw, offset) => {
    const field = start < 0 ? undefined : fields[start + offset];
    if (field === undefined) {
      result.skipped += 1;
      return;
    }
    result.filled += 1;
    if (!store(field, raw)) result.rejected += 1;
  });
  return result;
}

const plural = (count: number) => `${count} ${count === 1 ? "value" : "values"}`;

/**
 * What a paste left out, for the notice on screen: the values past the last
 * field or cell of the run (or the grid), and how many values came from
 * other spreadsheet columns where the run takes its first column only.
 */
export type PasteLeftOut = {
  /** As pasted, in reading order. Blank values are not data and are not listed. */
  readonly pastEnd: readonly string[];
  readonly otherColumns: number;
};

const isBlank = (value: string) => value.trim() === "";

/**
 * The planned values that fall past the last of `fieldCount` fields when the
 * paste starts at field `start` (fillRun's `skipped`), blanks dropped.
 */
export function valuesPastEnd(planned: readonly string[], fieldCount: number, start: number): string[] {
  const past = start < 0 ? planned : planned.slice(Math.max(0, fieldCount - start));
  return past.filter((value) => !isBlank(value));
}

/** Whether anything was left out: only then is there a notice. */
export function leftOutAnything({ pastEnd, otherColumns }: PasteLeftOut): boolean {
  return pastEnd.length > 0 || otherColumns > 0;
}

/** How long a value may run in the notice before it is cut ("99999999999999999…"). */
const VALUE_CHARACTERS = 18;

const quoted = (value: string) => {
  const text = value.trim();
  return `“${text.length > VALUE_CHARACTERS ? `${text.slice(0, VALUE_CHARACTERS - 1)}…` : text}”`;
};

/** “6.1”, “6.1” and “6.3”, or the first `shown` then "and 3 more". */
export function listValues(values: readonly string[], shown = 6): string {
  const words = values.map(quoted);
  if (words.length <= 1) return words[0] ?? "";
  if (words.length <= shown) return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return `${words.slice(0, shown).join(", ")} and ${words.length - shown} more`;
}

/**
 * The notice's sentences, in plain words, with the values that were not
 * stored, so the inspector can place them by hand. The live region keeps its
 * short form (pasteNotice).
 */
export function leftOutMessages({ pastEnd, otherColumns }: PasteLeftOut): string[] {
  const messages: string[] = [];
  if (pastEnd.length > 0) {
    const one = pastEnd.length === 1;
    messages.push(
      `${pastEnd.length} pasted ${one ? "value" : "values"} did not fit and ${one ? "was" : "were"} not stored: ${listValues(pastEnd)}.`,
    );
  }
  if (otherColumns > 0) {
    messages.push(
      `Only the first column is used here: ${plural(otherColumns)} from other columns ${otherColumns === 1 ? "was" : "were"} not stored.`,
    );
  }
  return messages;
}

/** What a paste did, for the field's live region. */
export function pasteNotice({ filled, rejected, skipped, leftOut }: PasteResult & { leftOut: number }): string {
  return [
    `Pasted ${plural(filled)}.`,
    rejected > 0 && `${rejected} not stored.`,
    skipped > 0 && `${skipped} did not fit.`,
    leftOut > 0 && `Only the first column is used here: ${plural(leftOut)} from other columns left out.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The item `step` places after `current`, or null past either end. */
export function neighbour<T>(items: readonly T[], current: T, step: 1 | -1): T | null {
  const index = items.indexOf(current);
  if (index === -1) return null;
  return items[index + step] ?? null;
}

/** The fields of `input`'s group that can take a value, in reading order. */
export function groupFields(input: HTMLInputElement): HTMLInputElement[] {
  const name = input.getAttribute(ENTER_GROUP_ATTRIBUTE) ?? "";
  const scope: ParentNode | null =
    input.closest(`[${ENTER_SCOPE_ATTRIBUTE}]`) ?? (name !== "" ? input.ownerDocument : null);
  if (!scope) return [input];
  const owner = scope instanceof Element ? scope : null;
  return Array.from(scope.querySelectorAll<HTMLInputElement>(`input[${ENTER_FIELD_ATTRIBUTE}]`)).filter(
    (field) =>
      (field.getAttribute(ENTER_GROUP_ATTRIBUTE) ?? "") === name &&
      field.closest(`[${ENTER_SCOPE_ATTRIBUTE}]`) === owner &&
      (field === input || (!field.readOnly && !field.disabled && field.getClientRects().length > 0)),
  );
}
