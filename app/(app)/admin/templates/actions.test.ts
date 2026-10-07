import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { redirect } from "next/navigation";
import { NEW_TEMPLATE_IDLE } from "@/lib/admin/new-template";
import { authorizeAction } from "@/lib/auth/session";
import type { ResolvedTemplate, TemplateDefinition } from "@/lib/schemas/template";
import { createClient } from "@/lib/supabase/server";
import { createTemplate } from "./actions";

/*
 * New template against a fake Supabase client: what it refuses before it
 * writes, and the draft it writes. e2e/admin-template-flow runs it against
 * the live project, from the dialog to the capture screen.
 */

const NEW_ID = "3d6a4adc-4bc3-4f4d-9b5c-3e4f5a6b7c8d";
const CLIENT_ID = "20000000-0000-4000-8000-000000000001";
const ADMIN = { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };

let queries: Query[] = [];

function fakeSupabase(answer: (query: Query) => Result) {
  queries = [];
  const from = (table: string) => {
    const entry: Query = { table, calls: [] };
    queries.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "eq", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        return builder;
      };
    }
    for (const method of ["single", "maybeSingle"]) {
      builder[method] = () => {
        entry.calls.push([method, []]);
        return Promise.resolve(answer(entry));
      };
    }
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(answer(entry)).then(resolve, reject);
    return builder;
  };
  vi.mocked(createClient).mockResolvedValue({ from } as never);
}

const kind = (query: Query) => query.calls[0]?.[0];
const args = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1];
const selected = (query: Query) => String(args(query, "select")?.[0] ?? "");
const inserts = () => queries.filter((query) => kind(query) === "insert");

const STD_EG: TemplateDefinition = {
  code: "STD_EG",
  name: "Standard examination gloves (EN 455)",
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
  modules: [
    { key: "header", include: true },
    { key: "glove_info", include: true },
    { key: "conclusion", include: true },
  ],
};

type Answers = {
  /** Rows of the same code already there. */
  taken?: boolean;
  /** The base's versions, newest first. */
  base?: { version: number; status: string; definition: unknown }[];
  insert?: { id: string } | { error: { code: string; message: string } };
};

function database({ taken = false, base = [{ version: 2, status: "active", definition: STD_EG }], insert }: Answers = {}) {
  fakeSupabase((query) => {
    if (kind(query) === "insert") {
      const next = insert ?? { id: NEW_ID };
      return "error" in next ? { data: null, error: next.error } : { data: next, error: null };
    }
    if (selected(query) === "id") return { data: taken ? [{ id: "existing" }] : [], error: null };
    if (selected(query) === "version, status, definition") return { data: base, error: null };
    return { data: null, error: null };
  });
}

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values = {
    code: "client eg",
    name: "Client A nitrile gloves",
    base: "STD_EG",
    productType: "examination",
    standard: "ASTM_D6319",
    clientId: CLIENT_ID,
    manufacturerId: "any",
    ...fields,
  };
  for (const [name, value] of Object.entries(values)) data.append(name, value);
  return data;
}

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("createTemplate", () => {
  it("answers anyone but an active admin with the reason, before reading anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    database();
    expect(await createTemplate(NEW_TEMPLATE_IDLE, form())).toEqual({
      status: "error",
      message: "You do not have permission to do that.",
    });
    expect(queries).toEqual([]);
    expect(authorizeAction).toHaveBeenCalledWith("admin");
  });

  it("names each field to fix without asking the database", async () => {
    database();
    expect(await createTemplate(NEW_TEMPLATE_IDLE, form({ code: "", base: "", standard: "EN374" }))).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        code: "Enter a code, e.g. CLIENT_EG.",
        base: "Choose the template to build on, or None.",
        standard: "Choose the standard.",
      },
    });
    expect(queries).toEqual([]);
  });

  it("refuses a code that is taken: each template keeps its code", async () => {
    database({ taken: true });
    expect(await createTemplate(NEW_TEMPLATE_IDLE, form())).toMatchObject({
      status: "error",
      fieldErrors: { code: expect.stringContaining("CLIENT_EG is taken") },
    });
    expect(inserts()).toEqual([]);
  });

  it("builds only on a base with an active version", async () => {
    database({ base: [{ version: 3, status: "draft", definition: STD_EG }, { version: 2, status: "retired", definition: STD_EG }] });
    expect(await createTemplate(NEW_TEMPLATE_IDLE, form())).toMatchObject({
      fieldErrors: { base: "STD_EG has no active version: build on a template inspectors can start from, or on None." },
    });
    expect(inserts()).toEqual([]);
  });

  it("writes version 1 as a draft on the base's active version, resolved, then opens the editor", async () => {
    database({ base: [{ version: 3, status: "draft", definition: { ...STD_EG, name: "Newer draft" } }, { version: 2, status: "active", definition: STD_EG }] });
    await expect(createTemplate(NEW_TEMPLATE_IDLE, form())).rejects.toThrow(`NEXT_REDIRECT /admin/templates/${NEW_ID}/edit`);
    expect(redirect).toHaveBeenCalledWith(`/admin/templates/${NEW_ID}/edit`);
    const row = args(inserts()[0], "insert")?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      code: "CLIENT_EG",
      version: 1,
      status: "draft",
      extends_code: "STD_EG",
      product_type: "examination",
      standard: "ASTM_D6319",
      client_id: CLIENT_ID,
      manufacturer_id: null,
      source_file_path: null,
      coverage_confirmed_by: null,
      coverage_confirmed_at: null,
      definition: {
        code: "CLIENT_EG",
        name: "Client A nitrile gloves",
        extends: "STD_EG",
        scope: { productType: "examination", standard: "ASTM_D6319", clientId: CLIENT_ID },
        unit: "pcs",
        sizes: STD_EG.sizes,
        modules: [],
      },
    });
    const resolved = row.resolved as ResolvedTemplate;
    expect(resolved.bases).toEqual([{ code: "STD_EG", version: 2 }]);
    expect(resolved.modules.map((entry) => entry.key)).toEqual(["header", "glove_info", "conclusion"]);
  });

  it("starts a template of its own without reading a base", async () => {
    database();
    await expect(createTemplate(NEW_TEMPLATE_IDLE, form({ base: "none", productType: "surgical", standard: "ASTM_D3577" }))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(queries.some((query) => selected(query) === "version, status, definition")).toBe(false);
    const row = args(inserts()[0], "insert")?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({ extends_code: null, product_type: "surgical", definition: expect.objectContaining({ unit: "pairs" }) });
  });

  it("explains a code another admin took at the same moment, and a client that went", async () => {
    database({ insert: { error: { code: "23505", message: 'duplicate key value violates unique constraint "templates_code_version_key"' } } });
    expect(await createTemplate(NEW_TEMPLATE_IDLE, form())).toMatchObject({
      fieldErrors: { code: expect.stringContaining("CLIENT_EG is taken") },
    });
    database({ insert: { error: { code: "23503", message: "insert or update on table templates violates foreign key" } } });
    expect(await createTemplate(NEW_TEMPLATE_IDLE, form())).toEqual({
      status: "error",
      message: "The client or manufacturer you chose no longer exists. Reload the page and choose again.",
    });
    database({ insert: { error: { code: "XX000", message: "internal detail" } } });
    expect(await createTemplate(NEW_TEMPLATE_IDLE, form())).toEqual({
      status: "error",
      message: "Something went wrong on the server. Try again, and reload the page if it keeps happening.",
    });
    expect(console.error).toHaveBeenCalledWith("[admin/templates] new template refused", "XX000", "internal detail");
  });
});
