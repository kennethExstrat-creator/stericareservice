// Tripwire for client data in the fixtures (BUILD_SPEC rule 7, docs/FIXTURES.md).
//
// Two deny lists feed it:
// - Committed (anonymisation.test.ts): salted SHA-256 hashes of identifying
//   names that cannot be enumerated, multi-word company names and address
//   lines, which are plain text elsewhere in the repo already.
// - Git-ignored (docs/examples/deny-list.txt, next to the PDFs): the full
//   list in plain text, with the codes, numbers, people and real dates. A
//   hash of a PO number, a short code or a date is reversed by trying every
//   value, so these never enter the repo, not even hashed.
//
// Names and codes match as word sequences. Dates match by calendar day or
// month, however they are written.
//
// No relative imports and only erasable TypeScript, so Node can load this
// file directly to hash a new committed entry:
//   node -e "import('./tests/fixtures/examples/leak-scan.ts').then((m) => console.log(m.denyHash(process.argv[1])))" "Name"
import { createHash } from "node:crypto";

const SALT = "stericare-fixtures-deny-list:v2:";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Drops accents and splits camelCase ("mfgDateMay" is "mfg Date May"). */
const plain = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/([a-z])(?=[A-Z])/g, "$1 ");

/** SHA-256 hashes, such as the committed deny list, are not text to scan. */
const withoutHashes = (text: string) => text.replace(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/gi, " ");

/**
 * Lower-case word tokens. Accents are dropped; camelCase, an acronym before a
 * word and every boundary between letters and digits are split, so
 * "XYPlant7" is "xy plant 7" and "AB12Blue" is "ab 12 blue". Digit groups
 * joined by `_` (numeric separators) or a thousands comma are rejoined, so
 * "5_400_000", "5,400,000" and "5400000" are one token.
 */
export function tokenize(text: string): string[] {
  return plain(text)
    .replace(/([A-Z])(?=[A-Z][a-z])/g, "$1 ")
    .replace(/([A-Za-z])(?=\d)|(\d)(?=[A-Za-z])/g, "$1$2 ")
    .toLowerCase()
    .replace(/(\d)_(?=\d)/g, "$1")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}

/** The hash of a deny-list entry: its tokens joined by single spaces. */
export function denyHash(entry: string): string {
  return sha256(SALT + tokenize(entry).join(" "));
}

export type DenyMatch = { readonly text: string; readonly token: number };

/**
 * Every run of tokens in `text` whose hash is on the deny list. Entries of
 * one to `maxTokens` tokens are found wherever they appear, whatever the
 * punctuation or spacing between their words.
 */
export function findDenied(text: string, denyHashes: ReadonlySet<string>, maxTokens = 6): DenyMatch[] {
  const tokens = tokenize(withoutHashes(text));
  const matches: DenyMatch[] = [];
  for (let start = 0; start < tokens.length; start++) {
    for (let length = 1; length <= maxTokens && start + length <= tokens.length; length++) {
      const run = tokens.slice(start, start + length).join(" ");
      if (denyHashes.has(sha256(SALT + run))) matches.push({ text: run, token: start });
    }
  }
  return matches;
}

/* ------------------------------------------------------------------ *
 * The git-ignored deny list
 * ------------------------------------------------------------------ */

/** docs/examples/deny-list.txt, parsed. */
export type DenyList = {
  /** Names, codes and numbers, as written in the list. */
  readonly entries: readonly string[];
  /** Real days, `YYYY-MM-DD`. */
  readonly days: readonly string[];
  /** Real months, `YYYY-MM`, for fields that print only a month. */
  readonly months: readonly string[];
};

/**
 * One entry per line; a line starting with `#` is a comment. `date: YYYY-MM-DD`
 * denies a day and `date: YYYY-MM` a month; any other line is a name, code or
 * number.
 */
export function parseDenyList(source: string): DenyList {
  const entries: string[] = [];
  const days: string[] = [];
  const months: string[] = [];
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!/^date:/i.test(line)) {
      if (tokenize(line).length === 0) throw new Error(`deny list line ${index + 1}: no letters or digits`);
      entries.push(line);
      continue;
    }
    const value = line.slice("date:".length).trim();
    const [year, month, day] = value.split("-").map(Number);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && calendarDay(year, month, day) === value) days.push(value);
    else if (/^\d{4}-\d{2}$/.test(value) && calendarMonth(year, month) === value) months.push(value);
    else throw new Error(`deny list line ${index + 1}: write a date as "date: YYYY-MM-DD" or "date: YYYY-MM"`);
  }
  return { entries, days, months };
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/** A date written in the text, with every calendar day or month it can be read as. */
export type DateMention = {
  readonly text: string;
  /** `YYYY-MM-DD`: both readings when the day and month could be either way round. */
  readonly days: readonly string[];
  /** `YYYY-MM`, for a month written without a day. */
  readonly months: readonly string[];
};

type Reading = Pick<DateMention, "days" | "months">;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A month name or abbreviation (group 1), with an optional full stop, not inside a word. */
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?(?![a-z])";
/** What may stand between the parts of a written date: "3 Feb, '31", "3-Feb-31", "3/Feb/31". */
const SEP = "[\\s,./_'-]";
const ORDINAL = "(?:st|nd|rd|th)?";

const pad = (value: number) => String(value).padStart(2, "0");
const fullYear = (year: string) => (year.length === 2 ? 2000 + Number(year) : Number(year));
const monthNumber = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** `YYYY-MM-DD` for a real calendar day between 1900 and 2099, else null. */
function calendarDay(year: number, month: number, day: number): string | null {
  if (calendarMonth(year, month) === null || !(day >= 1)) return null;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate() ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** `YYYY-MM` for a real month between 1900 and 2099, else null. */
function calendarMonth(year: number, month: number): string | null {
  return year >= 1900 && year <= 2099 && month >= 1 && month <= 12 ? `${year}-${pad(month)}` : null;
}

const known = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => value !== null))];
const asDays = (...values: (string | null)[]): Reading => ({ days: known(values), months: [] });
const asMonths = (...values: (string | null)[]): Reading => ({ days: [], months: known(values) });

/** Day and month either way round: 03/02/2031 is 3 February or 2 March. */
const eitherWay = (year: number, first: number, second: number) =>
  asDays(calendarDay(year, second, first), calendarDay(year, first, second));

const DATE_PATTERNS: readonly { readonly pattern: RegExp; readonly read: (match: RegExpMatchArray) => Reading }[] = [
  // 2031-02-03, 2031/2/3, 2031.02.03, 2031_02_03, 2031 02 03, 2031-02-03T09:00Z
  {
    pattern: /(?<!\d)(\d{4})([-/._ ])(\d{1,2})\2(\d{1,2})(?!\d)/g,
    read: (m) => asDays(calendarDay(Number(m[1]), Number(m[3]), Number(m[4]))),
  },
  // 03/02/2031, 3-2-2031, 03.02.2031, 03 02 2031: day or month first
  {
    pattern: /(?<!\d)(\d{1,2})([-/._ ])(\d{1,2})\2(\d{4})(?!\d)/g,
    read: (m) => eitherWay(Number(m[4]), Number(m[1]), Number(m[3])),
  },
  // 03/02/31, 3-2-31, 03.02.31: a two-digit year is 20YY
  {
    pattern: /(?<![\d./-])(\d{1,2})([-/.])(\d{1,2})\2(\d{2})(?!\d|[-/.]\d)/g,
    read: (m) => eitherWay(fullYear(m[4]), Number(m[1]), Number(m[3])),
  },
  // 20310203, 03022031, 02032031
  {
    pattern: /(?<!\d)(\d{8})(?!\d)/g,
    read: ([digits]) => {
      const part = (from: number, to: number) => Number(digits.slice(from, to));
      return asDays(
        calendarDay(part(0, 4), part(4, 6), part(6, 8)),
        calendarDay(part(4, 8), part(2, 4), part(0, 2)),
        calendarDay(part(4, 8), part(0, 2), part(2, 4)),
      );
    },
  },
  // 203102: year and month, compact
  {
    pattern: /(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(?!\d)/g,
    read: (m) => asMonths(calendarMonth(Number(m[1]), Number(m[2]))),
  },
  // 2031-02, 2031/2
  {
    pattern: /(?<![\d/.-])(\d{4})([-/])(\d{1,2})(?!\d|[-/.]\d)/g,
    read: (m) => asMonths(calendarMonth(Number(m[1]), Number(m[3]))),
  },
  // 02/2031, 2-2031, 02.2031
  {
    pattern: /(?<![\d/.-])(\d{1,2})([-/.])(\d{4})(?!\d|[-/.]\d)/g,
    read: (m) => asMonths(calendarMonth(Number(m[3]), Number(m[1]))),
  },
  // February 3, 2031; Feb. 3rd 2031; Feb-03-31
  {
    pattern: new RegExp(`(?<![a-z])${MONTH}${SEP}{0,3}(\\d{1,2})${ORDINAL}(?!\\d)${SEP}{1,3}(\\d{4}|\\d{2})(?!\\d)`, "gi"),
    read: (m) => asDays(calendarDay(fullYear(m[3]), monthNumber(m[1]), Number(m[2]))),
  },
  // 3 February 2031; 3rd of Feb, 2031; 03-Feb-31; 3Feb2031
  {
    pattern: new RegExp(`(?<!\\d)(\\d{1,2})${ORDINAL}(?:\\s*of)?${SEP}{0,3}${MONTH}${SEP}{0,3}(\\d{4}|\\d{2})(?!\\d)`, "gi"),
    read: (m) => asDays(calendarDay(fullYear(m[3]), monthNumber(m[2]), Number(m[1]))),
  },
  // 2031 February 3; 2031-Feb-03
  {
    pattern: new RegExp(`(?<!\\d)(\\d{4})${SEP}{0,3}${MONTH}${SEP}{0,3}(\\d{1,2})${ORDINAL}(?!\\d)`, "gi"),
    read: (m) => asDays(calendarDay(Number(m[1]), monthNumber(m[2]), Number(m[3]))),
  },
  // February 2031; Feb-31; Feb '31 (a month with a two-digit year, as the reports print it),
  // but not the month and year of a full date such as 3 Feb 2031
  {
    pattern: new RegExp(
      `(?<![a-z])(?<!\\d${ORDINAL}(?:\\s*of)?${SEP}{0,3})${MONTH}${SEP}{0,3}(\\d{4}|\\d{2})(?!${SEP}{0,3}\\d)`,
      "gi",
    ),
    read: (m) => asMonths(calendarMonth(fullYear(m[2]), monthNumber(m[1]))),
  },
  // 2031 February; 2031-Feb
  {
    pattern: new RegExp(`(?<!\\d)(\\d{4})${SEP}{0,3}${MONTH}(?!${SEP}{0,3}\\d)`, "gi"),
    read: (m) => asMonths(calendarMonth(Number(m[1]), monthNumber(m[2]))),
  },
];

/**
 * Every date written in `text`: in numbers with one separator used
 * throughout, year first or day and month either way round before a two- or
 * four-digit year; compact (YYYYMMDD, DDMMYYYY, MMDDYYYY, YYYYMM); or with a
 * month name or abbreviation in any order, with or without a weekday or an
 * ordinal ("3rd"). A month with a year and no day ("Feb 2031", "Feb-31",
 * "2031-02") is a month. A date without a year, a weekday on its own, spaces
 * around the separators and a spreadsheet serial number are not dates here.
 */
export function findDates(text: string): DateMention[] {
  const source = plain(withoutHashes(text));
  const mentions: DateMention[] = [];
  for (const { pattern, read } of DATE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const reading = read(match);
      if (reading.days.length > 0 || reading.months.length > 0) mentions.push({ text: match[0], ...reading });
    }
  }
  return mentions;
}

/**
 * The dates in `text` that can mean a denied day or month. A denied day is
 * also found as its month written alone ("Feb 2031"); a denied month is also
 * found as any day in it.
 */
export function findDeniedDates(text: string, denied: Pick<DenyList, "days" | "months">): DateMention[] {
  const deniedDays = new Set(denied.days);
  const deniedMonths = new Set(denied.months);
  const monthsWrittenAlone = new Set([...denied.months, ...denied.days.map((day) => day.slice(0, 7))]);
  return findDates(text).filter(
    (mention) =>
      mention.days.some((day) => deniedDays.has(day) || deniedMonths.has(day.slice(0, 7))) ||
      mention.months.some((month) => monthsWrittenAlone.has(month)),
  );
}
