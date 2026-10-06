import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createMemoryDatabase } from "@/lib/offline/kv";
import { OFFLINE_STORES } from "@/lib/offline/db";
import {
  createSupabaseUploadQueue,
  postgrestOutcome,
  sessionToken,
  storageOutcome,
  supabaseRepository,
  supabaseStorage,
} from "./supabase-adapters";
import type { PhotoRow, UploadRequest } from "./upload-queue";

const URL_BASE = "https://project.supabase.co/";
const PATH = "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10/9d3c1a52-7e8f-4a6b-b1c2-d3e4f5a6b7c8.jpg";

class FakeXhr {
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  sent = false;
  aborted = false;
  status = 0;
  responseText = "";
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    this.sent = true;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, body = "") {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

function storage({ token = "user-jwt" as string | null, stallTimeoutMs = 60_000, fetch }: { token?: string | null; stallTimeoutMs?: number; fetch?: typeof globalThis.fetch } = {}) {
  const requests: FakeXhr[] = [];
  const client = supabaseStorage({
    url: URL_BASE,
    apiKey: "sb_publishable_test",
    getAccessToken: async () => token,
    stallTimeoutMs,
    createRequest: () => {
      const xhr = new FakeXhr();
      requests.push(xhr);
      return xhr as unknown as XMLHttpRequest;
    },
    fetch,
  });
  return { client, requests };
}

function request(overrides: Partial<UploadRequest> = {}): UploadRequest {
  return {
    bucket: "inspection-photos",
    path: PATH,
    body: new Blob(["jpeg bytes"], { type: "image/jpeg" }),
    contentType: "image/jpeg",
    signal: new AbortController().signal,
    ...overrides,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe("supabaseStorage", () => {
  it("posts to the Storage API with the user's token, never overwriting, and reports progress", async () => {
    const { client, requests } = storage();
    const progress: number[][] = [];
    const body = new Blob(["jpeg bytes"], { type: "image/jpeg" });
    const pending = client.upload(request({ body, onProgress: (loaded, total) => progress.push([loaded, total]) }));
    await flush();

    const [xhr] = requests;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(`https://project.supabase.co/storage/v1/object/inspection-photos/${PATH}`);
    expect(xhr.headers).toEqual({
      authorization: "Bearer user-jwt",
      apikey: "sb_publishable_test",
      "content-type": "image/jpeg",
      "cache-control": "max-age=3600",
      "x-upsert": "false",
    });
    expect(xhr.body).toBe(body);
    xhr.upload.onprogress?.({ loaded: 5, total: 10, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 10, total: 0, lengthComputable: false });
    xhr.respond(200, '{"Key":"inspection-photos/x.jpg"}');
    expect(await pending).toEqual({ ok: true });
    expect(progress).toEqual([
      [5, 10],
      [10, body.size],
    ]);
  });

  it("asks for a sign-in without sending anything when there is no session", async () => {
    const { client, requests } = storage({ token: null });
    expect(await client.upload(request())).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(requests).toHaveLength(0);
  });

  it("reports a dropped connection, and a cancelled upload, as network failures", async () => {
    const { client, requests } = storage();
    const dropped = client.upload(request());
    await flush();
    requests[0].onerror?.();
    expect(await dropped).toMatchObject({ ok: false, reason: "network" });

    const controller = new AbortController();
    const cancelled = client.upload(request({ signal: controller.signal }));
    await flush();
    controller.abort();
    expect(await cancelled).toMatchObject({ ok: false, reason: "network", message: expect.stringMatching(/cancelled/) });
    expect(requests[1].aborted).toBe(true);

    const already = new AbortController();
    already.abort();
    expect(await client.upload(request({ signal: already.signal }))).toMatchObject({ ok: false, reason: "network" });
    expect(requests[2].sent).toBe(false);
  });

  it("abandons an upload that makes no progress for a minute", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { client, requests } = storage({ stallTimeoutMs: 60_000 });
    const pending = client.upload(request());
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    await vi.advanceTimersByTimeAsync(59_000);
    requests[0].upload.onprogress?.({ loaded: 1, total: 10, lengthComputable: true });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(requests[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests[0].aborted).toBe(true);
    expect(await pending).toMatchObject({ ok: false, reason: "network", message: expect.stringMatching(/stalled/) });
  });

  it("deletes objects with the user's token", async () => {
    const fetch = vi.fn(async () => new Response("[]", { status: 200 }));
    const { client } = storage({ fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await client.remove?.("inspection-photos", [PATH])).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("https://project.supabase.co/storage/v1/object/inspection-photos", {
      method: "DELETE",
      headers: { authorization: "Bearer user-jwt", apikey: "sb_publishable_test", "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [PATH] }),
    });

    const offline = storage({ fetch: (async () => Promise.reject(new TypeError("Load failed"))) as typeof globalThis.fetch });
    expect(await offline.client.remove?.("inspection-photos", [PATH])).toMatchObject({ ok: false, reason: "network" });
  });
});

describe("storageOutcome", () => {
  it("counts an object that already exists as uploaded, in old and new Storage versions", () => {
    expect(storageOutcome(409, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}')).toEqual({ ok: true });
    expect(storageOutcome(400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}')).toEqual({ ok: true });
  });

  it.each([
    [403, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}', "forbidden"],
    [400, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}', "forbidden"],
    [400, '{"statusCode":"400","error":"InvalidJWT","message":"\\"exp\\" claim timestamp check failed"}', "unauthorized"],
    [401, "", "unauthorized"],
    [413, '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}', "too_large"],
    [415, '{"statusCode":"415","error":"invalid_mime_type","message":"mime type image/gif is not supported"}', "invalid"],
    [404, '{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}', "not_found"],
    [502, "<html>Bad gateway</html>", "server"],
    [429, "", "server"],
  ])("reads HTTP %i %s as %s", (status, body, reason) => {
    expect(storageOutcome(status, body)).toMatchObject({ ok: false, reason });
  });

  it("keeps Storage's message, or explains in plain words", () => {
    expect(storageOutcome(413, '{"statusCode":"413","message":"The object exceeded the maximum allowed size"}')).toMatchObject({
      message: "The object exceeded the maximum allowed size",
    });
    expect(storageOutcome(500, "")).toMatchObject({ message: expect.stringMatching(/server/i) });
  });
});

describe("postgrestOutcome", () => {
  it.each([
    [{ code: "23505", message: "duplicate key value violates unique constraint" }, 409, { ok: true }],
    [{ code: "42501", message: "new row violates row-level security policy" }, 403, { ok: false, reason: "forbidden" }],
    [{ code: "23503", message: "violates foreign key constraint" }, 409, { ok: false, reason: "not_found" }],
    [{ code: "23514", message: "violates check constraint" }, 400, { ok: false, reason: "invalid" }],
    [{ code: "PGRST301", message: "JWT expired" }, 401, { ok: false, reason: "unauthorized" }],
    [{ code: "", message: "TypeError: Failed to fetch" }, 0, { ok: false, reason: "network" }],
    [{ code: "XX000", message: "internal error" }, 500, { ok: false, reason: "server" }],
  ])("reads %o (HTTP %i)", (error, status, expected) => {
    expect(postgrestOutcome({ error, status })).toMatchObject(expected);
  });

  it("is ok without an error", () => {
    expect(postgrestOutcome({ error: null, status: 201 })).toEqual({ ok: true });
  });
});

describe("supabaseRepository", () => {
  type Answer = { data?: unknown; error: { code?: string; message: string } | null; status: number };

  function fakeClient(answers: { insert?: Answer; update?: Answer }) {
    const calls: unknown[][] = [];
    const client = {
      from(table: string) {
        return {
          insert: async (row: unknown) => {
            calls.push(["insert", table, row]);
            return answers.insert ?? { error: null, status: 201 };
          },
          update(patch: unknown) {
            calls.push(["update", table, patch]);
            return {
              eq(column: string, value: string) {
                calls.push(["eq", column, value]);
                return {
                  select: async (columns: string) => {
                    calls.push(["select", columns]);
                    return answers.update ?? { data: [{ id: value }], error: null, status: 200 };
                  },
                };
              },
            };
          },
        };
      },
    };
    return { client: client as unknown as SupabaseClient<Database>, calls };
  }

  const row = { id: "9d3c1a52-7e8f-4a6b-b1c2-d3e4f5a6b7c8", inspection_id: "x" } as PhotoRow;

  it("inserts rows and counts a duplicate as done", async () => {
    const { client, calls } = fakeClient({ insert: { error: { code: "23505", message: "duplicate" }, status: 409 } });
    const repository = supabaseRepository(client);
    expect(await repository.insertPhoto(row)).toEqual({ ok: true });
    expect(await repository.insertFile({ ...row, kind: "lab_report", storage_path: "p", name: "n", module_key: null })).toEqual({
      ok: true,
    });
    expect(calls.map(([kind, table]) => `${kind} ${table}`)).toEqual(["insert inspection_photos", "insert inspection_files"]);
  });

  it("updates a retagged row, and reads no row back as not allowed", async () => {
    const patch = { module_key: "visual", target: "size:M", caption: null };
    const allowed = fakeClient({});
    expect(await supabaseRepository(allowed.client).updatePhoto(row.id, patch)).toEqual({ ok: true });
    expect(allowed.calls).toEqual([
      ["update", "inspection_photos", patch],
      ["eq", "id", row.id],
      ["select", "id"],
    ]);

    const hidden = fakeClient({ update: { data: [], error: null, status: 200 } });
    expect(await supabaseRepository(hidden.client).updatePhoto(row.id, patch)).toMatchObject({ ok: false, reason: "forbidden" });

    const offline = fakeClient({ update: { data: null, error: { message: "TypeError: Load failed" }, status: 0 } });
    expect(await supabaseRepository(offline.client).updatePhoto(row.id, patch)).toMatchObject({ ok: false, reason: "network" });
  });
});

describe("sessionToken", () => {
  it("reads the access token of the current session, or null when signed out", async () => {
    const client = (session: unknown) =>
      ({ auth: { getSession: async () => ({ data: { session }, error: null }) } }) as unknown as SupabaseClient<Database>;
    expect(await sessionToken(client({ access_token: "user-jwt" }))).toBe("user-jwt");
    expect(await sessionToken(client(null))).toBeNull();
  });
});

describe("createSupabaseUploadQueue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function waitFor(condition: () => boolean) {
    for (let round = 0; round < 100 && !condition(); round++) await flush();
    expect(condition()).toBe(true);
  }

  it("uploads through Storage with the session's token, then writes the row", async () => {
    const requests: FakeXhr[] = [];
    vi.stubGlobal(
      "XMLHttpRequest",
      class extends FakeXhr {
        constructor() {
          super();
          requests.push(this);
        }
      },
    );
    const inserts: unknown[][] = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: { access_token: "user-jwt" } }, error: null }) },
      from: (table: string) => ({
        insert: async (inserted: unknown) => {
          inserts.push([table, inserted]);
          return { error: null, status: 201 };
        },
      }),
    } as unknown as SupabaseClient<Database>;
    const queue = createSupabaseUploadQueue({
      client,
      env: { url: URL_BASE, publishableKey: "sb_publishable_test" },
      userId: "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b",
      db: createMemoryDatabase(OFFLINE_STORES),
    });
    await queue.start();
    const photoId = await queue.enqueuePhoto({
      inspectionId: "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10",
      photo: {
        blob: new Blob(["photo"], { type: "image/jpeg" }),
        thumbBlob: new Blob(["thumb"], { type: "image/jpeg" }),
        width: 2048,
        height: 1536,
        takenAt: "2024-07-12T02:15:30.123Z",
        flagged: false,
        mimeType: "image/jpeg",
      },
      tag: { moduleKey: "weight", target: { size: "M" } },
    });

    await waitFor(() => requests.length === 1);
    expect(requests[0].headers.authorization).toBe("Bearer user-jwt");
    expect(requests[0].url).toMatch(new RegExp(`/storage/v1/object/inspection-photos/.+/${photoId}\\.jpg$`));
    requests[0].respond(200);
    await waitFor(() => requests.length === 2);
    expect(requests[1].url).toMatch(new RegExp(`/thumbs/${photoId}\\.jpg$`));
    requests[1].respond(200);
    await waitFor(() => inserts.length === 1);
    expect(inserts[0]).toEqual(["inspection_photos", expect.objectContaining({ id: photoId, target: "size:M" })]);
    await waitFor(() => queue.isEmpty("4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10"));
    queue.stop();
  });
});
