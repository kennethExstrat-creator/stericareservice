import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refresh } from "next/cache";
import { coverageChecklist, MESSAGES, SOURCE_TYPE_PROBLEM, type ActionResult } from "@/lib/admin/templates";
import { authorizeAction } from "@/lib/auth/session";
import type { ResolvedTemplate, TemplateDefinition } from "@/lib/schemas/template";
import { createClient } from "@/lib/supabase/server";
import { lookupFrom } from "@/lib/templates";
import { resolveTemplate } from "@/modules";
import {
  activateVersion,
  confirmCoverage,
  confirmSourceUpload,
  createNewVersion,
  getSourceDownload,
  prepareSourceUpload,
  retireVersion,
} from "./actions";

/*
 * The template version actions against a fake Supabase client: what each one
 * refuses before it writes, and what it writes. The database rules (RLS, the
 * templates guard, one active version per code) are tested in tests/db; the
 * end-to-end spec (e2e/templates) runs the same actions against the live project.
 */

const ID = "1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b";
const OTHER_ID = "2c5f39cb-3ab2-4e3c-8a4b-2d3e4f5a6b7c";
const NEW_ID = "3d6a4adc-4bc3-4f4d-9b5c-3e4f5a6b7c8d";
const SEEN = "2026-10-06T10:45:02.066067+00:00";
const PATH = "ROOT_EG/v1/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/form.pdf";
const OLD_PATH = "ROOT_EG/v1/5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b/old-form.pdf";
const IDLE: ActionResult = { status: "idle" };
const ADMIN = { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query and storage call is recorded and
 * answered by the test's responders.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type StorageCall = { bucket: string; method: string; args: unknown[] };

let queries: Query[] = [];
let storageCalls: StorageCall[] = [];

const OK: Result = { data: null, error: null };

function fakeSupabase({
  query = () => OK,
  storage = () => OK,
}: { query?: (query: Query) => Result; storage?: (call: StorageCall) => Result } = {}) {
  queries = [];
  storageCalls = [];
  const from = (table: string) => {
    const entry: Query = { table, calls: [] };
    queries.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "neq", "in", "is", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        return builder;
      };
    }
    for (const method of ["single", "maybeSingle"]) {
      builder[method] = () => {
        entry.calls.push([method, []]);
        return Promise.resolve(query(entry));
      };
    }
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(query(entry)).then(resolve, reject);
    return builder;
  };
  const bucket = (name: string) => {
    const api: Record<string, (...args: unknown[]) => Promise<Result>> = {};
    for (const method of ["createSignedUploadUrl", "createSignedUrl", "exists", "info", "list", "remove"]) {
      api[method] = (...args: unknown[]) => {
        const call = { bucket: name, method, args };
        storageCalls.push(call);
        return Promise.resolve(storage(call));
      };
    }
    return api;
  };
  vi.mocked(createClient).mockResolvedValue({ from, storage: { from: bucket } } as never);
}

const kind = (query: Query) => query.calls[0]?.[0];
const args = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1];
const calledWith = (query: Query, method: string, ...values: unknown[]) =>
  query.calls.some(([name, given]) => name === method && JSON.stringify(given) === JSON.stringify(values));
const selected = (query: Query) => String(args(query, "select")?.[0] ?? "");
const writes = () => queries.filter((query) => ["insert", "update", "delete"].includes(kind(query) ?? ""));
const storageOf = (method: string) => storageCalls.filter((call) => call.method === method);

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Template rows
 * ------------------------------------------------------------------ */

function definitionOf(code: string, extendsCode?: string): TemplateDefinition {
  return {
    code,
    name: `${code} gloves`,
    ...(extendsCode ? { extends: extendsCode } : {}),
    scope: { productType: "examination", standard: "custom" },
    unit: "pcs",
    sizes: [{ value: "M" }],
    modules: [
      { key: "header", include: true, labels: { poNo: "PO Number" } },
      { key: "conclusion", include: true },
    ],
    report: { title: `${code} report`, showClientLogo: false },
  };
}

function resolvedOf(definition: TemplateDefinition, bases: TemplateDefinition[] = []): ResolvedTemplate {
  const resolution = resolveTemplate(definition, lookupFrom(bases.map((base) => ({ definition: base, version: 1 }))));
  if (!resolution.ok) throw new Error(`fixture does not resolve: ${JSON.stringify(resolution.problems)}`);
  return resolution.template;
}

type Row = ReturnType<typeof row>;

function row(overrides: Record<string, unknown> = {}) {
  const definition = definitionOf("ROOT_EG");
  return {
    id: ID,
    code: "ROOT_EG",
    version: 1,
    status: "draft",
    extends_code: null,
    product_type: "examination",
    standard: "custom",
    client_id: null,
    manufacturer_id: null,
    definition,
    resolved: resolvedOf(definition) as unknown,
    source_file_path: PATH as string | null,
    coverage_confirmed_at: null as string | null,
    created_at: "2026-10-06T09:00:00+00:00",
    updated_at: SEEN,
    inspections: [{ count: 0 }],
    clients: null,
    manufacturers: null,
    confirmer: null,
    ...overrides,
  };
}

/** Answers readRow() and loadTemplateVersion() with `current`, the other versions with `versions`. */
function templateReads(current: Row | null, versions: Row[] = current ? [current] : []) {
  return (query: Query): Result | undefined => {
    if (query.table !== "templates" || kind(query) !== "select") return undefined;
    if (calledWith(query, "eq", "id", ID)) return { data: current, error: null };
    if (selected(query).includes("format:resolved->format")) {
      return {
        data: versions.map((entry) => ({
          id: entry.id,
          version: entry.version,
          status: entry.status,
          coverage_confirmed_at: entry.coverage_confirmed_at,
          updated_at: entry.updated_at,
          format: (entry.resolved as { format?: number } | null)?.format ?? null,
          inspections: entry.inspections,
        })),
        error: null,
      };
    }
    if (calledWith(query, "eq", "status", "active")) {
      return { data: versions.filter((entry) => entry.status === "active"), error: null };
    }
    return undefined;
  };
}

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN });
  vi.spyOn(console, "error").mockImplementation(() => {});
  fakeSupabase();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Source file
 * ------------------------------------------------------------------ */

describe("prepareSourceUpload", () => {
  const request = { templateId: ID, fileName: "STD EG report (2026).xlsx", type: "", size: 48_000 };

  it("needs an active admin before it reads anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });

    expect(await prepareSourceUpload(request)).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith("admin");
    expect(queries).toEqual([]);
    expect(storageCalls).toEqual([]);
  });

  it("refuses a file the bucket would refuse before it reads the version", async () => {
    expect(await prepareSourceUpload({ ...request, fileName: "notes.txt", type: "text/plain" })).toEqual({
      status: "error",
      message: SOURCE_TYPE_PROBLEM,
    });
    expect(await prepareSourceUpload({ ...request, size: 51 * 1024 * 1024 })).toMatchObject({
      message: "That file is 51 MB. Choose one up to 50 MB.",
    });
    expect(await prepareSourceUpload({ ...request, templateId: "not-an-id" })).toEqual({
      status: "error",
      message: MESSAGES.stale,
    });
    expect(queries).toEqual([]);
  });

  it("signs a one-time upload into the version's own folder, under a safe name", async () => {
    fakeSupabase({
      query: (query) => templateReads(row())(query) ?? OK,
      storage: (call) => ({ data: { path: call.args[0], token: "one-time-token" }, error: null }),
    });

    const result = await prepareSourceUpload(request);

    expect(result).toMatchObject({
      status: "ready",
      token: "one-time-token",
      // No type from the browser: the extension stands for it.
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.status === "ready" && result.path).toMatch(/^ROOT_EG\/v1\/[0-9a-f-]{36}\/STD-EG-report-2026\.xlsx$/);
    expect(storageOf("createSignedUploadUrl")).toHaveLength(1);
    expect(storageOf("createSignedUploadUrl")[0].bucket).toBe("template-sources");
  });

  it("keeps the file of a version that is no longer a draft, or is in use", async () => {
    for (const [overrides, message] of [
      [{ status: "active" }, /^Version 1 is active, so its source file stays as it was checked\./],
      [{ status: "active", inspections: [{ count: 3 }] }, /^Version 1 is used by inspections, so its source file stays as it is\./],
    ] as const) {
      fakeSupabase({ query: (query) => templateReads(row(overrides))(query) ?? OK });
      const result = await prepareSourceUpload(request);
      expect(result.status).toBe("error");
      expect(result.status === "error" && result.message).toMatch(message);
      expect(storageCalls).toEqual([]);
    }
    expect(refresh).toHaveBeenCalled();
  });

  it("says when the version is gone", async () => {
    fakeSupabase({ query: (query) => templateReads(null)(query) ?? OK });
    expect(await prepareSourceUpload(request)).toEqual({ status: "error", message: MESSAGES.notFound });
  });
});

describe("confirmSourceUpload", () => {
  it("takes only an object named for this version", async () => {
    fakeSupabase({ query: (query) => templateReads(row({ source_file_path: null }))(query) ?? OK });

    for (const path of [
      "OTHER_EG/v1/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/form.pdf",
      "ROOT_EG/v2/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/form.pdf",
      "ROOT_EG/v1/form.pdf",
    ]) {
      expect(await confirmSourceUpload({ templateId: ID, path }), path).toEqual({ status: "error", message: MESSAGES.stale });
    }
    expect(writes()).toEqual([]);
    expect(storageCalls).toEqual([]);
  });

  it("needs the upload to have finished", async () => {
    fakeSupabase({
      query: (query) => templateReads(row({ source_file_path: null }))(query) ?? OK,
      storage: () => ({ data: false, error: null }),
    });

    expect(await confirmSourceUpload({ templateId: ID, path: PATH })).toEqual({
      status: "error",
      message: "The upload did not finish. Choose the file again.",
    });
    expect(writes()).toEqual([]);
  });

  it("names the file in the column, the definition and the resolved template, clears the checklist and removes the old file", async () => {
    const current = row({ source_file_path: OLD_PATH, coverage_confirmed_at: "2026-10-06T10:00:00+00:00" });
    const now = new Date().toISOString();
    fakeSupabase({
      query: (query) => {
        if (kind(query) === "update") return { data: { id: ID }, error: null };
        if (selected(query) === "source_file_path" && args(query, "in")) return { data: [], error: null };
        return templateReads(current)(query) ?? OK;
      },
      storage: (call) => {
        if (call.method === "exists") return { data: true, error: null };
        if (call.method === "list" && call.args[0] === "ROOT_EG/v1") {
          return { data: [OLD_PATH, PATH].map((path) => ({ name: path.split("/")[2], id: null })), error: null };
        }
        if (call.method === "list") {
          const name = [OLD_PATH, PATH].find((path) => path.startsWith(`${call.args[0]}/`))!.split("/")[3];
          return { data: [{ name, id: `object-${name}`, created_at: now }], error: null };
        }
        return OK;
      },
    });

    expect(await confirmSourceUpload({ templateId: ID, path: PATH })).toEqual({
      status: "success",
      message: "Source file replaced. Check the coverage checklist against it and confirm it again.",
    });

    const [update] = writes();
    const payload = args(update, "update")?.[0] as Record<string, { sourceFile?: string } | string | null>;
    expect(payload.source_file_path).toBe(PATH);
    expect((payload.definition as { sourceFile?: string }).sourceFile).toBe(PATH);
    expect((payload.resolved as { sourceFile?: string }).sourceFile).toBe(PATH);
    expect(payload.coverage_confirmed_by).toBeNull();
    expect(payload.coverage_confirmed_at).toBeNull();
    // Only over the row as it was read.
    expect(calledWith(update, "eq", "updated_at", SEEN)).toBe(true);
    // The file it replaced goes at once; the new one stays.
    expect(storageOf("remove").map((call) => call.args[0])).toEqual([[OLD_PATH]]);
  });

  it("reads again when the version changed under it, then gives up", async () => {
    fakeSupabase({
      query: (query) => (kind(query) === "update" ? { data: null, error: null } : (templateReads(row({ source_file_path: null }))(query) ?? OK)),
      storage: () => ({ data: true, error: null }),
    });

    expect(await confirmSourceUpload({ templateId: ID, path: PATH })).toEqual({ status: "error", message: MESSAGES.changed });
    expect(writes()).toHaveLength(2);
    expect(storageOf("remove")).toEqual([]);
  });

  it("explains a version the database keeps frozen", async () => {
    fakeSupabase({
      query: (query) =>
        kind(query) === "update"
          ? { data: null, error: { code: "42501", message: "template ROOT_EG version 1 is in use: create a new version instead" } }
          : (templateReads(row({ source_file_path: null }))(query) ?? OK),
      storage: () => ({ data: true, error: null }),
    });

    const result = await confirmSourceUpload({ templateId: ID, path: PATH });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toMatch(
      /^ROOT_EG version 1 is used by inspections, so it can no longer change.*Make a new version/,
    );
  });
});

describe("getSourceDownload", () => {
  it("signs a one-minute download link under the file's own name", async () => {
    fakeSupabase({
      query: (query) => templateReads(row())(query) ?? OK,
      storage: () => ({ data: { signedUrl: "https://storage.example/signed" }, error: null }),
    });

    expect(await getSourceDownload({ templateId: ID })).toEqual({ status: "ready", url: "https://storage.example/signed" });
    expect(storageOf("createSignedUrl")[0].args).toEqual([PATH, 60, { download: "form.pdf" }]);
  });

  it("says when the version has no file", async () => {
    fakeSupabase({ query: (query) => templateReads(row({ source_file_path: null }))(query) ?? OK });
    expect(await getSourceDownload({ templateId: ID })).toEqual({
      status: "error",
      message: "This version has no source file any more.",
    });
    expect(storageCalls).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Coverage checklist
 * ------------------------------------------------------------------ */

describe("confirmCoverage", () => {
  // A template on top of STD_EG: its checklist lists STD_EG's forms, a tick per section.
  const stdEg = definitionOf("STD_EG");
  const child = definitionOf("CHILD_EG", "STD_EG");
  const childRow = () =>
    row({ code: "CHILD_EG", extends_code: "STD_EG", definition: child, resolved: resolvedOf(child, [stdEg]) });
  const sections = () => coverageChecklist(resolvedOf(child, [stdEg])).sectionKeys;

  it("needs the last tick before it reads anything", async () => {
    const result = await confirmCoverage(IDLE, form({ templateId: ID, seen: SEEN, section: sections() }));
    expect(result).toEqual({ status: "error", message: "Tick the last box once you have checked the source file." });
    expect(queries).toEqual([]);
  });

  it("confirms only the version as the page showed it", async () => {
    fakeSupabase({ query: (query) => templateReads(childRow())(query) ?? OK });
    const result = await confirmCoverage(
      IDLE,
      form({ templateId: ID, seen: "2026-10-06T09:00:00+00:00", section: sections(), attested: "yes" }),
    );
    expect(result).toEqual({ status: "error", message: MESSAGES.changed });
    expect(writes()).toEqual([]);
  });

  it("needs every section of the checklist ticked, then records who confirmed it and when", async () => {
    expect(sections().length).toBeGreaterThan(1);
    fakeSupabase({
      query: (query) => (kind(query) === "update" ? { data: { id: ID }, error: null } : (templateReads(childRow())(query) ?? OK)),
    });

    const missed = await confirmCoverage(IDLE, form({ templateId: ID, seen: SEEN, section: sections().slice(1), attested: "yes" }));
    expect(missed).toEqual({ status: "error", message: "Tick every section of the checklist once you have checked it." });
    expect(writes()).toEqual([]);

    const result = await confirmCoverage(IDLE, form({ templateId: ID, seen: SEEN, section: sections(), attested: "yes" }));
    expect(result).toEqual({ status: "success", message: "Coverage confirmed for CHILD_EG version 1. It can be activated now." });
    const [update] = writes();
    const payload = args(update, "update")?.[0] as { coverage_confirmed_by: string; coverage_confirmed_at: string };
    expect(payload.coverage_confirmed_by).toBe("admin-id");
    expect(Number.isNaN(Date.parse(payload.coverage_confirmed_at))).toBe(false);
    expect(calledWith(update, "eq", "updated_at", SEEN)).toBe(true);
    expect(calledWith(update, "is", "coverage_confirmed_at", null)).toBe(true);
  });

  it("never confirms a seed template that loses fields of its own forms (BUILD_SPEC 4.2 rule 2)", async () => {
    fakeSupabase({
      query: (query) =>
        templateReads(row({ code: "STD_EG", definition: stdEg, resolved: resolvedOf(stdEg) }))(query) ?? OK,
    });
    const own = coverageChecklist(resolvedOf(stdEg));
    expect(own.blocking).toBe(true);

    const result = await confirmCoverage(IDLE, form({ templateId: ID, seen: SEEN, section: own.sectionKeys, attested: "yes" }));
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toMatch(/not in this version\. Nothing may be lost \(BUILD_SPEC 4\.2 rule 2\)/);
    expect(writes()).toEqual([]);
  });

  it("needs the source file the checklist is checked against", async () => {
    fakeSupabase({ query: (query) => templateReads(row({ source_file_path: null }))(query) ?? OK });
    const result = await confirmCoverage(IDLE, form({ templateId: ID, seen: SEEN, attested: "yes" }));
    expect(result).toEqual({
      status: "error",
      message: "Upload the source form or report first: the checklist is checked against it.",
    });
    expect(writes()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Activate, retire, new version
 * ------------------------------------------------------------------ */

describe("activateVersion", () => {
  const confirmed = "2026-10-06T10:30:00+00:00";
  const draft = () => row({ version: 2, coverage_confirmed_at: confirmed });
  const active = () => row({ id: OTHER_ID, version: 1, status: "active", coverage_confirmed_at: confirmed });

  it("retires the code's active version first, then activates this one", async () => {
    fakeSupabase({
      query: (query) => {
        const payload = args(query, "update")?.[0] as { status?: string } | undefined;
        if (payload?.status === "retired") return { data: [{ id: OTHER_ID, version: 1 }], error: null };
        if (payload?.status === "active") return { data: { id: ID }, error: null };
        return templateReads(draft(), [draft(), active()])(query) ?? OK;
      },
    });

    const result = await activateVersion(IDLE, form({ templateId: ID, seen: SEEN }));

    expect(result).toEqual({
      status: "success",
      message:
        "ROOT_EG version 2 is active. New inspections start from it. Version 1 is retired; inspections that use it keep it.",
    });
    const [retire, activate] = writes();
    expect(args(retire, "update")).toEqual([{ status: "retired" }]);
    expect(calledWith(retire, "in", "id", [OTHER_ID])).toBe(true);
    expect(args(activate, "update")).toEqual([{ status: "active" }]);
    expect(calledWith(activate, "eq", "id", ID)).toBe(true);
    expect(calledWith(activate, "eq", "updated_at", SEEN)).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });

  it("puts the retired version back when the activation fails", async () => {
    fakeSupabase({
      query: (query) => {
        const payload = args(query, "update")?.[0] as { status?: string } | undefined;
        if (payload?.status === "retired") return { data: [{ id: OTHER_ID, version: 1 }], error: null };
        if (payload?.status === "active" && calledWith(query, "eq", "id", ID)) {
          return {
            data: null,
            error: { code: "23505", message: 'duplicate key value violates unique constraint "templates_one_active_version"' },
          };
        }
        if (payload?.status === "active") return OK;
        return templateReads(draft(), [draft(), active()])(query) ?? OK;
      },
    });

    const result = await activateVersion(IDLE, form({ templateId: ID, seen: SEEN }));

    expect(result.status === "error" && result.message).toMatch(/^Another version of ROOT_EG became active at the same moment/);
    const restore = writes()[2];
    expect(args(restore, "update")).toEqual([{ status: "active" }]);
    expect(calledWith(restore, "in", "id", [OTHER_ID])).toBe(true);
    expect(calledWith(restore, "eq", "status", "retired")).toBe(true);
  });

  it("writes nothing while the checklist is not confirmed or the source file is missing", async () => {
    for (const [overrides, message] of [
      [{ coverage_confirmed_at: null }, "Confirm the coverage checklist first (BUILD_SPEC 4.2 rule 10)."],
      [
        { source_file_path: null, coverage_confirmed_at: null },
        "Upload the source form or report first (BUILD_SPEC 4.2 rule 10). Confirm the coverage checklist first (BUILD_SPEC 4.2 rule 10).",
      ],
    ] as const) {
      const current = row({ version: 2, ...overrides });
      fakeSupabase({ query: (query) => templateReads(current, [current, active()])(query) ?? OK });
      expect(await activateVersion(IDLE, form({ templateId: ID, seen: SEEN }))).toEqual({ status: "error", message });
      expect(writes()).toEqual([]);
    }
  });

  it("refuses a version changed since the page read it", async () => {
    fakeSupabase({ query: (query) => templateReads(draft(), [draft(), active()])(query) ?? OK });
    expect(await activateVersion(IDLE, form({ templateId: ID, seen: "2026-10-06T09:00:00+00:00" }))).toEqual({
      status: "error",
      message: MESSAGES.changed,
    });
    expect(writes()).toEqual([]);
  });

  it("needs an active admin and a real version", async () => {
    expect(await activateVersion(IDLE, form({ templateId: "x", seen: SEEN }))).toEqual({ status: "error", message: MESSAGES.stale });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await activateVersion(IDLE, form({ templateId: ID, seen: SEEN }))).toEqual({
      status: "error",
      message: "Your session has ended. Sign in again.",
    });
    expect(queries).toEqual([]);
  });
});

describe("retireVersion", () => {
  it("retires the active version; inspections that use it keep it", async () => {
    fakeSupabase({
      query: (query) => (kind(query) === "update" ? { data: { id: ID }, error: null } : (templateReads(row({ status: "active" }))(query) ?? OK)),
    });

    expect(await retireVersion(IDLE, form({ templateId: ID, seen: SEEN }))).toEqual({
      status: "success",
      message: "ROOT_EG version 1 is retired. New inspections can no longer start from it; inspections that use it keep it.",
    });
    const [update] = writes();
    expect(args(update, "update")).toEqual([{ status: "retired" }]);
    expect(calledWith(update, "eq", "status", "active")).toBe(true);
  });

  it("leaves a draft alone", async () => {
    fakeSupabase({ query: (query) => templateReads(row())(query) ?? OK });
    expect(await retireVersion(IDLE, form({ templateId: ID, seen: SEEN }))).toEqual({
      status: "error",
      message: "Only the active version can be retired. A draft is not offered to inspectors yet.",
    });
    expect(writes()).toEqual([]);
  });
});

describe("createNewVersion", () => {
  function redirectOf(error: unknown): string | null {
    const digest = (error as { digest?: unknown })?.digest;
    return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : null;
  }

  it("copies the definition into the next draft version and opens it in the editor", async () => {
    const current = row({ status: "active", coverage_confirmed_at: "2026-10-06T10:30:00+00:00" });
    fakeSupabase({
      query: (query) => {
        if (kind(query) === "insert") return { data: { id: NEW_ID }, error: null };
        if (selected(query) === "version") return { data: [{ version: 1 }, { version: 2 }], error: null };
        return templateReads(current)(query) ?? OK;
      },
    });

    const thrown = await createNewVersion(IDLE, form({ templateId: ID, seen: SEEN })).catch((error: unknown) => error);

    expect(redirectOf(thrown)).toBe(`/admin/templates/${NEW_ID}/edit`);
    const [insert] = writes();
    const inserted = args(insert, "insert")?.[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      code: "ROOT_EG",
      version: 3,
      status: "draft",
      product_type: "examination",
      standard: "custom",
      source_file_path: PATH,
      coverage_confirmed_by: null,
      coverage_confirmed_at: null,
    });
    expect(inserted.definition).toEqual({ ...current.definition, sourceFile: PATH });
    expect((inserted.resolved as ResolvedTemplate).sourceFile).toBe(PATH);
  });

  it("counts again when someone takes the number at the same moment", async () => {
    let inserts = 0;
    fakeSupabase({
      query: (query) => {
        if (kind(query) === "insert") {
          inserts += 1;
          return inserts === 1
            ? { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "templates_code_version_key"' } }
            : { data: { id: NEW_ID }, error: null };
        }
        if (selected(query) === "version") {
          return { data: inserts === 0 ? [{ version: 1 }] : [{ version: 1 }, { version: 2 }], error: null };
        }
        return templateReads(row({ status: "retired" }))(query) ?? OK;
      },
    });

    const thrown = await createNewVersion(IDLE, form({ templateId: ID, seen: SEEN })).catch((error: unknown) => error);

    expect(redirectOf(thrown)).toBe(`/admin/templates/${NEW_ID}/edit`);
    expect(writes().map((query) => (args(query, "insert")?.[0] as { version: number }).version)).toEqual([2, 3]);
  });

  it("needs an active admin before it reads anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    expect(await createNewVersion(IDLE, form({ templateId: ID, seen: SEEN }))).toEqual({
      status: "error",
      message: "You do not have permission to do that.",
    });
    expect(queries).toEqual([]);
  });
});
