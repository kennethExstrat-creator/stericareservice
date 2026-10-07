import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { inspectionSearchFilter } from "./postgrest";
import { INSPECTION_LIST_SELECT, listInspections, loadFilterOptions, toListRow } from "./query";
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
    await listInspections(supabase, { page: 1 }, "inspector");

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
    await listInspections(supabase, { q: "x", status: "draft", page: 1 }, "inspector");
    const filterCalls = queries[0].filter(([method]) => !["from", "select", "order", "range"].includes(method));
    expect(filterCalls.map(([method, column]) => `${method} ${String(column)}`)).toEqual([
      "eq status",
      `or ${inspectionSearchFilter("x")}`,
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
    await listInspections(supabase, filters, "admin");

    expect(queries[0]).toEqual([
      ["from", "inspections"],
      ["select", INSPECTION_LIST_SELECT, { count: "exact", head: false }],
      ["eq", "status", "reopened"],
      ["eq", "client_id", CLIENT],
      ["eq", "manufacturer_id", MANUFACTURER],
      ["or", inspectionSearchFilter("),(.or(*%")],
      ...ORDER,
      ["range", 100, 149],
    ]);
  });

  it("returns the rows and the total", async () => {
    const { supabase } = fakeSupabase({ data: [ROW], count: 51 });
    expect(await listInspections(supabase, { page: 1 }, "admin")).toEqual({
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
    expect(toListRow(ROW, "inspector").inspectorId).toBe(ROW.inspector_id);
    expect(toListRow(ROW, "admin").inspectorId).toBe(ROW.inspector_id);
  });

  it("names the inspector for admins only", async () => {
    const asInspector = await listInspections(fakeSupabase({ data: [ROW], count: 1 }).supabase, { page: 1 }, "inspector");
    expect(asInspector.kind === "rows" && asInspector.rows[0].inspector).toBeNull();
    expect(toListRow(ROW, "admin").inspector).toBe("Test Inspector");
    expect(toListRow({ ...ROW, inspector: { full_name: null, email: "x@test.local" } }, "admin").inspector).toBe(
      "x@test.local",
    );
  });

  it("copes with an inspection that has no client or manufacturer yet", () => {
    expect(toListRow({ ...ROW, client: null, manufacturer: null }, "inspector")).toMatchObject({
      client: null,
      manufacturer: null,
    });
  });

  it("reports an empty list as rows with a total of 0", async () => {
    const { supabase } = fakeSupabase({ data: [], count: 0 });
    expect(await listInspections(supabase, { page: 1 }, "inspector")).toEqual({ kind: "rows", rows: [], total: 0 });
  });

  it("reports a page past the end when PostgREST refuses the range, with the total from a count", async () => {
    const { supabase, queries } = fakeSupabase(
      { error: { code: "PGRST103", message: "Requested range not satisfiable" } },
      { count: 7 },
    );
    expect(await listInspections(supabase, { status: "draft", page: 9 }, "inspector")).toEqual({
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
    expect(await listInspections(supabase, { page: 2 }, "inspector")).toEqual({ kind: "rows", rows: [], total: 0 });
  });

  it("reports a page past the end when it comes back empty", async () => {
    const { supabase } = fakeSupabase({ data: [], count: 12 });
    expect(await listInspections(supabase, { page: 2 }, "inspector")).toEqual({ kind: "out-of-range", total: 12 });
  });

  it("reports a failure without its details and logs it on the server", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = fakeSupabase({ error: { code: "42P01", message: 'relation "inspections" does not exist' } });
    expect(await listInspections(supabase, { page: 1 }, "admin")).toEqual({ kind: "error" });
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
    expect(await listInspections(supabase, { page: 4 }, "admin")).toEqual({ kind: "error" });
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
