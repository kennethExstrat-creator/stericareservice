import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refresh } from "next/cache";
import { NO_PERMISSION } from "@/lib/admin/manufacturers";
import { MESSAGES } from "@/lib/admin/reference";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  deleteBrand,
  deleteCompany,
  deleteFactory,
  saveBrand,
  saveCompany,
  saveFactory,
  type SaveFactoryResult,
} from "./actions";

const BRAND = "4168842d-a1f3-4f09-b6ee-0a6f6c787280";
const COMPANY = "bc4886cc-1703-4eb9-998f-34d5a4d8f046";
const FACTORY = "10000000-0000-4000-8000-000000000002";
const VERSION = "2026-10-27T07:41:32.592604+00:00";
const NEWER = "2026-10-27T08:02:13.512904+00:00";
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
    for (const method of ["select", "insert", "update", "delete", "eq"]) {
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
/** A read of the row, as the actions make before deleting or after a refused update. */
const isRead = (query: Query) => kind(query) === "select";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const brandForm = (overrides: Record<string, string> = {}) => form({ id: "", version: "", name: "  Top  Glove ", ...overrides });
const companyForm = (overrides: Record<string, string> = {}) =>
  form({ id: "", version: "", brand_id: BRAND, name: " Terang Nusa  Sdn. Bhd. ", ...overrides });
const factoryForm = (overrides: Record<string, string> = {}) =>
  form({
    id: "",
    version: "",
    company_id: COMPANY,
    factory_name: " TG-F40 ",
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
  } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  useDatabase(() => ({ data: null, error: null }));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Every action
 * ------------------------------------------------------------------ */

describe("every action", () => {
  const actions = [
    ["saveBrand", () => saveBrand(IDLE, brandForm())],
    ["deleteBrand", () => deleteBrand(IDLE, form({ id: BRAND }))],
    ["saveCompany", () => saveCompany(IDLE, companyForm())],
    ["deleteCompany", () => deleteCompany(IDLE, form({ id: COMPANY }))],
    ["saveFactory", () => saveFactory(IDLE, factoryForm())],
    ["deleteFactory", () => deleteFactory(IDLE, form({ id: FACTORY }))],
  ] as const;

  it.each(actions)("%s needs the role's Manufacturers switch before it reads anything", async (_name, run) => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    await expect(run()).resolves.toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "manufacturers" });
    expect(queries).toEqual([]);
  });

  it.each(actions)("%s turns an unexpected failure into a message", async (_name, run) => {
    vi.mocked(createClient).mockRejectedValue(new Error("Supabase is down"));
    await expect(run()).resolves.toEqual({ status: "error", message: MESSAGES.unexpected });
  });

  it.each([
    ["saveBrand", () => saveBrand(IDLE, brandForm({ id: "not-a-uuid", version: VERSION }))],
    ["saveCompany", () => saveCompany(IDLE, companyForm({ id: COMPANY, version: "" }))],
    ["saveFactory", () => saveFactory(IDLE, factoryForm({ id: "", version: VERSION }))],
    ["deleteBrand", () => deleteBrand(IDLE, form({ id: "'; delete from manufacturer_brands; --" }))],
    ["deleteCompany", () => deleteCompany(IDLE, form({}))],
    ["deleteFactory", () => deleteFactory(IDLE, form({ id: "x" }))],
  ] as const)("%s refuses a tampered target without touching the database", async (_name, run) => {
    await expect(run()).resolves.toEqual({ status: "error", message: MESSAGES.stale });
    expect(queries).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Brands
 * ------------------------------------------------------------------ */

describe("saveBrand", () => {
  it("shows field errors without touching the database", async () => {
    const result = await saveBrand(IDLE, brandForm({ name: " " }));
    expect(result).toEqual({ status: "error", message: MESSAGES.checkFields, fieldErrors: { name: "Enter the brand's name." } });
    expect(queries).toEqual([]);
  });

  it("adds a brand with its cleaned name and refreshes the page", async () => {
    useDatabase(() => ({ data: { id: BRAND }, error: null }));

    const result = await saveBrand(IDLE, brandForm());

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("manufacturer_brands");
    expect(arg(queries[0], "insert")?.[0]).toEqual({ name: "Top Glove" });
    expect(result).toEqual({ status: "success", message: "Top Glove added.", id: BRAND });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("puts a duplicate name under the name", async () => {
    useDatabase(() => ({ data: null, error: { code: "23505", message: "duplicate key" } }));
    const result = await saveBrand(IDLE, brandForm());
    expect(result).toEqual({
      status: "error",
      message: "There is already a brand with this name.",
      fieldErrors: { name: "There is already a brand with this name." },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves changes only to the version the form was opened on", async () => {
    useDatabase(() => ({ data: { id: BRAND }, error: null }));

    const result = await saveBrand(IDLE, brandForm({ id: BRAND, version: VERSION, name: "Top Glove Corporation" }));

    expect(arg(queries[0], "update")?.[0]).toEqual({ name: "Top Glove Corporation" });
    expect(queries[0].calls).toContainEqual(["eq", ["id", BRAND]]);
    expect(queries[0].calls).toContainEqual(["eq", ["updated_at", VERSION]]);
    expect(result).toEqual({ status: "success", message: "Top Glove Corporation saved.", id: BRAND });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when someone else saved first, and answers with their version for a second save to replace", async () => {
    useDatabase((query) =>
      kind(query) === "update" ? { data: null, error: null } : { data: { name: "Top Glove Bhd", updated_at: NEWER }, error: null },
    );

    const result = await saveBrand(IDLE, brandForm({ id: BRAND, version: VERSION }));

    expect(result).toEqual({
      status: "error",
      message:
        "Someone else changed this brand while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
      latest: { version: NEWER, values: { name: "Top Glove Bhd" } },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when the brand was deleted meanwhile", async () => {
    const result = await saveBrand(IDLE, brandForm({ id: BRAND, version: VERSION }));
    expect(result).toEqual({ status: "error", message: "This brand has been deleted, so your changes were not saved." });
  });

  it("calls an update that matched an unchanged row a refusal, not someone else's change", async () => {
    useDatabase((query) =>
      kind(query) === "update" ? { data: null, error: null } : { data: { name: "Top Glove", updated_at: VERSION }, error: null },
    );
    const result = await saveBrand(IDLE, brandForm({ id: BRAND, version: VERSION }));
    expect(result).toEqual({ status: "error", message: NO_PERMISSION.change });
  });
});

describe("deleteBrand", () => {
  it("deletes a brand with no companies", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: [{ id: BRAND }], error: null }
        : { data: { id: BRAND, name: "Top Glove", manufacturer_companies: [{ count: 0 }] }, error: null },
    );

    const result = await deleteBrand(IDLE, form({ id: BRAND }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].table).toBe("manufacturer_brands");
    expect(writes()[0].calls).toContainEqual(["eq", ["id", BRAND]]);
    expect(result).toEqual({ status: "success", message: "Top Glove deleted." });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps a brand that has companies, and says how many", async () => {
    useDatabase(() => ({ data: { id: BRAND, name: "Top Glove", manufacturer_companies: [{ count: 2 }] }, error: null }));

    const result = await deleteBrand(IDLE, form({ id: BRAND }));

    expect(writes()).toEqual([]);
    expect(result).toEqual({ status: "error", message: "Has 2 companies, so it cannot be deleted." });
    // The page showed it with none: refresh so it shows them.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains the database's refusal when a company arrived in between", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: null, error: { code: "23001", message: "violates foreign key constraint" } }
        : { data: { id: BRAND, name: "Top Glove", manufacturer_companies: [{ count: 0 }] }, error: null },
    );
    const result = await deleteBrand(IDLE, form({ id: BRAND }));
    expect(result).toEqual({ status: "error", message: "This brand has companies, so it cannot be deleted." });
  });

  it("does not claim a delete that removed nothing", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: [], error: null }
        : { data: { id: BRAND, name: "Top Glove", manufacturer_companies: [{ count: 0 }] }, error: null },
    );
    const result = await deleteBrand(IDLE, form({ id: BRAND }));
    expect(result).toEqual({ status: "error", message: "Top Glove could not be deleted. Reload the page and try again." });
  });

  it("treats a brand that is already gone as deleted", async () => {
    const result = await deleteBrand(IDLE, form({ id: BRAND }));
    expect(result).toEqual({ status: "success", message: "This brand was already deleted." });
    expect(writes()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Companies
 * ------------------------------------------------------------------ */

describe("saveCompany", () => {
  it("asks for the brand and the name", async () => {
    const result = await saveCompany(IDLE, companyForm({ brand_id: "", name: "" }));
    expect(result).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { brand_id: "Choose the brand.", name: "Enter the company's name." },
    });
    expect(queries).toEqual([]);
  });

  it("adds a company under its brand", async () => {
    useDatabase(() => ({ data: { id: COMPANY }, error: null }));

    const result = await saveCompany(IDLE, companyForm());

    expect(queries[0].table).toBe("manufacturer_companies");
    expect(arg(queries[0], "insert")?.[0]).toEqual({ brand_id: BRAND, name: "Terang Nusa Sdn. Bhd." });
    expect(result).toEqual({ status: "success", message: "Terang Nusa Sdn. Bhd. added.", id: COMPANY });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("moves a company to another brand, against the version the form was opened on", async () => {
    const OTHER = "54cf6009-2443-4f33-babc-ee964ee83c1c";
    useDatabase(() => ({ data: { id: COMPANY }, error: null }));

    const result = await saveCompany(IDLE, companyForm({ id: COMPANY, version: VERSION, brand_id: OTHER }));

    expect(arg(queries[0], "update")?.[0]).toEqual({ brand_id: OTHER, name: "Terang Nusa Sdn. Bhd." });
    expect(queries[0].calls).toContainEqual(["eq", ["updated_at", VERSION]]);
    expect(result).toEqual({ status: "success", message: "Terang Nusa Sdn. Bhd. saved.", id: COMPANY });
  });

  it("puts a company name any brand already has under the name", async () => {
    useDatabase(() => ({ data: null, error: { code: "23505", message: "duplicate key" } }));
    const result = await saveCompany(IDLE, companyForm());
    expect(result).toMatchObject({ fieldErrors: { name: "There is already a company with this name." } });
  });

  it("says when the brand has gone, under the brand, and refreshes the choices", async () => {
    useDatabase(() => ({ data: null, error: { code: "23503", message: "violates foreign key constraint" } }));
    const result = await saveCompany(IDLE, companyForm());
    expect(result).toEqual({
      status: "error",
      message: "That brand is no longer on the list. Reload the page.",
      fieldErrors: { brand_id: "That brand is no longer on the list. Reload the page." },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when someone else changed the company first", async () => {
    useDatabase((query) =>
      kind(query) === "update"
        ? { data: null, error: null }
        : { data: { brand_id: BRAND, name: "Terang Nusa", updated_at: NEWER }, error: null },
    );
    const result = await saveCompany(IDLE, companyForm({ id: COMPANY, version: VERSION }));
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringMatching(/^Someone else changed this company while you were editing\./),
      latest: { version: NEWER, values: { brand_id: BRAND, name: "Terang Nusa" } },
    });
  });

  it("explains a refusal by Row Level Security in plain words", async () => {
    useDatabase(() => ({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } }));
    const result = await saveCompany(IDLE, companyForm());
    expect(result).toEqual({ status: "error", message: NO_PERMISSION.change });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("deleteCompany", () => {
  it("deletes a company with no factories", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: [{ id: COMPANY }], error: null }
        : { data: { id: COMPANY, name: "TG Medical Sdn. Bhd.", manufacturers: [{ count: 0 }] }, error: null },
    );
    const result = await deleteCompany(IDLE, form({ id: COMPANY }));
    expect(writes()[0].table).toBe("manufacturer_companies");
    expect(result).toEqual({ status: "success", message: "TG Medical Sdn. Bhd. deleted." });
  });

  it("keeps a company that has factories", async () => {
    useDatabase(() => ({ data: { id: COMPANY, name: "Terang Nusa Sdn. Bhd.", manufacturers: [{ count: 1 }] }, error: null }));
    const result = await deleteCompany(IDLE, form({ id: COMPANY }));
    expect(writes()).toEqual([]);
    expect(result).toEqual({ status: "error", message: "Has 1 factory, so it cannot be deleted." });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["23001", "This company has factories, so it cannot be deleted."],
    ["42501", NO_PERMISSION.delete],
  ])("explains the database's refusal %s in plain words", async (code, message) => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: null, error: { code, message: "refused" } }
        : { data: { id: COMPANY, name: "Terang", manufacturers: [{ count: 0 }] }, error: null },
    );
    await expect(deleteCompany(IDLE, form({ id: COMPANY }))).resolves.toEqual({ status: "error", message });
  });
});

/* ------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------ */

describe("saveFactory", () => {
  it("asks for the company and checks each field's length", async () => {
    const result = await saveFactory(IDLE, factoryForm({ company_id: "", country: "x".repeat(61) }));
    expect(result).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { company_id: "Choose the company.", country: "Keep the country to 60 characters or fewer." },
    });
    expect(queries).toEqual([]);
  });

  it("adds a factory under its company, leaving manufacturers.name to the trigger", async () => {
    useDatabase(() => ({ data: { id: FACTORY, company: { name: "Terang Nusa Sdn. Bhd." } }, error: null }));

    const result = await saveFactory(IDLE, factoryForm());

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("manufacturers");
    expect(arg(queries[0], "insert")?.[0]).toEqual({
      company_id: COMPANY,
      factory_name: "TG-F40",
      address: "Lot 67330\nKlang",
      country: "Malaysia",
      notes: null,
    });
    expect(String(arg(queries[0], "select")?.[0])).toBe("id, company:manufacturer_companies(name)");
    expect(result).toEqual({ status: "success", message: "TG-F40 added.", id: FACTORY });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("names a factory without a name by its company", async () => {
    useDatabase(() => ({ data: { id: FACTORY, company: { name: "Hartalega NGC" } }, error: null }));
    const result = await saveFactory(IDLE, factoryForm({ factory_name: "  " }));
    expect(arg(queries[0], "insert")?.[0]).toMatchObject({ factory_name: null });
    expect(result).toEqual({ status: "success", message: "Hartalega NGC's factory added.", id: FACTORY });
  });

  it("moves a factory to another company, against the version the form was opened on", async () => {
    const OTHER = "04a465bb-8362-4c64-ae29-e9bfc8e80ff0";
    useDatabase(() => ({ data: { id: FACTORY, company: { name: "Hartalega NGC" } }, error: null }));

    const result = await saveFactory(IDLE, factoryForm({ id: FACTORY, version: VERSION, company_id: OTHER }));

    expect(arg(queries[0], "update")?.[0]).toMatchObject({ company_id: OTHER, factory_name: "TG-F40" });
    expect(queries[0].calls).toContainEqual(["eq", ["id", FACTORY]]);
    expect(queries[0].calls).toContainEqual(["eq", ["updated_at", VERSION]]);
    expect(result).toEqual({ status: "success", message: "TG-F40 saved.", id: FACTORY });
  });

  it("puts a name the company already has under the factory, with or without a name", async () => {
    useDatabase(() => ({ data: null, error: { code: "23505", message: "duplicate key" } }));

    const named = (await saveFactory(IDLE, factoryForm())) as Extract<SaveFactoryResult, { status: "error" }>;
    expect(named.fieldErrors).toEqual({ factory_name: "This company already has a factory with this name." });

    const unnamed = (await saveFactory(IDLE, factoryForm({ factory_name: "" }))) as Extract<SaveFactoryResult, { status: "error" }>;
    expect(unnamed.fieldErrors).toEqual({ factory_name: "This company already has a factory without a name." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says when the company has gone, under the company", async () => {
    useDatabase(() => ({ data: null, error: { code: "23503", message: "violates foreign key constraint" } }));
    const result = await saveFactory(IDLE, factoryForm());
    expect(result).toMatchObject({ fieldErrors: { company_id: "That company is no longer on the list. Reload the page." } });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when someone else saved first, with their version", async () => {
    useDatabase((query) =>
      kind(query) === "update"
        ? { data: null, error: null }
        : {
            data: { company_id: COMPANY, factory_name: "TG-F40", address: null, country: "Malaysia", notes: "Their note", updated_at: NEWER },
            error: null,
          },
    );

    const result = await saveFactory(IDLE, factoryForm({ id: FACTORY, version: VERSION }));

    expect(result).toEqual({
      status: "error",
      message:
        "Someone else changed this factory while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
      latest: {
        version: NEWER,
        values: { company_id: COMPANY, factory_name: "TG-F40", address: "", country: "Malaysia", notes: "Their note" },
      },
    });
    expect(queries.filter(isRead)[0].calls).toContainEqual(["eq", ["id", FACTORY]]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when the factory was deleted meanwhile", async () => {
    const result = await saveFactory(IDLE, factoryForm({ id: FACTORY, version: VERSION }));
    expect(result).toEqual({ status: "error", message: "This factory has been deleted, so your changes were not saved." });
  });
});

describe("deleteFactory", () => {
  it("deletes a factory nothing uses", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: [{ id: FACTORY }], error: null }
        : { data: { id: FACTORY, factory_name: "TG-F40", company: { name: "Terang Nusa Sdn. Bhd." }, ...counts(0, 0) }, error: null },
    );

    const result = await deleteFactory(IDLE, form({ id: FACTORY }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].table).toBe("manufacturers");
    expect(writes()[0].calls).toContainEqual(["eq", ["id", FACTORY]]);
    expect(result).toEqual({ status: "success", message: "TG-F40 deleted." });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("names a factory without a name by its company", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: [{ id: FACTORY }], error: null }
        : { data: { id: FACTORY, factory_name: null, company: { name: "Hartalega NGC" }, ...counts(0, 0) }, error: null },
    );
    await expect(deleteFactory(IDLE, form({ id: FACTORY }))).resolves.toEqual({
      status: "success",
      message: "Hartalega NGC's factory deleted.",
    });
  });

  it("keeps a factory that templates or inspections use, and says why", async () => {
    useDatabase(() => ({
      data: { id: FACTORY, factory_name: "TG-F40", company: { name: "Terang Nusa Sdn. Bhd." }, ...counts(1, 11) },
      error: null,
    }));

    const result = await deleteFactory(IDLE, form({ id: FACTORY }));

    expect(writes()).toEqual([]);
    expect(result).toEqual({ status: "error", message: "Used by 1 template and 11 inspections, so it cannot be deleted." });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains the database's refusal when an inspection arrived in between", async () => {
    useDatabase((query) =>
      kind(query) === "delete"
        ? { data: null, error: { code: "23503", message: "violates foreign key constraint" } }
        : { data: { id: FACTORY, factory_name: "TG-F40", company: { name: "Terang" }, ...counts(0, 0) }, error: null },
    );
    const result = await deleteFactory(IDLE, form({ id: FACTORY }));
    expect(result).toEqual({ status: "error", message: "Templates or inspections use this factory, so it cannot be deleted." });
  });

  it("treats a factory that is already gone as deleted", async () => {
    const result = await deleteFactory(IDLE, form({ id: FACTORY }));
    expect(result).toEqual({ status: "success", message: "This factory was already deleted." });
    expect(writes()).toEqual([]);
  });
});
