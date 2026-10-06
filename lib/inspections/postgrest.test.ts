import { describe, expect, it } from "vitest";
import {
  arrayLiteral,
  containsFilter,
  escapeRegex,
  inspectionSearchFilter,
  lotVariants,
  quoteFilterValue,
} from "./postgrest";

/**
 * Reads a logic tree back the way PostgREST's parser does (QueryParams.hs:
 * `column.operator.value`, conditions split on top-level commas, a quoted
 * value runs to its closing quote and a backslash takes the next character
 * literally). Anything else, such as an unquoted value, fails the test.
 */
function parseLogicTree(tree: string): { column: string; operator: string; value: string }[] {
  const conditions: { column: string; operator: string; value: string }[] = [];
  let at = 0;
  for (;;) {
    const head = /^([a-z_]+)\.([a-z]+)\./.exec(tree.slice(at));
    if (!head) throw new Error(`expected column.operator. at ${at}: ${tree.slice(at)}`);
    at += head[0].length;
    if (tree[at] !== '"') throw new Error(`unquoted value at ${at}: ${tree.slice(at)}`);
    at += 1;
    let value = "";
    while (tree[at] !== '"') {
      if (at >= tree.length) throw new Error("unterminated quoted value");
      if (tree[at] === "\\") at += 1;
      value += tree[at];
      at += 1;
    }
    at += 1;
    conditions.push({ column: head[1], operator: head[2], value });
    if (at === tree.length) return conditions;
    if (tree[at] !== ",") throw new Error(`expected a comma at ${at}: ${tree.slice(at)}`);
    at += 1;
  }
}

/** Reads a Postgres text[] literal of quoted elements, as Postgres does. */
function parseArrayLiteral(literal: string): string[] {
  expect(literal.startsWith("{") && literal.endsWith("}")).toBe(true);
  const elements: string[] = [];
  let at = 1;
  while (at < literal.length - 1) {
    expect(literal[at]).toBe('"');
    at += 1;
    let element = "";
    while (literal[at] !== '"') {
      if (literal[at] === "\\") at += 1;
      element += literal[at];
      at += 1;
    }
    at += 1;
    elements.push(element);
    if (literal[at] === ",") at += 1;
  }
  return elements;
}

// Search text that would change the query if it were interpolated raw.
const HOSTILE = [
  "a,b",
  "),(",
  "%",
  "*",
  "_",
  ".or(",
  "a.b",
  ":",
  '"',
  "\\",
  '\\"',
  "x),status.eq.approved,(y",
  "ref_no.not.is.null",
  '"),or(id.neq.0',
  "{x}",
  "INS*",
  "***:a",
  "(?i)x",
  "[a-z]+$",
  "^PO|.*",
  "a\\d",
  "Lot é 7",
];

describe("quoteFilterValue", () => {
  it("wraps the value in double quotes", () => {
    expect(quoteFilterValue("a,b")).toBe('"a,b"');
  });

  it("escapes double quotes and backslashes", () => {
    expect(quoteFilterValue('say "hi" \\o/')).toBe('"say \\"hi\\" \\\\o/"');
  });
});

describe("escapeRegex", () => {
  it("escapes every metacharacter", () => {
    expect(escapeRegex("\\^$.|?*+()[]{}")).toBe("\\\\\\^\\$\\.\\|\\?\\*\\+\\(\\)\\[\\]\\{\\}");
  });

  it("leaves letters, digits and other punctuation alone", () => {
    expect(escapeRegex("INS-2026-0001 PO/7 #3 %_,:'\"é")).toBe("INS-2026-0001 PO/7 #3 %_,:'\"é");
  });
});

describe("arrayLiteral", () => {
  it("quotes every element", () => {
    expect(arrayLiteral(["A1", "b,2"])).toBe('{"A1","b,2"}');
  });

  it("escapes quotes and backslashes inside elements", () => {
    expect(arrayLiteral(['a"b\\c'])).toBe('{"a\\"b\\\\c"}');
  });
});

describe("lotVariants", () => {
  it("adds the capitals once", () => {
    expect(lotVariants("l2410a")).toEqual(["l2410a", "L2410A"]);
    expect(lotVariants("L2410A")).toEqual(["L2410A"]);
  });
});

describe("inspectionSearchFilter", () => {
  it("searches the ref and PO by contents and the lot numbers exactly", () => {
    expect(inspectionSearchFilter("INS-2026-0001")).toBe(
      'ref_no.imatch."INS-2026-0001",po_no.imatch."INS-2026-0001",lot_numbers.ov."{\\"INS-2026-0001\\"}"',
    );
    expect(containsFilter("po_no", "4500.1")).toBe('po_no.imatch."4500\\\\.1"');
  });

  it.each(HOSTILE)("keeps %j to exactly three conditions with the text as a literal", (text) => {
    const conditions = parseLogicTree(inspectionSearchFilter(text));

    expect(conditions.map(({ column, operator }) => `${column}.${operator}`)).toEqual([
      "ref_no.imatch",
      "po_no.imatch",
      "lot_numbers.ov",
    ]);

    // The ref and PO patterns match exactly the strings that contain the
    // text, in any case. JavaScript and Postgres regular expressions read
    // these escapes the same way.
    const probes = [
      text,
      `before ${text} after`,
      text.toUpperCase(),
      "INS-2026-0001",
      "PO-4500,(12).*%",
      "",
      "unrelated",
      "a",
    ];
    for (const { value } of conditions.slice(0, 2)) {
      const pattern = new RegExp(value, "i");
      for (const probe of probes) {
        expect(pattern.test(probe), `${JSON.stringify(text)} in ${JSON.stringify(probe)}`).toBe(
          probe.toLowerCase().includes(text.toLowerCase()),
        );
      }
    }

    // Lots: exactly the text, as typed and in capitals.
    expect(parseArrayLiteral(conditions[2].value)).toEqual(lotVariants(text));
  });

  it("never lets an asterisk or percent sign match everything", () => {
    for (const text of ["*", "%", "_", ".*", "%%"]) {
      const [ref] = parseLogicTree(inspectionSearchFilter(text));
      expect(new RegExp(ref.value, "i").test("INS-2026-0001")).toBe(false);
    }
  });
});
