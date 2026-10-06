import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refresh } from "next/cache";
import { MESSAGES } from "@/lib/admin/reference";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { deleteManufacturer, saveManufacturer, type SaveManufacturerResult } from "./actions";

const ID = "3c9a2f1e-8b7d-4c6e-9f5a-1b2c3d4e5f60";
const VERSION = "2026-10-06T10:45:02.066067+00:00";
const IDLE = { status: "idle" } as const;

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the test's responder returns for it.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type Responder = (query: Query) => Result;

let queries: Query[] = [];

function useDatabase(respond: Responder) {
  queries = [];
  const from = (table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "neq", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    for (const method of ["single", "maybeSingle"]) {
      builder[method] = () => {
        query.calls.push([method, []]);
        return Promise.resolve(respond(query));
      };
    }
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  };
  vi.mocked(createClient).mockResolvedValue({ from } as never);
}

const kind = (query: Query) => query.calls[0]?.[0];
const arg = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1];
const writes = () => queries.filter((query) => ["insert", "update", "delete"].includes(kind(query) ?? ""));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const manufacturerForm = (overrides: Record<string, string> = {}) =>
  form({
    id: "",
    version: "",
    name: "  Terang Nusa  Sdn. Bhd. ",
    factory_name: "TG Factory 40",
    address: "Lot 67330\r\nKlang  ",
    country: "Malaysia",
    notes: "",
    ...overrides,
  });

const counts = (templates: number, inspections: number) => ({
  templates: [{ count: templates }],
  inspections: [{ count: inspections }],
});

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  useDatabase(() => ({ data: null, error: null }));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("saveManufacturer", () => {
  it("needs an active admin before it reads anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });

    const result = await saveManufacturer(IDLE, manufacturerForm());

    expect(authorizeAction).toHaveBeenCalledWith("admin");
    expect(result).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(queries).toEqual([]);
  });

  it("shows field errors without touching the database", async () => {
    const result = await saveManufacturer(IDLE, manufacturerForm({ name: " ", country: "x".repeat(61) }));

    expect(result).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: {
        name: "Enter the manufacturer's name.",
        country: "Keep the country to 60 characters or fewer.",
      },
    });
    expect(queries).toEqual([]);
  });

  it("refuses a tampered target", async () => {
    const result = await saveManufacturer(IDLE, manufacturerForm({ id: "not-a-uuid", version: VERSION }));
    expect(result).toEqual({ status: "error", message: MESSAGES.stale });
    expect(queries).toEqual([]);
  });

  it("adds a manufacturer with cleaned values and refreshes the page", async () => {
    useDatabase(() => ({ data: { id: ID }, error: null }));

    const result = await saveManufacturer(IDLE, manufacturerForm());

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("manufacturers");
    expect(arg(queries[0], "insert")?.[0]).toEqual({
      name: "Terang Nusa Sdn. Bhd.",
      factory_name: "TG Factory 40",
      address: "Lot 67330\nKlang",
      country: "Malaysia",
      notes: null,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "success", message: "Terang Nusa Sdn. Bhd., TG Factory 40 added.", id: ID });
  });

  it("puts a duplicate name and factory next to the name", async () => {
    useDatabase(() => ({ data: null, error: { code: "23505", message: "duplicate key" } }));

    const result = (await saveManufacturer(IDLE, manufacturerForm())) as Extract<SaveManufacturerResult, { status: "error" }>;

    expect(result.fieldErrors).toEqual({ name: "There is already a manufacturer with this name and factory." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves changes only to the version the form was opened on", async () => {
    useDatabase(() => ({ data: { id: ID }, error: null }));

    const result = await saveManufacturer(IDLE, manufacturerForm({ id: ID, version: VERSION, factory_name: "" }));

    const update = queries[0];
    expect(arg(update, "update")?.[0]).toMatchObject({ name: "Terang Nusa Sdn. Bhd.", factory_name: null });
    expect(update.calls).toContainEqual(["eq", ["id", ID]]);
    expect(update.calls).toContainEqual(["eq", ["updated_at", VERSION]]);
    expect(result).toEqual({ status: "success", message: "Terang Nusa Sdn. Bhd. saved.", id: ID });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when someone else saved first, and shows their version", async () => {
    useDatabase((query) =>
      kind(query) === "update"
        ? { data: null, error: null }
        : { data: { id: ID, name: "Terang", factory_name: null, ...counts(0, 0) }, error: null },
    );

    const result = await saveManufacturer(IDLE, manufacturerForm({ id: ID, version: VERSION }));

    expect(result).toEqual({
      status: "error",
      message:
        "Someone else changed this manufacturer while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when the manufacturer was deleted meanwhile", async () => {
    useDatabase(() => ({ data: null, error: null }));
    const result = await saveManufacturer(IDLE, manufacturerForm({ id: ID, version: VERSION }));
    expect(result).toEqual({
      status: "error",
      message: "This manufacturer has been deleted, so your changes were not saved.",
    });
  });

  it("turns an unexpected failure into a message", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("Supabase is down"));
    const result = await saveManufacturer(IDLE, manufacturerForm());
    expect(result).toEqual({ status: "error", message: MESSAGES.unexpected });
  });
});

describe("deleteManufacturer", () => {
  it("needs an active admin", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    const result = await deleteManufacturer(IDLE, form({ id: ID }));
    expect(result).toEqual({ status: "error", message: "Your session has ended. Sign in again." });
    expect(queries).toEqual([]);
  });

  it("refuses a tampered id", async () => {
    const result = await deleteManufacturer(IDLE, form({ id: "'; delete from manufacturers; --" }));
    expect(result).toEqual({ status: "error", message: MESSAGES.stale });
    expect(queries).toEqual([]);
  });

  it("deletes a manufacturer nothing uses", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: [{ id: ID }], error: null }
        : { data: { id: ID, name: "Terang Nusa", factory_name: "TG Factory 40", ...counts(0, 0) }, error: null },
    );

    const result = await deleteManufacturer(IDLE, form({ id: ID }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].calls).toContainEqual(["eq", ["id", ID]]);
    expect(result).toEqual({ status: "success", message: "Terang Nusa, TG Factory 40 deleted." });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps a manufacturer that templates or inspections use, and says why", async () => {
    useDatabase(() => ({ data: { id: ID, name: "Terang Nusa", factory_name: null, ...counts(1, 3) }, error: null }));

    const result = await deleteManufacturer(IDLE, form({ id: ID }));

    expect(writes()).toEqual([]);
    expect(result).toEqual({
      status: "error",
      message: "Used by 1 template and 3 inspections, so it cannot be deleted.",
    });
    // The page showed it as unused: refresh so it shows the counts as they are.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains the database's refusal when a template arrived in between", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: null, error: { code: "23503", message: "violates foreign key constraint" } }
        : { data: { id: ID, name: "Terang Nusa", factory_name: null, ...counts(0, 0) }, error: null },
    );

    const result = await deleteManufacturer(IDLE, form({ id: ID }));

    expect(result).toEqual({
      status: "error",
      message: "Templates or inspections use this manufacturer, so it cannot be deleted.",
    });
  });

  it("does not claim a delete that removed nothing", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: [], error: null }
        : { data: { id: ID, name: "Terang Nusa", factory_name: null, ...counts(0, 0) }, error: null },
    );
    const result = await deleteManufacturer(IDLE, form({ id: ID }));
    expect(result).toEqual({
      status: "error",
      message: "Terang Nusa could not be deleted. Reload the page and try again.",
    });
  });

  it("treats a manufacturer that is already gone as deleted", async () => {
    useDatabase(() => ({ data: null, error: null }));
    const result = await deleteManufacturer(IDLE, form({ id: ID }));
    expect(result).toEqual({ status: "success", message: "This manufacturer was already deleted." });
    expect(writes()).toEqual([]);
  });
});
