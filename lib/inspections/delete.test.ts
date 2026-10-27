import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionStatus } from "@/lib/schemas/common";
import type { Database } from "@/lib/supabase/database.types";
import {
  canDeleteInspection,
  DELETE_MESSAGES,
  DeleteInspectionInputSchema,
  deleteDraftInspection,
  deleteFailureMessage,
  removeInspectionObjects,
  type DeletedInspection,
  type ObjectStore,
} from "./delete";

const ID = "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0001";
const OTHER_ID = "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0002";
const INSPECTOR = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const SOMEONE_ELSE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canDeleteInspection", () => {
  const STATUSES: InspectionStatus[] = ["draft", "submitted", "reopened", "approved"];

  it("lets the inspector delete their own draft, and nothing else of theirs", () => {
    const allowed = STATUSES.filter((status) =>
      canDeleteInspection({ status, inspectorId: INSPECTOR }, { id: INSPECTOR, role: "inspector" }),
    );
    expect(allowed).toEqual(["draft"]);
  });

  it("never lets an inspector delete someone else's draft", () => {
    expect(canDeleteInspection({ status: "draft", inspectorId: SOMEONE_ELSE }, { id: INSPECTOR, role: "inspector" })).toBe(
      false,
    );
  });

  it("lets an admin delete any inspector's draft, and no inspection past it", () => {
    for (const inspectorId of [INSPECTOR, SOMEONE_ELSE]) {
      const allowed = STATUSES.filter((status) =>
        canDeleteInspection({ status, inspectorId }, { id: SOMEONE_ELSE, role: "admin" }),
      );
      expect(allowed, inspectorId).toEqual(["draft"]);
    }
  });

  // Roles and permissions (migration 20261027150000): whose drafts stays with what the role sees.
  it("needs the role's Delete Drafts, for an admin too", () => {
    const draft = { status: "draft" as const, inspectorId: INSPECTOR };
    const off = { builtIn: null, access: "all" as const, permissions: ["create_inspections"], id: "r1", name: "Desk" };
    expect(canDeleteInspection(draft, { id: SOMEONE_ELSE, role: "admin", grant: off })).toBe(false);
    expect(canDeleteInspection(draft, { id: INSPECTOR, role: "inspector", grant: { ...off, access: "own" } })).toBe(false);
    const on = { ...off, permissions: ["delete_drafts"] };
    expect(canDeleteInspection(draft, { id: SOMEONE_ELSE, role: "admin", grant: on })).toBe(true);
    // The switch never reaches past what the role sees: someone else's draft stays theirs.
    expect(canDeleteInspection(draft, { id: SOMEONE_ELSE, role: "inspector", grant: { ...on, access: "own" } })).toBe(false);
  });
});

describe("DeleteInspectionInputSchema", () => {
  it("takes an inspection id and nothing that is not one", () => {
    expect(DeleteInspectionInputSchema.parse({ inspectionId: ID })).toEqual({ inspectionId: ID });
    for (const input of [{}, { inspectionId: "INS-2026-0001" }, { inspectionId: `${ID}/..` }, null, ID]) {
      expect(DeleteInspectionInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });
});

/** A client whose rpc() answers like supabase-js. */
function rpcClient(answer: { data?: unknown; error?: { code?: string; message: string } | null; status?: number }) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, status: 200, ...answer });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("deleteDraftInspection", () => {
  it("asks the database function, as the caller, with the id only", async () => {
    const { client, rpc } = rpcClient({
      data: { inspection_id: ID, ref_no: "INS-2026-0001", photo_paths: [`${ID}/a.jpg`], file_paths: [`${ID}/b.pdf`] },
    });

    const outcome = await deleteDraftInspection(client, ID);

    expect(rpc).toHaveBeenCalledWith("delete_draft_inspection", { inspection_id: ID });
    expect(outcome).toEqual({
      kind: "deleted",
      inspection: { inspectionId: ID, refNo: "INS-2026-0001", photoPaths: [`${ID}/a.jpg`], filePaths: [`${ID}/b.pdf`] },
    });
  });

  it("reads null as gone: missing, or another inspector's", async () => {
    expect(await deleteDraftInspection(rpcClient({ data: null }).client, ID)).toEqual({ kind: "gone" });
  });

  it.each([
    [{ code: "23514", message: "only a draft that was never submitted can be deleted" }, 400, { kind: "not_draft" }],
    [{ code: "42501", message: "the account is not active" }, 403, { kind: "not_allowed" }],
    [{ code: "42501", message: "your role cannot delete drafts" }, 403, { kind: "role_refused" }],
    [{ code: "PGRST202", message: "Could not find the function" }, 404, { kind: "unavailable" }],
    [{ message: "fetch failed" }, 0, { kind: "failed", reason: "network" }],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, 500, { kind: "failed", reason: "server" }],
  ])("turns %j (HTTP %i) into %j", async (error, status, expected) => {
    expect(await deleteDraftInspection(rpcClient({ error, status }).client, ID)).toEqual(expected);
  });

  it("logs refusals it did not expect, not the rule's own", async () => {
    await deleteDraftInspection(rpcClient({ error: { code: "23514", message: "x" }, status: 400 }).client, ID);
    expect(console.error).not.toHaveBeenCalled();
    await deleteDraftInspection(rpcClient({ error: { code: "PGRST202", message: "missing" }, status: 404 }).client, ID);
    expect(console.error).toHaveBeenCalledWith("[inspections] delete refused", expect.objectContaining({ code: "PGRST202" }));
  });

  it("still counts an answer in an unexpected shape as deleted, and names the folder from the request", async () => {
    const outcome = await deleteDraftInspection(rpcClient({ data: { deleted: true } }).client, ID.toUpperCase());
    expect(outcome).toEqual({
      kind: "deleted",
      inspection: { inspectionId: ID, refNo: null, photoPaths: [], filePaths: [] },
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("deleteFailureMessage", () => {
  it("says in plain words why nothing was deleted", () => {
    expect(deleteFailureMessage({ kind: "gone" })).toBe(DELETE_MESSAGES.gone);
    expect(deleteFailureMessage({ kind: "not_draft" })).toBe(DELETE_MESSAGES.notDraft);
    expect(deleteFailureMessage({ kind: "not_allowed" })).toBe(DELETE_MESSAGES.notAllowed);
    expect(deleteFailureMessage({ kind: "role_refused" })).toBe("Your role does not allow deleting drafts. Ask an admin to check it.");
    expect(deleteFailureMessage({ kind: "unavailable" })).toBe(DELETE_MESSAGES.unavailable);
    expect(deleteFailureMessage({ kind: "failed", reason: "network" })).toBe(DELETE_MESSAGES.network);
    expect(deleteFailureMessage({ kind: "failed", reason: "server" })).toBe(DELETE_MESSAGES.failed);
  });
});

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

type Entry = { name: string; id: string | null };

/**
 * An in-memory Storage: each bucket holds object names; list() answers one
 * level of a folder (subfolders without an id), in pages; remove() deletes.
 */
function fakeStore(objects: Record<string, string[]>, faults: { list?: string; remove?: string } = {}) {
  const buckets = new Map(Object.entries(objects).map(([bucket, names]) => [bucket, new Set(names)]));
  const calls: { bucket: string; method: "list" | "remove"; arg: unknown }[] = [];
  const store: ObjectStore = {
    from(bucket) {
      const names = buckets.get(bucket) ?? new Set<string>();
      return {
        async list(path, { limit, offset }) {
          calls.push({ bucket, method: "list", arg: { path, offset } });
          if (faults.list === bucket) return { data: null, error: { message: "list failed" } };
          const level = new Map<string, Entry>();
          for (const name of names) {
            if (!name.startsWith(`${path}/`)) continue;
            const [first, ...rest] = name.slice(path.length + 1).split("/");
            level.set(first, { name: first, id: rest.length > 0 ? null : `id-${first}` });
          }
          const sorted = [...level.values()].sort((a, b) => a.name.localeCompare(b.name));
          return { data: sorted.slice(offset, offset + limit), error: null };
        },
        async remove(paths) {
          calls.push({ bucket, method: "remove", arg: paths });
          if (faults.remove === bucket) return { data: null, error: { message: "remove failed" } };
          for (const path of paths) names.delete(path);
          return { data: [], error: null };
        },
      };
    },
  };
  return { store, calls, left: (bucket: string) => [...(buckets.get(bucket) ?? [])].sort() };
}

const DELETED: DeletedInspection = {
  inspectionId: ID,
  refNo: "INS-2026-0001",
  photoPaths: [`${ID}/p1.jpg`, `${ID}/thumbs/p1.jpg`],
  filePaths: [`${ID}/f1.pdf`],
};

describe("removeInspectionObjects", () => {
  it("removes the rows' objects and anything else in the inspection's folders, thumbnails included", async () => {
    const { store, left } = fakeStore({
      "inspection-photos": [`${ID}/p1.jpg`, `${ID}/thumbs/p1.jpg`, `${ID}/orphan.jpg`, `${ID}/thumbs/orphan.jpg`, `${OTHER_ID}/p9.jpg`],
      "inspection-files": [`${ID}/f1.pdf`, `${OTHER_ID}/f9.pdf`],
    });

    const report = await removeInspectionObjects(store, DELETED);

    expect(report).toEqual({ removed: 5, problems: [] });
    expect(left("inspection-photos")).toEqual([`${OTHER_ID}/p9.jpg`]);
    expect(left("inspection-files")).toEqual([`${OTHER_ID}/f9.pdf`]);
  });

  it("never touches a name outside the inspection's folder, whatever it is handed", async () => {
    const { store, left } = fakeStore({ "inspection-photos": [`${OTHER_ID}/p9.jpg`], "inspection-files": [] });

    await removeInspectionObjects(store, {
      ...DELETED,
      photoPaths: [`${OTHER_ID}/p9.jpg`, `${ID}/../${OTHER_ID}/p9.jpg`],
      filePaths: [],
    });

    expect(left("inspection-photos")).toEqual([`${OTHER_ID}/p9.jpg`]);
  });

  it("reads a long folder page by page and removes in batches of 100", async () => {
    const many = Array.from({ length: 1234 }, (_, n) => `${ID}/${String(n).padStart(4, "0")}.jpg`);
    const { store, calls, left } = fakeStore({ "inspection-photos": many, "inspection-files": [] });

    const report = await removeInspectionObjects(store, { ...DELETED, photoPaths: [], filePaths: [] });

    expect(report).toEqual({ removed: 1234, problems: [] });
    expect(left("inspection-photos")).toEqual([]);
    const photoCalls = calls.filter((call) => call.bucket === "inspection-photos");
    expect(photoCalls.filter((call) => call.method === "list").map((call) => call.arg)).toEqual([
      { path: ID, offset: 0 },
      { path: ID, offset: 1000 },
    ]);
    const batches = photoCalls.filter((call) => call.method === "remove").map((call) => (call.arg as string[]).length);
    expect(batches).toEqual([...Array(12).fill(100), 34]);
  });

  it("still removes the objects the rows named when the folder cannot be listed", async () => {
    const { store, left } = fakeStore(
      { "inspection-photos": [`${ID}/p1.jpg`, `${ID}/thumbs/p1.jpg`, `${ID}/orphan.jpg`], "inspection-files": [`${ID}/f1.pdf`] },
      { list: "inspection-photos" },
    );

    const report = await removeInspectionObjects(store, DELETED);

    expect(report.removed).toBe(3);
    expect(report.problems).toEqual([{ bucket: "inspection-photos", step: "list", message: "list failed" }]);
    expect(left("inspection-photos")).toEqual([`${ID}/orphan.jpg`]);
  });

  it("reports what it could not remove and goes on with the other bucket", async () => {
    const { store, left } = fakeStore(
      { "inspection-photos": [`${ID}/p1.jpg`], "inspection-files": [`${ID}/f1.pdf`] },
      { remove: "inspection-photos" },
    );

    const report = await removeInspectionObjects(store, DELETED);

    expect(report.problems).toEqual([
      { bucket: "inspection-photos", step: "remove", objects: 2, message: "remove failed" },
    ]);
    expect(report.removed).toBe(1);
    expect(left("inspection-files")).toEqual([]);
  });
});
