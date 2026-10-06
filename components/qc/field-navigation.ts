// Enter-to-next and paste-to-fill for NumberField groups, kept pure where it
// can be tested. Fields of one group are found in the DOM, in reading order:
// the inputs marked data-enter-field with the same data-enter-group name
// inside the nearest EnterGroup (data-enter-scope).

export const ENTER_SCOPE_ATTRIBUTE = "data-enter-scope";
export const ENTER_FIELD_ATTRIBUTE = "data-enter-field";
export const ENTER_GROUP_ATTRIBUTE = "data-enter-group";
/** Dispatched on a field's input with the raw text to store, when a paste fills it. */
export const FILL_EVENT = "qc-fill";

/**
 * The values in pasted text, in order: one per line, and tab-separated
 * values (a row from a spreadsheet) in reading order. One value is a normal
 * paste. Blank and invalid entries stay in place for the fields to judge.
 */
export function splitPastedValues(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return lines.split(/[\n\t]/).map((value) => value.trim());
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
