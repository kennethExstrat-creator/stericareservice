import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refresh } from "next/cache";
import { LOGO_MAX_BYTES, MESSAGES } from "@/lib/admin/reference";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  confirmLogoUpload,
  deleteClient,
  prepareLogoUpload,
  removeClientLogo,
  saveClient,
  type SaveClientResult,
} from "./actions";

const CLIENT = "6f1d2c3b-4a5e-4f7d-8c9b-0a1b2c3d4e5f";
const OTHER = "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a0b";
const NEW_FILE = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
const OLD_FILE = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
const NEW_LOGO = `${CLIENT}/${NEW_FILE}.png`;
const OLD_LOGO = `${CLIENT}/${OLD_FILE}.jpg`;
const VERSION = "2026-10-06T10:45:02.066067+00:00";
const IDLE = { status: "idle" } as const;

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the test's responder returns; Storage calls are spies.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type Responder = (query: Query) => Result;

let queries: Query[] = [];
let bucket: ReturnType<typeof fakeBucket>;

function fakeBucket() {
  return {
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { path, token: "upload-token", signedUrl: `https://storage.example/upload/${path}` },
      error: null as unknown,
    })),
    createSignedUrls: vi.fn(async (): Promise<Result> => ({ data: [], error: null })),
    list: vi.fn(async (): Promise<Result> => ({ data: [], error: null })),
    remove: vi.fn(async (): Promise<Result> => ({ data: [], error: null })),
  };
}

function useDatabase(respond: Responder) {
  queries = [];
  bucket = fakeBucket();
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
  const storage = { from: vi.fn(() => bucket) };
  vi.mocked(createClient).mockResolvedValue({ from, storage } as never);
}

const kind = (query: Query) => query.calls[0]?.[0];
const arg = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1];
const writes = () => queries.filter((query) => ["insert", "update", "delete"].includes(kind(query) ?? ""));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const counts = (templates: number, inspections: number) => ({
  templates: [{ count: templates }],
  inspections: [{ count: inspections }],
});

/** The client row readClient() reads. */
const clientRow = (logoPath: string | null, templates = 0, inspections = 0) => ({
  id: CLIENT,
  name: "Polyco Healthline",
  logo_path: logoPath,
  ...counts(templates, inspections),
});

/** Answers readClient() with `row` and every write with `write`; other selects (who else uses a logo) find nothing. */
function respondWith(row: unknown, write: Result = { data: { id: CLIENT }, error: null }): Responder {
  return (query) => {
    if (kind(query) !== "select") return write;
    return query.calls.some(([name]) => name === "neq") ? { data: [], error: null } : { data: row, error: null };
  };
}

/** A Storage listing entry, created `ageMinutes` ago. */
const stored = (name: string, ageMinutes = 0) => ({
  name,
  id: `id-${name}`,
  created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
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

describe("saveClient", () => {
  it("needs an active admin before it reads anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "This account has been deactivated." });
    const result = await saveClient(IDLE, form({ id: "", version: "", name: "Polyco", notes: "" }));
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "clients" });
    expect(result).toEqual({ status: "error", message: "This account has been deactivated." });
    expect(queries).toEqual([]);
  });

  it("needs a name", async () => {
    const result = await saveClient(IDLE, form({ id: "", version: "", name: "", notes: "" }));
    expect(result).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { name: "Enter the client's name." },
    });
  });

  it("adds a client and offers the logo next, with the version the open panel saves against", async () => {
    useDatabase(() => ({ data: { id: CLIENT, updated_at: VERSION }, error: null }));
    const result = await saveClient(IDLE, form({ id: "", version: "", name: " Polyco  Healthline ", notes: "" }));
    expect(arg(queries[0], "insert")?.[0]).toEqual({ name: "Polyco Healthline", notes: null });
    expect(arg(queries[0], "select")?.[0]).toBe("id, updated_at");
    expect(result).toEqual({
      status: "success",
      message: "Polyco Healthline added. You can add their logo now.",
      id: CLIENT,
      version: VERSION,
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("puts a duplicate name next to the name field", async () => {
    useDatabase(() => ({ data: null, error: { code: "23505", message: "duplicate key" } }));
    const result = (await saveClient(IDLE, form({ id: "", version: "", name: "Polyco", notes: "" }))) as Extract<
      SaveClientResult,
      { status: "error" }
    >;
    expect(result.fieldErrors).toEqual({ name: "There is already a client with this name." });
  });

  it("saves changes only to the version the form was opened on", async () => {
    useDatabase(() => ({ data: { id: CLIENT }, error: null }));
    const result = await saveClient(IDLE, form({ id: CLIENT, version: VERSION, name: "Polyco", notes: "Notes" }));
    expect(queries[0].calls).toContainEqual(["eq", ["updated_at", VERSION]]);
    // Never the logo: that has its own actions.
    expect(arg(queries[0], "update")?.[0]).toEqual({ name: "Polyco", notes: "Notes" });
    expect(result).toEqual({ status: "success", message: "Polyco saved.", id: CLIENT });
  });

  it("says when someone else saved first, and answers with their version for a second save to replace", async () => {
    const NEWER = "2026-10-06T11:02:13.512904+00:00";
    useDatabase(respondWith({ name: "Polyco Healthline", notes: null, updated_at: NEWER }, { data: null, error: null }));
    const result = await saveClient(IDLE, form({ id: CLIENT, version: VERSION, name: "Polyco", notes: "Mine" }));
    expect(result).toEqual({
      status: "error",
      message:
        "Someone else changed this client while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
      latest: { version: NEWER, values: { name: "Polyco Healthline", notes: "" } },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when the client was deleted meanwhile", async () => {
    useDatabase(respondWith(null, { data: null, error: null }));
    const result = await saveClient(IDLE, form({ id: CLIENT, version: VERSION, name: "Polyco", notes: "" }));
    expect(result).toEqual({ status: "error", message: "This client has been deleted, so your changes were not saved." });
  });
});

describe("deleteClient", () => {
  it("needs an active admin before it reads or deletes anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    const result = await deleteClient(IDLE, form({ id: CLIENT }));
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "clients" });
    expect(result).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(createClient).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("keeps a client that templates or inspections use, and says why", async () => {
    useDatabase(respondWith(clientRow(null, 0, 12)));
    const result = await deleteClient(IDLE, form({ id: CLIENT }));
    expect(writes()).toEqual([]);
    expect(result).toEqual({ status: "error", message: "Used by 12 inspections, so it cannot be deleted." });
  });

  it("deletes the client, then its logo files", async () => {
    useDatabase(respondWith(clientRow(OLD_LOGO), { data: [{ id: CLIENT }], error: null }));
    bucket.list.mockResolvedValueOnce({ data: [stored(`${OLD_FILE}.jpg`), stored(`${NEW_FILE}.png`)], error: null });

    const result = await deleteClient(IDLE, form({ id: CLIENT }));

    expect(writes().map((query) => [query.table, kind(query)])).toEqual([["clients", "delete"]]);
    expect(bucket.list).toHaveBeenCalledWith(CLIENT, expect.anything());
    expect(bucket.remove).toHaveBeenCalledExactlyOnceWith([OLD_LOGO, NEW_LOGO]);
    expect(result).toEqual({ status: "success", message: "Polyco Healthline deleted." });
  });

  it("leaves the logo alone when the database refuses the delete", async () => {
    useDatabase(respondWith(clientRow(OLD_LOGO), { data: null, error: { code: "23001", message: "restrict" } }));
    const result = await deleteClient(IDLE, form({ id: CLIENT }));
    expect(result).toEqual({
      status: "error",
      message: "Templates or inspections use this client, so it cannot be deleted.",
    });
    expect(bucket.remove).not.toHaveBeenCalled();
  });
});

describe("prepareLogoUpload", () => {
  it("needs an active admin before it signs anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    const result = await prepareLogoUpload({ clientId: CLIENT, type: "image/png", size: 1000 });
    expect(result).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    [{ clientId: CLIENT, type: "image/svg+xml", size: 1000 }, "Choose a PNG, JPEG or WebP image."],
    [{ clientId: CLIENT, type: "image/png", size: LOGO_MAX_BYTES + 1 }, "That image is 2.0 MB. Choose one up to 2 MB."],
    [{ clientId: "not-an-id", type: "image/png", size: 1000 }, MESSAGES.stale],
    [{ clientId: CLIENT, type: "image/png", size: "1000" }, MESSAGES.stale],
  ])("refuses %o", async (request, message) => {
    const result = await prepareLogoUpload(request as never);
    expect(result).toEqual({ status: "error", message });
    expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("names a new object in the client's folder and signs a one-time upload for it", async () => {
    useDatabase(respondWith(clientRow(null)));
    const result = await prepareLogoUpload({ clientId: CLIENT, type: "image/webp", size: 5000 });
    const path = bucket.createSignedUploadUrl.mock.calls[0][0];
    expect(path).toMatch(new RegExp(`^${CLIENT}/[0-9a-f-]{36}\\.webp$`));
    expect(result).toEqual({ status: "ready", path, token: "upload-token" });
  });

  it("stops when the client has been deleted", async () => {
    useDatabase(respondWith(null));
    const result = await prepareLogoUpload({ clientId: CLIENT, type: "image/png", size: 5000 });
    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/^This client has been deleted/) });
    expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("says so when Storage will not sign the upload", async () => {
    useDatabase(respondWith(clientRow(null)));
    bucket.createSignedUploadUrl.mockResolvedValueOnce({ data: null as never, error: { message: "denied" } });
    const result = await prepareLogoUpload({ clientId: CLIENT, type: "image/png", size: 5000 });
    expect(result).toEqual({ status: "error", message: "The upload could not start. Try again." });
  });
});

describe("confirmLogoUpload", () => {
  it("needs an active admin before it reads, points or removes anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    const result = await confirmLogoUpload({ clientId: CLIENT, path: NEW_LOGO });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "clients" });
    expect(result).toEqual({ status: "error", message: "You do not have permission to do that." });
    // Not even for a client that has gone, whose whole logo folder it would otherwise remove.
    expect(createClient).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("refuses an object outside the client's own folder", async () => {
    for (const path of [`${OTHER}/${NEW_FILE}.png`, `${CLIENT}/../${OTHER}/${NEW_FILE}.png`, `${CLIENT}/logo.png`]) {
      const result = await confirmLogoUpload({ clientId: CLIENT, path });
      expect(result, path).toEqual({ status: "error", message: MESSAGES.stale });
    }
    expect(queries).toEqual([]);
  });

  it("makes the upload the logo and removes the logo it replaces", async () => {
    useDatabase(respondWith(clientRow(OLD_LOGO)));
    bucket.list
      // logoFileExists: the upload is there
      .mockResolvedValueOnce({ data: [stored(`${NEW_FILE}.png`)], error: null })
      // removeUnusedLogos: the folder
      .mockResolvedValueOnce({ data: [stored(`${OLD_FILE}.jpg`, 600), stored(`${NEW_FILE}.png`)], error: null });

    const result = await confirmLogoUpload({ clientId: CLIENT, path: NEW_LOGO });

    const update = writes()[0];
    expect(arg(update, "update")?.[0]).toEqual({ logo_path: NEW_LOGO });
    expect(update.calls).toContainEqual(["eq", ["id", CLIENT]]);
    expect(bucket.remove).toHaveBeenCalledExactlyOnceWith([OLD_LOGO]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "success", message: "Logo replaced." });
  });

  it("calls a first logo added", async () => {
    useDatabase(respondWith(clientRow(null)));
    bucket.list.mockResolvedValueOnce({ data: [stored(`${NEW_FILE}.png`)], error: null });
    const result = await confirmLogoUpload({ clientId: CLIENT, path: NEW_LOGO });
    expect(result).toEqual({ status: "success", message: "Logo added." });
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("does not point the client at a file that never arrived", async () => {
    useDatabase(respondWith(clientRow(OLD_LOGO)));
    const result = await confirmLogoUpload({ clientId: CLIENT, path: NEW_LOGO });
    expect(result).toEqual({ status: "error", message: "The upload did not finish. Choose the image again." });
    expect(writes()).toEqual([]);
  });

  it("changes nothing when the same upload is confirmed twice", async () => {
    useDatabase(respondWith(clientRow(NEW_LOGO)));
    bucket.list.mockResolvedValueOnce({ data: [stored(`${NEW_FILE}.png`)], error: null });
    const result = await confirmLogoUpload({ clientId: CLIENT, path: NEW_LOGO });
    expect(result).toEqual({ status: "success", message: "Logo added." });
    expect(writes()).toEqual([]);
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("removes the upload when the client was deleted meanwhile", async () => {
    useDatabase(respondWith(null));
    bucket.list.mockResolvedValueOnce({ data: [stored(`${NEW_FILE}.png`)], error: null });
    const result = await confirmLogoUpload({ clientId: CLIENT, path: NEW_LOGO });
    expect(result).toEqual({ status: "error", message: "This client has been deleted, so the logo was not kept." });
    expect(bucket.remove).toHaveBeenCalledExactlyOnceWith([NEW_LOGO]);
  });
});

describe("removeClientLogo", () => {
  it("takes the logo off the client, then deletes its file", async () => {
    useDatabase(respondWith(clientRow(OLD_LOGO)));
    bucket.list.mockResolvedValueOnce({ data: [stored(`${OLD_FILE}.jpg`, 5)], error: null });

    const result = await removeClientLogo(IDLE, form({ id: CLIENT }));

    expect(arg(writes()[0], "update")?.[0]).toEqual({ logo_path: null });
    expect(bucket.remove).toHaveBeenCalledExactlyOnceWith([OLD_LOGO]);
    expect(result).toEqual({ status: "success", message: "Logo removed." });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("is done already when there is no logo", async () => {
    useDatabase(respondWith(clientRow(null)));
    const result = await removeClientLogo(IDLE, form({ id: CLIENT }));
    expect(result).toEqual({ status: "success", message: "The logo was already removed." });
    expect(writes()).toEqual([]);
  });

  it("needs an active admin", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    const result = await removeClientLogo(IDLE, form({ id: CLIENT }));
    expect(result).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(queries).toEqual([]);
  });
});
