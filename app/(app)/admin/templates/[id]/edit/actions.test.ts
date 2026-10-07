import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { authorizeAction } from "@/lib/auth/session";
import type { TemplateDefinition } from "@/lib/schemas/template";
import { createClient } from "@/lib/supabase/server";
import { lookupFrom } from "@/lib/templates";
import { resolveTemplate } from "@/modules";
import { createTemplateVersion, saveTemplate } from "./actions";
import { SAVE_IDLE, VERSION_IDLE } from "./_lib/results";

/*
 * The editor's actions against a fake Supabase client: what each refuses
 * before it writes, and what it writes. The database rules themselves (RLS,
 * the templates guard that freezes a version in use) are tested in tests/db;
 * e2e/editor runs the same actions against the live project.
 */

const ID = "1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b";
const NEW_ID = "3d6a4adc-4bc3-4f4d-9b5c-3e4f5a6b7c8d";
const SEEN = "2026-10-06T10:45:02.066067+00:00";
const LATER = "2026-10-07T08:00:00.123456+00:00";
const ADMIN = { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };
const UNEXPECTED = "Something went wrong on the server. Try again; if it keeps happening, reload the page.";

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query is recorded and answered by the test.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown; count?: number | null };
type Query = { table: string; calls: Array<[string, unknown[]]> };

let queries: Query[] = [];

function fakeSupabase(answer: (query: Query) => Result) {
  queries = [];
  const from = (table: string) => {
    const entry: Query = { table, calls: [] };
    queries.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "eq", "in", "order"]) {
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
const writes = () => queries.filter((query) => kind(query) === "insert" || kind(query) === "update");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/* ------------------------------------------------------------------ *
 * Template rows
 * ------------------------------------------------------------------ */

function definitionOf(name = "Root gloves"): TemplateDefinition {
  return {
    code: "ROOT_EG",
    name,
    scope: { productType: "examination", standard: "custom" },
    unit: "pcs",
    sizes: [{ value: "M" }],
    modules: [
      { key: "header", include: true },
      { key: "conclusion", include: true },
    ],
  };
}

function resolvedOf(definition: TemplateDefinition) {
  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) throw new Error(`fixture does not resolve: ${JSON.stringify(resolution.problems)}`);
  return resolution.template;
}

function row(overrides: Record<string, unknown> = {}) {
  const definition = definitionOf();
  return {
    id: ID,
    code: "ROOT_EG",
    version: 1,
    status: "draft",
    definition,
    resolved: resolvedOf(definition),
    updated_at: SEEN,
    source_file_path: null,
    coverage_confirmed_at: null,
    extends_code: null,
    product_type: "examination",
    standard: "custom",
    client_id: null,
    manufacturer_id: null,
    ...overrides,
  };
}

type Answers = {
  row?: ReturnType<typeof row> | null;
  inUse?: number;
  versions?: number[];
  /** What the update answers: the new updated_at, null for a row that changed meanwhile, or an error. */
  update?: { updated_at: string } | null | { error: { code: string; message: string } };
  /** What each insert answers, in turn. */
  inserts?: Array<{ id: string } | { error: { code: string; message: string } }>;
};

function database(answers: Answers) {
  const inserts = [...(answers.inserts ?? [])];
  fakeSupabase((query) => {
    if (query.table === "inspections") return { data: null, error: null, count: answers.inUse ?? 0 };
    if (kind(query) === "update") {
      const update = answers.update === undefined ? { updated_at: LATER } : answers.update;
      return update !== null && "error" in update ? { data: null, error: update.error } : { data: update, error: null };
    }
    if (kind(query) === "insert") {
      const next = inserts.shift() ?? { id: NEW_ID };
      return "error" in next ? { data: null, error: next.error } : { data: next, error: null };
    }
    if (selected(query) === "definition, version") return { data: [], error: null };
    if (selected(query) === "version") return { data: (answers.versions ?? [1]).map((version) => ({ version })), error: null };
    return { data: answers.row === undefined ? row() : answers.row, error: null };
  });
}

function saveForm(definition: unknown, updatedAt = SEEN) {
  return form({ id: ID, updatedAt, definition: JSON.stringify(definition) });
}

const updateOf = () => args(writes().find((query) => kind(query) === "update"), "update")?.[0] as Record<string, unknown>;
const insertOf = (index = 0) =>
  args(writes().filter((query) => kind(query) === "insert")[index], "insert")?.[0] as Record<string, unknown>;

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Save
 * ------------------------------------------------------------------ */

describe("saveTemplate", () => {
  it("answers anyone but an active admin with the reason, before reading anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    database({});
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf()))).toEqual({
      status: "error",
      message: "You do not have permission to do that.",
    });
    expect(queries).toEqual([]);
    expect(authorizeAction).toHaveBeenCalledWith("admin");
  });

  it("refuses input that did not arrive whole, a malformed timestamp included, without asking the database", async () => {
    database({});
    for (const data of [
      saveForm(definitionOf(), "not-a-time"),
      form({ id: "nope", updatedAt: SEEN, definition: "{}" }),
      form({ id: ID, updatedAt: SEEN, definition: "{not json" }),
    ]) {
      expect(await saveTemplate(SAVE_IDLE, data)).toEqual({
        status: "error",
        message: "The template did not arrive whole. Reload the page and try again.",
      });
    }
    expect(queries).toEqual([]);
  });

  it("names the problems of a definition that does not fit the template format", async () => {
    database({});
    const result = await saveTemplate(SAVE_IDLE, saveForm({ ...definitionOf(), name: "" }));
    expect(result).toMatchObject({ status: "error", problems: [expect.objectContaining({ path: ["name"] })] });
    expect(writes()).toEqual([]);
  });

  it("keeps the code of the version", async () => {
    database({ row: row({ code: "OTHER_EG" }) });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf()))).toEqual({
      status: "error",
      message: "The code of this version is OTHER_EG; it cannot change.",
    });
    expect(writes()).toEqual([]);
  });

  it("refuses a version that is active, retired or in use, saying why", async () => {
    database({ row: row({ status: "active" }) });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf()))).toMatchObject({
      status: "locked",
      message: expect.stringContaining("Version 1 is active"),
    });
    database({ inUse: 2 });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf()))).toMatchObject({
      status: "locked",
      message: expect.stringContaining("2 inspections use it"),
    });
    expect(writes()).toEqual([]);
  });

  it("writes the definition and its resolution, only over the version the editor read", async () => {
    database({});
    const definition = definitionOf("Renamed gloves");
    const result = await saveTemplate(SAVE_IDLE, saveForm(definition));
    expect(result).toEqual({ status: "saved", message: "Saved ROOT_EG version 1.", updatedAt: LATER, coverageCleared: false });
    const update = writes()[0];
    expect(update.calls).toEqual(
      expect.arrayContaining([
        ["eq", ["id", ID]],
        ["eq", ["updated_at", SEEN]],
      ]),
    );
    expect(updateOf()).toMatchObject({ definition, resolved: resolvedOf(definition), code: "ROOT_EG" });
    expect(refresh).toHaveBeenCalled();
  });

  it("says when someone else saved the draft since it was opened, and does not overwrite theirs", async () => {
    database({ update: null });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf("Mine")))).toMatchObject({ status: "conflict" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the coverage confirmation when the template or what it resolves to changes, and only then", async () => {
    const confirmed = { coverage_confirmed_at: "2026-10-06T12:00:00+00:00" };
    // Saved unchanged: the confirmation stands.
    database({ row: row(confirmed) });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf()))).toMatchObject({ coverageCleared: false });
    expect(updateOf()).not.toHaveProperty("coverage_confirmed_at");
    // A changed definition.
    database({ row: row(confirmed) });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf("Changed")))).toMatchObject({ coverageCleared: true });
    expect(updateOf()).toMatchObject({ coverage_confirmed_at: null, coverage_confirmed_by: null });
    // The same definition, resolved differently now (no stored resolution, a base that moved on).
    database({ row: row({ ...confirmed, resolved: null }) });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf()))).toMatchObject({ coverageCleared: true });
  });

  it("keeps the uploaded source file with the definition", async () => {
    database({ row: row({ source_file_path: "ROOT_EG/v1/form.pdf" }) });
    await saveTemplate(SAVE_IDLE, saveForm(definitionOf()));
    expect(updateOf()).toMatchObject({
      definition: expect.objectContaining({ sourceFile: "ROOT_EG/v1/form.pdf" }),
      source_file_path: "ROOT_EG/v1/form.pdf",
    });
  });

  it("explains the refusals it expects, and keeps the database's own words for the log", async () => {
    database({ update: { error: { code: "42501", message: "new row violates row-level security policy" } } });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf("A")))).toEqual({
      status: "locked",
      message: "Version 1 has just been used by an inspection, so it can no longer be changed. Make a new version.",
    });
    database({ update: { error: { code: "23503", message: 'insert or update on table "templates" violates foreign key' } } });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf("B")))).toEqual({
      status: "error",
      message: "The client or manufacturer this template applies to no longer exists. Choose another in Details.",
    });
    database({ update: { error: { code: "22007", message: 'invalid input syntax for type timestamp with time zone: "x"' } } });
    expect(await saveTemplate(SAVE_IDLE, saveForm(definitionOf("C")))).toEqual({ status: "error", message: UNEXPECTED });
    expect(console.error).toHaveBeenCalledWith("[admin/templates] save refused", "22007", expect.any(String));
  });
});

/* ------------------------------------------------------------------ *
 * New version
 * ------------------------------------------------------------------ */

describe("createTemplateVersion", () => {
  const versionForm = (definition?: unknown) =>
    form({ id: ID, ...(definition === undefined ? {} : { definition: JSON.stringify(definition) }) });

  it("leaves a draft no inspection uses to be changed directly", async () => {
    database({});
    expect(await createTemplateVersion(VERSION_IDLE, versionForm())).toEqual({
      status: "error",
      message: "Version 1 is a draft no inspection uses: change it directly.",
    });
    expect(writes()).toEqual([]);
  });

  it("copies a version in use into the next draft, resolved again, then opens it", async () => {
    database({ inUse: 1, versions: [1, 2], row: row({ source_file_path: "ROOT_EG/v1/form.pdf" }) });
    await expect(createTemplateVersion(VERSION_IDLE, versionForm())).rejects.toThrow(`NEXT_REDIRECT /admin/templates/${NEW_ID}/edit`);
    expect(insertOf()).toMatchObject({
      version: 3,
      status: "draft",
      code: "ROOT_EG",
      definition: expect.objectContaining({ name: "Root gloves", sourceFile: "ROOT_EG/v1/form.pdf" }),
      resolved: expect.objectContaining({ code: "ROOT_EG" }),
    });
    expect(redirect).toHaveBeenCalledWith(`/admin/templates/${NEW_ID}/edit`);
  });

  it("starts the new version from unsaved changes carried over, and refuses ones with problems", async () => {
    database({ inUse: 1 });
    await expect(createTemplateVersion(VERSION_IDLE, versionForm(definitionOf("Carried")))).rejects.toThrow("NEXT_REDIRECT");
    expect(insertOf()).toMatchObject({ definition: expect.objectContaining({ name: "Carried" }) });

    database({ inUse: 1 });
    expect(await createTemplateVersion(VERSION_IDLE, versionForm({ ...definitionOf(), name: "" }))).toEqual({
      status: "error",
      message: "Your changes have problems, so they cannot go into a new version. Reload to start from the saved version.",
    });
    expect(writes()).toEqual([]);
  });

  it("takes the next number when another admin took this one meanwhile", async () => {
    database({ inUse: 1, inserts: [{ error: { code: "23505", message: "duplicate key" } }, { id: NEW_ID }] });
    await expect(createTemplateVersion(VERSION_IDLE, versionForm())).rejects.toThrow("NEXT_REDIRECT");
    expect(writes().filter((query) => kind(query) === "insert")).toHaveLength(2);
  });

  it("keeps the database's words for the log", async () => {
    database({ inUse: 1, inserts: [{ error: { code: "XX000", message: "internal detail" } }] });
    expect(await createTemplateVersion(VERSION_IDLE, versionForm())).toEqual({ status: "error", message: UNEXPECTED });
    expect(console.error).toHaveBeenCalledWith("[admin/templates] new version refused", "XX000", "internal detail");
  });
});
