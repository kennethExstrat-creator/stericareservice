import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { inspectionSearchFilter } from "./postgrest";
import {
  INSPECTION_LIST_SELECT,
  listInspections,
  listSearchFilter,
  loadFilterOptions,
  SEARCH_COLUMNS_MIGRATION,
  toListRow,
} from "./query";
import type { InspectionListFilters } from "./search-params";

type Call = [method: string, ...args: unknown[]];
type Response = { data?: unknown; error?: { code: string; message: string } | null; count?: number | null };

/**
 * A stand-in for the Supabase client: every query records its method calls
 * and resolves to the next canned response, the way the real builder
 * resolves when awaited.
 */
function fakeSupabase(...responses: Response[]) {
  const queries: Call[][] = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [["from", table]];
      const response = responses[queries.length] ?? {};
      queries.push(calls);
      const builder: object = new Proxy(
        {},
        {
          get(_, method) {
            if (method === "then") {
              return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null, count: null, ...response }).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              calls.push([String(method), ...args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient<Database>, queries };
}

const INSPECTOR = { role: "inspector" } as const;
const LEAD = { role: "inspector", isLead: true } as const;
const ADMIN = { role: "admin" } as const;
const CLIENT = "20000000-0000-4000-8000-000000000001";
const MANUFACTURER = "10000000-0000-4000-8000-000000000002";

const ROW = {
  id: "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0001",
  ref_no: "INS-2026-0001",
  inspection_date: "2026-10-06",
  po_no: "PO-0001",
  product_name: "Nitrile examination gloves",
  status: "submitted" as const,
  result: "pass" as const,
  inspector_id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e",
  client: { name: "Client A" },
  manufacturer: { name: "Manufacturer B", factory_name: "Factory 1" },
  inspector: { full_name: "Test Inspector", email: "inspector@test.local" },
};

const ORDER: Call[] = [
  ["order", "inspection_date", { ascending: false }],
  ["order", "created_at", { ascending: false }],
  ["order", "id", { ascending: false }],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listInspections", () => {
  it("asks for the first 50, newest first, with the names joined in and the total counted", async () => {
    const { supabase, queries } = fakeSupabase({ data: [], count: 0 });
    await listInspections(supabase, { page: 1 }, INSPECTOR);

    expect(queries).toEqual([
      [
        ["from", "inspections"],
        ["select", INSPECTION_LIST_SELECT, { count: "exact", head: false }],
        ...ORDER,
        ["range", 0, 49],
      ],
    ]);
    expect(INSPECTION_LIST_SELECT).toContain("client:clients(name)");
    expect(INSPECTION_LIST_SELECT).toContain("manufacturer:manufacturers(name, factory_name)");
    expect(INSPECTION_LIST_SELECT).toContain("inspector:profiles!inspections_inspector_id_fkey(full_name, email)");
    // Whose it is, for every role: the row actions compare it with the signed-in user.
    expect(INSPECTION_LIST_SELECT).toMatch(/(^|, )inspector_id(,|$)/);
  });

  it("never filters by inspector itself: Row Level Security scopes the rows", async () => {
    const { supabase, queries } = fakeSupabase({ data: [], count: 0 });
    await listInspections(supabase, { q: "x", status: "draft", page: 1 }, INSPECTOR);
    const filterCalls = queries[0].filter(([method]) => !["from", "select", "order", "range"].includes(method));
    expect(filterCalls.map(([method, column]) => `${method} ${String(column)}`)).toEqual([
      "eq status",
      `or ${listSearchFilter("x")}`,
    ]);
    expect(JSON.stringify(filterCalls)).not.toContain("inspector_id");
  });

  it("applies every filter and pages by 50", async () => {
    const filters: InspectionListFilters = {
      q: "),(.or(*%",
      status: "reopened",
      client: CLIENT,
      manufacturer: MANUFACTURER,
      page: 3,
    };
    const { supabase, queries } = fakeSupabase({ data: [], count: 0 });
    await listInspections(supabase, filters, ADMIN);

    expect(queries[0]).toEqual([
      ["from", "inspections"],
      ["select", INSPECTION_LIST_SELECT, { count: "exact", head: false }],
      ["eq", "status", "reopened"],
      ["eq", "client_id", CLIENT],
      ["eq", "manufacturer_id", MANUFACTURER],
      ["or", listSearchFilter("),(.or(*%")],
      ...ORDER,
      ["range", 100, 149],
    ]);
  });

  it("returns the rows and the total", async () => {
    const { supabase } = fakeSupabase({ data: [ROW], count: 51 });
    expect(await listInspections(supabase, { page: 1 }, ADMIN)).toEqual({
      kind: "rows",
      total: 51,
      rows: [
        {
          id: ROW.id,
          refNo: "INS-2026-0001",
          inspectionDate: "2026-10-06",
          client: "Client A",
          manufacturer: "Manufacturer B · Factory 1",
          product: "Nitrile examination gloves",
          po: "PO-0001",
          status: "submitted",
          result: "pass",
          inspectorId: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e",
          inspector: "Test Inspector",
        },
      ],
    });
  });

  it("keeps whose inspection it is for every role, for the row actions", () => {
    expect(toListRow(ROW, INSPECTOR).inspectorId).toBe(ROW.inspector_id);
    expect(toListRow(ROW, ADMIN).inspectorId).toBe(ROW.inspector_id);
  });

  it("names the inspector in charge for admins and lead inspectors, not for inspectors", async () => {
    const asInspector = await listInspections(fakeSupabase({ data: [ROW], count: 1 }).supabase, { page: 1 }, INSPECTOR);
    expect(asInspector.kind === "rows" && asInspector.rows[0].inspector).toBeNull();
    expect(toListRow(ROW, ADMIN).inspector).toBe("Test Inspector");
    expect(toListRow(ROW, LEAD).inspector).toBe("Test Inspector");
    expect(toListRow({ ...ROW, inspector: { full_name: null, email: "x@test.local" } }, ADMIN).inspector).toBe(
      "x@test.local",
    );
  });

  it("copes with an inspection that has no client or manufacturer yet", () => {
    expect(toListRow({ ...ROW, client: null, manufacturer: null }, INSPECTOR)).toMatchObject({
      client: null,
      manufacturer: null,
    });
  });

  it("reports an empty list as rows with a total of 0", async () => {
    const { supabase } = fakeSupabase({ data: [], count: 0 });
    expect(await listInspections(supabase, { page: 1 }, INSPECTOR)).toEqual({ kind: "rows", rows: [], total: 0 });
  });

  it("reports a page past the end when PostgREST refuses the range, with the total from a count", async () => {
    const { supabase, queries } = fakeSupabase(
      { error: { code: "PGRST103", message: "Requested range not satisfiable" } },
      { count: 7 },
    );
    expect(await listInspections(supabase, { status: "draft", page: 9 }, INSPECTOR)).toEqual({
      kind: "out-of-range",
      total: 7,
    });
    expect(queries[1]).toEqual([
      ["from", "inspections"],
      ["select", INSPECTION_LIST_SELECT, { count: "exact", head: true }],
      ["eq", "status", "draft"],
    ]);
  });

  it("treats a page past the end of nothing as an empty list", async () => {
    const { supabase } = fakeSupabase({ error: { code: "PGRST103", message: "Requested range not satisfiable" } }, { count: 0 });
    expect(await listInspections(supabase, { page: 2 }, INSPECTOR)).toEqual({ kind: "rows", rows: [], total: 0 });
  });

  it("reports a page past the end when it comes back empty", async () => {
    const { supabase } = fakeSupabase({ data: [], count: 12 });
    expect(await listInspections(supabase, { page: 2 }, INSPECTOR)).toEqual({ kind: "out-of-range", total: 12 });
  });

  it("reports a failure without its details and logs it on the server", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = fakeSupabase({ error: { code: "42P01", message: 'relation "inspections" does not exist' } });
    expect(await listInspections(supabase, { page: 1 }, ADMIN)).toEqual({ kind: "error" });
    expect(log).toHaveBeenCalledWith("Inspections list: list failed", {
      code: "42P01",
      message: 'relation "inspections" does not exist',
    });
  });

  it("reports a failure of the follow-up count", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = fakeSupabase(
      { error: { code: "PGRST103", message: "Requested range not satisfiable" } },
      { error: { code: "57014", message: "canceling statement due to statement timeout" } },
    );
    expect(await listInspections(supabase, { page: 4 }, ADMIN)).toEqual({ kind: "error" });
  });
});

describe("listInspections on a project without the search columns", () => {
  const NO_COLUMN = { code: "42703", message: "column inspections.lot_numbers_upper does not exist" };
  const searchOf = (calls: Call[]) => calls.find(([method]) => method === "or")?.[1];

  it("searches again without them, says which migration is missing, and shows what it finds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase, queries } = fakeSupabase({ error: NO_COLUMN }, { data: [ROW], count: 1 });
    const result = await listInspections(supabase, { q: "5420", page: 1 }, ADMIN);

    expect(result).toMatchObject({ kind: "rows", total: 1, rows: [{ refNo: "INS-2026-0001" }] });
    expect(queries.map(searchOf)).toEqual([listSearchFilter("5420"), inspectionSearchFilter("5420")]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(SEARCH_COLUMNS_MIGRATION), NO_COLUMN);
  });

  it("counts a page past the end with the same search", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase, queries } = fakeSupabase(
      { error: NO_COLUMN },
      { error: { code: "PGRST103", message: "Requested range not satisfiable" } },
      { count: 3 },
    );
    expect(await listInspections(supabase, { q: "LT081315", page: 5 }, ADMIN)).toEqual({ kind: "out-of-range", total: 3 });
    expect(queries.map(searchOf)).toEqual([
      listSearchFilter("LT081315"),
      inspectionSearchFilter("LT081315"),
      inspectionSearchFilter("LT081315"),
    ]);
  });

  it("counts a page past the end with the search columns when the project has them", async () => {
    const { supabase, queries } = fakeSupabase(
      { error: { code: "PGRST103", message: "Requested range not satisfiable" } },
      { count: 2 },
    );
    await listInspections(supabase, { q: "LT081315", page: 5 }, ADMIN);
    expect(queries.map(searchOf)).toEqual([listSearchFilter("LT081315"), listSearchFilter("LT081315")]);
  });

  it("reports any other missing column as a failure, without searching again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Without search text the search columns are not asked for.
    const plain = fakeSupabase({ error: NO_COLUMN });
    expect(await listInspections(plain.supabase, { status: "draft", page: 1 }, ADMIN)).toEqual({ kind: "error" });
    expect(plain.queries).toHaveLength(1);
    // The search without them fails as well.
    const both = fakeSupabase({ error: NO_COLUMN }, { error: NO_COLUMN });
    expect(await listInspections(both.supabase, { q: "x", page: 1 }, ADMIN)).toEqual({ kind: "error" });
    expect(both.queries).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/**
 * Reads a logic tree back the way PostgREST's parser does (as in
 * postgrest.test.ts): `column.operator."value"`, split on top-level commas,
 * a backslash taking the next character literally.
 */
function conditionsOf(tree: string): { column: string; operator: string; value: string }[] {
  const conditions: { column: string; operator: string; value: string }[] = [];
  let at = 0;
  while (at < tree.length) {
    const head = /^([a-z_]+)\.([a-z]+)\."/.exec(tree.slice(at));
    if (!head) throw new Error(`expected column.operator."value" at ${at}: ${tree.slice(at)}`);
    at += head[0].length;
    let value = "";
    while (tree[at] !== '"') {
      if (at >= tree.length) throw new Error("unterminated quoted value");
      if (tree[at] === "\\") at += 1;
      value += tree[at];
      at += 1;
    }
    conditions.push({ column: head[1], operator: head[2], value });
    at += 1;
    if (at < tree.length && tree[at++] !== ",") throw new Error(`expected a comma at ${at - 1}`);
  }
  return conditions;
}

describe("listSearchFilter", () => {
  it("adds a lot in any case to the ref, PO and lot search", () => {
    const conditions = conditionsOf(listSearchFilter("Lt081315"));
    expect(conditions.map(({ column, operator }) => `${column}.${operator}`)).toEqual([
      "ref_no.imatch",
      "po_no.imatch",
      "lot_numbers.ov",
      "lot_numbers_upper.ov",
    ]);
    // Every lot in capitals, compared with the text in capitals: the iPad's 'Lt081315' and the printed LT081315 meet.
    expect(conditions[3].value).toBe('{"LT081315"}');
    expect(listSearchFilter("Lt081315")).toBe(`${inspectionSearchFilter("Lt081315")},lot_numbers_upper.ov."{\\"LT081315\\"}"`);
  });

  it("adds a carton number when the text is a whole number, leading zeros ignored", () => {
    for (const [text, carton] of [
      ["5420", "{5420}"],
      ["005420", "{5420}"],
      ["1", "{1}"],
      ["999999999", "{999999999}"],
    ]) {
      const conditions = conditionsOf(listSearchFilter(text));
      expect(conditions.at(-1), text).toEqual({ column: "carton_numbers", operator: "cs", value: carton });
      expect(conditions, text).toHaveLength(5);
    }
  });

  it("asks for no carton when the text is not a whole number from 1, or too long for one", () => {
    for (const text of ["0", "000", "1234567890", "12.5", "-3", "1e3", "5420A", "54 20", "５４２０", "0x1F"]) {
      expect(conditionsOf(listSearchFilter(text)).map(({ column }) => column), text).not.toContain("carton_numbers");
    }
  });

  it("keeps hostile text literal in every condition", () => {
    for (const text of ["a,b", "),(", '"),or(id.neq.0', "{E2E-LOT-C3}", 'E2E-LOT-C3","x', "\\", "x),status.eq.reopened,(y"]) {
      const conditions = conditionsOf(listSearchFilter(text));
      expect(conditions.map(({ column }) => column), text).toEqual([
        "ref_no",
        "po_no",
        "lot_numbers",
        "lot_numbers_upper",
      ]);
      expect(conditions[3].value, text).toBe(`{"${text.toUpperCase().replace(/["\\]/g, "\\$&")}"}`);
    }
  });

  it("is the ref, PO and lot search alone without the search columns", () => {
    for (const text of ["5420", "Lt081315", "),("]) expect(listSearchFilter(text, false)).toBe(inspectionSearchFilter(text));
  });
});

describe("loadFilterOptions", () => {
  it("lists clients and manufacturers by name", async () => {
    const { supabase, queries } = fakeSupabase(
      { data: [{ id: CLIENT, name: "Client A" }] },
      {
        data: [
          { id: MANUFACTURER, name: "Manufacturer B", factory_name: "Factory 1" },
          { id: "10000000-0000-4000-8000-000000000001", name: "Manufacturer C", factory_name: null },
        ],
      },
    );
    expect(await loadFilterOptions(supabase)).toEqual({
      ok: true,
      clients: [{ id: CLIENT, label: "Client A" }],
      manufacturers: [
        { id: MANUFACTURER, label: "Manufacturer B · Factory 1" },
        { id: "10000000-0000-4000-8000-000000000001", label: "Manufacturer C" },
      ],
    });
    expect(queries).toEqual([
      [
        ["from", "clients"],
        ["select", "id, name"],
        ["order", "name"],
      ],
      [
        ["from", "manufacturers"],
        ["select", "id, name, factory_name"],
        ["order", "name"],
        ["order", "factory_name", { nullsFirst: true }],
      ],
    ]);
  });

  it("fails as a whole when either list fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = { code: "42501", message: "permission denied" };
    expect(await loadFilterOptions(fakeSupabase({ error: failure }, { data: [] }).supabase)).toEqual({ ok: false });
    expect(await loadFilterOptions(fakeSupabase({ data: [] }, { error: failure }).supabase)).toEqual({ ok: false });
  });
});
