import { describe, expect, it } from "vitest";
import {
  buildInspectionsHref,
  dropUnknownReferences,
  hasActiveFilters,
  MAX_SEARCH_LENGTH,
  normaliseSearchText,
  pageCount,
  pageRange,
  parseInspectionSearchParams,
  type InspectionListFilters,
  type RawSearchParams,
} from "./search-params";

const CLIENT = "20000000-0000-4000-8000-000000000001";
const MANUFACTURER = "10000000-0000-4000-8000-000000000002";

/** Parses an href the way Next.js hands search params to a page. */
function paramsOf(href: string): RawSearchParams {
  const raw: RawSearchParams = {};
  const url = new URL(href, "http://localhost");
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  return raw;
}

describe("parseInspectionSearchParams", () => {
  it("defaults to the first page with no filters", () => {
    expect(parseInspectionSearchParams({})).toEqual({ page: 1 });
  });

  it("reads every filter", () => {
    expect(
      parseInspectionSearchParams({
        q: "INS-2026-0001",
        status: "submitted",
        client: CLIENT,
        manufacturer: MANUFACTURER,
        page: "3",
      }),
    ).toEqual({ q: "INS-2026-0001", status: "submitted", client: CLIENT, manufacturer: MANUFACTURER, page: 3 });
  });

  it.each([
    ["an unknown status", { status: "deleted" }],
    ["a status in the wrong case", { status: "Draft" }],
    ["a client id that is not an id", { client: "polyco" }],
    ["a manufacturer id with SQL in it", { manufacturer: "1' or '1'='1" }],
    ["page 0", { page: "0" }],
    ["a negative page", { page: "-2" }],
    ["a fractional page", { page: "1.5" }],
    ["a page in exponent form", { page: "1e3" }],
    ["a page that is not a number", { page: "two" }],
    ["an absurd page", { page: "99999999" }],
    ["blank search text", { q: "   " }],
    ["search text over the limit", { q: "x".repeat(MAX_SEARCH_LENGTH + 1) }],
    ["empty values from a submitted form", { q: "", status: "", client: "", manufacturer: "", page: "" }],
  ] as const)("drops %s", (_, raw) => {
    expect(parseInspectionSearchParams(raw)).toEqual({ page: 1 });
  });

  it("keeps the valid filters when another one is invalid", () => {
    expect(parseInspectionSearchParams({ status: "bogus", client: CLIENT, page: "x", q: "PO-1" })).toEqual({
      q: "PO-1",
      client: CLIENT,
      page: 1,
    });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseInspectionSearchParams({ status: ["draft", "approved"], page: ["2", "5"] })).toEqual({
      status: "draft",
      page: 2,
    });
  });

  it("ignores parameters it does not know", () => {
    expect(parseInspectionSearchParams({ sort: "asc", inspector: CLIENT })).toEqual({ page: 1 });
  });

  it("compares ids in lower case", () => {
    expect(parseInspectionSearchParams({ client: CLIENT.toUpperCase() }).client).toBe(CLIENT);
  });

  it("tidies search text and keeps punctuation as typed", () => {
    expect(parseInspectionSearchParams({ q: "  PO\t 4500,(12)\u0000*%  " }).q).toBe("PO 4500,(12) *%");
  });

  it("keeps search text at the limit", () => {
    const text = "x".repeat(MAX_SEARCH_LENGTH);
    expect(parseInspectionSearchParams({ q: text }).q).toBe(text);
  });
});

describe("normaliseSearchText", () => {
  it("replaces control characters, which Postgres rejects in text", () => {
    expect(normaliseSearchText("a\u0000b\u001fc\u007fd\ne")).toBe("a b c d e");
  });

  it("collapses unicode spaces", () => {
    expect(normaliseSearchText("lot   A1")).toBe("lot A1");
  });
});

describe("buildInspectionsHref", () => {
  it("is the bare path for the unfiltered first page", () => {
    expect(buildInspectionsHref({})).toBe("/inspections");
    expect(buildInspectionsHref({ page: 1 })).toBe("/inspections");
  });

  it("leaves out empty filters and page 1", () => {
    expect(buildInspectionsHref({ q: "", status: "draft", page: 1 })).toBe("/inspections?status=draft");
  });

  it("encodes search text so it survives the round trip", () => {
    const href = buildInspectionsHref({ q: "a,b & c=d?#%", page: 2 });
    expect(href).toBe("/inspections?q=a%2Cb+%26+c%3Dd%3F%23%25&page=2");
    expect(parseInspectionSearchParams(paramsOf(href))).toEqual({ q: "a,b & c=d?#%", page: 2 });
  });

  it("tidies typed search text", () => {
    expect(buildInspectionsHref({ q: "  INS-2026  " })).toBe("/inspections?q=INS-2026");
    expect(buildInspectionsHref({ q: "   " })).toBe("/inspections");
  });

  it.each<InspectionListFilters>([
    { page: 1 },
    { q: "INS-2026-0001", page: 1 },
    { status: "reopened", client: CLIENT, manufacturer: MANUFACTURER, page: 4 },
    { q: "),(.or(*%", status: "approved", page: 2 },
  ])("parses back to the same filters: %j", (filters) => {
    expect(parseInspectionSearchParams(paramsOf(buildInspectionsHref(filters)))).toEqual(filters);
  });
});

describe("hasActiveFilters", () => {
  it("is false for paging alone", () => {
    expect(hasActiveFilters({ page: 3 })).toBe(false);
  });

  it.each<Partial<InspectionListFilters>>([{ q: "x" }, { status: "draft" }, { client: CLIENT }, { manufacturer: MANUFACTURER }])(
    "is true for %j",
    (filters) => {
      expect(hasActiveFilters(filters)).toBe(true);
    },
  );
});

describe("dropUnknownReferences", () => {
  const known = { clients: [{ id: CLIENT }], manufacturers: [{ id: MANUFACTURER }] };

  it("returns the same filters when every id is known", () => {
    const filters: InspectionListFilters = { client: CLIENT, manufacturer: MANUFACTURER, page: 2 };
    expect(dropUnknownReferences(filters, known)).toBe(filters);
  });

  it("drops an id nobody can see and starts again at page 1", () => {
    const unknown = "30000000-0000-4000-8000-000000000009";
    expect(dropUnknownReferences({ client: unknown, manufacturer: MANUFACTURER, status: "draft", page: 3 }, known)).toEqual({
      manufacturer: MANUFACTURER,
      status: "draft",
      page: 1,
    });
    expect(dropUnknownReferences({ manufacturer: unknown, page: 1 }, known)).toEqual({ page: 1 });
  });
});

describe("paging", () => {
  it("counts pages of 50", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(123)).toBe(3);
  });

  it("numbers the rows on a page", () => {
    expect(pageRange(1, 0)).toEqual({ from: 0, to: 0 });
    expect(pageRange(1, 3)).toEqual({ from: 1, to: 3 });
    expect(pageRange(2, 123)).toEqual({ from: 51, to: 100 });
    expect(pageRange(3, 123)).toEqual({ from: 101, to: 123 });
  });
});
