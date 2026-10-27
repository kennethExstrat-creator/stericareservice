// Phone numbers formatted as they are typed (Kenneth, 27 October 2026: "build
// in format to the phone field during user onboarding"). A Malaysian number
// takes the national style, with the country code ("+60 12-345 6789") or
// without it ("012-345 6789"): mobile 1X-XXX XXXX (11 and 15: 1X-XXXX XXXX),
// the Klang Valley 3-XXXX XXXX, Sabah and Sarawak 8X-XX XXXX, the other states
// X-XXX XXXX. Any other country's number stays as typed: its grouping is that
// country's own. Only digits, a leading +, spaces and hyphens come out, so a
// formatted number is still one lib/auth/fields.ts (and the database's
// profiles_phone_format) accepts. No server-only imports: the forms use it.

const MALAYSIA = "60";

/** What a formatter may rewrite: digits, a +, spaces, brackets and hyphens, nothing a person wrote in words. */
const PHONE_CHARACTERS = /^[\d\s+()-]*$/;

/** How a Malaysian number splits after its trunk 0 (or +60): the area or mobile prefix, then the subscriber's groups. */
function malaysianPlan(national: string): { prefix: number; groups: readonly number[] } | null {
  const first = national[0];
  if (first === "1") return { prefix: 2, groups: national.startsWith("11") || national.startsWith("15") ? [4, 4] : [3, 4] };
  if (first === "3") return { prefix: 1, groups: [4, 4] };
  if (first === "8") return { prefix: 2, groups: [2, 4] };
  if (first !== undefined && "45679".includes(first)) return { prefix: 1, groups: [3, 4] };
  return null;
}

/** "173701066" → "17-370 1066". Partial input stays partial; digits past the plan run on, for the check to refuse. */
function formatNational(national: string): string {
  const plan = malaysianPlan(national);
  if (!plan || national.length <= plan.prefix) return national;
  let rest = national.slice(plan.prefix);
  const groups: string[] = [];
  for (const size of plan.groups) {
    if (rest === "") break;
    groups.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  if (rest !== "") groups[groups.length - 1] += rest;
  return `${national.slice(0, plan.prefix)}-${groups.join(" ")}`;
}

/**
 * The number as the app writes it. A Malaysian one, with +60 or a leading 0,
 * in the national style (a trunk 0 after +60 is dropped: "+60 012…" is
 * "+60 12…"); anything else as typed.
 */
export function formatPhone(input: string): string {
  if (!PHONE_CHARACTERS.test(input)) return input;
  const text = input.trim();
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) {
    if (!digits.startsWith(MALAYSIA)) return input;
    let national = digits.slice(MALAYSIA.length);
    if (national.startsWith("0")) national = national.slice(1);
    return national === "" ? `+${digits.slice(0, MALAYSIA.length)}` : `+${MALAYSIA} ${formatNational(national)}`;
  }
  if (digits.startsWith("0")) {
    const national = digits.slice(1);
    return national === "" ? "0" : `0${formatNational(national)}`;
  }
  return input;
}

/** A digit or the leading +: what the caret keeps its place by while separators come and go. */
function significant(character: string): boolean {
  return character === "+" || (character >= "0" && character <= "9");
}

/** How many significant characters come before `caret` in `text`. */
export function significantBefore(text: string, caret: number): number {
  let count = 0;
  for (let index = 0; index < Math.min(caret, text.length); index += 1) if (significant(text[index])) count += 1;
  return count;
}

/** The position just after the `count`-th significant character of `text` (0: its start). */
export function caretAfter(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (significant(text[index])) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return text.length;
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/**
 * One edit of the field: `previous` is what it showed, `typed` what the
 * browser made of the keystroke, paste or deletion, with the caret at
 * `caret`. Returns what the field shows now and where the caret goes (null:
 * where the browser put it, as typed). Deleting only a separator ("-", " ")
 * deletes the digit beside it, as the key meant: formatting would put the
 * separator straight back, and the key would seem to do nothing.
 */
export function phoneEdit({
  previous,
  typed,
  caret,
  inputType,
}: {
  previous: string;
  typed: string;
  caret: number;
  /** The InputEvent's inputType: "insertText", "deleteContentBackward", "deleteContentForward", "insertFromPaste"… */
  inputType?: string;
}): { value: string; caret: number | null } {
  let raw = typed;
  let at = caret;
  const onlySeparatorGone =
    inputType?.startsWith("delete") === true && raw.length < previous.length && digitsOf(raw) === digitsOf(previous);
  if (onlySeparatorGone && formatPhone(previous) === previous) {
    const before = significantBefore(raw, at);
    if (inputType === "deleteContentBackward" && before > 0) {
      const index = caretAfter(raw, before) - 1;
      raw = raw.slice(0, index) + raw.slice(index + 1);
      at = index;
    } else if (inputType === "deleteContentForward") {
      const index = caretAfter(raw, before + 1) - 1;
      if (index >= at) raw = raw.slice(0, index) + raw.slice(index + 1);
    }
  }
  const value = formatPhone(raw);
  if (value === typed) return { value, caret: null };
  return { value, caret: caretAfter(value, significantBefore(raw, at)) };
}
