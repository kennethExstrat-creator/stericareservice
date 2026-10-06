// Checks the expected results: consistent with themselves and the fixtures,
// and, where the git-ignored docs/examples/expected-results.md is present,
// row for row the same as that file. Point STERICARE_EXAMPLES_DIR at another
// copy of docs/examples to run the comparison from a worktree.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REPORT_MODULE_KEYS } from "@/lib/schemas";
import { SAFEDON_EG_EXPECTED, STD_EG_EXPECTED, type ExpectedAqlCheck } from "./expected";
import { cartonList, SECTION_MODULE } from "./helpers";
import { SAFEDON_EG_EXAMPLE } from "./safedon-eg";
import { STD_EG_EXAMPLE } from "./std-eg";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXAMPLES_DIR = process.env.STERICARE_EXAMPLES_DIR ?? join(ROOT, "docs", "examples");
const EXPECTED_RESULTS = join(EXAMPLES_DIR, "expected-results.md");

/** ISO 2859-1 sample size to code letter (BUILD_SPEC 7). */
const CODE_LETTER: Readonly<Record<number, string>> = {
  2: "A",
  3: "B",
  5: "C",
  8: "D",
  13: "E",
  20: "F",
  32: "G",
  50: "H",
  80: "J",
  125: "K",
  200: "L",
  315: "M",
  500: "N",
  800: "P",
  1250: "Q",
  2000: "R",
};

type Entry = { readonly check: string; readonly originalReport: string; readonly [key: string]: unknown };

/** Every object with a `check` label, wherever it sits in the expected data. */
function entries(value: unknown): Entry[] {
  if (Array.isArray(value)) return value.flatMap(entries);
  if (value === null || typeof value !== "object") return [];
  const own = typeof (value as Entry).check === "string" ? [value as Entry] : [];
  return [...own, ...Object.values(value).flatMap(entries)];
}

/** Every number inside a value. */
function numbersIn(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(numbersIn);
}

/** Entries with an accept / reject limit: watertight and visual checks. */
function aqlChecks(value: unknown): ExpectedAqlCheck[] {
  return entries(value).filter((entry): entry is Entry & ExpectedAqlCheck => typeof entry.accept === "number");
}

describe("expected results", () => {
  it("cover every report module key in the fixtures' section map", () => {
    expect(new Set(Object.values(SECTION_MODULE))).toEqual(new Set(REPORT_MODULE_KEYS));
  });

  it.each([SAFEDON_EG_EXPECTED, STD_EG_EXPECTED])("$template: every limit fits its sample size", (expected) => {
    for (const check of aqlChecks(expected)) {
      expect(check.reject, check.check).toBe(check.accept + 1);
      expect(CODE_LETTER[check.n], check.check).toBe(check.codeLetter);
      if (check.arrow) expect(CODE_LETTER[check.arrow.n], check.check).toBe(check.arrow.codeLetter);
      if (check.aql === 0) expect({ accept: check.accept, reject: check.reject }).toEqual({ accept: 0, reject: 1 });
      expect(check.found < check.reject ? "pass" : "fail", check.check).toBe(check.status);
    }
  });

  it("SAFEDON_EG: one sampling warning per ordered size, only when level I is set, and no errors", () => {
    expect(SAFEDON_EG_EXPECTED.errors).toEqual([]);
    expect(SAFEDON_EG_EXPECTED.warnings.map((warning) => warning.size)).toEqual(SAFEDON_EG_EXAMPLE.sizesOrdered);
    for (const warning of SAFEDON_EG_EXPECTED.warnings) {
      expect(warning).toMatchObject({ level: "warning", module: "sampling_plan", code: "sample_below_plan" });
      expect(warning.when).toBeTruthy();
    }
  });

  it("STD_EG: the two carton errors point at the fixture's duplicate and stray box", () => {
    const grid = STD_EG_EXAMPLE.cartons.M!;
    const boxes = STD_EG_EXAMPLE.dispensingPacking.perSize.M!.boxes.map((box) => box.box);
    const [duplicate, stray] = STD_EG_EXPECTED.errors;
    expect(duplicate).toMatchObject({ module: "carton_sampling", size: "M", code: "carton_duplicate" });
    expect(duplicate.message).toContain(String(STD_EG_EXPECTED.cartonList.duplicate.carton));
    expect(stray).toMatchObject({ module: "dispensing_packing", size: "M", code: "box_not_in_carton_list" });
    expect(stray.message).toContain(String(STD_EG_EXPECTED.dispensingBox.box));
    expect(boxes[STD_EG_EXPECTED.dispensingBox.item - 1]).toBe(STD_EG_EXPECTED.dispensingBox.box);
    expect(cartonList(grid)).not.toContain(STD_EG_EXPECTED.dispensingBox.box);
    expect(STD_EG_EXPECTED.warnings.map((warning) => warning.code)).toEqual(["weight_deviation"]);
  });

  it("STD_EG: the duplicate fails carton_sampling; the stray box blocks submit but leaves dispensing_packing passing", () => {
    // BUILD_SPEC 6.1: carton_sampling fails on validation errors, while
    // dispensing_packing is judged on its averages and stickiness codes.
    // 6.2 rule 7 makes the stray box a validation error, not a result.
    expect(STD_EG_EXPECTED.cartonList.status).toBe("fail");
    expect(STD_EG_EXPECTED.dispensingBox.validation).toBe("error");
    expect(STD_EG_EXPECTED.dispensing.M!.status).toBe("pass");
    expect(STD_EG_EXPECTED.errors.map(({ level, module, size }) => [level, module, size])).toEqual([
      ["error", "carton_sampling", "M"],
      ["error", "dispensing_packing", "M"],
    ]);
  });

  it("STD_EG: the corrections clear both errors", () => {
    const { duplicateCarton, strayBox } = STD_EG_EXPECTED.corrections;
    const rows = STD_EG_EXAMPLE.cartons.M!.rows.map((row) => [...row]);
    expect(rows[duplicateCarton.cell.row - 1][duplicateCarton.cell.column - 1]).toBe(duplicateCarton.from);
    rows[duplicateCarton.cell.row - 1][duplicateCarton.cell.column - 1] = duplicateCarton.to;
    const list = rows.flat();
    expect(new Set(list).size).toBe(STD_EG_EXAMPLE.sampling.M!.cases);
    expect(list.every((carton) => carton >= 1 && carton <= STD_EG_EXAMPLE.order.lines.M!.qtyCases)).toBe(true);

    const boxes = STD_EG_EXAMPLE.dispensingPacking.perSize.M!.boxes.map((box) => box.box);
    expect(boxes[strayBox.item - 1]).toBe(strayBox.from);
    boxes[strayBox.item - 1] = strayBox.to;
    expect(new Set(boxes).size).toBe(boxes.length);
    expect(boxes.every((box) => list.includes(box))).toBe(true);
  });

  it("STD_EG: the product code is the one in the report header", () => {
    expect(STD_EG_EXPECTED.productCode.code).toBe(STD_EG_EXAMPLE.header.productCode);
    expect(STD_EG_EXPECTED.productCode.originalReport).toContain(STD_EG_EXAMPLE.header.productCodeElsewhere!.code);
  });
});

/* ------------------------------------------------------------------ *
 * The comparison with docs/examples/expected-results.md
 * ------------------------------------------------------------------ */

type MarkdownRow = { readonly check: string; readonly expected: string; readonly original: string };

/** The table rows of sections "A." (SAFEDON_EG) and "B." (STD_EG). */
function readRows(markdown: string): Record<"A" | "B", MarkdownRow[]> {
  const rows: Record<"A" | "B", MarkdownRow[]> = { A: [], B: [] };
  let section: "A" | "B" | null = null;
  for (const line of markdown.split("\n")) {
    const heading = /^## ([AB])\./.exec(line);
    if (heading) section = heading[1] as "A" | "B";
    if (!section || !line.startsWith("|")) continue;
    const [check, expected, original] = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (check === "Check" || /^-+$/.test(check)) continue;
    rows[section].push({ check, expected, original });
  }
  return rows;
}

/** Carton and box numbers are placeholders in the fixtures: compare without digits. */
const withoutDigits = (text: string) => text.replace(/\d+/g, "#");

/** Rows whose original-report text names a box or product code that the fixtures replace. */
const ANONYMISED = new Set(["Dispensing XS", "Dispensing box #", "Product code"]);

/** Numbers in an "Expected" cell ("1,530" is one), except carton and box numbers. */
function expectedNumbers(row: MarkdownRow): number[] {
  if (withoutDigits(row.check) === "Carton list") return [];
  const text = row.expected.replace(/box \d+/g, "box").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

/** Figures an "Expected" cell states as rounded or bounds that the typed data holds otherwise. */
const STATED_ONLY: Readonly<Record<string, readonly number[]>> = {
  "Weight M": [17],
  "Sampling notice": [500_000],
};

describe.skipIf(!existsSync(EXPECTED_RESULTS))("expected results against docs/examples/expected-results.md", () => {
  const markdown = existsSync(EXPECTED_RESULTS) ? readFileSync(EXPECTED_RESULTS, "utf8") : "";
  const sections = [
    ["A", SAFEDON_EG_EXPECTED],
    ["B", STD_EG_EXPECTED],
  ] as const;

  it.each(sections)("section %s has the same rows as the typed data", (section, expected) => {
    const rows = readRows(markdown)[section];
    expect(rows.length).toBeGreaterThan(10);
    const fromMarkdown = new Set(rows.map((row) => withoutDigits(row.check)));
    const typed = new Set(entries(expected).map((entry) => withoutDigits(entry.check)));
    expect(typed).toEqual(fromMarkdown);
  });

  it.each(sections)("section %s: the original-report column is copied word for word", (section, expected) => {
    for (const row of readRows(markdown)[section]) {
      const label = withoutDigits(row.check);
      for (const entry of entries(expected).filter((typed) => withoutDigits(typed.check) === label)) {
        if (ANONYMISED.has(label)) {
          if (label !== "Product code") expect(withoutDigits(entry.originalReport), label).toBe(withoutDigits(row.original));
        } else {
          expect(entry.originalReport, label).toBe(row.original);
        }
      }
    }
  });

  it.each(sections)("section %s: every figure in the expected column is in the typed data", (section, expected) => {
    for (const row of readRows(markdown)[section]) {
      const label = withoutDigits(row.check);
      const typed = new Set(
        entries(expected)
          .filter((entry) => withoutDigits(entry.check) === label)
          .flatMap((entry) => numbersIn(entry)),
      );
      const missing = expectedNumbers(row).filter(
        (figure) => !typed.has(figure) && !(STATED_ONLY[label] ?? []).includes(figure),
      );
      expect(missing, label).toEqual([]);
    }
  });

  it("section A: the original size S averages are the typed ones", () => {
    const row = readRows(markdown).A.find((candidate) => candidate.check === "Dimension averages S")!;
    const original = SAFEDON_EG_EXPECTED.dimensions.S!.originalAverage!;
    const figures = [...row.original.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    expect(figures.slice(0, 4)).toEqual([original.length, original.width, original.finger, original.palm]);
  });
});
