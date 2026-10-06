// Keeps client data out of the fixtures (BUILD_SPEC rule 7; docs/FIXTURES.md, "Leak guard").
//
// Two tiers. The committed one runs everywhere: hashes of identifying names
// that cannot be enumerated. The full one runs where the git-ignored
// docs/examples/deny-list.txt exists, or STERICARE_EXAMPLES_DIR points at a
// copy of docs/examples: every name, code, number and real date, in plain text.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cartonList } from "./helpers";
import {
  denyHash,
  findDates,
  findDenied,
  findDeniedDates,
  parseDenyList,
  tokenize,
  type DenyList,
} from "./leak-scan";
import { SAFEDON_EG_EXAMPLE } from "./safedon-eg";
import { STD_EG_EXAMPLE } from "./std-eg";
import type { ExampleReport, FictionalDate } from "./types";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL("./", import.meta.url));
const EXAMPLES_DIR = process.env.STERICARE_EXAMPLES_DIR ?? join(ROOT, "docs", "examples");
const DENY_LIST_FILE = join(EXAMPLES_DIR, "deny-list.txt");
const REPORTS: readonly ExampleReport[] = [STD_EG_EXAMPLE, SAFEDON_EG_EXAMPLE];

/**
 * The committed tier: identifying names from the example PDFs that cannot be
 * enumerated (the multi-word company names and the factory address lines),
 * as salted hashes (leak-scan.ts). Each is plain text elsewhere in the repo
 * already (supabase/seed.sql, BUILD_SPEC 11), so its hash gives nothing away.
 * Numbers, codes, single words, people and dates never go here: a hash of a
 * value that can be enumerated is reversed by trying every value. They belong
 * in the git-ignored deny list (docs/FIXTURES.md).
 */
const DENY_HASHES = [
  "32b91ee5d4fbf62eb542da61a99bdc9eeb93b173422aa284ecd21c68ab060c47",
  "3e0f2fee60344e95b5b50f1cd07f44ec4cac087d0c981894e65a1e8829f78617",
  "40101a62e946fde005a8a9e5de1fd9dac7216d06b41c0bb80fbd0c5ee3a439b3",
  "4e5b999d9388351ac2efc4d65c161e55b83f86d39576ed60fff17f6282c5343e",
  "6e67dadc4222243d57f90838d621358b45121f2fb8f1387cd7ed19e8cf269b99",
  "9847ee42234772db55bd55d9fa0b369f7d4cc5061a72deb61b56ca46f9021ee6",
  "b5b57e14c05bf7a70cb4f7116fdc97c83f3f48796c8efb11792a15e20b61be85",
  "d1e8164dfe1122d2163140d1f5c9ef78863cc6064be614163b3214c4270442c7",
];
const DENY_SET: ReadonlySet<string> = new Set(DENY_HASHES);

/** The fixture files (this folder, recursively) and their documentation. */
function scannedFiles(): string[] {
  const fixtures = readdirSync(FIXTURE_DIR, { recursive: true, encoding: "utf8" })
    .map((name) => join(FIXTURE_DIR, name))
    .filter((path) => statSync(path).isFile());
  return [...fixtures, join(ROOT, "docs", "FIXTURES.md")];
}

/** Each scanned file's findings, as "path: match", with the file name scanned too. */
function scan(find: (text: string) => readonly { readonly text: string }[]): string[] {
  return scannedFiles().flatMap((path) => {
    const name = relative(ROOT, path);
    return find(`${name}\n${readFileSync(path, "utf8")}`).map((match) => `${name}: ${match.text}`);
  });
}

describe("the leak scanner", () => {
  const deny = new Set(["Acme Gloves Sdn. Bhd.", "98765", "XY Plant 7", "QZ42"].map(denyHash));
  const found = (text: string) => findDenied(text, deny).map((match) => match.text);

  it("finds a name whatever its case, punctuation or spacing", () => {
    expect(found("Made by ACME-gloves  sdn bhd, Factory 2")).toEqual(["acme gloves sdn bhd"]);
    expect(found("const acmeGlovesSdnBhd = 1;")).toEqual(["acme gloves sdn bhd"]);
    expect(found("Acmé Gloves Sdn Bhd")).toEqual(["acme gloves sdn bhd"]);
  });

  it("finds a code glued to other words or split by punctuation", () => {
    expect(found("XYPlant7, xy-plant-7, XY_Plant_7")).toEqual(["xy plant 7", "xy plant 7", "xy plant 7"]);
    expect(found("QZ42Blue Nitrile, codeQZ42, QZ-42, qz 42")).toEqual(["qz 42", "qz 42", "qz 42", "qz 42"]);
  });

  it("finds a number written with separators", () => {
    expect(found("po: 98765")).toEqual(["98765"]);
    expect(found("po: 98_765")).toEqual(["98765"]);
    expect(found("po: 98,765")).toEqual(["98765"]);
  });

  it("ignores longer tokens, other numbers and partial matches", () => {
    expect(found("1987654, 9876, 98 765, [98, 765], Acme Gloves Ltd, QZ421, AQZ42, XY Plant 77")).toEqual([]);
  });

  it("skips SHA-256 hashes, which are not text", () => {
    const hash = `${"ab".repeat(10)}98765${"cd".repeat(19)}e`;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(found(`"${hash}"`)).toEqual([]);
    expect(found(`"${hash.slice(0, 63)}"`)).toEqual(["98765"]);
  });

  it("splits camelCase and letter-digit boundaries", () => {
    expect(tokenize("lotNumber XY9876Z12, 5_800_000 and 3,060,000")).toEqual([
      "lot",
      "number",
      "xy",
      "9876",
      "z",
      "12",
      "5800000",
      "and",
      "3060000",
    ]);
  });
});

describe("the date scanner", () => {
  const denied = { days: ["2031-02-03"], months: ["2032-07"] };
  const found = (text: string) => findDeniedDates(text, denied).map((mention) => mention.text);
  const missed = (spellings: readonly string[]) => spellings.filter((text) => found(`(${text}).`).length === 0);
  const caught = (spellings: readonly string[]) => spellings.filter((text) => found(`(${text}).`).length > 0);

  it("finds a denied day however it is written", () => {
    expect(daySpellings("2031-02-03")).toContain("Monday, February 3, 2031");
    expect(missed(daySpellings("2031-02-03"))).toEqual([]);
  });

  it("finds a denied day's month written alone", () => {
    expect(missed(monthSpellings("2031-02"))).toEqual([]);
  });

  it("finds a denied month however it is written, and any day in it", () => {
    expect(missed(monthSpellings("2032-07"))).toEqual([]);
    expect(missed(daySpellings("2032-07-15"))).toEqual([]);
  });

  it("ignores other days and months", () => {
    expect(caught(daySpellings("2031-02-04"))).toEqual([]);
    expect(caught(daySpellings("2032-08-15"))).toEqual([]);
    expect(caught(monthSpellings("2031-03"))).toEqual([]);
  });

  it("reads day and month both ways round when either could come first", () => {
    expect(findDates("03/02/2031").map((mention) => mention.days)).toEqual([["2031-02-03", "2031-03-02"]]);
    expect(findDates("13/02/2031").map((mention) => mention.days)).toEqual([["2031-02-13"]]);
    expect(findDates("4 Feb 2031").map((mention) => [mention.days, mention.months])).toEqual([[["2031-02-04"], []]]);
    expect(findDates("Jan-80").map((mention) => mention.months)).toEqual([["2080-01"]]);
  });

  it("finds dates inside longer text", () => {
    expect(found("mfgDateFeb31, stamped 2031-02-03T09:12:00Z").sort()).toEqual(["2031-02-03", "Feb31"]);
  });

  it("ignores dates without a year, number lists and words that start like a month", () => {
    expect(found("3 Feb, Feb 3, [3, 2, 2031], 2031, 1/80, decimal 31, Mayor 2031, Marching 2031")).toEqual([]);
  });
});

describe("the deny list file format", () => {
  it("reads names, days and months, and skips comments and blank lines", () => {
    expect(parseDenyList("# a comment\n\nAcme Gloves\n  date: 2031-02-03 \ndate: 2032-07\r\nQZ42\n")).toEqual({
      entries: ["Acme Gloves", "QZ42"],
      days: ["2031-02-03"],
      months: ["2032-07"],
    });
  });

  it("refuses a date it cannot read and a line with no letters or digits", () => {
    expect(() => parseDenyList("date: 3 Feb 2031")).toThrow(/line 1/);
    expect(() => parseDenyList("date: 2031-02-30")).toThrow(/line 1/);
    expect(() => parseDenyList("date: 2031-13")).toThrow(/line 1/);
    expect(() => parseDenyList("Acme\n---")).toThrow(/line 2/);
  });
});

describe("anonymisation", () => {
  it("has a committed list of distinct SHA-256 hashes", () => {
    expect(DENY_HASHES.length).toBeGreaterThan(0);
    expect(DENY_SET.size).toBe(DENY_HASHES.length);
    for (const hash of DENY_HASHES) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the committed deny-listed names out of the fixtures and docs/FIXTURES.md", () => {
    expect(scannedFiles().map((path) => relative(ROOT, path))).toEqual(
      expect.arrayContaining([
        "docs/FIXTURES.md",
        "tests/fixtures/examples/std-eg.ts",
        "tests/fixtures/examples/safedon-eg.ts",
        "tests/fixtures/examples/expected.ts",
      ]),
    );
    expect(scan((text) => findDenied(text, DENY_SET))).toEqual([]);
  });

  it.each(REPORTS)("$template names nobody: every party is a placeholder", (report) => {
    const { header, order, conclusion } = report;
    expect(header.manufacturer).toMatch(/^Manufacturer [A-Z]$/);
    if (header.factory !== undefined) expect(header.factory).toMatch(/^Factory [A-Z]\d$/);
    expect(header.factoryAddress).toMatch(/^Address [A-Z]$/);
    expect(header.po.poNo).toMatch(/^PO-\d{4}$/);
    expect(header.po.ref).toMatch(/^(SO|REF)-\d{4}$/);
    expect(header.po.printed).toBe(`${header.po.poNo} (${header.po.ref})`);
    expect(header.productName).toMatch(/^Brand [A-Z] /);
    for (const code of [header.productCode, header.productCodeElsewhere?.code]) {
      if (code !== null && code !== undefined) expect(code).toMatch(/^PC-[A-Z]\d{2}$/);
    }
    if (header.clientLogo !== undefined) expect(header.clientLogo).toMatch(/^Client [A-Z]$/);
    for (const person of [header.inspectedBy, conclusion.inspectedBy]) {
      if (person !== undefined) expect(person).toMatch(/^Inspector [A-Z]$/);
    }
    for (const line of Object.values(order.lines)) {
      for (const lot of line?.lots ?? []) expect(lot).toMatch(/^LOT-[A-Z]\d{2}$/);
      if (line?.packingSite !== undefined) expect(line.packingSite).toMatch(/^(Manufacturer|Packer) [A-Z]$/);
    }
  });

  it.each(REPORTS)("$template prints its fictional dates in the report's own formats", (report) => {
    const { inspectionDate, mfgDate, expiryDate } = report.header;
    for (const date of [inspectionDate, mfgDate, expiryDate, report.conclusion.date]) {
      expect(formatDate(date)).toBe(date.printed);
    }
  });

  it.each(REPORTS)("$template keeps the real dates' order: made, inspected, reported, expires", (report) => {
    const { inspectionDate, mfgDate, expiryDate } = report.header;
    const day = (date: FictionalDate) => (date.iso.length === 7 ? `${date.iso}-01` : date.iso);
    expect(day(mfgDate) <= day(inspectionDate)).toBe(true);
    expect(day(inspectionDate) <= day(report.conclusion.date)).toBe(true);
    expect(day(report.conclusion.date) < day(expiryDate)).toBe(true);
  });

  it.each(REPORTS)("$template keeps carton numbers in range and never reuses one across sizes", (report) => {
    const owner = new Map<number, string>();
    for (const [size, grid] of Object.entries(report.cartons)) {
      const qty = report.order.lines[size as keyof typeof report.order.lines]?.qtyCases ?? 0;
      for (const carton of new Set(cartonList(grid!))) {
        expect(Number.isInteger(carton) && carton >= 1 && carton <= qty).toBe(true);
        expect(owner.get(carton) ?? size).toBe(size);
        owner.set(carton, size);
      }
    }
  });
});

describe.skipIf(!existsSync(DENY_LIST_FILE))("anonymisation against the git-ignored deny list", () => {
  const list: DenyList = existsSync(DENY_LIST_FILE)
    ? parseDenyList(readFileSync(DENY_LIST_FILE, "utf8"))
    : { entries: [], days: [], months: [] };
  const hashes: ReadonlySet<string> = new Set(list.entries.map(denyHash));
  const maxTokens = Math.max(1, ...list.entries.map((entry) => tokenize(entry).length));

  it("lists names, codes, numbers and dates, every committed name among them", () => {
    expect(list.entries.length).toBeGreaterThan(DENY_HASHES.length);
    expect(list.days.length + list.months.length).toBeGreaterThan(0);
    expect(DENY_HASHES.filter((hash) => !hashes.has(hash))).toEqual([]);
  });

  it("commits only names that cannot be enumerated: two or more words, ten or more letters", () => {
    const committed = list.entries.filter((entry) => DENY_SET.has(denyHash(entry)));
    const enumerable = committed.filter((entry) => {
      const tokens = tokenize(entry);
      return tokens.length < 2 || tokens.join("").replace(/\d/g, "").length < 10;
    });
    expect(enumerable).toEqual([]);
  });

  it("keeps every listed name, code and number out of the fixtures and docs/FIXTURES.md", () => {
    expect(scan((text) => findDenied(text, hashes, maxTokens))).toEqual([]);
  });

  it("keeps every real date out of the fixtures and docs/FIXTURES.md, however it is written", () => {
    expect(scan((text) => findDeniedDates(text, list))).toEqual([]);
  });

  it("would find each real date in every spelling the scanner reads", () => {
    const spellings = [
      ...list.days.flatMap((day) => [...daySpellings(day), ...monthSpellings(day.slice(0, 7))]),
      ...list.months.flatMap((month) => [...monthSpellings(month), ...daySpellings(`${month}-15`)]),
    ];
    expect(spellings.filter((text) => findDeniedDates(`(${text}).`, list).length === 0)).toEqual([]);
  });
});

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

function formatDate({ iso, format }: FictionalDate): string {
  const [year, month, day] = iso.split("-").map(Number);
  switch (format) {
    case "dddd, MMMM D, YYYY": {
      const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
      return `${weekday}, ${MONTHS[month - 1]} ${day}, ${year}`;
    }
    case "M/D/YYYY":
      return `${month}/${day}/${year}`;
    case "DD/MM/YYYY":
      return `${pad(day)}/${pad(month)}/${year}`;
    case "MMM-YY":
      if (day !== undefined) throw new Error(`${iso}: a month-only field holds a day`);
      return `${MONTHS[month - 1].slice(0, 3)}-${pad(year % 100)}`;
  }
}

/** A day (`YYYY-MM-DD`) written the ways the reports and spreadsheets write dates. */
function daySpellings(iso: string): string[] {
  const [y, m, d] = iso.split("-").map(Number);
  const [yyyy, yy, mm, dd] = [String(y), String(y).slice(2), pad(m), pad(d)];
  const [month, mon] = [MONTHS[m - 1], MONTHS[m - 1].slice(0, 3)];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const nth = `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
  return [
    `${weekday}, ${month} ${d}, ${yyyy}`,
    `${month} ${d}, ${yyyy}`,
    `${mon} ${d}, ${yyyy}`,
    `${mon}. ${nth}, ${yyyy}`,
    `${month} ${nth} ${yyyy}`,
    `${d} ${month} ${yyyy}`,
    `${nth} of ${month}, ${yyyy}`,
    `${d}-${mon}-${yyyy}`,
    `${dd}-${mon}-${yy}`,
    `${d}${mon}${yyyy}`,
    `${yyyy} ${month} ${d}`,
    `${yyyy}-${mon}-${dd}`,
    `${yyyy}-${mm}-${dd}`,
    `${yyyy}-${mm}-${dd}T09:12:00Z`,
    `${yyyy}/${m}/${d}`,
    `${yyyy}.${mm}.${dd}`,
    `${yyyy}_${mm}_${dd}`,
    `${dd}/${mm}/${yyyy}`,
    `${d}/${m}/${yyyy}`,
    `${mm}/${dd}/${yyyy}`,
    `${m}/${d}/${yyyy}`,
    `${dd}-${mm}-${yyyy}`,
    `${dd}.${mm}.${yyyy}`,
    `${dd}/${mm}/${yy}`,
    `${m}/${d}/${yy}`,
    `${yyyy}${mm}${dd}`,
    `${dd}${mm}${yyyy}`,
    `${mm}${dd}${yyyy}`,
  ];
}

/** A month (`YYYY-MM`) written without a day. */
function monthSpellings(iso: string): string[] {
  const [y, m] = iso.split("-").map(Number);
  const [yyyy, yy, mm] = [String(y), String(y).slice(2), pad(m)];
  const [month, mon] = [MONTHS[m - 1], MONTHS[m - 1].slice(0, 3)];
  return [
    `${mon}-${yy}`,
    `${mon} '${yy}`,
    `${month} ${yyyy}`,
    `${mon}. ${yyyy}`,
    `mfgDate${mon}${yy}`,
    `${yyyy} ${month}`,
    `${yyyy}-${mon}`,
    `${yyyy}-${mm}`,
    `${yyyy}/${m}`,
    `${mm}/${yyyy}`,
    `${m}/${yyyy}`,
    `${mm}.${yyyy}`,
    `${yyyy}${mm}`,
  ];
}
