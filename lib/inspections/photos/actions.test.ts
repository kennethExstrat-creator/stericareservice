import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { deleteInspectionFile, deletePhoto, setPhotoInReport, updatePhotoTags } from "./actions";
import { IDLE_PHOTO_ACTION, PHOTO_MESSAGES } from "./messages";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const FILE = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * what the test's responder returns; Storage and RPC calls are spies.
 * ------------------------------------------------------------------ */

type Answer = { data: unknown; error: { code?: string; message: string } | null; status?: number };
type Query = { table: string; calls: Array<[string, unknown[]]> };

let queries: Query[] = [];
let respond: (query: Query) => Answer;
const bucket = { remove: vi.fn() };
const storage = { from: vi.fn(() => bucket) };
const rpc = vi.fn();

function useDatabase(responder: (query: Query) => Answer) {
  queries = [];
  respond = responder;
  const from = (table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "delete", "eq"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => {
      query.calls.push(["maybeSingle", []]);
      const answer = respond(query);
      return Promise.resolve({ status: answer.error ? 400 : 200, ...answer });
    };
    return builder;
  };
  vi.mocked(createClient).mockResolvedValue({ from, storage, rpc } as never);
}

const arg = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const returnedPhoto = (patch: Record<string, unknown> = {}) => ({
  id: PHOTO,
  module_key: "visual",
  target: "size:M/defect:thin_spot",
  caption: "Near the cuff",
  include_in_report: false,
  ...patch,
});

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: "inspector-id", email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" },
  });
  bucket.remove.mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValue({ data: 1, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  useDatabase(() => ({ data: null, error: null }));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("updatePhotoTags", () => {
  it("checks the session before it reads anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    const result = await updatePhotoTags(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, moduleKey: "visual" }));
    expect(authorizeAction).toHaveBeenCalledWith();
    expect(result).toEqual({ status: "error", message: "Your session has ended. Sign in again." });
    expect(queries).toEqual([]);
  });

  it("names the fields that are wrong, without a query", async () => {
    const result = await updatePhotoTags(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, moduleKey: "visual", hand: "both" }));
    expect(result).toEqual({
      status: "error",
      message: PHOTO_MESSAGES.checkFields,
      fieldErrors: { hand: "Choose the right or the left hand." },
    });
    expect(queries).toEqual([]);
  });

  it("writes the module, the target string and the caption, and answers with the row", async () => {
    useDatabase(() => ({ data: returnedPhoto(), error: null }));
    const result = await updatePhotoTags(
      IDLE_PHOTO_ACTION,
      form({ photoId: PHOTO, moduleKey: "visual", size: "M", defect: "thin_spot", box: "12", caption: "Near the cuff" }),
    );
    const [query] = queries;
    expect(query.table).toBe("inspection_photos");
    // The box is not something visual records: it is left out of the target.
    expect(arg(query, "update")).toEqual([{ module_key: "visual", target: "size:M/defect:thin_spot", caption: "Near the cuff" }]);
    expect(arg(query, "eq")).toEqual(["id", PHOTO]);
    expect(result).toEqual({
      status: "success",
      message: PHOTO_MESSAGES.updated,
      photo: { id: PHOTO, moduleKey: "visual", target: "size:M/defect:thin_spot", caption: "Near the cuff", includeInReport: false },
    });
  });

  it("untags a photo: no module, no target", async () => {
    useDatabase(() => ({ data: returnedPhoto({ module_key: null, target: null, caption: null }), error: null }));
    await updatePhotoTags(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, moduleKey: "", size: "M", caption: "" }));
    expect(arg(queries[0], "update")).toEqual([{ module_key: null, target: null, caption: null }]);
  });

  it("reads no row back as gone, or no longer the user's to change (RLS hides it)", async () => {
    const result = await updatePhotoTags(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, moduleKey: "visual" }));
    expect(result).toEqual({ status: "error", message: PHOTO_MESSAGES.photoGone });
  });

  it("explains a refusal by the guards in words", async () => {
    useDatabase(() => ({ data: null, error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 }));
    expect(await updatePhotoTags(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, moduleKey: "visual" }))).toEqual({
      status: "error",
      message: PHOTO_MESSAGES.forbidden,
    });
    useDatabase(() => ({ data: null, error: { message: "JWT expired" }, status: 401 }));
    expect(await updatePhotoTags(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, moduleKey: "visual" }))).toEqual({
      status: "error",
      message: PHOTO_MESSAGES.signedOut,
    });
  });

  it("turns an unexpected failure into a message instead of an error page", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("cookies() was called outside a request"));
    expect(await updatePhotoTags(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, moduleKey: "visual" }))).toEqual({
      status: "error",
      message: PHOTO_MESSAGES.unexpected,
    });
  });
});

describe("deletePhoto", () => {
  const deletedRow = (thumb: string | null) => ({
    id: PHOTO,
    inspection_id: INSPECTION,
    module_key: "dimensions",
    target: "size:M",
    storage_path: `${INSPECTION}/${PHOTO}.jpg`,
    thumb_path: thumb,
  });

  it("deletes the row, then the photo and its thumbnail, and records it in the audit trail", async () => {
    useDatabase(() => ({ data: deletedRow(`${INSPECTION}/thumbs/${PHOTO}.jpg`), error: null }));
    const result = await deletePhoto(IDLE_PHOTO_ACTION, form({ photoId: PHOTO }));
    expect(arg(queries[0], "delete")).toEqual([]);
    expect(arg(queries[0], "eq")).toEqual(["id", PHOTO]);
    expect(storage.from).toHaveBeenCalledWith("inspection-photos");
    expect(bucket.remove).toHaveBeenCalledWith([`${INSPECTION}/${PHOTO}.jpg`, `${INSPECTION}/thumbs/${PHOTO}.jpg`]);
    expect(rpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: INSPECTION,
      action: "photo.deleted",
      changes: { photo_id: PHOTO, module_key: "dimensions", target: "size:M", storage_path: `${INSPECTION}/${PHOTO}.jpg` },
    });
    expect(result).toEqual({ status: "success", message: PHOTO_MESSAGES.deleted, removedId: PHOTO });
  });

  it("removes only the original of a flagged photo, which has no thumbnail", async () => {
    useDatabase(() => ({ data: deletedRow(null), error: null }));
    await deletePhoto(IDLE_PHOTO_ACTION, form({ photoId: PHOTO }));
    expect(bucket.remove).toHaveBeenCalledWith([`${INSPECTION}/${PHOTO}.jpg`]);
  });

  it("counts the photo deleted when Storage keeps the objects: no row points at them any more", async () => {
    useDatabase(() => ({ data: deletedRow(null), error: null }));
    bucket.remove.mockResolvedValue({ data: null, error: { message: "Storage unavailable" } });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not allowed" } });
    expect(await deletePhoto(IDLE_PHOTO_ACTION, form({ photoId: PHOTO }))).toMatchObject({ status: "success" });
  });

  it("touches nothing in Storage when the row was not the user's to delete", async () => {
    const result = await deletePhoto(IDLE_PHOTO_ACTION, form({ photoId: PHOTO }));
    expect(result).toEqual({ status: "error", message: PHOTO_MESSAGES.photoGone });
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a photo's before any query", async () => {
    expect(await deletePhoto(IDLE_PHOTO_ACTION, form({ photoId: "x" }))).toEqual({
      status: "error",
      message: "This photo could not be found.",
    });
    expect(queries).toEqual([]);
  });
});

describe("setPhotoInReport", () => {
  it("is for admins only", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    const result = await setPhotoInReport(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, include: "true" }));
    expect(authorizeAction).toHaveBeenCalledWith("admin");
    expect(result).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(queries).toEqual([]);
  });

  it("sets include_in_report and says where the photo goes", async () => {
    useDatabase(() => ({ data: returnedPhoto({ include_in_report: true }), error: null }));
    const added = await setPhotoInReport(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, include: "true" }));
    expect(arg(queries[0], "update")).toEqual([{ include_in_report: true }]);
    expect(added).toMatchObject({ status: "success", message: PHOTO_MESSAGES.inReport, photo: { includeInReport: true } });

    useDatabase(() => ({ data: returnedPhoto({ include_in_report: false }), error: null }));
    const removed = await setPhotoInReport(IDLE_PHOTO_ACTION, form({ photoId: PHOTO, include: "false" }));
    expect(arg(queries[0], "update")).toEqual([{ include_in_report: false }]);
    expect(removed).toMatchObject({ status: "success", message: PHOTO_MESSAGES.outOfReport });
  });
});

describe("deleteInspectionFile", () => {
  it("deletes the row, then the file, and records it", async () => {
    useDatabase(() => ({
      data: {
        id: FILE,
        inspection_id: INSPECTION,
        module_key: "tensile",
        kind: "lab_report",
        name: "Tensile report.pdf",
        storage_path: `${INSPECTION}/${FILE}.pdf`,
      },
      error: null,
    }));
    const result = await deleteInspectionFile(IDLE_PHOTO_ACTION, form({ fileId: FILE }));
    expect(queries[0].table).toBe("inspection_files");
    expect(storage.from).toHaveBeenCalledWith("inspection-files");
    expect(bucket.remove).toHaveBeenCalledWith([`${INSPECTION}/${FILE}.pdf`]);
    expect(rpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: INSPECTION,
      action: "file.deleted",
      changes: {
        file_id: FILE,
        module_key: "tensile",
        kind: "lab_report",
        name: "Tensile report.pdf",
        storage_path: `${INSPECTION}/${FILE}.pdf`,
      },
    });
    expect(result).toEqual({ status: "success", message: PHOTO_MESSAGES.fileDeleted, removedId: FILE });
  });

  it("answers a file that is gone in the file's words", async () => {
    expect(await deleteInspectionFile(IDLE_PHOTO_ACTION, form({ fileId: FILE }))).toEqual({
      status: "error",
      message: PHOTO_MESSAGES.fileGone,
    });
  });
});
