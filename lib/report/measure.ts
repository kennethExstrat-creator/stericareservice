// How much room a line of the report's text takes, in millimetres, for the
// builders that plan their pages before anything is drawn (Section 06's
// tables, the photo records' captions and notes): Outfit's own character
// widths, as Chrome draws them, with a margin, so a line estimated to fit
// does. Pure and client-safe.

const MM_PER_PT = 25.4 / 72;

/**
 * Outfit's advance widths in hundredths of an em for the characters " " to
 * "~", as Chrome draws them (the print route prints from Chrome): regular,
 * and semibold for every heavier weight. Figures are tabular. Other
 * characters take their own width, or a wide letter's.
 */
const OUTFIT_WIDTHS = {
  regular:
    "21 26 40 64 59 66 66 24 30 30 49 54 27 46 29 39 59 59 59 59 59 59 59 59 59 59 27 27 54 54 54 51 75 66 62 66 74 59 57 78 71 26 45 65 55 84 71 80 60 82 62 54 58 68 66 96 65 63 56 34 39 34 45 50 28 58 58 48 58 54 33 58 55 22 29 50 22 86 55 57 58 58 40 43 33 52 49 73 48 50 45 32 28 32 54",
  bold: "20 27 44 65 59 67 68 25 30 30 49 56 28 46 29 39 59 59 59 59 59 59 59 59 59 59 28 27 56 56 56 50 75 68 63 66 75 60 58 79 72 28 47 67 56 85 73 81 61 82 63 55 60 70 67 97 67 64 57 34 39 34 46 49 31 59 59 48 59 54 35 58 56 25 31 53 25 87 56 57 59 59 42 44 34 53 51 75 50 51 47 33 29 33 56",
} as const;

export type Weight = keyof typeof OUTFIT_WIDTHS;

const ADVANCES: Readonly<Record<Weight, readonly number[]>> = {
  regular: OUTFIT_WIDTHS.regular.split(" ").map(Number),
  bold: OUTFIT_WIDTHS.bold.split(" ").map(Number),
};
const OTHER_ADVANCES: Readonly<Record<string, number>> = { "·": 16, "≤": 55, "—": 86, "–": 56, "×": 56 };
/** Over the characters' sum: for kerning and rounding it leaves out, so a line estimated to fit does. */
const WIDTH_MARGIN = 1.04;

function advance(character: string, weight: Weight): number {
  const code = character.charCodeAt(0);
  return (code >= 32 && code < 127 ? ADVANCES[weight][code - 32] : (OTHER_ADVANCES[character] ?? 80)) / 100;
}

/** The width of some words on one line, in mm, at `pt` points. */
export function textWidth(words: string, pt: number, weight: Weight = "regular"): number {
  let em = 0;
  for (const character of words) em += advance(character, weight);
  return em * pt * MM_PER_PT * WIDTH_MARGIN;
}

/** The lines a text wraps to in a box `width` mm wide, word by word; a word longer than a line breaks inside it. */
export function lineCount(words: string, width: number, pt: number, weight: Weight = "regular"): number {
  const parts = words.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || !(width > 0)) return 1;
  const space = textWidth(" ", pt, weight);
  let lines = 1;
  let used = 0;
  for (const part of parts) {
    const size = textWidth(part, pt, weight);
    if (used > 0 && used + space + size <= width) {
      used += space + size;
      continue;
    }
    if (used > 0) lines += 1;
    const extra = Math.max(0, Math.ceil(size / width) - 1);
    lines += extra;
    used = size - extra * width;
  }
  return lines;
}

/**
 * The words kept to `lines` lines of a box `width` mm wide: whole, or cut at
 * a word's end with an ellipsis (inside a word only where one word alone is
 * too long).
 */
export function clipToLines(words: string, width: number, pt: number, weight: Weight, lines: number): string {
  const whole = words.trim();
  if (lineCount(whole, width, pt, weight) <= lines) return whole;
  const parts = whole.split(/\s+/);
  for (let keep = parts.length - 1; keep > 0; keep -= 1) {
    const cut = `${parts.slice(0, keep).join(" ").replace(/[\s,;:·–—-]+$/, "")}…`;
    if (lineCount(cut, width, pt, weight) <= lines) return cut;
  }
  let cut = whole;
  while (cut.length > 1 && lineCount(`${cut}…`, width, pt, weight) > lines) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
