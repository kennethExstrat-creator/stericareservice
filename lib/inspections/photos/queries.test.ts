import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stdEgTemplate } from "@/lib/export/__fixtures__/std-eg";
import { loadFiles, loadInspectionMedia, loadPhotos, MEDIA_MESSAGES, signPaths } from "./queries";
import type { FileRow, PhotoRow } from "./view";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const FLAGGED = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const FILE = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";

/* ------------------------------------------------------------------ *
 * A fake browser or server client: tables answer from `tables`, the two
 * helpers from `rpcs`, and Storage signs every path it is asked for
 * unless the test says otherwise.
 * ------------------------------------------------------------------ */

type Answer = { data: unknown; error: { code?: string; message: string } | null };
type Query = { table: string; calls: Array<[string, unknown[]]> };

let queries: Query[];
let tables: Record<string, Answer>;
/** Steri-AI's descriptions: the photos read again for ai_description (migration 20261027200000). */
let described: Answer;
let rpcs: Record<string, Answer>;
let signing: ReturnType<typeof vi.fn>;

function fakeClient() {
  const from = (table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    const answer = () => {
      const columns = query.calls.find(([name]) => name === "select")?.[1][0];
      if (table === "inspection_photos" && typeof columns === "string" && columns.includes("ai_description")) return described;
      return tables[table] ?? { data: [], error: null };
    };
    builder.maybeSingle = () => Promise.resolve(answer());
    builder.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(answer()).then(resolve, reject);
    return builder;
  };
  const rpc = vi.fn((name: string) => Promise.resolve(rpcs[name] ?? { data: null, error: null }));
  const storage = { from: vi.fn(() => ({ createSignedUrls: signing })) };
  return { from, rpc, storage } as never;
}

function photoRow(id: string, patch: Partial<PhotoRow> = {}): PhotoRow {
  return {
    id,
    inspection_id: INSPECTION,
    module_key: "dimensions",
    target: "size:M",
    storage_path: `${INSPECTION}/${id}.jpg`,
    thumb_path: `${INSPECTION}/thumbs/${id}.jpg`,
    caption: null,
    taken_at: null,
    width: 2048,
    height: 1536,
    flagged: false,
    include_in_report: false,
    created_by: INSPECTOR,
    created_at: "2026-10-06T01:14:05.123456+00:00",
    ...patch,
  };
}

const fileRow: FileRow = {
  id: FILE,
  inspection_id: INSPECTION,
  module_key: "force_at_break",
  kind: "lab_report",
  storage_path: `${INSPECTION}/${FILE}.pdf`,
  name: "Force at break.pdf",
  created_by: INSPECTOR,
  created_at: "2026-10-06T01:15:00.000000+00:00",
};

const signedUrl = (bucket: string, path: string) => `https://storage.example/sign/${bucket}/${path}?token=t`;

beforeEach(() => {
  queries = [];
  tables = {
    inspections: {
      data: {
        id: INSPECTION,
        ref_no: "INS-2026-0042",
        status: "draft",
        inspector_id: INSPECTOR,
        module_overrides: {},
        template: { resolved: { not: "a template" } },
      },
      error: null,
    },
    inspection_photos: {
      data: [photoRow(PHOTO), photoRow(FLAGGED, { storage_path: `${INSPECTION}/${FLAGGED}.heic`, thumb_path: null, flagged: true })],
      error: null,
    },
    inspection_files: { data: [fileRow], error: null },
    defect_codes: { data: [{ code: "stain", name: "Stain" }], error: null },
  };
  described = { data: [], error: null };
  rpcs = { can_edit_inspection: { data: true, error: null }, is_admin: { data: false, error: null } };
  signing = vi.fn((paths: string[]) =>
    Promise.resolve({
      data: paths.map((path) => ({ path, signedUrl: signedUrl("b", path), error: null })),
      error: null,
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadInspectionMedia", () => {
  it("answers an id that is not a UUID as not found, without asking the database", async () => {
    expect(await loadInspectionMedia(fakeClient(), "../photos")).toEqual({ kind: "not_found" });
    expect(queries).toEqual([]);
  });

  it("answers an inspection RLS hides like one that does not exist", async () => {
    tables.inspections = { data: null, error: null };
    expect(await loadInspectionMedia(fakeClient(), INSPECTION)).toEqual({ kind: "not_found" });
  });

  it("reports a failed read in words", async () => {
    tables.inspections = { data: null, error: { message: "connection reset" } };
    expect(await loadInspectionMedia(fakeClient(), INSPECTION)).toEqual({ kind: "error", message: MEDIA_MESSAGES.loadFailed });
  });

  it("loads the photos and files with signed URLs, the user's rights and the tag options", async () => {
    const result = await loadInspectionMedia(fakeClient(), INSPECTION, { now: () => 1_000 });
    if (result.kind !== "ok") throw new Error(result.kind);
    const { media } = result;
    expect(media.inspection).toEqual({ id: INSPECTION, refNo: "INS-2026-0042", status: "draft", inspectorId: INSPECTOR });
    expect(media.access).toEqual({ canEdit: true, isAdmin: false });
    expect(media.signedAt).toBe(1_000);
    expect(media.problems).toEqual([]);
    expect(media.photos.map((photo) => [photo.id, photo.thumbUrl, photo.fullUrl])).toEqual([
      [PHOTO, signedUrl("b", `${INSPECTION}/thumbs/${PHOTO}.jpg`), signedUrl("b", `${INSPECTION}/${PHOTO}.jpg`)],
      // A flagged HEIC has no thumbnail and nothing a browser can show as one.
      [FLAGGED, null, signedUrl("b", `${INSPECTION}/${FLAGGED}.heic`)],
    ]);
    expect(media.files).toEqual([expect.objectContaining({ id: FILE, url: signedUrl("b", `${INSPECTION}/${FILE}.pdf`) })]);
    // The template did not parse: no modules or sizes, but the defect list stays.
    expect(media.options).toEqual({
      modules: [],
      sizes: [],
      defects: [{ code: "stain", name: "Stain" }],
      defectLabels: {},
      levels: {},
      items: {},
    });
  });

  it("names the modules as the inspection shows them: weight with no count of gloves, whatever the sampling plan holds", async () => {
    const order = { sizes: { M: { qtyCases: 100, lotNumbers: ["LOT-1"] } } };
    const plan = { sizes: { M: { glovesWeight: 12 } } };
    tables.inspections = {
      data: {
        ...(tables.inspections.data as object),
        template: { resolved: stdEgTemplate() },
        data: { modules: { order_lots: order, sampling_plan: plan }, custom: {} },
      },
      error: null,
    };
    const result = await loadInspectionMedia(fakeClient(), INSPECTION);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.media.options.modules.find((entry) => entry.key === "weight")?.title).toBe("Weight (g)");
  });

  // docs/AI.md, "Describing photos": read apart, so a project without the columns still shows its photos.
  it("brings Steri-AI's description with each photo, and none, quietly, on a project without descriptions", async () => {
    const pinhole = { text: "Pinhole, palm area", kind: "defect", defect: "hole_palm", location: "hole_palm", clarity: 0.9, check: "watertight" };
    described = {
      data: [
        { id: PHOTO, ai_description: pinhole, ai_described_at: "2026-10-27T02:00:00+00:00" },
        { id: FLAGGED, ai_description: { text: "" }, ai_described_at: "2026-10-27T02:00:00+00:00" },
      ],
      error: null,
    };
    const loaded = await loadInspectionMedia(fakeClient(), INSPECTION);
    if (loaded.kind !== "ok") throw new Error(loaded.kind);
    expect(loaded.media.photos.map((photo) => [photo.id, photo.description, photo.describedAt])).toEqual([
      [PHOTO, pinhole, "2026-10-27T02:00:00+00:00"],
      // Looked at, but nothing that reads as a description: Steri-AI could not tell.
      [FLAGGED, null, "2026-10-27T02:00:00+00:00"],
    ]);

    described = { data: null, error: { code: "42703", message: "column inspection_photos.ai_description does not exist" } };
    const older = await loadInspectionMedia(fakeClient(), INSPECTION);
    if (older.kind !== "ok") throw new Error(older.kind);
    expect(older.media.photos.map((photo) => [photo.id, photo.description, photo.describedAt])).toEqual([
      [PHOTO, null, null],
      [FLAGGED, null, null],
    ]);
    expect(older.media.problems).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reads oldest first, for this inspection only", async () => {
    await loadInspectionMedia(fakeClient(), INSPECTION);
    const photos = queries.find((query) => query.table === "inspection_photos");
    expect(photos?.calls.filter(([name]) => name !== "select")).toEqual([
      ["eq", ["inspection_id", INSPECTION]],
      ["order", ["created_at"]],
      ["order", ["id"]],
    ]);
  });

  it("signs the photos and the files in their own buckets, for an hour", async () => {
    const client = fakeClient() as unknown as { storage: { from: ReturnType<typeof vi.fn> } };
    await loadInspectionMedia(client as never, INSPECTION);
    expect(client.storage.from.mock.calls.map(([bucket]) => bucket).sort()).toEqual(["inspection-files", "inspection-photos"]);
    expect(signing).toHaveBeenCalledWith(
      [`${INSPECTION}/${PHOTO}.jpg`, `${INSPECTION}/thumbs/${PHOTO}.jpg`, `${INSPECTION}/${FLAGGED}.heic`],
      3600,
    );
  });

  // Roles and permissions (migration 20261027150000): choosing the report's photos is part of approving.
  it("lets an admin choose the report's photos only when their role approves and reopens", async () => {
    const client = fakeClient();
    const access = async () => {
      const result = await loadInspectionMedia(client, INSPECTION);
      if (result.kind !== "ok") throw new Error(result.kind);
      return result.media.access;
    };
    rpcs.is_admin = { data: true, error: null };
    rpcs.has_permission = { data: true, error: null };
    expect(await access()).toEqual({ canEdit: true, isAdmin: true });
    expect((client as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("has_permission", {
      permission: "approve_inspections",
    });
    rpcs.has_permission = { data: false, error: null };
    expect(await access()).toEqual({ canEdit: true, isAdmin: false });
    // The switch stored on a role that does not see every inspection does nothing.
    rpcs.is_admin = { data: false, error: null };
    rpcs.has_permission = { data: true, error: null };
    expect(await access()).toEqual({ canEdit: true, isAdmin: false });
  });

  it("shows the photos read-only when the rights cannot be checked", async () => {
    rpcs.can_edit_inspection = { data: null, error: { message: "timeout" } };
    const result = await loadInspectionMedia(fakeClient(), INSPECTION);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.media.access).toEqual({ canEdit: false, isAdmin: false });
    expect(result.media.problems).toEqual([MEDIA_MESSAGES.accessFailed]);
  });

  it("logs a request that never reached the server as a warning, any other failure as an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcs.can_edit_inspection = { data: null, error: { message: "TypeError: Failed to fetch" } };
    await loadInspectionMedia(fakeClient(), INSPECTION);
    expect(warn).toHaveBeenCalledWith("Inspection photos: loading access failed", expect.anything());
    expect(console.error).not.toHaveBeenCalled();

    rpcs.can_edit_inspection = { data: null, error: { code: "42501", message: "permission denied" } };
    await loadInspectionMedia(fakeClient(), INSPECTION);
    expect(console.error).toHaveBeenCalledWith("Inspection photos: loading access failed", expect.anything());
  });

  it("still shows the photos when the files or the signing fail", async () => {
    tables.inspection_files = { data: null, error: { message: "timeout" } };
    signing.mockResolvedValueOnce({ data: null, error: { message: "Storage unavailable" } });
    const result = await loadInspectionMedia(fakeClient(), INSPECTION);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.media.files).toEqual([]);
    expect(result.media.photos).toHaveLength(2);
    expect(result.media.problems).toEqual([MEDIA_MESSAGES.filesFailed, MEDIA_MESSAGES.signFailed]);
  });

  it("fails as a whole only when the photos cannot be read", async () => {
    tables.inspection_photos = { data: null, error: { message: "timeout" } };
    expect(await loadInspectionMedia(fakeClient(), INSPECTION)).toEqual({ kind: "error", message: MEDIA_MESSAGES.loadFailed });
  });
});

describe("signPaths", () => {
  it("signs in batches of 200", async () => {
    const paths = Array.from({ length: 450 }, (_, index) => `${INSPECTION}/${index}.jpg`);
    const signed = await signPaths(fakeClient(), "inspection-photos", paths, 60);
    expect(signing.mock.calls.map(([batch, ttl]) => [batch.length, ttl])).toEqual([
      [200, 60],
      [200, 60],
      [50, 60],
    ]);
    expect(signed.complete).toBe(true);
    expect(signed.urls.size).toBe(450);
  });

  it("is incomplete when one object cannot be signed, or the request throws", async () => {
    signing.mockResolvedValueOnce({
      data: [
        { path: "a/1.jpg", signedUrl: "https://ok", error: null },
        { path: "a/2.jpg", signedUrl: "", error: "Object not found" },
      ],
      error: null,
    });
    const partial = await signPaths(fakeClient(), "inspection-photos", ["a/1.jpg", "a/2.jpg"]);
    expect(partial).toEqual({ urls: new Map([["a/1.jpg", "https://ok"]]), complete: false });

    signing.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await signPaths(fakeClient(), "inspection-files", ["a/3.pdf"])).toEqual({ urls: new Map(), complete: false });
  });

  it("asks for nothing when there is nothing to sign", async () => {
    expect(await signPaths(fakeClient(), "inspection-photos", [])).toEqual({ urls: new Map(), complete: true });
    expect(signing).not.toHaveBeenCalled();
  });
});

describe("loadPhotos and loadFiles", () => {
  it("read rows by id with fresh URLs, leaving out ids that are not UUIDs", async () => {
    tables.inspection_photos = { data: [photoRow(PHOTO)], error: null };
    const result = await loadPhotos(fakeClient(), [PHOTO, "not-an-id"]);
    expect(queries[0].calls).toContainEqual(["in", ["id", [PHOTO]]]);
    expect(result).toEqual({
      ok: true,
      photos: [expect.objectContaining({ id: PHOTO, fullUrl: expect.stringContaining(PHOTO) })],
      complete: true,
    });

    const files = await loadFiles(fakeClient(), [FILE]);
    expect(files).toEqual({ ok: true, files: [expect.objectContaining({ id: FILE, url: expect.stringContaining(FILE) })], complete: true });
  });

  it("say when some URLs could not be signed, so the screen signs them again soon", async () => {
    tables.inspection_photos = { data: [photoRow(PHOTO)], error: null };
    signing.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    expect(await loadPhotos(fakeClient(), [PHOTO])).toEqual({
      ok: true,
      photos: [expect.objectContaining({ id: PHOTO, thumbUrl: null, fullUrl: null })],
      complete: false,
    });
  });

  it("do not query for nothing, and report a failed read", async () => {
    expect(await loadPhotos(fakeClient(), [])).toEqual({ ok: true, photos: [], complete: true });
    expect(await loadFiles(fakeClient(), ["x"])).toEqual({ ok: true, files: [], complete: true });
    expect(queries).toEqual([]);
    tables.inspection_files = { data: null, error: { message: "timeout" } };
    expect(await loadFiles(fakeClient(), [FILE])).toEqual({ ok: false });
  });
});
